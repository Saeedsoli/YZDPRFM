/**
 * عطر یزد | مسیرهای کاتالوگ مدیریتی
 * ------------------------------------
 * گام ۱ از تفکیک کامل `server.js`.
 *
 * ── محتوا ──
 *   PUT    /api/admin/variants/:sku    ویرایش قیمت و موجودی
 *   PUT    /api/admin/products/:id     ویرایش گروهی متغیرها
 *   GET    /api/admin/low-stock        کالاهای رو به اتمام
 *   GET    /api/admin/logs             لاگ سیستم
 *   POST   /api/admin/maintenance      آزادسازی سفارش‌های معلق
 *   POST   /api/admin/reindex          بازسازی ایندکس جستجو و نُت
 *
 * ── چرا این بلوک اول ──
 * شش مسیر پیوسته با مرز روشن، پوشش آزمون خوب
 * (`smoke_test.sh`، `test_stock_alerts.js`، `test_access_card.js`)
 * و بدون دست زدن به پول یا احراز هویت.
 *
 * ── قرارداد `ctx` ──
 * همان الگوی `routes/articles.js`: ماژول یک زمینه می‌گیرد و
 * `Promise<boolean>` برمی‌گرداند —
 *   true  → رسیدگی شد
 *   false → مسئولش نیستم، ادامه بده
 *
 * ── نکته `can()` ──
 * `can()` در صورت نبود مجوز، خودش پاسخ ۴۰۳ را می‌فرستد. در
 * `server.js` الگویش `return;` بود (خروج از handler)، ولی اینجا
 * باید `return true;` باشد: پاسخ فرستاده شده، پس مسیر **رسیدگی
 * شده** است. اگر `false` برگردد، سرور ادامه می‌دهد و در نهایت
 * ۴۰۴ روی همان پاسخ می‌نویسد.
 *
 * ── درسی که این ماژول رعایت می‌کند ──
 * در تفکیک RBAC، وابستگی‌ها با regex استخراج شدند و چهار مورد جا
 * افتاد؛ `node -c` سبز داد ولی مسیرها در اجرا می‌شکستند. اینجا
 * از `scripts/lib/extract_deps.js` استفاده شد که آگاه از رشته و
 * کامنت است، و پس از تفکیک **هر شش مسیر واقعاً اجرا شدند**.
 */

'use strict';

/**
 * @param {object}   ctx
 * @param {string}   ctx.method
 * @param {string}   ctx.pathname
 * @param {object}   ctx.parsed              خروجی url.parse
 * @param {object}   ctx.req
 * @param {Function} ctx.sendJSON
 * @param {Function} ctx.can                 خودش ۴۰۳ می‌فرستد
 * @param {Function} ctx.parseBody
 * @param {Function} ctx.logAudit
 * @param {Function} ctx.appLog
 * @param {object}   ctx.db
 * @param {Function} ctx.parseProduct
 * @param {object}   ctx.who              کارمند واردشده (برای بررسی نرم مجوز)
 * @param {Function} ctx.attachVariants
 * @param {Function} ctx.notifyStockWatchers
 * @param {Function} ctx.releaseStaleOrders
 * @param {Function} ctx.buildSearchIndex
 * @param {Function} ctx.buildNotesIndex
 * @returns {Promise<boolean>}
 */
