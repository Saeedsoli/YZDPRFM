/**
 * عطر یزد | مسیرهای کاتالوگ عمومی
 * ------------------------------------------------
 * گام ۷ از تفکیک کامل `server.js` — و بزرگ‌ترین گام تا اینجا.
 *
 * ── محتوا ──
 *   GET    /api/products            جستجو، فیلتر، مرتب‌سازی، صفحه‌بندی
 *   GET    /api/products/:key       یک محصول با شناسه یا نامک
 *   GET    /api/showcase            بخش‌های خودکار صفحه اصلی
 *   GET    /api/brands              فهرست برندها با شمار
 *   GET    /api/families            خانواده‌های بویایی
 *   GET    /api/notes               نُت‌های بویایی با شمار محصول
 *   GET    /api/essences            خانه‌های اسانس
 *   POST   /api/quiz                نتیجه کوییز بویایی
 *   POST   /api/taste/suggest       پیشنهاد بر پایه پروفایل
 *   GET    /api/taste/profile       خواندن پروفایل ذخیره‌شده
 *   DELETE /api/taste/profile       فراموش شدن
 *   GET    /api/campaigns           جشنواره‌های فعال (عمومی)
 *   GET    /api/coupons/public      اعتبارسنجی نمایشی یک کد
 *
 * ── چرا این ماژول با شش ماژول پیشین فرق دارد ──
 * تا اینجا هرچه جدا شد، مدیریتی یا احراز هویتی بود: ترافیک کم،
 * کاربر شناخته‌شده. این ماژول **پرترافیک‌ترین بخش سایت** است؛
 * `/api/products` تقریباً در هر بازدید صدا زده می‌شود.
 *
 * سه قاعده که هنگام جابه‌جایی باید سالم می‌ماندند:
 *
 *   ۱) مرتب‌سازی از **فهرست سفید** می‌آید. هیچ رشته‌ای از کاربر
 *      مستقیم داخل SQL نمی‌رود. (`SORTS`)
 *
 *   ۲) `activeCampaigns()` یک بار برای کل صفحه خوانده می‌شود،
 *      نه یک بار به ازای هر محصول. روی پربازدیدترین مسیر سایت
 *      ۲۴ کوئری اضافه بی‌دلیل است.
 *
 *   ۳) `/api/taste/suggest` گران است (پویش کل جدول) و محدودیت
 *      نرخ دارد. هنگام رد شدن **۲۰۰ با فهرست خالی** برمی‌گرداند،
 *      نه ۴۲۹ — نبود پیشنهاد نباید صفحه اصلی را بشکند.
 *
 * ── قرارداد `ctx` ──
 * ماژول زمینه می‌گیرد و `Promise<boolean>` برمی‌گرداند.
 * `true` یعنی «پاسخ داده شد»، `false` یعنی «مسئولش نیستم».
 */

'use strict';
const { publicVariantSql } = require('../variant-visibility');

/**
 * @param {object}   ctx
 * @param {string}   ctx.method
 * @param {string}   ctx.pathname
 * @param {object}   ctx.parsed              خروجی url.parse با query
 * @param {object}   ctx.req
 * @param {string}   ctx.reqIP               IP از پیش محاسبه‌شده
 * @param {object}   ctx.db
 * @param {Function} ctx.parseBody
 * @param {Function} ctx.rateLimit
 * @param {object}   ctx.RL                  پیکربندی سطل‌های محدودیت نرخ
 * @param {Function} ctx.parseProduct
 * @param {Function} ctx.attachVariants
 * @param {Function} ctx.attachCampaign
 * @param {Function} ctx.campaignPercentFor
 * @param {Function} ctx.activeCampaigns
 * @param {Function} ctx.listNotes
 * @param {Function} ctx.normalizeFa
 * @param {Function} ctx.getCustomer
 * @param {Function} ctx.getCustomerToken
 * @param {object}   ctx.otp
 * @param {object}   ctx.taste
 * @param {object}   ctx.essences
 * @param {object}   ctx.analytics
 * @returns {Promise<boolean>}
 */
