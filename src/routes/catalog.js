'use strict';
const { publicVariantSql } = require('../variant-visibility');
const brandLogos = require('../brand-logos');
const brandList = require('../brand-list');
const shopTime = require('../shop-time');

async function handle(ctx) {
  const {
    method, pathname, parsed, req, reqIP, db,
    parseBody, rateLimit, RL,
    parseProduct, attachVariants, attachCampaign,
    campaignPercentFor, activeCampaigns, listNotes, normalizeFa,
    getCustomer, getCustomerToken, otp, taste, essences, analytics, res
  } = ctx;

  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  if (method === 'GET' && pathname === '/api/products') {
    const q = (parsed.query.q || '').trim();
    const family = parsed.query.family || '';
    const gender = parsed.query.gender || '';
    const brand = parsed.query.brand || '';

    const noteRaw = parsed.query.note || '';
    const notes = String(noteRaw).split(',')
      .map(s => normalizeFa(s.trim())).filter(Boolean).slice(0, 4);
    const page = Math.max(1, parseInt(parsed.query.page) || 1);
    const limit = Math.min(60, Math.max(1, parseInt(parsed.query.limit) || 24));

    const where = [];
    const args = {};
    if (q) {

      const words = normalizeFa(q).split(/\s+/).filter(Boolean).slice(0, 5);
      words.forEach((w, i) => {
        where.push(`search_blob LIKE @w${i}`);
        args[`w${i}`] = `%${w}%`;
      });
    }

    notes.forEach((n, i) => {
      where.push(`EXISTS (SELECT 1 FROM product_notes pn
                   WHERE pn.product_id = products.id AND pn.note_key = @note${i})`);
      args[`note${i}`] = n;
    });
    if (family) { where.push('family_slug = @family'); args.family = family; }
    if (gender) { where.push('gender = @gender'); args.gender = gender.toUpperCase(); }
    if (brand)  { where.push('(brand_fa = @brand OR brand_en = @brand)'); args.brand = brand; }

    if (parsed.query.in_stock === '1') {
      where.push(`products.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS (SELECT 1 FROM variants v
                    WHERE v.product_id = products.id AND ${publicVariantSql('v')} AND v.stock > 0 AND v.price_toman>0)`);
    }

    const samplesOnly = parsed.query.sample_5 === '1';
    if (samplesOnly) {
      where.push(`products.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS (
        SELECT 1 FROM variants sv WHERE sv.product_id=products.id AND sv.type='SAMPLE'
        AND sv.volume_ml=5 AND sv.price_toman>0
        AND (sv.stock>0 OR products.supply_mode='MADE_TO_ORDER'))`);
    }

    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const CHEAPEST = `(SELECT MIN(price_toman) FROM variants v WHERE v.product_id = products.id AND ${publicVariantSql('v')})`;

    const IN_STOCK = `(products.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS
      (SELECT 1 FROM variants v2 WHERE v2.product_id = products.id AND ${publicVariantSql('v2')} AND (v2.stock > 0 OR products.supply_mode='MADE_TO_ORDER') AND v2.price_toman>0)) DESC`;
    const SAMPLE_PRICE = `(SELECT MIN(sv.price_toman) FROM variants sv WHERE sv.product_id=products.id
      AND sv.type='SAMPLE' AND sv.volume_ml=5 AND sv.price_toman>0
      AND (sv.stock>0 OR products.supply_mode='MADE_TO_ORDER'))`;
    const SORTS = {
      sample_price_asc: samplesOnly ? `${SAMPLE_PRICE} ASC, id` : 'id',
      default:    'id',
      price_asc:  `${CHEAPEST} ASC, id`,
      price_desc: `${CHEAPEST} DESC, id`,
      name:       'name_fa COLLATE NOCASE, id',
      brand:      'brand_fa COLLATE NOCASE, name_fa COLLATE NOCASE'
    };
    const orderBy = samplesOnly && parsed.query.sort === 'sample_price_asc'
      ? SORTS.sample_price_asc : `${IN_STOCK}, ${SORTS[parsed.query.sort] || SORTS.default}`;

    let relevance = '0';
    if (q) {
      const nq = normalizeFa(q);
      args.rel = `${nq}%`;
      args.relAny = `%${nq}%`;
      relevance = `(CASE WHEN name_fa LIKE @rel THEN 30
                         WHEN name_fa LIKE @relAny THEN 20
                         WHEN brand_fa LIKE @relAny THEN 10
                         ELSE 0 END)`;
    }
    const finalOrder = q ? `${IN_STOCK}, ${relevance} DESC, ${SORTS[parsed.query.sort] || SORTS.default}`
                         : orderBy;

    let total = db.prepare(`SELECT COUNT(*) c FROM products ${clause}`).get(args).c;
    let rows = db.prepare(
      `SELECT * FROM products ${clause} ORDER BY ${finalOrder} LIMIT @limit OFFSET @offset`
    ).all({ ...args, limit, offset: (page - 1) * limit });

    let relaxed = false;
    const qWords = q ? normalizeFa(q).split(/\s+/).filter(Boolean).slice(0, 5) : [];
    if (total === 0 && qWords.length > 1) {
      const orParts = qWords.map((_, i) => `search_blob LIKE @w${i}`);
      const score = qWords
        .map((_, i) => `(CASE WHEN search_blob LIKE @w${i} THEN 1 ELSE 0 END)`)
        .join(' + ');

      const others = where.filter(w => !w.startsWith('search_blob'));
      const rxClause = 'WHERE (' + orParts.join(' OR ') + ')' +
                       (others.length ? ' AND ' + others.join(' AND ') : '');

      total = db.prepare(`SELECT COUNT(*) c FROM products ${rxClause}`).get(args).c;
      if (total > 0) {
        relaxed = true;
        rows = db.prepare(
          `SELECT * FROM products ${rxClause}
           ORDER BY ${IN_STOCK}, (${score}) DESC, ${SORTS[parsed.query.sort] || SORTS.default} LIMIT @limit OFFSET @offset`
        ).all({ ...args, limit, offset: (page - 1) * limit });
      }
    }

    const wantFull = parsed.query.full === '1';

    const camps = activeCampaigns();

    const products = rows.map(r => {
      const p = attachVariants(parseProduct(r));

      const pct = camps.length ? campaignPercentFor(p, camps) : 0;
      if (samplesOnly) {
        const samplePrices = p.variants.filter(v => v.type === 'SAMPLE' && v.volume_ml === 5 && v.price_toman > 0 &&
          (v.stock > 0 || p.supply_mode === 'MADE_TO_ORDER')).map(v => v.price_toman);
        p.sample_price = samplePrices.length ? Math.min(...samplePrices) : null;
      }
      if (wantFull) { p.campaign_percent = pct; return p; }

      const inStock = ['IN_STOCK','MADE_TO_ORDER'].includes(p.supply_mode) && p.variants.some(v => v.stock > 0 && v.price_toman > 0);
      return {
        id: p.id, slug: p.slug,
        name_fa: p.name_fa, name_en: p.name_en,
        brand_fa: p.brand_fa, brand_en: p.brand_en,
        gender: p.gender, family_fa: p.family_fa, family_slug: p.family_slug,
        season: p.season, image_url: p.image_url,
        notes: { top: p.notes.top.slice(0, 3) },
        min_price: p.min_price,
        ...(samplesOnly ? { sample_price: p.sample_price } : {}),
        campaign_percent: pct,
        in_stock: inStock,

        supply_mode: p.supply_mode || 'UNAVAILABLE',
        variant_count: p.variants.length
      };
    });

    if (q && page === 1) {
      analytics.track('search', q.slice(0, 60), { results: total, relaxed }, req);
    }

    return sendJSON(200, {
      total, page, limit,
      totalPages: Math.ceil(total / limit),

      relaxed,
      products
    });
  }

  if (method === 'GET' && pathname.startsWith('/api/products/')) {
    const key = pathname.replace('/api/products/', '');
    const row = db.prepare('SELECT * FROM products WHERE id = ? OR slug = ?').get(key, key);
    if (!row) return sendJSON(404, { error: 'محصول یافت نشد' });

    analytics.track('view', row.id, null, req);

    return sendJSON(200, attachCampaign(attachVariants(parseProduct(row))));
  }

  if (method === 'GET' && pathname === '/api/stats') {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return sendJSON(200, ctx.storeStats());
  }

  if (method === 'GET' && pathname === '/api/showcase') {
    const best   = analytics.getTrending('bestsellers');
    const wanted = analytics.getTrending('most_wanted');
    const hot    = analytics.getTrending('trending');
    const season = analytics.getTrending('seasonal');

    const scamps = activeCampaigns();

    const liveCard = db.prepare(`SELECT p.supply_mode,
      (SELECT MIN(v.price_toman) FROM variants v WHERE v.product_id=p.id AND ${publicVariantSql('v')} AND v.price_toman>0) AS min_price,
      EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND ${publicVariantSql('v')} AND v.stock>0 AND v.price_toman>0) AS in_stock
      FROM products p WHERE p.id=?`);
    const withPct = arr => (arr || []).map(x => {
      const live = liveCard.get(x.id);
      if (!live) return null;
      return { ...x, supply_mode: live.supply_mode, min_price: live.min_price || 0,
        campaign_percent: scamps.length ? campaignPercentFor(x, scamps) : 0,
        in_stock: ['IN_STOCK','MADE_TO_ORDER'].includes(live.supply_mode) && !!live.in_stock };
    }).filter(Boolean);

    return sendJSON(200, {
      bestsellers: withPct(best.items),

      bestsellers_fallback: !!best.fallback,
      most_wanted: withPct(wanted.items),
      trending: withPct(hot.items),

      seasonal: withPct(season.items),
      season_fa: season.season_fa || null
    });
  }

  if (method === 'GET' && pathname === '/api/brands') {

    const rows = brandList.listBrands(db);
    const brands = brandLogos.attach(rows);
    return sendJSON(200, { total: brands.length, brands });
  }

  if (method === 'GET' && pathname === '/api/families') {
    const rows = db.prepare(`
      SELECT family_slug, family_fa, COUNT(*) AS count
      FROM products WHERE family_slug IS NOT NULL
      GROUP BY family_slug ORDER BY count DESC
    `).all();
    return sendJSON(200, { families: rows });
  }

  if (method === 'GET' && pathname === '/api/notes') {
    const pos = ['top', 'middle', 'base', 'accord']
      .includes(parsed.query.position) ? parsed.query.position : null;
    const min = Math.min(200, Math.max(1, parseInt(parsed.query.min) || 12));
    const limit = Math.min(200, Math.max(1, parseInt(parsed.query.limit) || 60));
    return sendJSON(200, {
      notes: listNotes({ position: pos, minCount: min, limit }),
      position: pos
    });
  }

  if (method === 'GET' && pathname === '/api/essences') {
    return sendJSON(200, {
      total: essences.all().length,
      featured: essences.featured(),
      houses: essences.all(),
      short_notice: essences.SHORT_NOTICE,
      full_notice: essences.FULL_NOTICE
    });
  }

  if (method === 'POST' && pathname === '/api/quiz') {
    const { answers = {} } = await parseBody(req);
    const rec = taste.recommend(answers, 6);

    let saved = false;
    try {
      const mobile = otp.mobileFromToken(getCustomerToken(req));
      if (mobile) {

        const cid = taste.resolveCustomerId(mobile);
        if (cid) saved = taste.saveProfile(cid, answers);
      }
    } catch {  }

    const totalProducts = db.prepare('SELECT COUNT(*) c FROM products').get().c;
    return sendJSON(200, {
      total: rec.items.length,
      results: rec.items,
      total_products: totalProducts,
      profile: rec.profile,
      profile_saved: saved,
      budget_relaxed: rec.relaxed
    });
  }

  if (method === 'POST' && pathname === '/api/taste/suggest') {

    const srl = rateLimit(`taste:${reqIP}`, RL.taste.limit,
                          RL.taste.window, RL.taste.block);
    if (!srl.ok) return sendJSON(200, { items: [], throttled: true });

    const body = await parseBody(req);
    let answers = body.answers;
    let source = 'guest';

    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (mobile) {
      const cust = getCustomer(mobile);
      const saved = cust ? taste.getProfile(cust.id) : null;

      if (saved && !taste.isMeaningful(taste.sanitize(answers))) {
        answers = saved.answers;
        source = 'account';
      } else if (saved) {
        source = 'account';
      }
    }

    const rec = taste.recommend(answers, 8, { requireProfile: true });
    if (!rec.items.length) {
      return sendJSON(200, { items: [], profile: rec.profile, source });
    }

    const camps = activeCampaigns();
    return sendJSON(200, {
      items: rec.items.map(x => ({
        ...x,
        campaign_percent: camps.length ? campaignPercentFor(x, camps) : 0
      })),
      profile: rec.profile,
      summary: taste.describe(rec.profile),
      budget_relaxed: rec.relaxed,
      source
    });
  }

  if (method === 'GET' && pathname === '/api/taste/profile') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(200, { authenticated: false, profile: null });

    const cust = getCustomer(mobile);
    const prof = cust ? taste.getProfile(cust.id) : null;
    return sendJSON(200, {
      authenticated: true,
      profile: prof ? prof.answers : null,
      summary: prof ? taste.describe(prof.answers) : [],
      updated_at: prof ? prof.updated_at : null
    });
  }

  if (method === 'DELETE' && pathname === '/api/taste/profile') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(401, { error: 'ابتدا وارد شوید.' });

    const cust = getCustomer(mobile);
    if (cust) taste.clearProfile(cust.id);
    return sendJSON(200, { message: 'پروفایل بویایی پاک شد.' });
  }

  if (method === 'GET' && pathname === '/api/campaigns') {
    const list = activeCampaigns().map(c => ({
      id: c.id, title: c.title, percent: c.percent,
      ends_at: c.ends_at
    }));
    return sendJSON(200, { campaigns: list });
  }

  if (method === 'GET' && pathname === '/api/coupons/public') {
    const code = String(parsed.query.code || '').toUpperCase().trim();
    if (!code) return sendJSON(400, { error: 'کد مشخص نشده' });

    const c = db.prepare('SELECT * FROM coupons WHERE UPPER(code)=?').get(code);
    if (!c || !c.active) return sendJSON(404, { error: 'کد فعال نیست' });

    const today=shopTime.dateKey();
    if(c.starts_at && (!shopTime.validDateKey(c.starts_at) || today<c.starts_at))
      return sendJSON(404,{error:'کد فعال نیست'});
    if(c.expires_at && (!shopTime.validDateKey(c.expires_at) || today>c.expires_at))
      return sendJSON(404,{error:'کد منقضی شده'});
    if (c.usage_limit != null && c.used_count >= c.usage_limit) {
      return sendJSON(404, { error: 'ظرفیت کد تکمیل شده' });
    }

    return sendJSON(200, {
      code: c.code,
      type: c.type,
      value: c.value,
      min_subtotal: c.min_subtotal,
      max_discount: c.max_discount,
      description: c.description,
      per_user_once: !!c.per_user_once,
      remaining: c.usage_limit == null ? null : c.usage_limit - c.used_count
    });
  }
  return false;
}

module.exports = { handle };
