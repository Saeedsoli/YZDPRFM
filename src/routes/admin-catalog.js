'use strict';
const { RATE_KEY, rateString, previewExchangeRate, updateExchangeRate } = require('../essence-pricing-store');
const { gramToKg, productPriceState, previewProductPrice, applyProductPrice } = require('../product-essence-pricing');
const { publicVariantSql } = require('../variant-visibility');
const essenceInventory = require('../essence-inventory');

async function handle(ctx) {
  const {
    method, pathname, parsed, req,
    can, parseBody, logAudit, appLog, db,
    who, parseProduct, attachVariants, notifyStockWatchers, normalizeFa,
    releaseStaleOrders, buildSearchIndex, buildNotesIndex
  , bustStatsCache} = ctx;

  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  if (pathname === '/api/admin/essence-pricing/rate' && method === 'GET') {
    if (!can('settings.view') || !can('products.price')) return true;
    const rate = db.prepare('SELECT value FROM settings WHERE key=?').get(RATE_KEY);
    return sendJSON(200, { rate_toman: Number(rate.value) });
  }
  if (pathname === '/api/admin/essence-pricing/preview' && method === 'POST') {
    if (!can('settings.edit') || !can('products.price')) return true;
    const body = await parseBody(req);
    try { rateString(body.rate_toman); }
    catch { return sendJSON(400, { error: 'نرخ دلار باید عدد صحیح مثبت به تومان باشد.' }); }
    try { return sendJSON(200, previewExchangeRate(db, body.rate_toman)); }
    catch (error) {
      appLog('ERROR', 'pricing', 'خطا در پیش‌نمایش نرخ ارز', { error: error.message });
      return sendJSON(500, { error: 'پیش‌نمایش قیمت‌ها ممکن نیست؛ داده‌های قیمت‌گذاری نیاز به بررسی دارند.' });
    }
  }
  if (pathname === '/api/admin/essence-pricing/rate' && method === 'PUT') {
    if (!can('settings.edit') || !can('products.price')) return true;
    const body = await parseBody(req);
    try { rateString(body.rate_toman); rateString(body.expected_rate_toman); }
    catch { return sendJSON(400, { error: 'نرخ جدید و نرخ مشاهده‌شده باید عدد صحیح مثبت به تومان باشند.' }); }
    let result;
    try { result = updateExchangeRate(db, body.rate_toman, body.expected_rate_toman); }
    catch (error) {
      if (error.code === 'RATE_CONFLICT') return sendJSON(409, { error: 'نرخ دلار تغییر کرده است؛ دوباره پیش‌نمایش بگیرید.' });
      appLog('ERROR', 'pricing', 'خطا در به‌روزرسانی نرخ ارز', { error: error.message });
      return sendJSON(500, { error: 'قیمت‌ها تغییر نکردند؛ داده‌های قیمت‌گذاری نیاز به بررسی دارند.' });
    }

    try { logAudit('products.exchange_rate', { previous_rate: body.expected_rate_toman, ...result }); }
    catch (error) { appLog('ERROR', 'pricing', 'ثبت سابقه تغییر نرخ ناموفق بود', { error: error.message }); }
    return sendJSON(200, result);
  }

  const essenceProductMatch = pathname.match(/^\/api\/admin\/essence-pricing\/products\/([^/]+)(\/preview)?$/);
  if (essenceProductMatch && ['GET','POST','PUT'].includes(method)) {
    const preview = !!essenceProductMatch[2];
    if ((method === 'POST') !== preview || (preview && method !== 'POST')) return false;
    if (!can('products.price')) return true;
    let key;
    try { key = decodeURIComponent(essenceProductMatch[1]); }
    catch { return sendJSON(400, { error: 'شناسه محصول نامعتبر است.' }); }
    if (method === 'GET') {
      try { return sendJSON(200, productPriceState(db,key)); }
      catch (error) {
        if (error.code === 'PRODUCT_NOT_FOUND') return sendJSON(404, { error: 'محصول یافت نشد.' });
        appLog('ERROR','pricing','خطا در خواندن قیمت اسانس',{error:error.message});
        return sendJSON(500,{error:'خواندن قیمت اسانس ممکن نیست.'});
      }
    }
    const body = await parseBody(req);
    try {
      gramToKg(body.usd_per_gram);
      if (method === 'PUT') {
        rateString(body.expected_rate_toman);
        if (!Object.prototype.hasOwnProperty.call(body,'expected_usd_per_kg') ||
            (body.expected_usd_per_kg !== null && typeof body.expected_usd_per_kg !== 'string')) throw new Error('INVALID_EXPECTATION');
      }
    } catch { return sendJSON(400,{error:'قیمت هر گرم و مقادیر پیش‌نمایش نامعتبرند.'}); }
    let result;
    try {
      result = preview ? previewProductPrice(db,key,body.usd_per_gram) :
        applyProductPrice(db,key,body.usd_per_gram,body.expected_rate_toman,body.expected_usd_per_kg);
    } catch (error) {
      if (error.code === 'PRODUCT_NOT_FOUND') return sendJSON(404,{error:'محصول یافت نشد.'});
      if (error.code === 'PRICE_CONFLICT') return sendJSON(409,{error:'نرخ دلار یا قیمت اسانس تغییر کرده؛ دوباره پیش‌نمایش بگیرید.'});
      appLog('ERROR','pricing','خطا در قیمت‌گذاری محصول',{error:error.message});
      return sendJSON(500,{error:'قیمت محصول تغییر نکرد؛ داده‌ها نیاز به بررسی دارند.'});
    }
    if (!preview) {
      try { logAudit('products.essence_price',{product:result.product_id,usd_per_gram:result.usd_per_gram,rate_toman:result.rate_toman}); }
      catch (error) { appLog('ERROR','pricing','ثبت سابقه قیمت اسانس ناموفق بود',{error:error.message}); }
    }
    return sendJSON(200,result);
  }

  if (method === 'PUT' && pathname.startsWith('/api/admin/variants/')) {
    const sku = decodeURIComponent(pathname.replace('/api/admin/variants/', ''));
    const b = await parseBody(req);
    const v = db.prepare('SELECT * FROM variants WHERE sku=?').get(sku);
    if (!v) return sendJSON(404, { error: 'کالا یافت نشد' });

    const wantsPrice = b.price_toman != null && parseInt(b.price_toman) !== v.price_toman;
    const wantsStock = b.stock != null && parseInt(b.stock) !== v.stock;

    const usdRaw = b.price_usd;
    const usdNew = (usdRaw === '' || usdRaw === null) ? null
                 : (usdRaw === undefined ? undefined : parseFloat(usdRaw));
    const wantsUsd = usdNew !== undefined && usdNew !== v.price_usd;

    if (!wantsPrice && !wantsStock && !wantsUsd) {
      if (!can('products.view')) return true;
      return sendJSON(200, {
        message: 'تغییری اعمال نشد.',
        sku, price_toman: v.price_toman, price_usd: v.price_usd,
        stock: v.stock, notified: 0
      });
    }

    if ((wantsPrice || wantsUsd) && !can('products.price')) return true;
    if (wantsStock && !can('products.stock')) return true;

    const price = b.price_toman != null ? parseInt(b.price_toman) : v.price_toman;
    const stock = b.stock != null ? parseInt(b.stock) : v.stock;
    if (!Number.isInteger(price) || price < 0) return sendJSON(400, { error: 'قیمت نامعتبر است.' });
    if (!Number.isInteger(stock) || stock < 0) return sendJSON(400, { error: 'موجودی نامعتبر است.' });

    const usd = wantsUsd ? usdNew : v.price_usd;
    if (usd !== null && usd !== undefined) {
      if (!Number.isFinite(usd) || usd < 0) {
        return sendJSON(400, { error: 'قیمت دلاری نامعتبر است.' });
      }

      if (usd > 100000) {
        return sendJSON(400, { error: 'قیمت دلاری بیش از حد بزرگ است.' });
      }
    }

    db.prepare('UPDATE variants SET price_toman=?, stock=?, price_usd=? WHERE sku=?')
      .run(price, stock, usd ?? null, sku);
    appLog('INFO', 'admin', 'ویرایش کالا', {
      sku, price_from: v.price_toman, price_to: price,
      stock_from: v.stock, stock_to: stock,
      ...(wantsUsd ? { usd_from: v.price_usd, usd_to: usd } : {})
    });
    logAudit((wantsPrice || wantsUsd) ? 'products.price' : 'products.stock', {
      target: sku,
      detail: {
        ...(wantsPrice ? { price: [v.price_toman, price] } : {}),
        ...(wantsUsd ? { usd: [v.price_usd, usd] } : {}),
        ...(wantsStock ? { stock: [v.stock, stock] } : {})
      }
    });

    const notified = (stock > 0 && price > 0 && (v.stock <= 0 || v.price_toman <= 0))
      ? notifyStockWatchers([sku], 'ویرایش ادمین')
      : 0;

    return sendJSON(200, {
      message: notified
        ? `کالا به‌روزرسانی شد و به ${notified} نفر اطلاع داده شد.`
        : 'کالا به‌روزرسانی شد.',
      sku, price_toman: price, price_usd: usd ?? null, stock, notified
    });
  }

  if (method === 'GET' && /^\/api\/admin\/products\/[^/]+$/.test(pathname)) {
    if (!can('products.view')) return true;
    const key = decodeURIComponent(pathname.replace('/api/admin/products/', ''));
    const row = db.prepare('SELECT * FROM products WHERE id=? OR slug=?').get(key, key);
    if (!row) return sendJSON(404, { error: 'محصول یافت نشد' });

    const product = attachVariants(parseProduct(row, { includeDrafts: true }), { includeHidden: true });

    if (who && who.permissions.includes('products.price')) {
      const usd = db.prepare(
        'SELECT sku, price_usd FROM variants WHERE product_id=?').all(row.id);
      const map = Object.fromEntries(usd.map(x => [x.sku, x.price_usd]));
      product.variants.forEach(v => { v.price_usd = map[v.sku] ?? null; });
    }
    return sendJSON(200, product);
  }

  if (method === 'PUT' && /^\/api\/admin\/products\/[^/]+$/.test(pathname)) {
    if (!can('products.edit')) return true;
    const key = decodeURIComponent(pathname.replace('/api/admin/products/', ''));
    const b = await parseBody(req);
    const p = db.prepare('SELECT * FROM products WHERE id=? OR slug=?').get(key, key);
    if (!p) return sendJSON(404, { error: 'محصول یافت نشد' });

    if (b.price_change_percent != null) {
      const pct = parseFloat(b.price_change_percent);
      if (isNaN(pct) || pct < -90 || pct > 500)
        return sendJSON(400, { error: 'درصد تغییر باید بین ۹۰- تا ۵۰۰ باشد.' });
      db.prepare(
        `UPDATE variants SET price_toman = CAST(price_toman * (1 + ?/100.0) AS INTEGER)
         WHERE product_id=?`).run(pct, p.id);
      appLog('INFO', 'admin', 'تغییر درصدی قیمت', { product: p.id, percent: pct });
    }

    if (b.set_all_stock != null) {
      const s = parseInt(b.set_all_stock);
      if (!Number.isInteger(s) || s < 0) return sendJSON(400, { error: 'موجودی نامعتبر است.' });
      db.prepare('UPDATE variants SET stock=? WHERE product_id=?').run(s, p.id);
      appLog('INFO', 'admin', 'تنظیم گروهی موجودی', { product: p.id, stock: s });
    }

    if (b.supply_mode != null) {
      const MODES = ['IN_STOCK', 'MADE_TO_ORDER', 'UNAVAILABLE'];
      if (!MODES.includes(b.supply_mode)) {
        return sendJSON(400, {
          error: 'وضعیت تأمین نامعتبر است. مجاز: ' + MODES.join('، ') });
      }
      db.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(b.supply_mode, p.id);
      if (p.supply_mode === 'UNAVAILABLE' && b.supply_mode !== 'UNAVAILABLE') {
        const skus = db.prepare('SELECT sku FROM variants WHERE product_id=? AND stock>0').all(p.id).map(v => v.sku);
        if (skus.length) notifyStockWatchers(skus, 'تغییر وضعیت تأمین');
      }
      bustStatsCache && bustStatsCache();
      appLog('INFO', 'admin', 'تغییر وضعیت تأمین',
             { product: p.id, mode: b.supply_mode });
    }

    if (b.maker_note !== undefined) {
      const note = String(b.maker_note ?? '').trim();
      if (note.length > 1500) {
        return sendJSON(400, { error: 'یادداشت عطرساز نباید بیش از ۱۵۰۰ نویسه باشد.' });
      }
      const by = String(b.maker_note_by ?? '').trim().slice(0, 80);
      db.prepare('UPDATE products SET maker_note=?, maker_note_by=?, maker_note_approved=? WHERE id=?')
        .run(note || null, note ? (by || 'عطرساز عطر یزد') : null, note ? 1 : 0, p.id);
      appLog('INFO', 'admin', note ? 'ویرایش یادداشت عطرساز' : 'حذف یادداشت عطرساز',
             { product: p.id, chars: note.length });
    }

    const fresh = attachVariants(parseProduct(
      db.prepare('SELECT * FROM products WHERE id=?').get(p.id), { includeDrafts: true }), { includeHidden: true });
    return sendJSON(200, { message: 'محصول به‌روزرسانی شد.', product: fresh });
  }

  if (method === 'GET' && pathname === '/api/admin/inventory') {
    if (!can('products.view')) return true;
    const q = String(parsed.query.q || '').trim().slice(0, 100);
    const status = String(parsed.query.status || 'all');
    const type = String(parsed.query.type || 'all');
    const sort = String(parsed.query.sort || 'default');
    const page = Math.min(100000, Math.max(1, Number.parseInt(parsed.query.page, 10) || 1));
    const limit = 30;
    const state = `(CASE WHEN p.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND v.price_toman>0 AND v.stock>=0 AND ${publicVariantSql('v')} THEN CASE WHEN v.stock>0 THEN 'IN_STOCK' WHEN p.supply_mode='MADE_TO_ORDER' THEN 'MADE_TO_ORDER' ELSE 'UNAVAILABLE' END ELSE 'UNAVAILABLE' END)`;
    const wheres = [publicVariantSql('v')];
    const args = {};
    if (q) {
      wheres.push('(p.search_blob LIKE @q OR v.sku LIKE @q OR p.name_en LIKE @q OR p.brand_en LIKE @q)');
      args.q = `%${normalizeFa(q).replace(/[\\%_]/g, '\\$&')}%`;
      wheres[wheres.length - 1] = wheres[wheres.length - 1].replaceAll(' LIKE @q', " LIKE @q ESCAPE '\\'");
    }
    if (['IN_STOCK', 'MADE_TO_ORDER', 'UNAVAILABLE'].includes(status)) { wheres.push(`${state}=@status`); args.status = status; }
    if (['EDP', 'SAMPLE', 'BODY_SPLASH'].includes(type)) { wheres.push('v.type=@type'); args.type = type; }
    const sorts = { default: 'p.id, v.type, v.volume_ml, v.sku', name: 'p.name_fa COLLATE NOCASE, p.id, v.type, v.volume_ml, v.sku', stock_up: 'v.stock ASC, p.id, v.sku', stock_down: 'v.stock DESC, p.id, v.sku' };
    const from = `FROM variants v JOIN products p ON p.id=v.product_id WHERE ${wheres.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(args).n;
    const items = db.prepare(`SELECT p.slug,p.name_fa,p.name_en,p.brand_fa,p.brand_en,v.sku,v.type,v.type_label,v.volume_ml,v.stock,${state} AS availability ${from} ORDER BY ${sorts[sort] || sorts.default} LIMIT @limit OFFSET @offset`).all({ ...args, limit, offset: (page-1)*limit });
    return sendJSON(200, { total, page, limit, items });
  }

  if (pathname === '/api/admin/essence-stock' && method === 'GET') {
    if (!can('products.view')) return true;
    const type = String(parsed.query.type || '');
    const percents = essenceInventory.typePercents(db);
    const key = String(parsed.query.product || '').trim();
    if (key) {
      const p = db.prepare('SELECT id, slug, name_fa, brand_fa FROM products WHERE id=? OR slug=?').get(key, key);
      if (!p) return sendJSON(404, { error: 'محصول یافت نشد.' });
      const variants = db.prepare(`SELECT sku, type, type_label, volume_ml, stock FROM variants v
        WHERE product_id=? AND ${publicVariantSql('v')} ORDER BY type, volume_ml`).all(p.id)
        .map(v => {
          const cap = essenceInventory.sellableCapacity(db, p.id, v.type, v.volume_ml);
          return {
            ...v,
            ml_per_unit: essenceInventory.mlPerUnit(db, p.id, v.type, v.volume_ml),
            max_units: essenceInventory.maxUnits(db, p.id, v.type, v.volume_ml),
            capacity: cap
          };
        });
      return sendJSON(200, { product: p, percents, essence: essenceInventory.snapshot(db, p.id), variants });
    }
    const rows = db.prepare(`SELECT e.product_id, e.ml_on_hand, e.percent_override, e.updated_at,
        e.use_count, e.use_essence,
        p.slug, p.name_fa, p.brand_fa, p.supply_mode
      FROM essence_inventory e JOIN products p ON p.id=e.product_id
      ${type ? 'WHERE 1=1' : ''} ORDER BY e.ml_on_hand ASC LIMIT 200`).all();
    return sendJSON(200, { total: rows.length, percents, items: rows });
  }

  if (pathname === '/api/admin/essence-stock' && method === 'PUT') {
    if (!can('products.stock')) return true;
    const body = await parseBody(req);
    const key = String(body.product || '').trim();
    const p = db.prepare('SELECT id, slug FROM products WHERE id=? OR slug=?').get(key, key);
    if (!p) return sendJSON(404, { error: 'محصول یافت نشد.' });
    let result;
    try {
      result = essenceInventory.setStock(db, p.id, body.ml_on_hand, who?.username, body.percent_override,
        { use_count: body.use_count, use_essence: body.use_essence });
    } catch (error) {
      if (error.message === 'INVALID_ML') return sendJSON(400, { error: 'موجودی اسانس باید عدد صفر یا مثبت به میلی‌لیتر باشد.' });
      if (error.message === 'INVALID_PERCENT') return sendJSON(400, { error: 'درصد اسانس باید بین ۰ و ۱۰۰ باشد.' });
      if (error.message === 'NO_STOCK_SOURCE') return sendJSON(400, { error: 'دست‌کم یکی از دو منبع موجودی باید فعال بماند.' });
      throw error;
    }
    try { logAudit('products.essence_stock', { product: p.id, ml: result.ml_on_hand, percent: result.percent_override }); }
    catch (error) { appLog('ERROR', 'pricing', 'ثبت سابقه موجودی اسانس ناموفق بود', { error: error.message }); }
    return sendJSON(200, { message: 'موجودی اسانس ثبت شد.', essence: result });
  }

  if (pathname === '/api/admin/essence-percent' && method === 'PUT') {
    if (!can('products.stock')) return true;
    const body = await parseBody(req);
    try {
      const percents = essenceInventory.setTypePercent(db, String(body.type || ''), body.percent);
      try { logAudit('products.essence_percent', { type: body.type, percent: body.percent }); } catch {}
      return sendJSON(200, { message: 'درصد مصرف اسانس ذخیره شد.', percents });
    } catch (error) {
      if (error.message === 'INVALID_TYPE') return sendJSON(400, { error: 'نوع محصول نامعتبر است.' });
      if (error.message === 'INVALID_PERCENT') return sendJSON(400, { error: 'درصد باید بین ۰ و ۱۰۰ باشد.' });
      throw error;
    }
  }

  if (method === 'GET' && pathname === '/api/admin/low-stock') {
    if (!can('reports.stock')) return true;
    const th = parseInt(parsed.query.threshold) || 10;
    const rows = db.prepare(`
      SELECT v.sku, v.type_label, v.volume_ml, v.stock, v.price_toman,
             p.name_fa, p.brand_fa, p.slug
      FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.stock <= ? ORDER BY v.stock ASC LIMIT 100
    `).all(th);
    return sendJSON(200, { threshold: th, total: rows.length, items: rows });
  }

  if (method === 'GET' && pathname === '/api/admin/logs') {
    if (!can('system.logs')) return true;
    const level = parsed.query.level;
    const limit = Math.min(200, parseInt(parsed.query.limit) || 60);
    const rows = level
      ? db.prepare('SELECT * FROM app_logs WHERE level=? ORDER BY id DESC LIMIT ?').all(level, limit)
      : db.prepare('SELECT * FROM app_logs ORDER BY id DESC LIMIT ?').all(limit);
    return sendJSON(200, { total: rows.length, logs: rows });
  }

  if (method === 'POST' && pathname === '/api/admin/maintenance') {
    if (!can('system.maintenance')) return true;
    const res_ = releaseStaleOrders();
    const alerted = notifyStockWatchers(res_.skus, 'انقضای سفارش');
    return sendJSON(200, {
      message: `${res_.count} سفارش منقضی پردازش شد.`
        + (res_.review_count ? ` ${res_.review_count} سفارش قدیمی نیازمند بررسی دستی رزرو است.` : '')
        + (alerted ? ` به ${alerted} نفر منتظر اطلاع داده شد.` : ''),
      released: res_.count,
      review_count: res_.review_count || 0,
      notified: alerted
    });
  }

  if (method === 'POST' && pathname === '/api/admin/reindex') {
    if (!can('system.maintenance')) return true;
    const t0 = Date.now();
    const search = buildSearchIndex(true);
    const notes = buildNotesIndex(true);
    logAudit('system.maintenance', {
      target: 'reindex', detail: { search, notes }
    });
    return sendJSON(200, {
      message: `ایندکس بازسازی شد — ${search} محصول، ${notes} نسبت نُت.`,
      products: search, note_rows: notes, ms: Date.now() - t0
    });
  }

  return false;
}

module.exports = { handle };
