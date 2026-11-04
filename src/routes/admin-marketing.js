/**
 * عطر یزد | مسیرهای بازاریابی — کوپن، جشنواره، اعلان
 * ------------------------------------------------------
 * گام ۳ از تفکیک کامل `server.js`.
 *
 * ── محتوا ──
 *   GET|POST|PUT|DELETE  /api/admin/coupons      کد تخفیف
 *   GET|POST|PUT|DELETE  /api/admin/campaigns    جشنواره خودکار
 *   GET|POST|PUT|DELETE  /api/admin/notices      نوار اعلان
 *
 * ── چرا این سه با هم ──
 * هر سه «ابزار تخفیف و پیام» هستند و از همان مجوز `coupons.*`
 * استفاده می‌کنند. تفکیک مجوزشان فقط پیچیدگی اضافه می‌کرد
 * (تصمیم ثبت‌شده در خود کد).
 *
 * ── حساسیت مالی ──
 * تخفیف **مستقیم روی پرداختی مشتری** اثر می‌گذارد. یک جشنواره با
 * درصد اشتباه یا دامنه غلط، یعنی فروش زیر قیمت تمام‌شده.
 *
 * دو محافظ که باید سالم بمانند:
 *   ۱) اعتبارسنجی درصد و تاریخ هنگام ساخت
 *   ۲) `bustCampaignCache()` پس از هر تغییر — وگرنه جشنواره تا
 *      پنج ثانیه بعد اعمال نمی‌شود و مشتری قیمت قدیم می‌بیند
 *
 * آزمون این ماژول روی همین دو تمرکز دارد.
 *
 * ── قرارداد `ctx` ──
 * ماژول زمینه می‌گیرد و `Promise<boolean>` برمی‌گرداند.
 */

'use strict';

/**
 * @param {object}   ctx
 * @param {string}   ctx.method
 * @param {string}   ctx.pathname
 * @param {object}   ctx.req
 * @param {Function} ctx.can                 خودش ۴۰۳ می‌فرستد
 * @param {Function} ctx.parseBody
 * @param {Function} ctx.logAudit
 * @param {object}   ctx.db
 * @param {Function} ctx.cleanText
 * @param {Function} ctx.normalizeDigits
 * @param {Function} ctx.bustCampaignCache   کش جشنواره را باطل می‌کند
 * @returns {Promise<boolean>}
 */
