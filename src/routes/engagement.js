/**
 * عطر یزد | مسیرهای تعامل مشتری
 * ------------------------------------------------
 * گام ۸ از تفکیک کامل `server.js` — و آخرین گام بی‌خطر.
 *
 * ── محتوا ──
 *   POST   /api/track                 ثبت رویداد از مرورگر
 *   GET    /api/wishlist              فهرست علاقه‌مندی
 *   POST   /api/wishlist              افزودن/برداشتن (کلید دوحالته)
 *   GET    /api/wishlist/check/:key   وضعیت یک محصول
 *   GET    /api/reviews/:key          نظرات تأییدشده یک محصول
 *   GET    /api/review-invite/:token  اعتبار دعوت‌نامه حضوری
 *   POST   /api/review-invite         ثبت نظر با دعوت‌نامه
 *   POST   /api/reviews               ثبت نظر (کاربر واردشده)
 *   POST   /api/stock-alert           اطلاع موجود شدن
 *   GET    /api/notice                نوار اعلان
 *   GET|POST /api/orders/track        پیگیری با موبایل و شماره سفارش
 *
 * ── وجه مشترک این یازده مسیر ──
 * همه **بدون `can()`** کار می‌کنند و همه به شکلی «کاربر چیزی
 * می‌گذارد» هستند نه «کاربر چیزی می‌خرد». پول جابه‌جا نمی‌شود،
 * پس هیچ‌کدام تراکنشی نیستند — ولی سه‌تایشان داده‌ی شخصی
 * برمی‌گردانند و محافظشان باید سالم بماند:
 *
 *   ۱) `/api/orders/track` موبایل و شناسه سفارش را هر دو می‌خواهد.
 *      برای عدم تطبیق، فهرست خالی می‌دهد و داده نشانی برنمی‌گرداند.
 *
 *   ۲) `/api/review-invite/:token` شماره را **ماسک‌شده** برمی‌گرداند
 *      (`0913****79`). مشتری مطمئن می‌شود لینک مال خودش است، ولی
 *      اگر لینک به دست دیگری افتاد شماره کامل لو نمی‌رود.
 *
 *   ۳) `/api/wishlist` بدون ورود ۴۰۱ می‌دهد. علاقه‌مندی خودش
 *      یک نیمرخ رفتاری است.
 *
 * ── سه محدودیت نرخ با دو رفتار عمداً متفاوت ──
 *   `track`   → رد شدن **۲۰۰ با `throttled:true`**. تحلیل نباید
 *               تجربه کاربر را خراب کند؛ کاربر منتظر پاسخ نیست.
 *   `alert`   → رد شدن **۴۲۹ با پیام**. کاربر منتظر تأیید است و
 *               سکوت یعنی دروغ گفتن.
 *   `review`  → **۵ نظر در ۲۴ ساعت** به ازای هر شماره. مثل `alert`
 *               گویا است. سطلش پنجره‌ی درازی دارد، پس آزمون باید
 *               پیش از هر اجرا پاکش کند.
 *
 * ── قرارداد `ctx` ──
 * ماژول زمینه می‌گیرد و `Promise<boolean>` برمی‌گرداند.
 */

'use strict';

const shopTime = require('../shop-time');
const { publicVariantSql } = require('../variant-visibility');
const crypto = require('crypto');
const { variantAvailability } = require('../availability');

/**
 * @param {object}   ctx
 * @param {string}   ctx.method
 * @param {string}   ctx.pathname
 * @param {object}   ctx.parsed
 * @param {object}   ctx.req
 * @param {string}   ctx.reqIP
 * @param {object}   ctx.db
 * @param {Function} ctx.parseBody
 * @param {Function} ctx.rateLimit
 * @param {object}   ctx.RL
 * @param {Function} ctx.appLog
 * @param {Function} ctx.cleanText
 * @param {Function} ctx.parseProduct
 * @param {Function} ctx.attachVariants
 * @param {Function} ctx.reviewSummary
 * @param {Function} ctx.hasPurchased
 * @param {Function} ctx.readReviewInvite
 * @param {Function} ctx.consumeReviewInvite
 * @param {Function} ctx.getCustomerToken
 * @param {object}   ctx.otp
 * @param {object}   ctx.analytics
 * @returns {Promise<boolean>}
 */