async function handle(ctx) {
  const {
    method, pathname, parsed, req, reqIP, db,
    parseBody, rateLimit, RL,
    parseProduct, attachVariants, attachCampaign,
    campaignPercentFor, activeCampaigns, listNotes, normalizeFa,
    getCustomer, getCustomerToken, otp, taste, essences, analytics, res
  } = ctx;

  /* پوشش `sendJSON` — درس گام ۱.
     `ctx.sendJSON` چیزی برنمی‌گرداند؛ بدون این پوشش هر
     `return sendJSON(...)` مقدار `undefined` می‌داد، ماژول
     `false` تلقی می‌شد، سرور ادامه می‌داد و روی همان پاسخ ۴۰۴
     می‌فرستاد → `ERR_HTTP_HEADERS_SENT` بیرون از try/catch →
     مرگ کل فرآیند.

     بازبینی انجام‌شده روی این ماژول: هیچ `return;` خالی، هیچ
     `pipe(res)`، هیچ `res.end()` و هیچ `setHeader` — همه‌ی
     سیزده مسیر تنها از همین پوشش خارج می‌شوند. */
  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  // ═══════════ محصولات ═══════════
  if (method === 'GET' && pathname === '/api/products') {
    const q = (parsed.query.q || '').trim();
    const family = parsed.query.family || '';
    const gender = parsed.query.gender || '';
    const brand = parsed.query.brand || '';
    /* فیلتر نُت بویایی — می‌تواند چند مقدار داشته باشد.
       مشتری عطر با نُت جستجو می‌کند («چیزی با وانیل و عود»)، و
       این تا امروز تنها از راه جستجوی متنی مبهم ممکن بود. */
    const noteRaw = parsed.query.note || '';
    const notes = String(noteRaw).split(',')
      .map(s => normalizeFa(s.trim())).filter(Boolean).slice(0, 4);
    const page = Math.max(1, parseInt(parsed.query.page) || 1);
    const limit = Math.min(60, Math.max(1, parseInt(parsed.query.limit) || 24));

    const where = [];
    const args = {};
    if (q) {
      // ورودی کاربر با همان قاعده ایندکس یکسان‌سازی می‌شود
      // تا «کرید» و «کرِید» و «كريد» یک نتیجه بدهند
      const words = normalizeFa(q).split(/\s+/).filter(Boolean).slice(0, 5);
      words.forEach((w, i) => {
        where.push(`search_blob LIKE @w${i}`);
        args[`w${i}`] = `%${w}%`;
      });
    }
    /* هر نُت یک شرط EXISTS جدا می‌گیرد تا «وانیل و عود» یعنی
       محصولی که **هر دو** را دارد، نه یکی از آن‌ها. با IN
       نتیجه اجتماع می‌شد که برای فیلتر کردن بی‌فایده است. */
    notes.forEach((n, i) => {
      where.push(`EXISTS (SELECT 1 FROM product_notes pn
                   WHERE pn.product_id = products.id AND pn.note_key = @note${i})`);
      args[`note${i}`] = n;
    });
    if (family) { where.push('family_slug = @family'); args.family = family; }
    if (gender) { where.push('gender = @gender'); args.gender = gender.toUpperCase(); }
    if (brand)  { where.push('(brand_fa = @brand OR brand_en = @brand)'); args.brand = brand; }

    /* ── فیلتر «فقط موجودها» (ممیزی جعبه‌سیاه مرداد ۱۴۰۵) ──
       امروز تنها چند محصول از کل کاتالوگ قابل خرید است. بدون این فیلتر،
       کاربر باید تک‌تک کلیک کند تا چیزی پیدا کند که بشود خرید.

       `EXISTS` به‌جای `JOIN` عمدی است: با JOIN اگر محصولی چند
       واریانت موجود داشته باشد چند بار در نتیجه می‌آید و
       صفحه‌بندی به هم می‌ریزد. */
    if (parsed.query.in_stock === '1') {
      where.push(`products.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS (SELECT 1 FROM variants v
                    WHERE v.product_id = products.id AND ${publicVariantSql('v')} AND v.stock > 0 AND v.price_toman>0)`);
    }
    // Sample listings must refer to an actual sellable 5ml SKU, not min product price.
    const samplesOnly = parsed.query.sample_5 === '1';
    if (samplesOnly) {
      where.push(`products.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS (
        SELECT 1 FROM variants sv WHERE sv.product_id=products.id AND sv.type='SAMPLE'
        AND sv.volume_ml=5 AND sv.price_toman>0
        AND (sv.stock>0 OR products.supply_mode='MADE_TO_ORDER'))`);
    }

    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // مرتب‌سازی — فهرست سفید، هرگز رشته کاربر مستقیم در SQL نمی‌رود.
    // قیمت در جدول products نیست، پس از کمترین قیمت متغیرها گرفته می‌شود.
    const CHEAPEST = `(SELECT MIN(price_toman) FROM variants v WHERE v.product_id = products.id AND ${publicVariantSql('v')})`;

    /* ── موجودها اول (ممیزی جعبه‌سیاه مرداد ۱۴۰۵) ──
       نخستین چیزی که کاربر می‌بیند باید قابل خرید باشد. با
       ۰٫۰۵٪ موجودی، مرتب‌سازی بر پایه `id` یعنی صفحه اول پر است
       از چیزهایی که نمی‌شود خرید.

       `DESC` چون ۱ (موجود) باید پیش از ۰ بیاید.

       این پیشوند به **همه** مرتب‌سازی‌ها اضافه می‌شود، نه فقط
       پیش‌فرض: کسی که «ارزان‌ترین» را می‌خواهد، ارزان‌ترینِ
       قابل خرید را می‌خواهد. */
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

    /* ── رتبه‌بندی ربط برای جستجوی متنی ──
       🔴 باگ واقعی که تعویض منبع داده آشکار کرد (مرداد ۱۴۰۵):

       `search_blob` هم نام محصول را دارد، هم برند، هم نُت‌ها و هم
       متن توصیفی. تطبیق در همه‌شان یکسان شمرده می‌شد و ترتیب
       نهایی فقط `id` بود. نتیجه در عمل:

           جستجوی «اونتوس» → نتیجه اول: «فراپین — ارکید من»
                              چون توضیحش «مشابه اونتوس» دارد.
           «کرید — اونتوس» رتبه دوم می‌شد.

       این بدترین نوع باگ جستجوست: کاربر دقیقاً نام محصول را
       می‌نویسد و چیز دیگری می‌بیند. اعتماد به جستجو یک‌باره
       می‌رود و کاربر فرض می‌کند محصول را نداریم.

       امتیازدهی سه‌لایه (فقط وقتی q هست):
         ۳۰ — نام محصول با عبارت شروع می‌شود  (دقیق‌ترین)
         ۲۰ — نام محصول شامل عبارت است
         ۱۰ — نام برند شامل عبارت است
       امتیاز به ترتیب موجودی **اضافه** نمی‌شود بلکه پس از آن
       می‌آید: کالای موجود همچنان اول است، ولی درون هر گروه
       مرتبط‌ترین بالاست.

       چرا LIKE و نه FTS: کل جدول ۲٬۱۱۱ ردیف است و پرسمان زیر
       ۱۰ms اجرا می‌شود. افزودن FTS5 پیچیدگی نگهداری می‌آورد بدون
       سود محسوس در این مقیاس. */
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

    /* ── اگر جستجوی چندکلمه‌ای هیچ نتیجه‌ای نداد ──
       همه کلمات با AND ترکیب می‌شوند، پس «رز چوبی مردانه» وقتی
       هیچ محصولی هر سه را نداشته باشد کاربر را به بن‌بست می‌برد.
       در این حالت یک بار دیگر با OR می‌گردیم و مرتب‌سازی را بر
       اساس «چند کلمه تطبیق داد» انجام می‌دهیم — یعنی نزدیک‌ترین
       نتیجه‌ها اول می‌آیند. فروشگاه خالی بهتر از فروشگاه تقریبی نیست. */
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
           ORDER BY (${score}) DESC, ${orderBy} LIMIT @limit OFFSET @offset`
        ).all({ ...args, limit, offset: (page - 1) * limit });
      }
    }

    // حالت کامل تنها در صورت درخواست صریح؛ فهرست به متغیرها نیاز ندارد
    const wantFull = parsed.query.full === '1';

    /* جشنواره‌های فعال یک بار برای کل صفحه خوانده می‌شوند، نه
       یک بار به ازای هر محصول. جدول کوچک است ولی ۲۴ کوئری
       اضافه روی پربازدیدترین مسیر سایت بی‌دلیل است. */
    const camps = activeCampaigns();

    const products = rows.map(r => {
      const p = attachVariants(parseProduct(r));
      /* درصد جشنواره‌ای که این محصول را می‌گیرد — مبنای قیمت
         خط‌خورده روی کارت. صفر یعنی جشنواره‌ای شامل نمی‌شود. */
      const pct = camps.length ? campaignPercentFor(p, camps) : 0;
      if (samplesOnly) {
        const samplePrices = p.variants.filter(v => v.type === 'SAMPLE' && v.volume_ml === 5 && v.price_toman > 0 &&
          (v.stock > 0 || p.supply_mode === 'MADE_TO_ORDER')).map(v => v.price_toman);
        p.sample_price = samplePrices.length ? Math.min(...samplePrices) : null;
      }
      if (wantFull) { p.campaign_percent = pct; return p; }
      // نسخه سبک برای کارت محصول — حدود نصف حجم
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
        /* وضعیت تأمین برای کارت — تفاوت «به سفارش ساخته می‌شود»
           با «فعلاً نداریم» را کارت باید نشان دهد، نه فقط صفحه
           محصول. مشتری در فهرست تصمیم می‌گیرد. */
        supply_mode: p.supply_mode || 'UNAVAILABLE',
        variant_count: p.variants.length
      };
    });

    /* ثبت جستجو — تنها صفحه اول، وگرنه صفحه‌بندی همان عبارت را
       چند بار می‌شمارد. عبارت‌های بی‌نتیجه ارزشمندترین گزارش‌اند:
       یعنی مشتری چیزی خواسته که نداریم. */
    if (q && page === 1) {
      analytics.track('search', q.slice(0, 60), { results: total, relaxed }, req);
    }

    return sendJSON(200, {
      total, page, limit,
      totalPages: Math.ceil(total / limit),
      // به فرانت می‌گوید «نتیجه دقیق نبود، نزدیک‌ترین‌ها را آوردیم»
      relaxed,
      products
    });
  }

  if (method === 'GET' && pathname.startsWith('/api/products/')) {
    const key = pathname.replace('/api/products/', '');
    const row = db.prepare('SELECT * FROM products WHERE id = ? OR slug = ?').get(key, key);
    if (!row) return sendJSON(404, { error: 'محصول یافت نشد' });
    // مبنای «پربازدیدترین این هفته»
    analytics.track('view', row.id, null, req);
    /* جشنواره روی خود واریانت‌ها می‌نشیند تا صفحه محصول قیمت
       خط‌خورده نشان دهد — نه فقط سبد خرید. */
    return sendJSON(200, attachCampaign(attachVariants(parseProduct(row))));
  }

  /**
   * پرفروش‌ترین، محبوب‌ترین و پربازدیدترین — از داده واقعی.
   * از جدول `trending` خوانده می‌شود که هر ساعت تازه می‌شود،
   * پس صفحه اصلی هیچ محاسبه سنگینی انجام نمی‌دهد.
   */
  /* ── آمار زنده فروشگاه ──
     تنها منبع عددهای کاتالوگ برای همه صفحات. هیچ صفحه‌ای نباید
     شمار محصول یا برند را سخت‌کد کند؛ با اضافه شدن یک عطر همه
     خودکار به‌روز می‌شوند.

     کش HTTP یک دقیقه — همان عمر کش داخلی storeStats. */
  if (method === 'GET' && pathname === '/api/stats') {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return sendJSON(200, ctx.storeStats());
  }

  if (method === 'GET' && pathname === '/api/showcase') {
    const best   = analytics.getTrending('bestsellers');
    const wanted = analytics.getTrending('most_wanted');
    const hot    = analytics.getTrending('trending');
    const season = analytics.getTrending('seasonal');

    /* ویترین از جدول `trending` می‌آید که هر ساعت ساخته می‌شود،
       پس درصد جشنواره داخلش ذخیره نیست — و نباید هم باشد، وگرنه
       جشنواره‌ای که ظهر شروع شود تا یک ساعت روی صفحه اصلی دیده
       نمی‌شود. اینجا در لحظه محاسبه می‌شود (سبک، بدون کوئری). */
    const scamps = activeCampaigns();
    // Cached analytics cannot be trusted for current price/availability.
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
      // اگر هنوز فروشی نبوده، سایت باید صادق باشد و نگوید «پرفروش»
      bestsellers_fallback: !!best.fallback,
      most_wanted: withPct(wanted.items),
      trending: withPct(hot.items),
      /* ویترین فصلی — تنها بخشی که از روز اول و با صفر بازدید
         هم پر است، چون به تاریخچه رفتار کاربر نیاز ندارد. */
      seasonal: withPct(season.items),
      season_fa: season.season_fa || null
    });
  }

  // برندها
  if (method === 'GET' && pathname === '/api/brands') {
    /* ── چرا محصولات غیرقابل تأمین شمرده نمی‌شوند ──
       عدد کنار نام برند وعده‌ای است به مشتری: «اینجا ۶۰ رایحه
       داری». اگر ۵۸ تایشان قابل سفارش نباشند، کلیک می‌کند و
       فهرست تقریباً خالی می‌بیند — بدترین نوع بدقولی، چون
       خودمان عدد را نوشته‌ایم.

       ⚠ این پرس‌وجو باید **دقیقاً** با آنچه `seo.brandsPage`
       سمت سرور می‌سازد یکی بماند. اگر واگرا شوند، جاوااسکریپت
       فهرستِ سرور را با فهرست متفاوتی بازنویسی می‌کند و
       چیدمان جلوی چشم کاربر می‌پرد. آزمون مرورگر این را
       می‌گیرد. */
    const rows = db.prepare(`
      SELECT brand_fa, brand_en, COUNT(*) AS count
      FROM products
      WHERE brand_fa IS NOT NULL AND supply_mode != 'UNAVAILABLE'
      GROUP BY brand_fa, brand_en
      ORDER BY count DESC, brand_fa
    `).all();
    return sendJSON(200, { total: rows.length, brands: rows });
  }

  // خانواده‌های بویایی
  if (method === 'GET' && pathname === '/api/families') {
    const rows = db.prepare(`
      SELECT family_slug, family_fa, COUNT(*) AS count
      FROM products WHERE family_slug IS NOT NULL
      GROUP BY family_slug ORDER BY count DESC
    `).all();
    return sendJSON(200, { families: rows });
  }

  /**
   * فهرست نُت‌های بویایی با شمار محصول.
   *
   * ۱۸۱ نُت متمایز در دیتابیس هست ولی نمایش همه‌شان فهرست فیلتر
   * را غیرقابل استفاده می‌کند. `min` جلوی نُت‌های تک‌محصولی را
   * می‌گیرد؛ کاوش با آن‌ها بن‌بست است.
   */
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

  // ═══════════ خانه‌های اسانس ═══════════
  if (method === 'GET' && pathname === '/api/essences') {
    return sendJSON(200, {
      total: essences.all().length,
      featured: essences.featured(),
      houses: essences.all(),
      short_notice: essences.SHORT_NOTICE,
      full_notice: essences.FULL_NOTICE
    });
  }

  // ═══════════ کوییز و پروفایل بویایی ═══════════
  /**
   * نتیجه کوییز.
   *
   * منطق امتیازدهی به `src/taste.js` منتقل شد تا «پیشنهاد برای
   * شما» از همان فرمول استفاده کند. پیش‌تر اینجا درون‌خطی بود و
   * استفاده دوباره‌اش یعنی کپی کردن — و دو نسخه‌ای که دیر یا زود
   * واگرا می‌شوند.
   *
   * اگر کاربر وارد شده باشد، پاسخ‌ها به‌عنوان پروفایل بویایی
   * ذخیره می‌شوند. برای مهمان، مرورگر خودش در localStorage
   * نگه می‌دارد.
   */
  if (method === 'POST' && pathname === '/api/quiz') {
    const { answers = {} } = await parseBody(req);
    const rec = taste.recommend(answers, 6);

    // ثبت پروفایل برای کاربر واردشده — بی‌صدا، خطایش نباید
    // نتیجه کوییز را خراب کند
    let saved = false;
    try {
      const mobile = otp.mobileFromToken(getCustomerToken(req));
      if (mobile) {
        /* `resolveCustomerId` رکورد را در صورت نبود می‌سازد.
           ورود با کد یکبارمصرف فقط نشست می‌سازد، نه رکورد
           مشتری — بدون این، پروفایل کاربرانی که ثبت‌نام نکرده‌اند
           بی‌صدا ذخیره نمی‌شد. */
        const cid = taste.resolveCustomerId(mobile);
        if (cid) saved = taste.saveProfile(cid, answers);
      }
    } catch { /* ذخیره پروفایل اختیاری است */ }

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

  /**
   * پیشنهاد بر پایه پروفایل بویایی.
   *
   * دو راه ورودی:
   *   ۱) کاربر واردشده  → پروفایل از دیتابیس خوانده می‌شود
   *   ۲) مهمان          → پروفایل در بدنه درخواست می‌آید
   *
   * راه دوم عمدی است: اکثر بازدیدکنندگان ثبت‌نام نمی‌کنند و
   * قابلیتی که فقط برای کاربر واردشده کار کند، عملاً برای
   * هیچ‌کس کار نمی‌کند.
   */
  if (method === 'POST' && pathname === '/api/taste/suggest') {
    /* این مسیر گران است (پویش کل جدول محصولات)، پس محدودیت
       نرخ دارد. مثل `/api/track` بی‌صدا رد می‌شود نه با خطا —
       نبود پیشنهاد نباید صفحه اصلی را بشکند. */
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
      /* پروفایل ذخیره‌شده اولویت دارد، مگر اینکه مرورگر پروفایل
         تازه‌تری بفرستد (کاربری که تازه کوییز داده ولی هنوز
         ذخیره نشده). */
      if (saved && !taste.isMeaningful(taste.sanitize(answers))) {
        answers = saved.answers;
        source = 'account';
      } else if (saved) {
        source = 'account';
      }
    }

    /* `requireProfile` یعنی بدون سلیقه مشخص چیزی پیشنهاد نده.
       ادعای «پیشنهاد برای شما» وقتی کاربر هیچ سلیقه‌ای اعلام
       نکرده، بی‌معناست — برخلاف کوییز که باید همیشه نتیجه بدهد. */
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

  /** خواندن پروفایل ذخیره‌شده — نیازمند ورود */
  if (method === 'GET' && pathname === '/api/taste/profile') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(200, { authenticated: false, profile: null });
    /* خواندن نباید بنویسد.
       نسخه اول `resolveCustomerId` را صدا می‌زد که رکورد مشتری
       را در صورت نبود **می‌سازد** — یعنی یک GET ساده، ردیف
       تازه در دیتابیس ایجاد می‌کرد. برای کاربری که فقط وارد
       شده و هرگز کوییز نداده، این ردیف بی‌فایده است.

       رکورد فقط هنگام ذخیره واقعی پروفایل ساخته می‌شود. */
    const cust = getCustomer(mobile);
    const prof = cust ? taste.getProfile(cust.id) : null;
    return sendJSON(200, {
      authenticated: true,
      profile: prof ? prof.answers : null,
      summary: prof ? taste.describe(prof.answers) : [],
      updated_at: prof ? prof.updated_at : null
    });
  }

  /** حذف پروفایل — کاربر باید بتواند فراموش شود */
  if (method === 'DELETE' && pathname === '/api/taste/profile') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(401, { error: 'ابتدا وارد شوید.' });
    // حذف هم نباید رکورد بسازد — چیزی که نیست، پاک شدنی نیست
    const cust = getCustomer(mobile);
    if (cust) taste.clearProfile(cust.id);
    return sendJSON(200, { message: 'پروفایل بویایی پاک شد.' });
  }

  /* ── جشنواره‌های فعال (عمومی) ──
     برای نمایش نشان تخفیف روی کارت محصول. */
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

    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      return sendJSON(404, { error: 'کد منقضی شده' });
    }
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
  return false;   // هیچ‌کدام از مسیرهای این ماژول نبود
}

module.exports = { handle };