async function handle(ctx) {
  const {
    method, pathname, req,
    can, parseBody, logAudit, db,
    cleanText, normalizeDigits, bustCampaignCache
  } = ctx;

  /* پوشش `sendJSON` — درس گام ۱.
     الگوی `return sendJSON(...)` در server.js `undefined` می‌دهد
     که falsy است؛ در ماژول یعنی «رسیدگی نشد» و سرور ۴۰۴ روی همان
     پاسخ می‌نویسد → ERR_HTTP_HEADERS_SENT → مرگ فرآیند.

     اینجا الگوی ternary هم هست
     (`return r.changes ? sendJSON(200,…) : sendJSON(404,…)`)
     که با همین پوشش، هر دو شاخه‌اش `true` می‌دهند. */
  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  if (method === 'GET' && pathname === '/api/admin/coupons') {
    if (!can('coupons.view')) return true;
    const rows = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    return sendJSON(200, { total: rows.length, coupons: rows });
  }

  if (method === 'POST' && pathname === '/api/admin/coupons') {
    if (!can('coupons.create')) return true;
    const b = await parseBody(req);
    const code = String(b.code || '').trim().toUpperCase();
    if (!code) return sendJSON(400, { error: 'کد تخفیف الزامی است.' });
    if (!['PERCENT', 'FIXED', 'FREE_SHIPPING'].includes(b.type))
      return sendJSON(400, { error: 'نوع تخفیف نامعتبر است.' });
    if (db.prepare('SELECT 1 FROM coupons WHERE UPPER(code)=?').get(code))
      return sendJSON(409, { error: 'این کد قبلاً ثبت شده است.' });

    /* اعتبارسنجی تاریخ — «۳۱ خرداد» یک بار در seed بود و
       جاوااسکریپت بی‌صدا به روز بعد تفسیرش می‌کرد. */
    const validDate = (x) => {
      if (!x) return true;
      const dt = new Date(x);
      return !isNaN(dt) && dt.toISOString().slice(0, 10) === x;
    };
    if (!validDate(b.starts_at) || !validDate(b.expires_at))
      return sendJSON(400, { error: 'تاریخ نامعتبر است (قالب: YYYY-MM-DD).' });
    if (b.starts_at && b.expires_at && b.starts_at > b.expires_at)
      return sendJSON(400, { error: 'تاریخ شروع بعد از پایان است.' });

    if (b.type === 'PERCENT') {
      const val = parseInt(b.value);
      if (!(val > 0 && val <= 100))
        return sendJSON(400, { error: 'درصد باید بین ۱ تا ۱۰۰ باشد.' });
    }

    // موبایل اختصاصی با ارقام فارسی هم پذیرفته شود
    const assigned = b.assigned_mobile
      ? normalizeDigits(String(b.assigned_mobile)) : null;
    if (assigned && !/^09\d{9}$/.test(assigned))
      return sendJSON(400, { error: 'شماره موبایل اختصاصی نامعتبر است.' });

    /* دامنه‌ها به‌صورت CSV ذخیره می‌شوند. آرایه هم پذیرفته
       می‌شود تا پنل بتواند مستقیم بفرستد. */
    const csv = (x) => {
      if (!x) return null;
      const arr = Array.isArray(x) ? x : String(x).split(',');
      const clean = arr.map(v => String(v).trim()).filter(Boolean);
      return clean.length ? clean.join(',') : null;
    };

    db.prepare(`
      INSERT INTO coupons (code, type, value, min_subtotal, max_subtotal,
        max_discount, usage_limit, per_user_once, starts_at, expires_at,
        active, description, scope_families, scope_brands, scope_types,
        scope_products, scope_gender, first_order_only, assigned_mobile)
      VALUES (@code,@type,@value,@min_subtotal,@max_subtotal,
        @max_discount,@usage_limit,@per_user_once,@starts_at,@expires_at,
        1,@description,@scope_families,@scope_brands,@scope_types,
        @scope_products,@scope_gender,@first_order_only,@assigned_mobile)
    `).run({
      code, type: b.type,
      value: parseInt(b.value) || 0,
      min_subtotal: parseInt(b.min_subtotal) || 0,
      max_subtotal: b.max_subtotal ? parseInt(b.max_subtotal) : null,
      max_discount: b.max_discount ? parseInt(b.max_discount) : null,
      usage_limit: b.usage_limit ? parseInt(b.usage_limit) : null,
      per_user_once: b.per_user_once === false ? 0 : 1,
      starts_at: b.starts_at || null,
      expires_at: b.expires_at || null,
      description: b.description || '',
      scope_families: csv(b.scope_families),
      scope_brands: csv(b.scope_brands),
      scope_types: csv(b.scope_types),
      scope_products: csv(b.scope_products),
      scope_gender: csv(b.scope_gender),
      first_order_only: b.first_order_only ? 1 : 0,
      assigned_mobile: assigned
    });

    logAudit('coupon.create', { target: code, type: b.type, value: b.value });
    return sendJSON(201, { message: 'کد تخفیف ایجاد شد.', code });
  }

  if (method === 'PUT' && pathname.startsWith('/api/admin/coupons/')) {
    if (!can('coupons.toggle')) return true;
    const code = decodeURIComponent(pathname.replace('/api/admin/coupons/', '')).toUpperCase();
    const b = await parseBody(req);
    const cur = db.prepare('SELECT * FROM coupons WHERE UPPER(code)=?').get(code);
    if (!cur) return sendJSON(404, { error: 'کد یافت نشد' });
    db.prepare('UPDATE coupons SET active=? WHERE UPPER(code)=?')
      .run(b.active ? 1 : 0, code);
    return sendJSON(200, { message: b.active ? 'کد فعال شد.' : 'کد غیرفعال شد.' });
  }

  /* ═══════════ جشنواره (تخفیف خودکار) ═══════════
     از همان مجوزهای کوپن استفاده می‌کند — هر دو ابزار تخفیف‌اند
     و تفکیک مجوزشان فقط پیچیدگی اضافه می‌کرد. */
  if (method === 'GET' && pathname === '/api/admin/campaigns') {
    if (!can('coupons.view')) return true;
    const rows = db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all();
    return sendJSON(200, { total: rows.length, campaigns: rows });
  }

  if (method === 'POST' && pathname === '/api/admin/campaigns') {
    if (!can('coupons.create')) return true;
    const b = await parseBody(req);

    const title = cleanText(b.title, 80);
    if (!title) return sendJSON(400, { error: 'عنوان جشنواره الزامی است.' });

    const pct = parseInt(b.percent);
    /* سقف ۹۰٪: تخفیف بالاتر معمولاً اشتباه تایپی است و ضرر
       مستقیم می‌زند. اگر واقعاً لازم شد، از کد تخفیف با مبلغ
       ثابت استفاده شود. */
    if (!(pct > 0 && pct <= 90))
      return sendJSON(400, { error: 'درصد باید بین ۱ تا ۹۰ باشد.' });

    const validDate = (x) => {
      if (!x) return true;
      const dt = new Date(x);
      return !isNaN(dt) && dt.toISOString().slice(0, 10) === x;
    };
    if (!validDate(b.starts_at) || !validDate(b.ends_at))
      return sendJSON(400, { error: 'تاریخ نامعتبر است (قالب: YYYY-MM-DD).' });
    if (b.starts_at && b.ends_at && b.starts_at > b.ends_at)
      return sendJSON(400, { error: 'تاریخ شروع بعد از پایان است.' });

    const csv = (x) => {
      if (!x) return null;
      const arr = Array.isArray(x) ? x : String(x).split(',');
      const clean = arr.map(v => String(v).trim()).filter(Boolean);
      return clean.length ? clean.join(',') : null;
    };

    const r = db.prepare(`
      INSERT INTO campaigns (title, percent, max_discount, scope_families,
        scope_brands, scope_types, scope_products, scope_gender,
        starts_at, ends_at, active)
      VALUES (@title,@percent,@max_discount,@scope_families,
        @scope_brands,@scope_types,@scope_products,@scope_gender,
        @starts_at,@ends_at,1)
    `).run({
      title, percent: pct,
      max_discount: b.max_discount ? parseInt(b.max_discount) : null,
      scope_families: csv(b.scope_families),
      scope_brands: csv(b.scope_brands),
      scope_types: csv(b.scope_types),
      scope_products: csv(b.scope_products),
      scope_gender: csv(b.scope_gender),
      starts_at: b.starts_at || null,
      ends_at: b.ends_at || null
    });

    /* کش را همین‌جا باطل کن تا مدیر بلافاصله اثر را ببیند —
       وگرنه تا ۵ ثانیه گمان می‌کند جشنواره کار نمی‌کند. */
    bustCampaignCache();
    logAudit('campaign.create', { target: title, percent: pct });
    return sendJSON(201, { message: 'جشنواره ایجاد شد.', id: r.lastInsertRowid });
  }

  if (method === 'PUT' && /^\/api\/admin\/campaigns\/\d+$/.test(pathname)) {
    if (!can('coupons.toggle')) return true;
    const id = parseInt(pathname.split('/').pop());
    const b = await parseBody(req);
    const cur = db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
    if (!cur) return sendJSON(404, { error: 'جشنواره یافت نشد' });
    db.prepare('UPDATE campaigns SET active=? WHERE id=?').run(b.active ? 1 : 0, id);
    bustCampaignCache();
    logAudit('campaign.toggle', { target: cur.title, active: !!b.active });
    return sendJSON(200, { message: b.active ? 'جشنواره فعال شد.' : 'جشنواره متوقف شد.' });
  }

  if (method === 'DELETE' && /^\/api\/admin\/campaigns\/\d+$/.test(pathname)) {
    if (!can('coupons.delete')) return true;
    const id = parseInt(pathname.split('/').pop());
    const cur = db.prepare('SELECT title FROM campaigns WHERE id=?').get(id);
    const r = db.prepare('DELETE FROM campaigns WHERE id=?').run(id);
    bustCampaignCache();
    if (r.changes) logAudit('campaign.delete', { target: cur?.title });
    return r.changes ? sendJSON(200, { message: 'جشنواره حذف شد.' })
                     : sendJSON(404, { error: 'جشنواره یافت نشد' });
  }

  /* ═══════════ نوار اعلان ═══════════ */
  if (method === 'GET' && pathname === '/api/admin/notices') {
    if (!can('coupons.view')) return true;
    const rows = db.prepare('SELECT * FROM notices ORDER BY id DESC').all();
    return sendJSON(200, { total: rows.length, notices: rows });
  }

  if (method === 'POST' && pathname === '/api/admin/notices') {
    if (!can('coupons.create')) return true;
    const b = await parseBody(req);
    const text = cleanText(b.text, 160);
    if (!text) return sendJSON(400, { error: 'متن اعلان الزامی است.' });

    /* لینک فقط داخلی — لینک بیرونی در نوار بالای سایت یعنی
       هر کسی که به پنل دسترسی بگیرد می‌تواند بازدیدکننده را
       به سایت دیگری بفرستد. */
    const link = b.link ? String(b.link).trim() : null;
    if (link && !link.startsWith('/'))
      return sendJSON(400, { error: 'لینک باید داخلی باشد و با / شروع شود.' });

    const tone = ['gold', 'dark', 'success', 'alert'].includes(b.tone) ? b.tone : 'gold';

    const validDate = (x) => {
      if (!x) return true;
      const dt = new Date(x);
      return !isNaN(dt) && dt.toISOString().slice(0, 10) === x;
    };
    if (!validDate(b.starts_at) || !validDate(b.ends_at))
      return sendJSON(400, { error: 'تاریخ نامعتبر است (قالب: YYYY-MM-DD).' });
    if (b.starts_at && b.ends_at && b.starts_at > b.ends_at)
      return sendJSON(400, { error: 'تاریخ شروع بعد از پایان است.' });

    /* فقط یک اعلان همزمان فعال باشد. دو نوار روی هم، هم زشت
       است هم فضای بالای صفحه را می‌بلعد. */
    const r = db.transaction(() => {
      db.prepare('UPDATE notices SET active=0').run();
      return db.prepare(`
        INSERT INTO notices (text, link, link_label, tone, starts_at, ends_at, active)
        VALUES (?,?,?,?,?,?,1)
      `).run(text, link, cleanText(b.link_label, 40) || null, tone,
             b.starts_at || null, b.ends_at || null);
    }).immediate();

    logAudit('notice.create', { target: text.slice(0, 40) });
    return sendJSON(201, { message: 'اعلان منتشر شد.', id: r.lastInsertRowid });
  }

  if (method === 'PUT' && /^\/api\/admin\/notices\/\d+$/.test(pathname)) {
    if (!can('coupons.toggle')) return true;
    const id = parseInt(pathname.split('/').pop());
    const b = await parseBody(req);
    if (!db.prepare('SELECT 1 FROM notices WHERE id=?').get(id))
      return sendJSON(404, { error: 'اعلان یافت نشد' });
    if (b.active) db.prepare('UPDATE notices SET active=0').run();
    db.prepare('UPDATE notices SET active=? WHERE id=?').run(b.active ? 1 : 0, id);
    return sendJSON(200, { message: b.active ? 'اعلان فعال شد.' : 'اعلان خاموش شد.' });
  }

  if (method === 'DELETE' && /^\/api\/admin\/notices\/\d+$/.test(pathname)) {
    if (!can('coupons.delete')) return true;
    const id = parseInt(pathname.split('/').pop());
    const r = db.prepare('DELETE FROM notices WHERE id=?').run(id);
    return r.changes ? sendJSON(200, { message: 'اعلان حذف شد.' })
                     : sendJSON(404, { error: 'اعلان یافت نشد' });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/admin/coupons/')) {
    if (!can('coupons.delete')) return true;
    const code = decodeURIComponent(pathname.replace('/api/admin/coupons/', '')).toUpperCase();
    const r = db.prepare('DELETE FROM coupons WHERE UPPER(code)=?').run(code);
    return r.changes ? sendJSON(200, { message: 'کد حذف شد.' })
                     : sendJSON(404, { error: 'کد یافت نشد' });
  }

  return false;   // هیچ‌کدام از مسیرهای این ماژول نبود
}

module.exports = { handle };