async function handle(ctx) {
  const {
    method, pathname, parsed, req, res, reqIP, db,
    parseBody, rateLimit, RL, appLog, cleanText,
    parseProduct, attachVariants, reviewSummary, hasPurchased,
    readReviewInvite, consumeReviewInvite,
    getCustomerToken, otp, analytics
  } = ctx;

  /* پوشش `sendJSON` — درس گام ۱.
     بازبینی انجام‌شده: مسیر پیگیری برای جلوگیری از ذخیره داده
     محرمانه هدر no-store می‌گذارد؛ بدنه‌ها از پوشش زیر می‌روند.

     یک نکته ویژه این ماژول: بلوک `/api/wishlist` بیرونی است و
     درونش `GET` و `POST` تودرتو دارد. اگر متد چیز دیگری باشد
     بلوک **بدون پاسخ** تمام می‌شود و اجرا به `return false`
     پایین می‌رسد — همان رفتار پیشین (۴۰۴ از سرور). */
  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  /* رقم فارسی در پیام‌های کاربر.
     پیش‌تر «۳۰ دقیقه» به‌صورت «30 دقیقه» نمایش داده می‌شد — تنها
     جای سایت که رقم لاتین به کاربر نشان داده می‌شد. */
  const fa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);


  /** ثبت رویداد از سمت مرورگر (افزودن به سبد، شروع تسویه، کوییز) */
  if (method === 'POST' && pathname === '/api/track') {
    /* بی‌صدا رد می‌شود، نه با خطا: تحلیل نباید تجربه کاربر را
       خراب کند. اگر کسی از سقف گذشت، رویدادش ثبت نمی‌شود ولی
       صفحه‌اش هم نمی‌شکند. */
    const trl = rateLimit(`track:${reqIP}`, RL.track.limit, RL.track.window, RL.track.block);
    if (!trl.ok) return sendJSON(200, { ok: false, throttled: true });

    const b = await parseBody(req);
    const ok = analytics.track(
      String(b.kind || ''),
      b.target,
      b.meta && typeof b.meta === 'object' ? b.meta : null,
      req
    );
    return sendJSON(200, { ok });
  }


  // ═══════════ علاقه‌مندی ═══════════
  if (pathname === '/api/wishlist') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(401, { error: 'برای استفاده از علاقه‌مندی وارد شوید.' });

    if (method === 'GET') {
      const rows = db.prepare(`
        SELECT p.* FROM wishlist w JOIN products p ON p.id = w.product_id
        WHERE w.mobile=? ORDER BY w.added_at DESC
      `).all(mobile);
      return sendJSON(200, {
        total: rows.length,
        products: rows.map(r => attachVariants(parseProduct(r)))
      });
    }

    if (method === 'POST') {
      const b = await parseBody(req);
      const p = db.prepare('SELECT id FROM products WHERE id=? OR slug=?')
        .get(b.product, b.product);
      if (!p) return sendJSON(404, { error: 'محصول یافت نشد' });

      const exists = db.prepare('SELECT 1 FROM wishlist WHERE mobile=? AND product_id=?')
        .get(mobile, p.id);
      if (exists) {
        db.prepare('DELETE FROM wishlist WHERE mobile=? AND product_id=?').run(mobile, p.id);
        return sendJSON(200, { message: 'از علاقه‌مندی حذف شد', saved: false });
      }
      db.prepare('INSERT INTO wishlist (mobile, product_id) VALUES (?,?)').run(mobile, p.id);
      analytics.track('wishlist', p.id, null, req);
      return sendJSON(201, { message: 'به علاقه‌مندی افزوده شد', saved: true });
    }
  }

  // بررسی وضعیت یک محصول در علاقه‌مندی
  if (method === 'GET' && pathname.startsWith('/api/wishlist/check/')) {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(200, { saved: false, guest: true });
    const key = decodeURIComponent(pathname.replace('/api/wishlist/check/', ''));
    const p = db.prepare('SELECT id FROM products WHERE id=? OR slug=?').get(key, key);
    if (!p) return sendJSON(404, { error: 'محصول یافت نشد' });
    const saved = !!db.prepare('SELECT 1 FROM wishlist WHERE mobile=? AND product_id=?')
      .get(mobile, p.id);
    return sendJSON(200, { saved });
  }

  // ═══════════ نظرات ═══════════
  if (method === 'GET' && pathname.startsWith('/api/reviews/')) {
    const key = decodeURIComponent(pathname.replace('/api/reviews/', ''));
    const p = db.prepare('SELECT id FROM products WHERE id=? OR slug=?').get(key, key);
    if (!p) return sendJSON(404, { error: 'محصول یافت نشد' });

    const rows = db.prepare(`
      SELECT id, display_name, rating, title, body, longevity, sillage,
             verified, source, admin_reply, created_at
      FROM reviews WHERE product_id=? AND status='APPROVED'
      ORDER BY verified DESC, created_at DESC LIMIT 50
    `).all(p.id);

    const mobile = otp.mobileFromToken(getCustomerToken(req));
    let mine = null;
    if (mobile) {
      mine = db.prepare('SELECT id, rating, title, body, status FROM reviews WHERE product_id=? AND mobile=?')
        .get(p.id, mobile) || null;
    }

    return sendJSON(200, {
      summary: reviewSummary(p.id),
      reviews: rows,
      my_review: mine,
      can_review: !!mobile,
      purchased: mobile ? !!hasPurchased(mobile, p.id) : false
    });
  }

  /* ── دعوت‌نامه نظر (عمومی) ──
     مشتری فروش حضوری با لینک یکتا وارد می‌شود. بدون ورود با
     رمز، چون این مشتری‌ها اصلاً حساب کاربری ندارند — خودِ لینک
     سند هویت است. */
  if (method === 'GET' && pathname.startsWith('/api/review-invite/')) {
    const token = pathname.replace('/api/review-invite/', '');
    const chk = readReviewInvite(token);
    if (!chk.ok) return sendJSON(410, { error: chk.error, used: !!chk.used });

    const p = db.prepare('SELECT id, slug, name_fa, name_en, brand_fa, image_url FROM products WHERE id=?')
      .get(chk.invite.product_id);
    if (!p) return sendJSON(404, { error: 'محصول این دعوت‌نامه یافت نشد.' });

    return sendJSON(200, {
      product: p,
      // شماره ماسک‌شده تا مشتری مطمئن شود لینک مال خودش است،
      // ولی اگر لینک به دست دیگری افتاد شماره کامل لو نرود
      mobile_masked: chk.invite.mobile.slice(0, 4) + '****' + chk.invite.mobile.slice(-2),
      expires_at: chk.invite.expires_at
    });
  }

  if (method === 'POST' && pathname === '/api/review-invite') {
    const b = await parseBody(req);
    const chk = readReviewInvite(b.token);
    if (!chk.ok) return sendJSON(410, { error: chk.error, used: !!chk.used });
    const inv = chk.invite;

    /* محدودیت نرخ روی خودِ توکن، نه شماره: مشتری حضوری شماره‌اش
       در سامانه ورود نیست و کسی که لینک را دارد فقط یک بار
       می‌تواند استفاده کند — ولی تلاش پیاپی برای دور زدن
       اعتبارسنجی باید متوقف شود. */
    const rl = rateLimit(`invite:${inv.token}`, 10, 3600e3);
    if (!rl.ok) return sendJSON(429, { error: 'تلاش بیش از حد. یک ساعت بعد دوباره امتحان کنید.' });

    const rating = Number(b.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return sendJSON(400, { error: 'امتیاز باید عددی بین ۱ تا ۵ باشد.' });

    const bodyText = cleanText(b.body, 2000);
    if (!bodyText || bodyText.length < 10)
      return sendJSON(400, { error: 'متن نظر باید حداقل ۱۰ حرف باشد.' });

    const clampV = v => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
    };
    const name = cleanText(b.display_name, 40)
      || `${inv.mobile.slice(0, 4)}****${inv.mobile.slice(-2)}`;

    /* ثبت نظر و مصرف دعوت در یک تراکنش.
       اگر مصرف دعوت جدا انجام شود و بین دو دستور خطایی بیفتد،
       یا نظر بدون باطل شدن لینک ثبت می‌شود (قابل تکرار) یا لینک
       می‌سوزد بدون اینکه نظری ثبت شده باشد. */
    let reviewId = null;
    const ok = db.transaction(() => {
      const r = db.prepare(`
        INSERT INTO reviews (product_id, mobile, display_name, rating, title, body,
                             longevity, sillage, verified, status, source)
        VALUES (?,?,?,?,?,?,?,?, 1, 'PENDING', 'INVITED')
        ON CONFLICT(product_id, mobile) DO UPDATE SET
          rating=excluded.rating, title=excluded.title, body=excluded.body,
          longevity=excluded.longevity, sillage=excluded.sillage,
          display_name=excluded.display_name, status='PENDING',
          source='INVITED', created_at=CURRENT_TIMESTAMP
      `).run(inv.product_id, inv.mobile, name, rating,
             cleanText(b.title, 120), bodyText,
             clampV(b.longevity), clampV(b.sillage));

      reviewId = r.lastInsertRowid
        || db.prepare('SELECT id FROM reviews WHERE product_id=? AND mobile=?')
             .get(inv.product_id, inv.mobile)?.id;

      // اتمی — دو درخواست همزمان با یک لینک، فقط یکی می‌گذرد
      return consumeReviewInvite(inv.token, reviewId);
    })();

    if (!ok) return sendJSON(409, { error: 'این دعوت‌نامه هم‌اکنون استفاده شد.' });

    appLog('INFO', 'review', 'نظر با دعوت‌نامه ثبت شد',
      { product: inv.product_id, rating });
    return sendJSON(201, {
      message: 'نظر شما ثبت شد و پس از بررسی منتشر می‌شود. سپاسگزاریم.'
    });
  }

  if (method === 'POST' && pathname === '/api/reviews') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(401, { error: 'برای ثبت نظر ابتدا وارد شوید.' });

    const rl = rateLimit(`review:${mobile}`, 5, 24 * 3600e3);
    if (!rl.ok) return sendJSON(429, { error: 'حداکثر ۵ نظر در روز مجاز است.' });

    const b = await parseBody(req);
    const p = db.prepare('SELECT id FROM products WHERE id=? OR slug=?')
      .get(b.product, b.product);
    if (!p) return sendJSON(404, { error: 'محصول یافت نشد' });

    const rating = Number(b.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return sendJSON(400, { error: 'امتیاز باید عددی بین ۱ تا ۵ باشد.' });
    if (!b.body || String(b.body).trim().length < 10)
      return sendJSON(400, { error: 'متن نظر باید حداقل ۱۰ حرف باشد.' });

    const clamp = v => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
    };
    const verified = hasPurchased(mobile, p.id) ? 1 : 0;
    const name = cleanText(b.display_name, 40)
      || `${mobile.slice(0, 4)}****${mobile.slice(-2)}`;
    const title = cleanText(b.title, 120);
    const bodyText = cleanText(b.body, 2000);
    if (bodyText.length < 10) {
      return sendJSON(400, { error: 'متن نظر باید حداقل ۱۰ حرف باشد.' });
    }

    db.prepare(`
      INSERT INTO reviews (product_id, mobile, display_name, rating, title, body,
                           longevity, sillage, verified, status)
      VALUES (?,?,?,?,?,?,?,?,?, 'PENDING')
      ON CONFLICT(product_id, mobile) DO UPDATE SET
        rating=excluded.rating, title=excluded.title, body=excluded.body,
        longevity=excluded.longevity, sillage=excluded.sillage,
        display_name=excluded.display_name, status='PENDING',
        created_at=CURRENT_TIMESTAMP
    `).run(p.id, mobile, name, rating, title, bodyText,
           clamp(b.longevity), clamp(b.sillage), verified);

    appLog('INFO', 'review', 'نظر جدید ثبت شد', { product: p.id, rating, verified });
    /* خبر به مسئول نظرات — شمار کل صف فرستاده می‌شود نه تک‌تک
       نظرها، چون سقف ساعتی دارد و «۳ نظر در انتظار» مفیدتر از
       سه پیامک جداگانه است. */
    try {
      const pend = db.prepare(
        "SELECT COUNT(*) c FROM reviews WHERE status='PENDING'").get().c;
      require('../alerts').fireAsync('newReview', { count: pend });
    } catch { /* اطلاع‌رسانی نباید ثبت نظر را بشکند */ }

    return sendJSON(201, {
      message: 'نظر شما ثبت شد و پس از بررسی منتشر می‌شود.',
      verified: !!verified
    });
  }

  // ═══════════ اطلاع موجود شدن ═══════════
  if (method === 'POST' && pathname === '/api/stock-alert') {
    const arl = rateLimit(`alert:${reqIP}`, RL.alert.limit, RL.alert.window, RL.alert.block);
    if (!arl.ok) {
      return sendJSON(429, {
        error: `درخواست‌های بیش از حد. ${fa(Math.ceil(arl.retry_after / 60))} دقیقه دیگر تلاش کنید.`
      });
    }
    const b = await parseBody(req);
    const mobile = otp.mobileFromToken(getCustomerToken(req))
      || (b.mobile ? otp.normalizeMobile(b.mobile) : null);
    if (!mobile || !otp.isValidMobile(mobile))
      return sendJSON(400, { error: 'شماره موبایل معتبر وارد کنید.' });

    const v = db.prepare(`SELECT v.sku, v.stock, v.price_toman, p.supply_mode FROM variants v
      JOIN products p ON p.id=v.product_id WHERE v.sku=? AND ${publicVariantSql('v')}`).get(b.sku);
    if (!v) return sendJSON(404, { error: 'کالا یافت نشد' });
    if (variantAvailability(v.supply_mode,v.stock,v.price_toman).state === 'IN_STOCK')
      return sendJSON(400, { error: 'این کالا هم‌اکنون موجود است.' });

    db.prepare('INSERT OR IGNORE INTO stock_alerts (sku, mobile) VALUES (?,?)')
      .run(b.sku, mobile);
    return sendJSON(201, { message: 'به‌محض موجود شدن، پیامک اطلاع‌رسانی می‌شود.' });
  }

  /* ── نوار اعلان (عمومی) ──
     تک‌پیامی و بدون چرخش. پژوهش‌ها نشان می‌دهند بنر اسلایدی
     فقط ۱٪ کلیک می‌گیرد و ۸۴٪ همان کلیک روی اسلاید اول است —
     پس چرخش عملاً پیام‌های بعدی را نامرئی می‌کند و CLS را هم
     خراب می‌کند. یک پیام، همان که مهم‌تر است. */
  if (method === 'GET' && pathname === '/api/notice') {
    const today = shopTime.dateKey();
    const n = db.prepare(`
      SELECT id, text, link, link_label, tone FROM notices
      WHERE active = 1
        AND (starts_at IS NULL OR starts_at <= @today)
        AND (ends_at   IS NULL OR ends_at   >= @today)
      ORDER BY id DESC LIMIT 1
    `).get({ today });
    return sendJSON(200, { notice: n || null });
  }

  // پیگیری سفارش با موبایل
  if ((method === 'GET' || method === 'POST') && pathname === '/api/orders/track') {
    // No listing by phone alone; both pieces are necessary. POST keeps them out
    // of access-log query strings. GET remains for existing clients.
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Pragma','no-cache');
    const data=method==='POST' ? await parseBody(req) : parsed.query;
    const mobile=String(data.mobile||'').trim();
    const oid=String(data.order_id||'').trim().toUpperCase();
    if (!/^09\d{9}$/.test(mobile)) return sendJSON(400,{error:'شماره موبایل معتبر وارد کنید.'});
    if (!/^[A-Z0-9_-]{1,80}$/.test(oid)) return sendJSON(400,{error:'شماره سفارش معتبر الزامی است.'});
    const ipRl=rateLimit(`track-ip:${reqIP}`,RL.trackIp.limit,RL.trackIp.window,RL.trackIp.block);
    if(!ipRl.ok)return sendJSON(429,{error:`درخواست‌های بیش از حد. ${fa(Math.ceil(ipRl.retry_after/60))} دقیقه دیگر تلاش کنید.`});
    const phRl=rateLimit(`track-ph:${mobile}`,RL.trackPhone.limit,RL.trackPhone.window,RL.trackPhone.block);
    if(!phRl.ok)return sendJSON(429,{error:`برای این شماره درخواست‌های زیادی ثبت شده. ${fa(Math.ceil(phRl.retry_after/60))} دقیقه دیگر تلاش کنید.`});
    const orderKey='track-order:'+crypto.createHash('sha256').update(oid).digest('hex');
    const orderRl=rateLimit(orderKey,RL.trackOrder.limit,RL.trackOrder.window,RL.trackOrder.block);
    if(!orderRl.ok)return sendJSON(429,{error:`برای این سفارش درخواست‌های زیادی ثبت شده. ${fa(Math.ceil(orderRl.retry_after/60))} دقیقه دیگر تلاش کنید.`});
    const o=db.prepare('SELECT order_id,created_at,status,total_paid,tracking_code,carrier FROM orders WHERE mobile=? AND order_id=?').get(mobile,oid);
    if(!o)return sendJSON(200,{total:0,orders:[]});
    const items=db.prepare('SELECT sku,product_name,quantity,unit_price,line_total FROM order_items WHERE order_id=?').all(o.order_id);
    return sendJSON(200,{total:1,orders:[{...o,items}]});
  }

  return false;   // هیچ‌کدام از مسیرهای این ماژول نبود
}

module.exports = { handle };