async function handle(ctx) {
  const {
    method, pathname, parsed, req,
    can, parseBody, logAudit, appLog, db,
    who, parseProduct, attachVariants, notifyStockWatchers,
    releaseStaleOrders, buildSearchIndex, buildNotesIndex
  , bustStatsCache} = ctx;

  /* ── چرا sendJSON پوششی ──
     در `server.js` الگوی `return sendJSON(...)` یعنی «پاسخ بده و
     از handler خارج شو». اینجا آن الگو `undefined` برمی‌گرداند —
     که falsy است، پس سرور فکر می‌کند مسیر رسیدگی نشده، ادامه
     می‌دهد و ۴۰۴ روی همان پاسخ می‌نویسد:

       Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after
       they are sent to the client

     و چون این خطا بیرون از try/catch رخ می‌دهد، **کل فرآیند
     سرور را می‌کشد**. یعنی نخستین درخواست به هر مسیر این ماژول،
     سایت را پایین می‌آورد.

     این باگ در نخستین اجرای آزمون گرفته شد.

     دو راه بود: ۱۳ نقطه `return sendJSON` را دستی به دو خط
     تبدیل کنیم (پرخطا و پرنویز)، یا یک پوشش که همان الگو را
     معنادار کند. راه دوم انتخاب شد — خواناتر و بدون فرصت
     فراموشی. */
  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  // ═══════════ مدیریت محصول و موجودی (ادمین) ═══════════

  // ویرایش قیمت/موجودی یک متغیر
  if (method === 'PUT' && pathname.startsWith('/api/admin/variants/')) {
    const sku = decodeURIComponent(pathname.replace('/api/admin/variants/', ''));
    const b = await parseBody(req);
    const v = db.prepare('SELECT * FROM variants WHERE sku=?').get(sku);
    if (!v) return sendJSON(404, { error: 'کالا یافت نشد' });

    /* یک مسیر، دو عمل با حساسیت متفاوت.
       انباردار باید موجودی را عوض کند ولی قیمت را نه — پس هر
       فیلد مجوز خودش را می‌خواهد. بررسی فقط وقتی انجام می‌شود
       که آن فیلد واقعاً فرستاده شده و مقدارش فرق دارد. */
    const wantsPrice = b.price_toman != null && parseInt(b.price_toman) !== v.price_toman;
    const wantsStock = b.stock != null && parseInt(b.stock) !== v.stock;

    /* ── قیمت دلاری ──
       گام اول از قیمت‌گذاری خودکار: فعلاً فقط ذخیره می‌شود.
       فرمول (وزن × نرخ دلار + هزینه‌ها) بعداً روی همین می‌نشیند.

       رشته خالی یعنی «پاک کن» و به NULL تبدیل می‌شود — نه صفر.
       صفر یعنی «رایگان» که معنای دیگری است.

       مقایسه با `!==` روی عدد اعشاری امن است چون هر دو طرف از
       یک مسیر تبدیل می‌شوند. */
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
    /* قیمت دلاری همان حساسیت قیمت تومانی را دارد — پایه محاسبه
       قیمت نهایی است، پس انباردار نباید بتواند عوضش کند. */
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
      /* سقف محافظتی: گران‌ترین اسانس جهان زیر ۱۰٬۰۰۰ دلار در
         کیلوست. عدد بزرگ‌تر یعنی اشتباه تایپی — و چون قرار است
         پایه محاسبه خودکار شود، اشتباه اینجا در قیمت هزاران
         محصول تکثیر می‌شود. */
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

    // اطلاع‌رسانی به منتظران در صورت موجود شدن
    const notified = (v.stock === 0 && stock > 0)
      ? notifyStockWatchers([sku], 'ویرایش ادمین')
      : 0;

    return sendJSON(200, {
      message: notified
        ? `کالا به‌روزرسانی شد و به ${notified} نفر اطلاع داده شد.`
        : 'کالا به‌روزرسانی شد.',
      sku, price_toman: price, price_usd: usd ?? null, stock, notified
    });
  }

  /* ── خواندن محصول برای پنل ──
     چرا مسیر جدا از `/api/products/:slug` عمومی:

     قیمت دلاری **پایه محاسبه** است، نه اطلاعات محصول. اگر در
     پاسخ عمومی بیاید، هر بازدیدکننده‌ای می‌تواند حاشیه سود
     فروشگاه را حساب کند: قیمت تومانی تقسیم بر قیمت دلاری ضرب
     در نرخ روز.

     `attachVariants` فهرست سفید دارد و `price_usd` را نمی‌دهد —
     همان‌طور که باید. پس پنل مسیر خودش را می‌خواهد. */
  if (method === 'GET' && /^\/api\/admin\/products\/[^/]+$/.test(pathname)) {
    if (!can('products.view')) return true;
    const key = decodeURIComponent(pathname.replace('/api/admin/products/', ''));
    const row = db.prepare('SELECT * FROM products WHERE id=? OR slug=?').get(key, key);
    if (!row) return sendJSON(404, { error: 'محصول یافت نشد' });

    const product = attachVariants(parseProduct(row));
    /* قیمت دلاری فقط برای کسی که مجوز قیمت دارد. انباردار
       محصول را می‌بیند ولی پایه قیمت‌گذاری را نه.

       `can()` صدا زده نمی‌شود چون خودش ۴۰۳ می‌فرستد و اینجا
       نبودِ مجوز خطا نیست — فقط یعنی این میدان را نبیند. */
    if (who && who.permissions.includes('products.price')) {
      const usd = db.prepare(
        'SELECT sku, price_usd FROM variants WHERE product_id=?').all(row.id);
      const map = Object.fromEntries(usd.map(x => [x.sku, x.price_usd]));
      product.variants.forEach(v => { v.price_usd = map[v.sku] ?? null; });
    }
    return sendJSON(200, product);
  }

  // ویرایش گروهی متغیرهای یک محصول
  if (method === 'PUT' && /^\/api\/admin\/products\/[^/]+$/.test(pathname)) {
    if (!can('products.edit')) return true;
    const key = decodeURIComponent(pathname.replace('/api/admin/products/', ''));
    const b = await parseBody(req);
    const p = db.prepare('SELECT * FROM products WHERE id=? OR slug=?').get(key, key);
    if (!p) return sendJSON(404, { error: 'محصول یافت نشد' });

    // تغییر درصدی قیمت همه متغیرها
    if (b.price_change_percent != null) {
      const pct = parseFloat(b.price_change_percent);
      if (isNaN(pct) || pct < -90 || pct > 500)
        return sendJSON(400, { error: 'درصد تغییر باید بین ۹۰- تا ۵۰۰ باشد.' });
      db.prepare(
        `UPDATE variants SET price_toman = CAST(price_toman * (1 + ?/100.0) AS INTEGER)
         WHERE product_id=?`).run(pct, p.id);
      appLog('INFO', 'admin', 'تغییر درصدی قیمت', { product: p.id, percent: pct });
    }
    // تنظیم موجودی همه متغیرها
    if (b.set_all_stock != null) {
      const s = parseInt(b.set_all_stock);
      if (!Number.isInteger(s) || s < 0) return sendJSON(400, { error: 'موجودی نامعتبر است.' });
      db.prepare('UPDATE variants SET stock=? WHERE product_id=?').run(s, p.id);
      appLog('INFO', 'admin', 'تنظیم گروهی موجودی', { product: p.id, stock: s });
    }

    /* ── وضعیت تأمین ──
       سه حالت، با فهرست سفید. مقدار دلخواه پذیرفته نمی‌شود چون
       رابط و منطق سبد فقط همین سه را می‌شناسند و مقدار ناشناخته
       یعنی کالایی که نه خریدنی است نه پیام درستی دارد. */
    if (b.supply_mode != null) {
      const MODES = ['IN_STOCK', 'MADE_TO_ORDER', 'UNAVAILABLE'];
      if (!MODES.includes(b.supply_mode)) {
        return sendJSON(400, {
          error: 'وضعیت تأمین نامعتبر است. مجاز: ' + MODES.join('، ') });
      }
      db.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(b.supply_mode, p.id);
      bustStatsCache && bustStatsCache();
      appLog('INFO', 'admin', 'تغییر وضعیت تأمین',
             { product: p.id, mode: b.supply_mode });
    }

    const fresh = attachVariants(parseProduct(
      db.prepare('SELECT * FROM products WHERE id=?').get(p.id)));
    return sendJSON(200, { message: 'محصول به‌روزرسانی شد.', product: fresh });
  }

  // کالاهای رو به اتمام
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

  // لاگ سیستم
  if (method === 'GET' && pathname === '/api/admin/logs') {
    if (!can('system.logs')) return true;
    const level = parsed.query.level;
    const limit = Math.min(200, parseInt(parsed.query.limit) || 60);
    const rows = level
      ? db.prepare('SELECT * FROM app_logs WHERE level=? ORDER BY id DESC LIMIT ?').all(level, limit)
      : db.prepare('SELECT * FROM app_logs ORDER BY id DESC LIMIT ?').all(limit);
    return sendJSON(200, { total: rows.length, logs: rows });
  }

  // اجرای دستی نگهداشت
  if (method === 'POST' && pathname === '/api/admin/maintenance') {
    if (!can('system.maintenance')) return true;
    const res_ = releaseStaleOrders();
    const alerted = notifyStockWatchers(res_.skus, 'انقضای سفارش');
    return sendJSON(200, {
      message: `${res_.count} سفارش منقضی پردازش شد.`
        + (alerted ? ` به ${alerted} نفر منتظر اطلاع داده شد.` : ''),
      released: res_.count,
      notified: alerted
    });
  }

  /**
   * بازسازی ایندکس جستجو و نُت.
   *
   * چرا لازم است: هر دو ایندکس از ستون‌های محصول ساخته می‌شوند و
   * فقط هنگام راه‌اندازی سرور به‌روز می‌شوند. اگر داده محصول از
   * بیرون عوض شود (اسکریپت، بازیابی پشتیبان، ویرایش مستقیم
   * دیتابیس)، ایندکس کهنه می‌ماند و **بی‌صدا** نتیجه غلط می‌دهد:
   * جستجو محصول تازه را پیدا نمی‌کند و فیلتر نُت شمار اشتباه
   * نشان می‌دهد. هیچ خطایی هم در لاگ نمی‌آید.
   *
   * تا امروز تنها راه بازسازی، راه‌اندازی دوباره کل سرور بود.
   */
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

  return false;   // هیچ‌کدام از مسیرهای این ماژول نبود
}

module.exports = { handle };
