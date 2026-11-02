/**
 * عطر یزد | Yazd Perfume — سرور اصلی
 * ----------------------------------
 * دیتابیس: SQLite واقعی (src/db.js)
 * امنیت: اعتبارسنجی قیمت سمت سرور + محافظت از مسیرهای ادمین
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const zlib = require('zlib');
const { isPublicVariant, publicVariantSql } = require('./variant-visibility');
const { variantAvailability } = require('./availability');

const {
  db, parseProduct, attachVariants, DB_PATH,
  validateCoupon, recordCouponUse, releaseCouponUse, logStatus,
  campaignDiscount, campaignPercentFor, activeCampaigns, attachCampaign,
  bustCampaignCache,
  createSession, readSession, destroySession,
  rateLimit, resetRateLimit, appLog, releaseStaleOrders, setStockFreedHandler, PENDING_TTL_MIN,
  hashPassword, verifyPassword, getRole, listRoles,
  getCustomer, createCustomer, setCustomerPassword,
  saveCustomerAddress, publicCustomer, publicStaff,
  getStaff, getStaffByUsername, listStaff, audit, purgeAudit,
  reviewSummary, hasPurchased,
  createReviewInvite, readReviewInvite, consumeReviewInvite, INVITE_TTL_DAYS,
  getSettings, saveSettings, nextInvoiceNo,
  buildSearchIndex, buildNotesIndex, listNotes, normalizeFa,
  storeStats, bustStatsCache
} = require('./db');
const reports = require('./reports').build(db);
const analytics = require('./analytics').build(db, appLog);
/* پروفایل بویایی — منطق امتیازدهی کوییز، بیرون کشیده شده تا هم
   `/api/quiz` و هم «پیشنهاد برای شما» از یک نسخه استفاده کنند.
   منطق تکراری در دو جا یعنی دیر یا زود دو نتیجه متفاوت. */
const taste = require('./taste').build(db, { parseProduct, attachVariants });
const pay = require('./payment');
const otp = require('./otp');
const perms = require('./permissions');
const notify = require('./notify');
const alerts = require('./alerts');
const media  = require('./media');
const seo = require('./seo');

/* ── مسیرهای جداشده ──
   `server.js` به ۴٬۳۵۱ خط رسیده بود و بزرگ‌ترین ریسک نگهداری
   پروژه شده. تفکیک تدریجی انجام می‌شود: هر ماژول یک `ctx`
   می‌گیرد و `true` برمی‌گرداند اگر مسیر را رسیدگی کرده باشد.

   عمداً از کم‌خطرترین بخش شروع شد (مقالات). مسیرهای پرداخت و
   ثبت سفارش تا تأیید این الگو دست‌نخورده می‌مانند. */
const routeArticles = require('./routes/articles');
const routeTickets  = require('./routes/tickets');
const routeRbac     = require('./routes/rbac');
const routeAdminCatalog = require('./routes/admin-catalog');
const routeAdminOrders  = require('./routes/admin-orders');
const routeAdminMarketing = require('./routes/admin-marketing');
const routeAdminSystem  = require('./routes/admin-system');
const routeAdminReviews = require('./routes/admin-reviews');
const routeAuth         = require('./routes/auth');
const routeCatalog      = require('./routes/catalog');
const routeEngagement   = require('./routes/engagement');
const essences = require('./essences');

/** چرخه مجاز وضعیت سفارش */
const ORDER_FLOW = {
  // وضعیت گذرا هنگام گفت‌وگو با درگاه؛ در همان درخواست تعیین تکلیف می‌شود
  VERIFYING:  ['PAID', 'CANCELLED', 'FAILED'],
  PENDING:    ['PAID', 'CANCELLED', 'FAILED'],
  PAID:       ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED:    ['DELIVERED', 'RETURNED'],
  DELIVERED:  ['RETURNED'],
  CANCELLED:  [],
  FAILED:     [],
  RETURNED:   []
};
const STATUS_FA = {
  PENDING: 'در انتظار پرداخت', PAID: 'پرداخت شده',
  PROCESSING: 'در حال آماده‌سازی', SHIPPED: 'ارسال شده',
  DELIVERED: 'تحویل داده شده', CANCELLED: 'لغو شده',
  FAILED: 'ناموفق', RETURNED: 'مرجوع شده', EXPIRED: 'منقضی شده',
  VERIFYING: 'در حال تأیید پرداخت'
};
ORDER_FLOW.EXPIRED = [];

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const SESSION_TTL = 8 * 3600 * 1000; // نشست ادمین: ۸ ساعت

function isValidSession(token) {
  return !!readSession(token, 'ADMIN');
}

/**
 * کارمند صاحب این نشست را برمی‌گرداند، همراه با مجوزهایش.
 *
 * نشست فقط شناسه کارمند را نگه می‌دارد؛ مجوزها هر بار از نقش
 * خوانده می‌شوند. یعنی اگر مدیر نقشی را تغییر دهد، بلافاصله روی
 * همه کاربران آن نقش اثر می‌گذارد — بدون نیاز به ورود دوباره.
 */
function currentStaff(token) {
  const sess = readSession(token, 'ADMIN');
  if (!sess) return null;

  const id = parseInt(sess.subject);
  if (!Number.isInteger(id)) return null;

  const st = getStaff(id);
  if (!st || !st.active) return null;      // حساب غیرفعال‌شده فوراً بی‌اثر است
  return st;
}

/** IP واقعی پشت پروکسی Liara */
function clientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** سیاست‌های محدودیت نرخ */
const RL = {
  login:    { limit: 6,   window: 10 * 60e3, block: 15 * 60e3 },
  otpIp:    { limit: 12,  window: 60 * 60e3, block: 30 * 60e3 },
  otpPhone: { limit: 5,   window: 60 * 60e3, block: 60 * 60e3 },
  /* سقف سفارش از هر IP. متغیر محیطی فقط برای آزمون همزمانی
     است — در تولید تنظیم نمی‌شود و همان ۱۰ می‌ماند. */
  order:    { limit: parseInt(process.env.RL_ORDER_LIMIT) || 10,
              window: 10 * 60e3, block: 10 * 60e3 },
  api:      { limit: 300, window: 60e3,      block: 0 },
  /* ── مسیرهای عمومی نوشتاری (ممیزی مرداد ۱۴۰۵) ──
     `/api/track`، `/api/tickets` و `/api/stock-alert` هیچ
     محدودیتی نداشتند. هر سه به دیتابیس **می‌نویسند** و از
     بیرون بدون احراز هویت قابل صدا زدن‌اند.

     خطر اندازه‌گیری‌شده: ۴۰ درخواست به `/api/track` در ۳۳۷
     میلی‌ثانیه، همه پذیرفته — یعنی یک اسکریپت ساده می‌تواند
     جدول `events` را باد کند، دیسک لیارا را پر کند و آمار
     «پربازدیدترین» را آلوده کند.

     سقف‌ها سخاوتمندانه‌اند تا کاربر واقعی هرگز نخورد: یک بازدید
     عادی حدود ۵ تا ۱۰ رویداد می‌سازد. */
  track:    { limit: 120, window: 60e3,      block: 5 * 60e3 },
  ticket:   { limit: 5,   window: 60 * 60e3, block: 60 * 60e3 },
  alert:    { limit: 10,  window: 60 * 60e3, block: 30 * 60e3 },
  /* ── پیشنهاد بویایی (ممیزی مرداد ۱۴۰۵) ──
     `/api/taste/suggest` کل جدول محصولات را می‌خواند و برای هر
     ۲٬۱۱۱ ردیف امتیاز حساب می‌کند. اندازه‌گیری: ۵۰ میلی‌ثانیه در
     برابر ۲.۵ میلی‌ثانیه `/api/products` — بیست برابر گران‌تر.

     ۴۰ درخواست موازی در ۲.۲ ثانیه همه پذیرفته شدند. روی لیارا با
     دو هسته، این ارزان‌ترین راه از پا درآوردن سرور بود.

     سقف سخاوتمندانه است: کاربر واقعی این مسیر را یک بار در هر
     بارگذاری صفحه اصلی صدا می‌زند.

     block صفر عمدی است: این مسیر مثل ورود یا سفارش نیست که تلاش
     مکرر نشانه حمله باشد. کاربر عادی ممکن است چند تب باز کند.
     با block صفر، پس از پایان پنجره یک‌دقیقه‌ای بلافاصله دوباره
     کار می‌کند — سقف هست، مجازات نیست. */
  taste:    { limit: 30,  window: 60e3,      block: 0 },
  /* ── پیگیری سفارش (ممیزی جعبه‌سیاه مرداد ۱۴۰۵) ──
     این مسیر با **فقط شماره موبایل** و بدون احراز هویت، نام،
     نشانی کامل و کد پستی مشتری را برمی‌گرداند. هیچ محدودیتی
     نداشت: ۲۵ درخواست پیاپی، هر ۲۵ تا پذیرفته شد.

     یعنی کسی که فهرستی از شماره‌ها دارد — که در ایران به‌سادگی
     به دست می‌آید — می‌توانست نشانی منزل مشتریان را استخراج کند.
     این ریسک امنیت فیزیکی است، نه فقط حریم خصوصی.

     ── چرا دو سطل جدا ──
     `trackIp` جلوی پویش انبوه از یک منبع را می‌گیرد.
     `trackPhone` جلوی حالتی را می‌گیرد که مهاجم IP عوض می‌کند
     ولی یک شماره هدف را می‌کوبد.

     سقف‌ها برای کاربر واقعی سخاوتمندانه‌اند: کسی که سفارشش را
     پیگیری می‌کند، دو سه بار در روز صفحه را باز می‌کند. */
  trackIp:    { limit: 15, window: 10 * 60e3, block: 30 * 60e3 },
  trackPhone: { limit: 8,  window: 60 * 60e3, block: 60 * 60e3 }
};
function getToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/yazd_admin=([a-f0-9]+)/);
  return m ? m[1] : null;
}

/** توکن مشتری (جدا از ادمین) */
function getCustomerToken(req) {
  const h = req.headers['x-customer-token'];
  if (h) return h;
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/yazd_customer=([a-f0-9]+)/);
  return m ? m[1] : null;
}

// ═══════════════════════════════════════════
/**
 * شماره سفارش یکتا.
 *
 * چرا این تابع لازم شد: نسخه پیش فقط `Date.now()` بود و دقتش
 * میلی‌ثانیه است. بنچمارک نشان داد از **دومین خریدار همزمان**
 * به بعد ۲۲ تا ۳۵ درصد سفارش‌ها با خطای دیتابیس رد می‌شوند:
 *   UNIQUE constraint failed: orders.order_id
 * مشتری فقط «خطای داخلی سرور» می‌دید — سبدش را از دست داده بود
 * بی‌آنکه بداند چرا.
 *
 * ساختار: YZD-<زمان بر مبنای ۳۶><۴ نویسه تصادفی>
 * مثال:   YZD-MS4MSMI0-K7QX
 *
 * بخش زمان مرتب‌پذیری را حفظ می‌کند (شماره‌های جدیدتر بزرگ‌ترند)
 * و بخش تصادفی برخورد را عملاً غیرممکن می‌سازد: ۳۶^۴ = ۱٬۶۷۹٬۶۱۶
 * حالت در هر میلی‌ثانیه. حتی با ۱۰۰ سفارش در همان میلی‌ثانیه،
 * احتمال برخورد حدود ۰٫۰۰۳ درصد است.
 *
 * از randomBytes استفاده می‌شود نه Math.random — شماره سفارش در
 * پیامک و لینک پیگیری می‌رود و نباید قابل حدس باشد.
 */
function newOrderId() {
  const t = Date.now().toString(36).toUpperCase();
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const b = crypto.randomBytes(4);
  let r = '';
  for (let i = 0; i < 4; i++) r += A[b[i] % A.length];
  return `YZD-${t}-${r}`;
}

// ═══════════════════════════════════════════
// قوانین ارسال (طبق توافق)
// ═══════════════════════════════════════════
/* نرخ ارسال یکسان است — بدون استثنا برای هیچ شهری.
   پیش‌تر شهر یزد نرخ جدا داشت؛ حذف شد چون تفاوت قیمت برای مشتری
   شهرستانی حس تبعیض می‌سازد و توضیح دادنش در هر صفحه هزینه
   ارتباطی دارد. یک عدد، همه‌جا. */
const SHIPPING = {
  FLAT: 100000,
  FREE_THRESHOLD: 2000000
};

/** بسته‌بندی کادویی — سرویس اختیاری در تسویه */
const GIFT_WRAP_FEE = 70000;

function calcShipping(subtotal) {
  if (subtotal >= SHIPPING.FREE_THRESHOLD) {
    return { fee: 0, label: 'رایگان (خرید بالای ۲٬۰۰۰٬۰۰۰ تومان)' };
  }
  return { fee: SHIPPING.FLAT, label: 'پست / تیپاکس سراسری (۱۰۰٬۰۰۰ تومان)' };
}

/**
 * هزینه بسته‌بندی کادویی.
 *
 * ورودی از کاربر می‌آید، پس هرگز مستقیم به مبلغ تبدیل نمی‌شود —
 * فقط «هست یا نیست». مبلغ همیشه از ثابت سرور خوانده می‌شود تا
 * دستکاری سمت مشتری بی‌اثر بماند.
 */
function calcGiftWrap(wanted) {
  return wanted ? GIFT_WRAP_FEE : 0;
}

/**
 * اعتبارسنجی سبد خرید — قیمت‌ها از دیتابیس خوانده می‌شوند، نه از کاربر.
 * جلوی دستکاری قیمت را می‌گیرد.
 */
/**
 * نام کامل و خوانای یک متغیر محصول.
 * برچسب سمپل خودش حجم را در خود دارد («سمپل ۳ میل تست»)، پس اگر
 * کورکورانه حجم را بچسبانیم نتیجه «سمپل ۳ میل تست 3 میل» می‌شود.
 * ضمناً حجم با رقم فارسی نوشته می‌شود تا با بقیه متن جور دربیاید.
 */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faNum = n => String(n).replace(/\d/g, d => FA_DIGITS[d]);

function variantLabel(row) {
  const label = (row.type_label || '').trim();
  const ml = row.volume_ml;
  // اگر برچسب پیش‌تر «میل» را ذکر کرده، دوباره اضافه نکن
  const hasVolume = !ml || /میل/.test(label);
  return hasVolume ? label : `${label} ${faNum(ml)} میل`.trim();
}

function variantFullName(row) {
  const base = row.brand_fa ? `${row.brand_fa} — ${row.name_fa}` : row.name_fa;
  const lbl = variantLabel(row);
  return lbl ? `${base} — ${lbl}` : base;
}

/**
 * اطلاع‌رسانی به منتظران یک کالا.
 *
 * موجودی از چهار راه می‌تواند از صفر بالا برود: ویرایش ادمین، لغو
 * سفارش، پرداخت ناموفق، و انقضای سفارش پرداخت‌نشده. پیش‌تر تنها
 * راه اول اطلاع می‌داد و کسی که «خبرم کن» زده بود در سه حالت دیگر
 * هرگز خبردار نمی‌شد.
 *
 * @param {string[]} skus  کالاهایی که موجودی‌شان تغییر کرده
 * @param {string} reason  برای لاگ
 * @returns {number} تعداد پیامک ارسال‌شده
 */
function notifyStockWatchers(skus, reason = 'موجودی') {
  const list = [...new Set((skus || []).filter(Boolean))];
  if (!list.length) return 0;

  let total = 0;
  for (const sku of list) {
    // تنها اگر واقعاً موجود شده باشد
    const v = db.prepare(`SELECT v.stock, v.type, v.volume_ml, v.price_toman, p.supply_mode
      FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=?`).get(sku);
    if (!v || !isPublicVariant(v.type, v.volume_ml) ||
        variantAvailability(v.supply_mode, v.stock, v.price_toman).state !== 'IN_STOCK') continue;

    const waiting = db.prepare(
      'SELECT mobile FROM stock_alerts WHERE sku=? AND notified=0'
    ).all(sku);
    if (!waiting.length) continue;

    const info = db.prepare(`
      SELECT p.name_fa, p.brand_fa, p.slug, v.volume_ml, v.type_label
      FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ?
    `).get(sku);
    if (!info) continue;

    const full = info.brand_fa ? `${info.brand_fa} — ${info.name_fa}` : info.name_fa;
    const site = (process.env.SITE_URL || 'https://yazdperfume.ir').replace(/\/$/, '');
    const text = `عطر یزد\n\n${full}\n${variantLabel(info)}`
      + `\n\nکالای مورد نظر شما موجود شد.\n${site}/perfume/${info.slug}`;

    waiting.forEach(w => notify.send(w.mobile, text, 'موجودی').catch(() => {}));
    db.prepare('UPDATE stock_alerts SET notified=1 WHERE sku=? AND notified=0').run(sku);

    total += waiting.length;
    appLog('INFO', 'stock', 'اطلاع‌رسانی موجود شدن',
           { sku, count: waiting.length, reason });
  }
  return total;
}

/**
 * تبدیل ارقام فارسی/عربی به لاتین و حذف جداکننده‌ها.
 *
 * کاربر ممکن است کد ملی را با ارقام فارسی، خط تیره یا فاصله وارد
 * کند («۱۲۳-۴۵۶-۷۸۹۰»). بدون این تبدیل، اعتبارسنجی ۱۰ رقمی رد
 * می‌کرد و کاربر نمی‌فهمید چرا.
 */
function normalizeDigits(v) {
  return String(v || '')
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[\s\-_.]/g, '')
    .trim();
}

/**
 * ثبت خرید موفق در تحلیل.
 *
 * سمت سرور ثبت می‌شود، نه از مرورگر — رویداد خرید مبنای
 * «پرفروش‌ترین» است و نباید با یک درخواست ساختگی قابل دستکاری باشد.
 * برای هر قلم سفارش یک رویداد جدا ثبت می‌شود تا بتوان محصول را شمرد.
 */
function trackPurchase(order, req) {
  try {
    const items = db.prepare(`
      SELECT v.product_id pid, i.quantity q
      FROM order_items i JOIN order_variant_history v ON v.sku = i.sku
      WHERE i.order_id = ?
    `).all(order.order_id);

    for (const it of items) {
      analytics.track('purchase', it.pid,
        { order: order.order_id, qty: it.q }, req);
    }
  } catch { /* تحلیل هرگز نباید پرداخت را بشکند */ }
}

/**
 * پاک‌سازی متن ورودی کاربر.
 *
 * دفاع لایه‌ای: فرانت با esc() خروجی را خنثی می‌کند، ولی به آن
 * تکیه نمی‌کنیم. اگر روزی جایی از قلم بیفتد یا کسی مستقیم API را
 * صدا بزند، داده مخرب نباید اصلاً وارد دیتابیس شود.
 *
 * تگ‌های HTML کاملاً حذف می‌شوند — نظر و تیکت به قالب‌بندی نیاز
 * ندارند و اجازه دادنش فقط سطح حمله را باز می‌کند.
 */
function cleanText(input, maxLen = 2000) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/<[^>]*>/g, '')          // هر تگ HTML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')  // نویسه کنترلی
    .replace(/javascript\s*:/gi, '')  // پروتکل خطرناک در متن
    .replace(/\son\w+\s*=/gi, ' ')   // هندلر رویداد
    .trim()
    .slice(0, maxLen);
}

function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'سبد خرید خالی است.' };
  }
  /* فیلدهای دامنه (خانواده، نوع، جنسیت، شناسه محصول) هم خوانده
     می‌شوند چون کوپن و جشنواره می‌توانند فقط روی بخشی از سبد
     اعمال شوند — مثلاً «۲۰٪ روی عطرهای چوبی». بدون این فیلدها
     دامنه‌سنجی نیازمند کوئری دوم به‌ازای هر قلم بود. */
  const stmt = db.prepare(`
    SELECT v.sku, v.price_toman, v.stock, v.volume_ml, v.type_label, v.type,
           p.name_fa, p.name_en, p.slug, p.brand_fa, p.id AS product_id,
           p.family_slug, p.gender, p.supply_mode
    FROM variants v JOIN products p ON p.id = v.product_id
    WHERE v.sku = ?
  `);

  const validated = [];
  let subtotal = 0;

  if (items.length > 30) {
    return { ok: false, error: 'تعداد اقلام سبد بیش از حد مجاز است.' };
  }

  for (const item of items) {
    const raw = Number(item.quantity);
    if (!Number.isInteger(raw) || raw < 1) {
      return { ok: false, error: 'تعداد کالا باید عددی صحیح و بزرگ‌تر از صفر باشد.' };
    }
    const qty = raw;
    if (qty > 50) {
      return { ok: false, error: 'حداکثر ۵۰ عدد از هر کالا در یک سفارش مجاز است.' };
    }
    const row = stmt.get(item.sku);
    if (!row) return { ok: false, error: `کالای «${item.sku}» یافت نشد.` };
    const availability = variantAvailability(row.supply_mode, row.stock, row.price_toman);
    if (!isPublicVariant(row.type, row.volume_ml) || availability.state === 'UNAVAILABLE') {
      return { ok: false, error: `«${row.name_fa}» فعلاً قابل تهیه نیست.` };
    }
    if (qty > availability.max_quantity) {
      return { ok: false, error: availability.state === 'MADE_TO_ORDER'
        ? `«${row.name_fa}» به سفارش ساخته می‌شود؛ حداکثر ۵ عدد در هر سفارش.`
        : `موجودی «${row.name_fa}» کافی نیست (موجود: ${row.stock}).` };
    }
    const madeToOrder = availability.state === 'MADE_TO_ORDER';
    const lineTotal = row.price_toman * qty;   // قیمت از دیتابیس
    subtotal += lineTotal;
    validated.push({
      sku: row.sku,
      product_name: variantFullName(row),
      slug: row.slug,
      unit_price: row.price_toman,
      quantity: qty,
      line_total: lineTotal,
      // فیلدهای دامنه — در پاسخ API فرستاده نمی‌شوند، فقط برای
      // محاسبه تخفیف داخلی به کار می‌روند
      _product_id: row.product_id,
      _family: row.family_slug,
      _brand: row.brand_fa,
      _type: row.type,
      _gender: row.gender
    });
  }
  return { ok: true, items: validated, subtotal };
}

// ═══════════════════════════════════════════
/** ساخت نشانی خوانا — فارسی و لاتین را پشتیبانی می‌کند */
function slugify(text) {
  return String(text || '')
    .trim()
    .replace(/[\u200c\u200f\u200e]/g, '')        // نیم‌فاصله و کاراکترهای جهت
    .replace(/[^\p{L}\p{N}]+/gu, '-')            // هر چیز غیرحرف و عدد
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'article';
}

/** خطای ورودی کاربر — با ۴۰۰ پاسخ داده می‌شود، نه ۵۰۰ */
class BadRequest extends Error {
  constructor(msg) { super(msg); this.name = 'BadRequest'; this.statusCode = 400; }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 1e6) {
        req.destroy();
        reject(new BadRequest('حجم درخواست بیش از حد مجاز است.'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        const parsed = JSON.parse(body);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new BadRequest('ساختار داده ارسالی نامعتبر است.'));
        }
        resolve(parsed);
      } catch {
        reject(new BadRequest('داده ارسالی قالب معتبری ندارد.'));
      }
    });
    req.on('error', () => reject(new BadRequest('خطا در دریافت داده.')));
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  /* بدون این سطر، manifest با نوع octet-stream می‌رفت و کروم آن را
     نادیده می‌گرفت — یعنی «افزودن به صفحه اصلی» روی اندروید نام و
     آیکن برند را نشان نمی‌داد. */
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  /* HEAD باید دقیقاً مثل GET مسیریابی شود ولی بدون بدنه.
     پیش از این HEAD به هیچ شرطی نمی‌خورد و همه‌چیز ۴۰۴ می‌گرفت —
     ابزارهای پایش آپ‌تایم، بررسی‌کننده‌های لینک و بعضی خزنده‌ها
     اول HEAD می‌زنند و سایت را «از دسترس خارج» گزارش می‌کردند.
     RFC 9110: پاسخ HEAD باید همان هدرهای GET را داشته باشد. */
  const isHead = req.method === 'HEAD';
  const method = isHead ? 'GET' : req.method;

  if (isHead) {
    const realEnd = res.end.bind(res);
    const realWrite = res.write.bind(res);
    res.write = () => true;                 // بدنه دور ریخته می‌شود
    res.end = (...a) => realEnd();          // هدرها دست‌نخورده می‌مانند
    void realWrite;
  }

  /* ── CORS ──
     کاتالوگ عمومی است و اشکالی ندارد از هر دامنه‌ای خوانده شود.
     ولی مسیرهای مدیریتی و حساب مشتری نباید از دامنه دیگر قابل
     صدا زدن باشند — وگرنه سایتی که مشتری بازش کرده می‌تواند با
     توکن او درخواست بفرستد. */
  /* مسیرهای نوشتاری هم بسته شدند: بدون این، سایت دیگری می‌توانست
     فرم سفارش یا ثبت نظر ما را روی دامنه خودش سوار کند و از طرف
     بازدیدکننده‌اش سفارش ثبت کند. فقط خواندن کاتالوگ باز می‌ماند. */
  const isPrivate = pathname.startsWith('/api/admin')
                 || pathname.startsWith('/api/auth')
                 || pathname.startsWith('/api/wishlist')
                 || pathname.startsWith('/api/orders')
                 || pathname.startsWith('/api/reviews')
                 // دعوت‌نامه هم نوشتاری است: بدون این، سایت دیگری
                 // می‌توانست با توکنِ دزدیده‌شده نظر ثبت کند
                 || pathname.startsWith('/api/review-invite')
                 || pathname.startsWith('/api/tickets')
                 || pathname.startsWith('/api/cart')
                 || pathname.startsWith('/api/stock-alert')
                 || pathname.startsWith('/api/payment');
  if (!isPrivate) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  /* ── هدرهای امنیتی ──
     فروشگاهی که پرداخت می‌گیرد باید جلوی جاسازی در iframe را
     بگیرد؛ بدون آن حمله کلیک‌دزدی ممکن است: مهاجم صفحه پرداخت
     را نامرئی روی سایت خودش می‌گذارد و کلیک کاربر را می‌دزدد. */
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()');

  /* HSTS تنها روی HTTPS معنا دارد. Liara پشت پروکسی TLS است، پس
     از هدر فوروارد تشخیص داده می‌شود — نه از req.socket. */
  if ((req.headers['x-forwarded-proto'] || '') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  /* ── Content-Security-Policy ──
     آخرین خط دفاع در برابر XSS: حتی اگر روزی کد مهاجم از فیلتر
     ما رد شود، مرورگر اجازه نمی‌دهد به دامنه بیرونی وصل شود یا
     اسکریپت بیگانه بار کند.

     چرا 'unsafe-inline'؟ صفحات این پروژه اسکریپت و استایل درون‌خطی
     دارند (طراحی تک‌فایلی، بدون فرآیند بیلد). حذف آن یعنی بازنویسی
     هر ۲۳ صفحه. حتی با آن، این سیاست جلوی مهم‌ترین بردار حمله را
     می‌گیرد: بارگذاری اسکریپت از دامنه مهاجم و نشت داده به بیرون.

     img-src داده‌های base64 را می‌پذیرد چون بارکد فاکتور و برخی
     آیکن‌ها این‌طور جاسازی شده‌اند.

     تنها استثنای دامنه بیرونی: `trustseal.enamad.ir` — نشان اعتماد
     الکترونیک باید از سرور خودِ اینماد بار شود، وگرنه احراز انجام
     نمی‌گیرد و کپی محلی هم تخلف است.

     دقت کنید این استثنا **فقط برای تصویر** است. `script-src`
     دست‌نخورده مانده، پس حتی اگر سرور اینماد روزی دستکاری شود،
     نمی‌تواند روی این سایت کد اجرا کند. بدترین حالت: تصویر نشان
     نمی‌آید. */
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://trustseal.enamad.ir",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    /* ── ویدیوی آپارات ──
       تنها دامنه‌ای که اجازه iframe دارد. بدون این، ویدیوی
       مقاله‌ها مسدود می‌شود و قاب سیاه می‌ماند.

       `frame-src` فقط اجازه **نمایش** می‌دهد؛ اسکریپت آپارات
       داخل iframe در بافت جدا اجرا می‌شود و به صفحه ما دسترسی
       ندارد. بدترین حالت: ویدیو بار نمی‌شود. */
    "frame-src 'self' https://www.aparat.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'"
  ].join('; '));

  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  /** آیا مرورگر gzip می‌پذیرد؟ */
/* ── نشانی IP در سطح درخواست ──
     پیش‌تر هر بلوک `const ip = clientIP(req)` خودش را داشت (۵ بار
     تکرار). هنگام افزودن محدودیت نرخ به `/api/track` معلوم شد
     بلوک‌های دیگر به آن دسترسی ندارند و `ip is not defined`
     می‌دهند — خطایی که در `catch` بلعیده می‌شد و کاربر ۲۰۰
     می‌گرفت. یک بار اینجا تعریف می‌شود تا همه‌جا در دسترس باشد. */
  const reqIP = clientIP(req);

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');

  /** ارسال با فشرده‌سازی برای پاسخ‌های بزرگ */
  const sendBody = (code, body, contentType, extraHeaders = {}) => {
    const buf = Buffer.from(body, 'utf-8');
    const headers = { 'Content-Type': contentType, ...extraHeaders };

    // زیر ۱ کیلوبایت، فشرده‌سازی سربارش بیشتر از سودش است
    if (acceptsGzip && buf.length > 1024) {
      zlib.gzip(buf, { level: 6 }, (err, gz) => {
        if (err) { res.writeHead(code, headers); return res.end(buf); }
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = headers['Vary'] ? headers['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
        res.writeHead(code, headers);
        res.end(gz);
      });
      return;
    }
    res.writeHead(code, headers);
    res.end(buf);
  };

  const sendJSON = (code, data) => {
    // در تولید فاصله‌گذاری لازم نیست
    const json = process.env.NODE_ENV === 'production'
      ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    sendBody(code, json, 'application/json; charset=utf-8');
  };
  /* ── احراز هویت و مجوز کارکنان ──
     `who` یک بار محاسبه می‌شود و در طول درخواست در دسترس است. */
  const who = currentStaff(getToken(req));

  /** ثبت در سابقه با اطلاعات کارمند فعلی */
  const logAudit = (action, extra = {}) => {
    audit({
      staff_id: who?.id ?? null,
      username: who?.username ?? null,
      role_key: who?.role_key ?? null,
      action, method, path: pathname,
      ip: clientIP(req),
      ...extra
    });
  };

  /**
   * بررسی مجوز.
   *
   * @param {string} perm کلید مجوز، مثل 'orders.cancel'
   * @returns {boolean} اگر false برگرداند، پاسخ خطا فرستاده شده
   */
  const can = (perm) => {
    if (!who) {
      sendJSON(401, { error: 'دسترسی غیرمجاز — لطفاً وارد پنل مدیریت شوید.' });
      return false;
    }
    /* رمز اولیه هنوز عوض نشده؟ حساب در حالت «نیمه‌باز» است.
       تا وقتی رمزی که مدیر روی کاغذ به کارمند داده تغییر نکند،
       هیچ کار واقعی انجام نمی‌شود — فقط ورود، دیدن هویت خود و
       تغییر رمز. وگرنه رمز اولیه عملاً یک رمز دائمی است که
       دست‌کم دو نفر می‌دانندش. */
    if (who.must_change) {
      logAudit(perm, { allowed: false, detail: { reason: 'رمز اولیه تغییر نکرده' } });
      sendJSON(403, {
        error: 'برای ادامه باید رمز عبور اولیه را عوض کنید.',
        must_change: true
      });
      return false;
    }
    if (!who.permissions.includes(perm)) {
      // تلاش ناموفق هم ثبت می‌شود — برای تشخیص سوءاستفاده
      logAudit(perm, { allowed: false });
      appLog('WARN', 'security', 'تلاش دسترسی بدون مجوز',
             { user: who.username, perm, path: pathname });
      sendJSON(403, {
        error: 'شما اجازه انجام این کار را ندارید.',
        required: perm
      });
      return false;
    }
    logAudit(perm);
    return true;
  };

  /** سازگاری با کد قدیمی: هر کارمند واردشده */
  const requireAdmin = () => {
    if (who) return true;
    sendJSON(401, { error: 'دسترسی غیرمجاز — لطفاً وارد پنل مدیریت شوید.' });
    return false;
  };

  try {
    // ═══════════ ورود ادمین ═══════════
    if (method === 'POST' && pathname === '/api/admin/login') {
      const ip = clientIP(req);
      const rl = rateLimit(`login:${ip}`, RL.login.limit, RL.login.window, RL.login.block);
      if (!rl.ok) {
        appLog('WARN', 'security', 'تلاش‌های مکرر ورود ادمین', { ip });
        return sendJSON(429, {
          error: `تلاش‌های ناموفق بیش از حد. ${Math.ceil(rl.retry_after / 60)} دقیقه دیگر تلاش کنید.`,
          retry_after: rl.retry_after
        });
      }

      const body = await parseBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');

      /* سازگاری با گذشته: اگر فقط رمز فرستاده شد (نسخه قدیمی پنل)،
         با حساب مدیر کل تطبیق داده می‌شود. */
      const target = username
        ? getStaffByUsername(username)
        : getStaffByUsername(process.env.ADMIN_USERNAME || 'owner');

      // The forwarded IP can vary behind a proxy (or be forged if a proxy is
      // misconfigured). A persistent account bucket also bounds attempts at a
      // single username across IPs and restarts. Hash the bucket identifier;
      // never store a password or raw username in the rate-limit key.
      const accountName = String(target?.username || username || process.env.ADMIN_USERNAME || 'owner').trim().toLowerCase();
      const accountKey = 'login-account:' + crypto.createHash('sha256').update(accountName).digest('hex');
      const accountLimit = rateLimit(accountKey, RL.login.limit, RL.login.window, RL.login.block);
      if (!accountLimit.ok) {
        appLog('WARN', 'security', 'محدودیت تعداد تلاش ورود برای حساب', { ip });
        return sendJSON(429, {
          error: `تلاش‌های ناموفق بیش از حد. ${Math.ceil(accountLimit.retry_after / 60)} دقیقه دیگر تلاش کنید.`,
          retry_after: accountLimit.retry_after
        });
      }

      const bad = () => {
        appLog('WARN', 'security', 'ورود ناموفق کارمند', { ip, username: username || '—' });
        audit({ username: username || '—', action: 'auth.login', method, path: pathname,
                ip, allowed: false, detail: { reason: 'اعتبار نادرست' } });
        // پیام یکسان برای «کاربر نیست» و «رمز غلط» تا نام‌های موجود لو نروند
        return sendJSON(401, { error: 'نام کاربری یا رمز عبور نادرست است.' });
      };

      if (!target) return bad();
      if (!verifyPassword(password, target.pass_hash, target.pass_salt)) return bad();

      if (!target.active) {
        audit({ staff_id: target.id, username: target.username, action: 'auth.login',
                method, path: pathname, ip, allowed: false,
                detail: { reason: 'حساب غیرفعال' } });
        return sendJSON(403, { error: 'حساب شما غیرفعال شده است. با مدیر تماس بگیرید.' });
      }

      resetRateLimit(`login:${ip}`);
      resetRateLimit(accountKey);
      db.prepare('UPDATE staff SET last_login=? WHERE id=?')
        .run(new Date().toISOString(), target.id);

      // موضوع نشست شناسه کارمند است، نه نام — نام ممکن است عوض شود
      const token = createSession('ADMIN', String(target.id), SESSION_TTL);

      appLog('INFO', 'auth', 'ورود موفق کارمند',
             { ip, user: target.username, role: target.role_key });
      audit({ staff_id: target.id, username: target.username, role_key: target.role_key,
              action: 'auth.login', method, path: pathname, ip });

      res.setHeader('Set-Cookie',
        `yazd_admin=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);

      return sendJSON(200, {
        message: 'ورود موفق',
        token,
        user: {
          id: target.id,
          username: target.username,
          display_name: target.display_name,
          role_key: target.role_key,
          role_name: target.role_name,
          permissions: target.permissions,
          must_change: target.must_change
        }
      });
    }

    if (method === 'POST' && pathname === '/api/admin/logout') {
      destroySession(getToken(req));
      res.setHeader('Set-Cookie', 'yazd_admin=; HttpOnly; Path=/; Max-Age=0');
      return sendJSON(200, { message: 'خروج انجام شد' });
    }

    if (method === 'GET' && pathname === '/api/admin/me') {
      return sendJSON(200, { authenticated: isValidSession(getToken(req)) });
    }

    /* ── کاتالوگ عمومی ── (گام ۷ تفکیک)
       محصولات، جستجو، ویترین، برند، خانواده، نُت، اسانس،
       کوییز، پروفایل بویایی، جشنواره و کد تخفیف عمومی
       → `src/routes/catalog.js`

       پرترافیک‌ترین ماژول سایت. مسیرهای عمومی‌اند (بدون `can`)؛
       محافظشان فهرست سفید مرتب‌سازی، پارامترهای مقیدشده و
       محدودیت نرخ روی `taste/suggest` است. */
    if (await routeCatalog.handle({
      method, pathname, parsed, req, reqIP, db,
      parseBody, rateLimit, RL,
      sendJSON, parseProduct, attachVariants, attachCampaign,
      campaignPercentFor, activeCampaigns, listNotes, normalizeFa,
      getCustomer, getCustomerToken, otp, taste, essences, analytics,
      res, storeStats
    })) return;

    /* ── تعامل مشتری ── (گام ۸ تفکیک)
       رویداد، علاقه‌مندی، نظر، دعوت‌نامه، اطلاع موجودی،
       نوار اعلان و پیگیری سفارش → `src/routes/engagement.js`

       همه بدون `can`. سه مسیر داده شخصی برمی‌گردانند و
       محافظشان ماسک شماره، پاسخ یکسان و ۴۰۱ است. */
    if (await routeEngagement.handle({
      method, pathname, parsed, req, reqIP, db,
      sendJSON, parseBody, rateLimit, RL, appLog, cleanText,
      parseProduct, attachVariants, reviewSummary, hasPurchased,
      readReviewInvite, consumeReviewInvite,
      getCustomerToken, otp, analytics
    })) return;

    // ═══════════ سبد خرید (اعتبارسنجی سمت سرور) ═══════════
    // وضعیت زنده چند SKU — برای همگام‌سازی سبد ذخیره‌شده در مرورگر.
    // سبد ممکن است روزها در localStorage بماند؛ این مسیر قیمت و موجودی
    // واقعی را برمی‌گرداند تا کاربر پیش از پرداخت از تغییرات باخبر شود.
    if (method === 'POST' && pathname === '/api/cart/sync') {
      const body = await parseBody(req);
      const skus = Array.isArray(body.skus) ? body.skus.slice(0, 30) : [];
      if (!skus.length) return sendJSON(200, { variants: [] });

      const marks = skus.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT v.sku, v.price_toman, v.stock, v.volume_ml, v.type_label,
               p.name_fa, p.brand_fa, p.slug, p.image_url, p.supply_mode
        FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.sku IN (${marks}) AND ${publicVariantSql('v')}
      `).all(...skus);

      return sendJSON(200, {
        variants: rows.map(r => ({
          sku: r.sku,
          price: r.price_toman,
          stock: r.stock,
          ...variantAvailability(r.supply_mode, r.stock, r.price_toman),
          slug: r.slug,
          image_url: r.image_url,
          name: variantFullName(r)
        }))
      });
    }

    if (method === 'POST' && pathname === '/api/cart/calculate') {
      const body = await parseBody(req);
      const v = validateCart(body.items);
      if (!v.ok) return sendJSON(400, { error: v.error });

      /* ── جشنواره پیش از کوپن ──
         ترتیب مهم است: جشنواره خودکار است و مشتری روی آن کنترلی
         ندارد، پس اول اعمال می‌شود. کوپن بعد روی مبلغِ
         تخفیف‌خورده حساب می‌شود — وگرنه دو تخفیف روی قیمت کامل
         جمع می‌شوند و ممکن است مجموع از خودِ کالا بیشتر شود. */
      const camp = campaignDiscount(v.items);
      const afterCampaign = Math.max(0, v.subtotal - camp.total);

      /* ── آستانه ارسال رایگان روی جمع کالاها، نه پس از تخفیف ──
         با اندازه‌گیری واقعی کشف شد: سبد ۲,۶۵۲,۵۰۰ تومانی ارسال
         رایگان داشت؛ با جشنواره ۱۰٪ به ۲,۳۸۷,۲۵۰ رسید — زیر
         آستانه — و ۳۵۰,۰۰۰ کرایه اضافه شد. نتیجه: مشتری با
         تخفیف ۸۴,۷۵۰ تومان **بیشتر** می‌پرداخت.

         تخفیفی که پرداختی را بالا ببرد، از هر جشنواره‌ای بدتر
         است. معیار درست «چقدر کالا خریده» است نه «چقدر پول داده»
         — همان‌طور که کوپن هم روی کرایه اثر نمی‌گذارد. */
      const ship = calcShipping(v.subtotal);
      let shippingFee = ship.fee, shippingLabel = ship.label;
      let discount = 0, couponInfo = null, couponError = null;

      if (body.coupon_code) {
        const mobile = otp.mobileFromToken(getCustomerToken(req)) || body.mobile || null;
        const cv = validateCoupon(body.coupon_code, afterCampaign, shippingFee, mobile, v.items);
        if (cv.ok) {
          if (cv.free_shipping) {
            shippingFee = 0;
            shippingLabel = 'رایگان (کد تخفیف)';
            discount = 0;
          } else {
            discount = cv.discount;
          }
          couponInfo = {
            code: cv.coupon.code, type: cv.coupon.type,
            description: cv.coupon.description,
            discount: cv.free_shipping ? cv.discount : discount,
            free_shipping: !!cv.free_shipping
          };
        } else {
          couponError = cv.error;
        }
      }

      /* بسته‌بندی کادویی — سرویس جدا از کالا.
         عمداً **پس از** محاسبه تخفیف و آستانه ارسال اضافه می‌شود:
           • کوپن نباید روی آن اثر بگذارد (تخفیف روی کالاست)
           • نباید مشتری را به آستانه ارسال رایگان برساند
         وگرنه کسی با افزودن کادو به ارسال رایگان می‌رسید و
         فروشگاه هم کرایه می‌داد هم کادو. */
      const giftWrap = calcGiftWrap(body.gift_wrap);

      return sendJSON(200, {
        items: v.items,
        subtotal: v.subtotal,
        discount,
        coupon: couponInfo,
        coupon_error: couponError,
        campaign_discount: camp.total,
        campaign_lines: camp.lines,
        shipping_fee: shippingFee,
        shipping_label: shippingLabel,
        is_free_shipping: shippingFee === 0,
        gift_wrap: giftWrap > 0,
        gift_wrap_fee: giftWrap,
        total_payable: Math.max(0, v.subtotal - camp.total - discount + shippingFee) + giftWrap
      });
    }

    // بررسی مستقل کد تخفیف
    if (method === 'POST' && pathname === '/api/coupons/validate') {
      const body = await parseBody(req);
      const v = validateCart(body.items || []);
      if (!v.ok) return sendJSON(400, { error: v.error });

      /* جشنواره اینجا هم اول اعمال می‌شود — دقیقاً مثل
         `/api/cart/calculate` و ثبت سفارش.

         چرا لازم بود: صفحه سبد از این مسیر استفاده می‌کند و صفحه
         تسویه از `calculate`. وقتی جشنواره فعال بود، سبد کوپن را
         روی قیمت کامل حساب می‌کرد و تسویه روی قیمت تخفیف‌خورده —
         مشتری در سبد عدد بزرگ‌تری می‌دید و یک صفحه بعد کمتر
         می‌شد. تخفیفی که آب برود، بدتر از نداشتنش است. */
      const camp = campaignDiscount(v.items);
      const afterCampaign = Math.max(0, v.subtotal - camp.total);

      // آستانه ارسال روی جمع کالاها — توضیح در /api/cart/calculate
      const ship = calcShipping(v.subtotal);
      const mobile = otp.mobileFromToken(getCustomerToken(req)) || body.mobile || null;
      const cv = validateCoupon(body.code, afterCampaign, ship.fee, mobile, v.items);
      if (!cv.ok) return sendJSON(400, { error: cv.error });
      return sendJSON(200, {
        valid: true, code: cv.coupon.code,
        description: cv.coupon.description,
        discount: cv.discount, free_shipping: !!cv.free_shipping,
        campaign_discount: camp.total,
        campaign_lines: camp.lines,
        subtotal: v.subtotal
      });
    }

    // ═══════════ سفارش ═══════════
    if (method === 'POST' && pathname === '/api/orders') {
      const ip = clientIP(req);
      const rl = rateLimit(`order:${ip}`, RL.order.limit, RL.order.window, RL.order.block);
      if (!rl.ok) {
        appLog('WARN', 'security', 'ثبت سفارش بیش از حد', { ip });
        return sendJSON(429, { error: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.' });
      }

      const body = await parseBody(req);

      if (!body.customer_name || !/^09\d{9}$/.test(String(body.mobile || ''))) {
        return sendJSON(400, { error: 'نام و شماره موبایل معتبر (۰۹xxxxxxxxx) الزامی است.' });
      }

      /* نام و نشانی روی فاکتور و برچسب پستی چاپ می‌شوند و در پنل
         مدیریت رندر می‌گردند — پس همین‌جا پاک می‌شوند. */
      body.customer_name = cleanText(body.customer_name, 100);
      body.address       = cleanText(body.address, 500);
      body.city          = cleanText(body.city, 60);
      body.province      = cleanText(body.province, 60);
      /* یادداشت مشتری هم پاک‌سازی می‌شود: در پنل و روی فاکتور
         رندر می‌شود، پس همان مسیر خطر را دارد که نام و نشانی.
         سقف ۵۰۰ نویسه — برای «فاکتور رسمی می‌خواهم» یا
         «کادوپیچ کنید» بیش از کافی است. */
      body.customer_note = cleanText(body.customer_note, 500);
      if (!body.customer_name) {
        return sendJSON(400, { error: 'نام معتبر وارد کنید.' });
      }
      const v = validateCart(body.items);
      if (!v.ok) return sendJSON(400, { error: v.error });

      /* جشنواره دوباره سمت سرور محاسبه می‌شود، نه از سبد مشتری
         خوانده شود. اگر جشنواره بین دیدن سبد و پرداخت تمام شده
         باشد، مبلغ درست ثبت می‌گردد. */
      const camp = campaignDiscount(v.items);
      const afterCampaign = Math.max(0, v.subtotal - camp.total);

      // آستانه ارسال روی جمع کالاها — توضیح در /api/cart/calculate
      const ship = calcShipping(v.subtotal);

      /* شماره یکتا — با تضمین، نه با احتمال.
         بخش تصادفی برخورد را عملاً غیرممکن می‌کند، ولی «عملاً» کافی
         نیست وقتی نتیجه‌اش از دست رفتن سفارش مشتری است. یک بررسی
         سبک (روی کلید اصلی، بدون هزینه) تا سه بار تلاش می‌کند.
         این کار باید **پیش از** رزرو کوپن انجام شود، چون رزرو به
         شماره سفارش گره می‌خورد و عوض کردنش بعداً رزرو را یتیم
         می‌گذارد. */
      let orderId = null;
      for (let i = 0; i < 3; i++) {
        const cand = newOrderId();
        if (!db.prepare('SELECT 1 FROM orders WHERE order_id=?').get(cand)) {
          orderId = cand;
          break;
        }
      }
      if (!orderId) {
        appLog('ERROR', 'orders', 'ساخت شماره سفارش یکتا پس از ۳ تلاش ناموفق ماند');
        return sendJSON(503, {
          error: 'سامانه لحظه‌ای شلوغ است. چند ثانیه بعد دوباره تلاش کنید.'
        });
      }

      /* اعمال کد تخفیف (اعتبارسنجی مجدد سمت سرور).

         رزرو ظرفیت **همین‌جا** انجام می‌شود، نه هنگام پرداخت.
         پیش‌تر شمارنده فقط پس از پرداخت بالا می‌رفت و بین ثبت سفارش
         تا پرداخت، ده نفر می‌توانستند از کوپنی با ظرفیت ۳ استفاده
         کنند. حالا مثل موجودی کالا، ظرفیت در لحظه ثبت رزرو می‌شود
         و اگر پرداخت انجام نشود آزاد می‌گردد. */
      let shippingFee = ship.fee, discount = 0, appliedCode = null;
      if (body.coupon_code) {
        const cv = validateCoupon(body.coupon_code, afterCampaign, shippingFee, body.mobile, v.items);
        if (!cv.ok) return sendJSON(400, { error: cv.error });

        const reserved = recordCouponUse(cv.coupon.code, body.mobile, orderId);
        if (!reserved.ok) {
          return sendJSON(409, {
            error: reserved.reason === 'ظرفیت کد تکمیل شده'
              ? 'ظرفیت استفاده از این کد همین لحظه تکمیل شد.'
              : reserved.reason || 'کد تخفیف قابل استفاده نیست.'
          });
        }

        if (cv.free_shipping) shippingFee = 0;
        else discount = cv.discount;
        appliedCode = cv.coupon.code;
      }

      /* جشنواره و کوپن هر دو کم می‌شوند. discount_amount در
         دیتابیس مجموع هر دو است تا فاکتور با مبلغ پرداختی بخواند. */
      const totalDiscount = camp.total + discount;

      /* بسته‌بندی کادویی — مبلغ از ثابت سرور، نه از ورودی کاربر.
         بیرون از تخفیف و آستانه ارسال می‌ماند (توضیح در
         /api/cart/calculate). */
      const giftWrapFee = calcGiftWrap(body.gift_wrap);

      const total = Math.max(0, v.subtotal - totalDiscount + shippingFee) + giftWrapFee;

      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO orders (order_id, created_at, customer_name, mobile,
            first_name, last_name, email,
            province, city, address, postal_code,
            subtotal, shipping_fee, gift_wrap_fee, total_paid, payment_gateway, status,
            discount_code, discount_amount,
            campaign_discount, campaign_note, customer_note, updated_at)
          VALUES (@order_id, @created_at, @customer_name, @mobile,
            @first_name, @last_name, @email,
            @province, @city, @address, @postal_code,
            @subtotal, @shipping_fee, @gift_wrap_fee, @total_paid, @gateway, 'PENDING',
            @discount_code, @discount_amount,
            @campaign_discount, @campaign_note, @customer_note, @created_at)
        `).run({
          customer_note: body.customer_note || null,
          discount_code: appliedCode,
          // مجموع جشنواره و کوپن — وگرنه جمع فاکتور با مبلغ
          // پرداختی نمی‌خواند و آزمون «بدون عدد پنهان» قرمز می‌شود
          discount_amount: totalDiscount,
          /* سهم جشنواره جدا ثبت می‌شود تا فاکتور بتواند دو سطر
             صادق چاپ کند: «تخفیف جشنواره» و «تخفیف کد». */
          campaign_discount: camp.total || null,
          campaign_note: camp.lines.length
            ? [...new Set(camp.lines.map(l => l.title))].join(' · ').slice(0, 160)
            : null,
          order_id: orderId,
          created_at: new Date().toISOString(),
          customer_name: String(body.customer_name).slice(0, 100),
          /* نام تفکیک‌شده برای خطاب مؤدبانه و برچسب پستی مرتب.
             سفارش‌های قدیمی این فیلدها را ندارند، پس اگر نیامد
             از customer_name جدا می‌شود. */
          first_name: body.first_name
            ? String(body.first_name).slice(0, 40)
            : String(body.customer_name || '').split(' ')[0] || null,
          last_name: body.last_name
            ? String(body.last_name).slice(0, 40)
            : String(body.customer_name || '').split(' ').slice(1).join(' ') || null,
          email: body.email ? String(body.email).slice(0, 80) : null,
          mobile: body.mobile,
          province: body.province || null,
          city: body.city || null,
          address: body.address || null,
          postal_code: body.postal_code || null,
          subtotal: v.subtotal,
          shipping_fee: shippingFee,
          gift_wrap_fee: giftWrapFee,
          total_paid: total,
          gateway: pay.gatewayName()
        });

        const insItem = db.prepare(`
          INSERT INTO order_items (order_id, sku, product_name, unit_price, quantity, line_total)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        /* 🔴 موجودی هرگز منفی نشود.
           کالای «به سفارش» موجودی صفر دارد؛ کم کردن از صفر عدد
           منفی می‌سازد که هم گزارش انبار را خراب می‌کند هم
           آزادسازی هنگام لغو سفارش را. */
        const decStock = db.prepare(
          'UPDATE variants SET stock = MAX(0, stock - ?) WHERE sku = ?');
        for (const it of v.items) {
          insItem.run(orderId, it.sku, it.product_name, it.unit_price, it.quantity, it.line_total);
          decStock.run(it.quantity, it.sku);
        }
        logStatus(orderId, 'PENDING', 'ثبت سفارش');
      });
      tx();

      // درخواست پرداخت از درگاه فعال
      const pr = await pay.requestPayment({
        orderId, amountToman: total, mobile: body.mobile,
        description: `سفارش ${orderId} — عطر یزد`
      });

      if (!pr.ok) {
        /* بازگرداندن موجودی در صورت خطای درگاه.
           این مسیر رقابتی نیست (هر درخواست orderId تازه می‌سازد)، اما
           شرط PENDING را برای یکدستی با بقیه مسیرها نگه می‌داریم. */
        db.transaction(() => {
          const failed = db.prepare(
            "UPDATE orders SET status='FAILED', updated_at=? " +
            "WHERE order_id=? AND status='PENDING'"
          ).run(new Date().toISOString(), orderId);
          if (!failed.changes) return;

          const its = db.prepare('SELECT sku, quantity FROM order_items WHERE order_id=?').all(orderId);
          const inc = db.prepare('UPDATE variants SET stock = stock + ? WHERE sku = ?');
          its.forEach(i => inc.run(i.quantity, i.sku));
          logStatus(orderId, 'FAILED', 'اتصال به درگاه ممکن نشد — موجودی آزاد شد');
        })();
        releaseCouponUse(orderId);
        return sendJSON(502, { error: 'اتصال به درگاه پرداخت ممکن نشد: ' + pr.error });
      }

      db.prepare('UPDATE orders SET payment_ref=? WHERE order_id=?').run(pr.authority, orderId);

      return sendJSON(201, {
        message: 'سفارش ثبت شد. در حال انتقال به درگاه پرداخت…',
        order_id: orderId,
        subtotal: v.subtotal,
        discount,
        discount_code: appliedCode,
        shipping_fee: shippingFee,
        gift_wrap_fee: giftWrapFee,
        total_payable: total,
        payment_url: pr.redirect_url
      });
    }

    // ═══════════ تأیید پرداخت ═══════════
    if (method === 'POST' && pathname === '/api/payment/verify') {
      const body = await parseBody(req);
      const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(body.order_id);
      if (!order) return sendJSON(404, { error: 'سفارش یافت نشد' });

      /* ── جلوگیری از پردازش دوباره ──
         درگاه بانکی گاهی callback را چند بار می‌فرستد (تلاش مجدد شبکه)
         یا کاربر صفحه را رفرش می‌کند. تنها سفارشی که هنوز در انتظار
         پرداخت است باید پردازش شود. */
      if (order.status === 'PAID') {
        return sendJSON(200, {
          message: 'این سفارش قبلاً پرداخت شده است',
          order_id: order.order_id, payment_ref: order.payment_ref
        });
      }
      if (order.status !== 'PENDING') {
        // CANCELLED / FAILED / EXPIRED — موجودی پیش‌تر آزاد شده است.
        // بدون این بررسی، هر فراخوانی دوباره موجودی را افزایش می‌داد.
        return sendJSON(409, {
          error: `این سفارش در وضعیت «${STATUS_FA[order.status] || order.status}» است و قابل پرداخت نیست.`,
          order_id: order.order_id, status: order.status
        });
      }

      /* ── قفل پیش از فراخوانی درگاه ──
         verifyPayment ناهمگام است. بدون قفل، ده درخواست هم‌زمان همگی
         از بررسی وضعیت رد می‌شوند، در await معلق می‌مانند، و بعد همه
         با هم به مسیر شکست می‌رسند — نتیجه: موجودی ده بار آزاد می‌شد.

         VERIFYING یک وضعیت گذراست و در ORDER_FLOW نیست؛ کاربر هرگز
         نمی‌بیندش چون در همین درخواست به PAID یا CANCELLED می‌رود. */
      const claimed = db.prepare(
        "UPDATE orders SET status='VERIFYING', updated_at=? " +
        "WHERE order_id=? AND status='PENDING'"
      ).run(new Date().toISOString(), order.order_id);

      if (!claimed.changes) {
        return sendJSON(409, {
          error: 'این سفارش هم‌اکنون در حال پردازش است. چند لحظه بعد وضعیت را بررسی کنید.',
          order_id: order.order_id
        });
      }

      const vr = await pay.verifyPayment({
        authority: body.authority || order.payment_ref,
        amountToman: order.total_paid,
        sandboxResult: body.result
      });

      if (vr.ok) {
        // شرط VERIFYING همان قفلی است که بالاتر گرفتیم؛ تنها دارنده قفل
        // می‌تواند سفارش را PAID کند
        const paid = db.prepare(
          "UPDATE orders SET status='PAID', payment_ref=?, updated_at=? " +
          "WHERE order_id=? AND status='VERIFYING'"
        ).run(vr.ref_id, new Date().toISOString(), order.order_id);

        if (!paid.changes) {
          return sendJSON(200, {
            message: 'این سفارش قبلاً پرداخت شده است',
            order_id: order.order_id, payment_ref: order.payment_ref
          });
        }
        logStatus(order.order_id, 'PAID', 'پرداخت تأیید شد');

        // کوپن هنگام ثبت سفارش رزرو شده است؛ اینجا کاری لازم نیست.
        notify.orderPaid({ ...order, status: 'PAID' }).catch(() => {});
        /* خبر به مسئول فروشگاه — بدون await، چون سفارش نباید
           منتظر پیامک بماند. */
        alerts.fireAsync('newOrder', order);
        trackPurchase(order, req);

        return sendJSON(200, {
          message: 'پرداخت تأیید شد',
          order_id: order.order_id, payment_ref: vr.ref_id
        });
      }

      let freed = [];
      /* ناموفق: بازگرداندن موجودی — تنها یک بار.
         شرط status='PENDING' داخل همان تراکنش تضمین می‌کند حتی اگر
         چند درخواست هم‌زمان به اینجا برسند، موجودی یک بار برگردد. */
      db.transaction(() => {
        const cancelled = db.prepare(
          "UPDATE orders SET status='CANCELLED', updated_at=? " +
          "WHERE order_id=? AND status='VERIFYING'"
        ).run(new Date().toISOString(), order.order_id);
        if (!cancelled.changes) return;   // درخواست دیگری زودتر رسیدگی کرده

        const items = db.prepare('SELECT sku, quantity FROM order_items WHERE order_id=?')
          .all(order.order_id);
        const inc = db.prepare('UPDATE variants SET stock = stock + ? WHERE sku = ?');
        items.forEach(i => inc.run(i.quantity, i.sku));
        logStatus(order.order_id, 'CANCELLED', 'پرداخت ناموفق — موجودی آزاد شد');
        freed = items.map(i => i.sku);
      })();
      releaseCouponUse(order.order_id);   // ظرفیت کد تخفیف هم برمی‌گردد
      notifyStockWatchers(freed, 'پرداخت ناموفق');
      return sendJSON(200, { message: vr.error || 'پرداخت لغو شد', order_id: order.order_id, failed: true });
    }

    // بازگشت از درگاه واقعی (زرین‌پال)
    if (method === 'GET' && pathname === '/payment/callback') {
      const orderId = parsed.query.order;
      const authority = parsed.query.Authority || parsed.query.authority;
      const status = parsed.query.Status || parsed.query.status;
      const order = db.prepare('SELECT * FROM orders WHERE order_id=?').get(orderId);

      const goto = (ok, ref, msg) => {
        const u = `/payment/result?order=${encodeURIComponent(orderId || '')}`
          + `&ok=${ok ? '1' : '0'}`
          + (ref ? `&ref=${encodeURIComponent(ref)}` : '')
          + (msg ? `&msg=${encodeURIComponent(msg)}` : '');
        res.writeHead(302, { Location: u });
        res.end();
      };

      if (!order) return goto(false, null, 'سفارش یافت نشد');

      // بازگشت دوباره از درگاه یا رفرش مرورگر — نتیجه قبلی را نشان بده
      if (order.status === 'PAID') return goto(true, order.payment_ref);
      if (order.status === 'CANCELLED' || order.status === 'FAILED') {
        return goto(false, null, 'این سفارش پیش‌تر لغو شده است');
      }
      if (order.status === 'VERIFYING') {
        return goto(false, null, 'پرداخت شما در حال بررسی است. چند لحظه بعد وضعیت سفارش را ببینید.');
      }
      if (order.status !== 'PENDING') {
        return goto(false, null, `سفارش در وضعیت «${STATUS_FA[order.status] || order.status}» است`);
      }

      /* آزادسازی موجودی — تنها یک بار.
         شرط PENDING داخل تراکنش، از چند بار برگرداندن موجودی هنگام
         رفرش صفحه یا callback تکراری جلوگیری می‌کند. */
      let releasedSkus = [];
      const releaseStock = (note) => db.transaction(() => {
        const done = db.prepare(
          "UPDATE orders SET status='CANCELLED', updated_at=? " +
          "WHERE order_id=? AND status IN ('PENDING','VERIFYING')"
        ).run(new Date().toISOString(), orderId);
        if (!done.changes) return false;   // درخواست دیگری زودتر رسیدگی کرد

        const its = db.prepare('SELECT sku, quantity FROM order_items WHERE order_id=?').all(orderId);
        const inc = db.prepare('UPDATE variants SET stock = stock + ? WHERE sku = ?');
        its.forEach(i => inc.run(i.quantity, i.sku));
        logStatus(orderId, 'CANCELLED', note);
        releasedSkus = its.map(i => i.sku);
        return true;
      })();
      if (releasedSkus.length) releaseCouponUse(orderId);

      // کاربر در صفحه بانک «انصراف» زده است
      if (status !== 'OK') {
        releaseStock('پرداخت توسط کاربر لغو شد');
        notifyStockWatchers(releasedSkus, 'انصراف در درگاه');
        return goto(false, null, 'پرداخت توسط شما لغو شد');
      }

      /* قفل پیش از گفت‌وگو با درگاه.
         verifyPayment ناهمگام است؛ بدون این قفل، دو callback هم‌زمان
         هر دو رد می‌شدند و موجودی دو بار آزاد می‌شد. */
      const lock = db.prepare(
        "UPDATE orders SET status='VERIFYING', updated_at=? " +
        "WHERE order_id=? AND status='PENDING'"
      ).run(new Date().toISOString(), orderId);
      if (!lock.changes) {
        return goto(false, null, 'این پرداخت هم‌اکنون در حال بررسی است');
      }

      const vr = await pay.verifyPayment({ authority, amountToman: order.total_paid });

      if (vr.ok) {
        const paid = db.prepare(
          "UPDATE orders SET status='PAID', payment_ref=?, updated_at=? " +
          "WHERE order_id=? AND status='VERIFYING'"
        ).run(vr.ref_id, new Date().toISOString(), orderId);

        if (!paid.changes) return goto(true, order.payment_ref);   // دیگری زودتر ثبت کرد

        logStatus(orderId, 'PAID', 'پرداخت تأیید شد');
        // کوپن هنگام ثبت سفارش رزرو شده است؛ اینجا کاری لازم نیست.
        notify.orderPaid({ ...order, status: 'PAID' }).catch(() => {});
        alerts.fireAsync('newOrder', order);
        trackPurchase(order, req);
        return goto(true, vr.ref_id);
      }

      alerts.fireAsync('paymentFailed', { order_id: orderId });
      releaseStock('پرداخت تأیید نشد — موجودی آزاد شد');
      notifyStockWatchers(releasedSkus, 'پرداخت تأیید نشد');
      return goto(false, null, vr.error);
    }


    // ادمین: سفارشات با جستجو و فیلتر

    // پشتیبان‌گیری از دیتابیس

    // فهرست پشتیبان‌های خودکار

    /* دانلود یک پشتیبان مشخص.
       پشتیبان روی همان دیسک دیتابیس ذخیره می‌شود؛ اگر آن دیسک از دست
       برود همه‌چیز می‌رود. مدیر باید بتواند نسخه‌ها را بیرون بکشد و
       جای دیگری نگه دارد. */

    // ═══════════ مدیریت وضعیت سفارش (ادمین) ═══════════

    // تاریخچه وضعیت

    /* ── احراز هویت مشتری ── (گام ۶ تفکیک)
       ثبت‌نام، ورود، بازیابی رمز، کد یکبارمصرف، نشست
       → `src/routes/auth.js`

       این مسیرها عمومی‌اند (بدون `can`)، پس محافظشان محدودیت
       نرخ چندلایه و کوکی HttpOnly است. */
    if (await routeAuth.handle({
      method, pathname, req, res,
      sendJSON, parseBody, appLog, db, otp, analytics,
      RL, rateLimit, resetRateLimit, clientIP, cleanText,
      getCustomer, createCustomer, setCustomerPassword, verifyPassword,
      publicCustomer, createSession, getCustomerToken
    })) return;

    /* ── نظرات و دعوت‌نامه ── (گام ۵ تفکیک)
       تأیید، پاسخ، حذف نظر و مدیریت دعوت‌نامه مشتریان حضوری
       → `src/routes/admin-reviews.js` */
    if (await routeAdminReviews.handle({
      method, pathname, parsed, req,
      sendJSON, can, parseBody, logAudit, appLog, who, db,
      otp, cleanText, faNum, createReviewInvite, INVITE_TTL_DAYS
    })) return;

    /* ── سیستم و آمادگی ── (گام ۴ تفکیک)
       پشتیبان، سابقه کارها، بررسی آمادگی، گزارش و تحلیل
       → `src/routes/admin-system.js` */
    if (await routeAdminSystem.handle({
      method, pathname, parsed, req, res,
      sendJSON, can, parseBody, logAudit, appLog, rateLimit, who, db,
      DB_PATH, otp, notify, pay, getSettings, normalizeDigits,
      reports, analytics, verifyPassword
    })) return;

    /* ── بازاریابی مدیریتی ── (گام ۳ تفکیک)
       کوپن، جشنواره و نوار اعلان → `src/routes/admin-marketing.js` */
    if (await routeAdminMarketing.handle({
      method, pathname, req,
      sendJSON, can, parseBody, logAudit, db,
      cleanText, normalizeDigits, bustCampaignCache
    })) return;

    /* ── سفارش‌های مدیریتی ── (گام ۲ تفکیک)
       فهرست، وضعیت، تاریخچه، فاکتور و خروجی CSV
       → `src/routes/admin-orders.js`

       `POST /api/orders` عمداً اینجا نیست: با درگاه پرداخت گره
       خورده و آزمون واقعی با پول ندارد. */
    if (await routeAdminOrders.handle({
      method, pathname, parsed, req, res,
      sendJSON, can, parseBody, logAudit, who, db,
      otp, notify, getToken, getCustomerToken, isValidSession,
      logStatus, releaseCouponUse, notifyStockWatchers,
      getSettings, nextInvoiceNo, STATUS_FA, ORDER_FLOW
    })) return;

    /* ── کاتالوگ مدیریتی ── (گام ۱ تفکیک)
       ویرایش قیمت/موجودی، کالاهای رو به اتمام، لاگ، نگهداشت و
       بازسازی ایندکس → `src/routes/admin-catalog.js` */
    if (await routeAdminCatalog.handle({
      method, pathname, parsed, req,
      sendJSON, can, who, parseBody, logAudit, appLog, db,
      parseProduct, attachVariants, notifyStockWatchers,
      releaseStaleOrders, buildSearchIndex, buildNotesIndex, bustStatsCache
    })) return;
    // اطلاعات تماس عمومی — تنها فیلدهای بی‌خطر.
    // کد اقتصادی و شناسه ملی عمداً بیرون گذاشته شده‌اند؛ آن‌ها
    // فقط روی فاکتور رسمی معنا دارند نه در یک API باز.
    if (method === 'GET' && pathname === '/api/contact-info') {
      const st = getSettings();
      return sendJSON(200, {
        shop_name: st.shop_name,
        shop_name_en: st.shop_name_en,
        phone: st.phone || null,
        address: st.address || null,
        postal_code: st.postal_code || null,
        /* فروشگاه تلفن ثابت ندارد و موبایل تنها راه ارتباط است.
           مشتری باید بداند می‌تواند پیام بدهد، نه فقط زنگ بزند —
           بسیاری ترجیح می‌دهند بنویسند. */
        phone_whatsapp: String(st.phone_whatsapp || '') === '1',
        /* نشان اعتماد — هر دو بخش لازم است.
           هر دو در نشانی عمومی نشان دیده می‌شوند، پس محرمانه
           نیستند؛ ولی تنها وقتی فرستاده می‌شوند که **هر دو** ثبت
           شده باشند. نیمه‌کاره یعنی نشانی خراب و تصویر شکسته. */
        enamad_id: (st.enamad_id && st.enamad_code) ? st.enamad_id : null,
        enamad_code: (st.enamad_id && st.enamad_code) ? st.enamad_code : null
      });
    }

    // ═══════════ کارکنان و نقش‌ها ═══════════

    /** اطلاعات کارمند واردشده — برای ساخت منوی پنل */
    /**
     * اعلان‌های کاری کارمند.
     *
     * فقط کارهایی که **این کارمند** مجوزش را دارد شمرده می‌شوند.
     * انباردار «تیکت تازه» نمی‌بیند چون کاری با آن ندارد، و
     * شمردنش فقط شلوغی می‌سازد.
     *
     * هر شمارش با مجوز خودش محافظت می‌شود؛ نبود مجوز یعنی آن
     * بخش اصلاً در پاسخ نیست — نه اینکه صفر باشد.
     */
    /**
     * پروفایل و کارنامه شخصی کارمند.
     *
     * هر کارمند **فقط فعالیت خودش** را می‌بیند — نیازی به مجوز
     * ویژه ندارد چون داده‌ای جز کار خودش نمی‌بیند. مقایسه با
     * دیگران هم عمداً نیست: کارنامه ابزار خودارزیابی است، نه
     * تابلوی رقابت.
     *
     * `staff_id` مبنای فیلتر است نه `username`، چون نام کاربری
     * ممکن است عوض شود ولی شناسه ثابت می‌ماند.
     */
    if (method === 'GET' && pathname === '/api/admin/me/activity') {
      if (!who) return sendJSON(401, { error: 'وارد نشده‌اید.' });
      if (who.must_change) {
        return sendJSON(403, { error: 'ابتدا رمز اولیه را عوض کنید.', must_change: true });
      }

      const days = Math.min(365, Math.max(1, parseInt(parsed.query.days) || 30));
      const since = `-${days} days`;

      const summary = db.prepare(`
        SELECT COUNT(*) total,
               SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END) denied,
               COUNT(DISTINCT date(at)) active_days
        FROM audit_log
        WHERE staff_id = ? AND at >= datetime('now', ?)
      `).get(who.id, since);

      /* پرکارترین عمل‌ها — «مشاهده» هم ثبت می‌شود، پس فهرست
         بدون فیلتر شلوغ می‌شد. تنها کارهای مؤثر شمرده می‌شوند. */
      const VIEW_ONLY = ['orders.view', 'products.view', 'reviews.view',
                         'tickets.view', 'coupons.view', 'staff.view',
                         'settings.view', 'content.view', 'reports.sales',
                         'reports.stock', 'reports.traffic', 'system.logs'];
      const ph = VIEW_ONLY.map(() => '?').join(',');

      const actions = db.prepare(`
        SELECT action, COUNT(*) n
        FROM audit_log
        WHERE staff_id = ? AND at >= datetime('now', ?)
          AND allowed = 1 AND action NOT IN (${ph})
        GROUP BY action ORDER BY n DESC LIMIT 12
      `).all(who.id, since, ...VIEW_ONLY);

      const daily = db.prepare(`
        SELECT date(at) day, COUNT(*) n
        FROM audit_log
        WHERE staff_id = ? AND at >= datetime('now', ?) AND allowed = 1
        GROUP BY day ORDER BY day
      `).all(who.id, since);

      const recent = db.prepare(`
        SELECT action, target, allowed, at
        FROM audit_log
        WHERE staff_id = ? ORDER BY id DESC LIMIT 15
      `).all(who.id);

      // آمار ویژه بر پایه نقش — فقط چیزی که به کارش می‌آید
      const highlights = [];
      if (who.permissions.includes('orders.status')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'orders.status'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'سفارش پردازش‌شده', value: n });
      }
      if (who.permissions.includes('tickets.reply')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'tickets.reply'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'پاسخ به تیکت', value: n });
      }
      if (who.permissions.includes('reviews.moderate')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'reviews.moderate'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'نظر بررسی‌شده', value: n });
      }
      if (who.permissions.includes('products.stock')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'products.stock'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'به‌روزرسانی موجودی', value: n });
      }
      if (who.permissions.includes('content.write')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'content.write'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'مقاله نوشته/ویرایش‌شده', value: n });
      }

      /* فقط نشست‌های هنوز معتبر شمرده می‌شوند. بدون شرط انقضا،
         عدد شامل نشست‌های مرده هم می‌شد و کارمند بی‌جهت نگران
         می‌شد که «کسی با حساب من وارد شده». */
      const sessions = db.prepare(
        "SELECT COUNT(*) n FROM sessions WHERE kind='ADMIN' AND subject=? AND expires_at > ?"
      ).get(String(who.id), Date.now()).n;

      /* ── شرح دسترسی ──
         پیش‌تر فقط عدد «۳۴ مجوز» برمی‌گشت. کارمند می‌دانست چند
         اجازه دارد ولی نمی‌دانست **کدام** — و مهم‌تر، نمی‌دانست
         چه کارهایی از او برنمی‌آید.

         نتیجه عملی: انباردار روی سفارش کلیک می‌کرد، خطای «دسترسی
         ندارید» می‌گرفت و نمی‌فهمید اشتباه کرده یا سیستم خراب
         است. حالا از اول می‌داند مرز کارش کجاست.

         `denied` عمداً برگردانده می‌شود: دانستن آنچه نمی‌توانی،
         به‌اندازه دانستن آنچه می‌توانی مهم است. */
      const mine = new Set(who.permissions);
      const granted = [], denied = [];
      for (const g of perms.groupedPermissions()) {
        const inG = { key: g.key, label: g.label, items: [] };
        const outG = { key: g.key, label: g.label, items: [] };
        for (const p of g.items) {
          const row = { key: p.key, label: p.label, hint: p.hint || null,
                        danger: !!p.danger };
          (mine.has(p.key) ? inG : outG).items.push(row);
        }
        if (inG.items.length) granted.push(inG);
        if (outG.items.length) denied.push(outG);
      }

      const role = getRole(who.role_key);

      return sendJSON(200, {
        profile: {
          id: who.id,
          username: who.username,
          display_name: who.display_name,
          mobile: who.mobile || null,
          role_key: who.role_key,
          role_name: who.role_name,
          role_description: role ? role.description : null,
          permission_count: who.permissions.length,
          total_permissions: perms.ALL_KEYS.length,
          created_at: who.created_at,
          last_login: who.last_login,
          active_sessions: sessions
        },
        access: { granted, denied },
        days,
        summary: {
          total: summary.total || 0,
          denied: summary.denied || 0,
          active_days: summary.active_days || 0
        },
        highlights,
        actions,
        daily,
        recent
      });
    }

    /** به‌روزرسانی مشخصات شخصی — نام نمایشی و موبایل */
    if (method === 'PUT' && pathname === '/api/admin/me/profile') {
      if (!who) return sendJSON(401, { error: 'وارد نشده‌اید.' });
      const b = await parseBody(req);

      const fields = [], args = [];

      if (b.display_name != null) {
        const dn = cleanText(b.display_name, 60);
        if (!dn) return sendJSON(400, { error: 'نام نمی‌تواند خالی باشد.' });
        fields.push('display_name=?'); args.push(dn);
      }

      if (b.mobile !== undefined) {
        const m = b.mobile ? otp.normalizeMobile(b.mobile) : null;
        if (m && !otp.isValidMobile(m)) {
          return sendJSON(400, { error: 'شماره موبایل معتبر نیست.' });
        }
        fields.push('mobile=?'); args.push(m);
      }

      /* نقش و وضعیت فعال عمداً اینجا نیستند — کارمند نباید بتواند
         خودش را ارتقا دهد. آن مسیر جداست و مجوز staff.manage
         می‌خواهد. */
      if (!fields.length) return sendJSON(400, { error: 'تغییری ارسال نشد.' });

      args.push(who.id);
      db.prepare(`UPDATE staff SET ${fields.join(', ')} WHERE id=?`).run(...args);

      logAudit('profile.update', {
        detail: { fields: Object.keys(b) }
      });
      appLog('INFO', 'staff', 'کارمند مشخصات خود را به‌روز کرد',
             { user: who.username });

      /* `publicStaff` فیلدهای رمز را حذف می‌کند.
         ممیزی نشان داد `getStaff()` هش scrypt و salt را هم
         برمی‌گرداند و اینجا مستقیم در پاسخ می‌رفت. */
      return sendJSON(200, {
        message: 'مشخصات شما به‌روز شد.',
        staff: publicStaff(getStaff(who.id))
      });
    }

    if (method === 'GET' && pathname === '/api/admin/notifications') {
      if (!who) return sendJSON(401, { error: 'وارد نشده‌اید.' });
      if (who.must_change) {
        return sendJSON(403, { error: 'ابتدا رمز اولیه را عوض کنید.', must_change: true });
      }

      const has = p => who.permissions.includes(p);
      const items = [];

      if (has('orders.view')) {
        const n = db.prepare(
          "SELECT COUNT(*) n FROM orders WHERE status IN ('PAID','PROCESSING')"
        ).get().n;
        if (n) items.push({
          key: 'orders', tab: 'orders', count: n,
          label: n === 1 ? 'سفارش در انتظار ارسال' : 'سفارش در انتظار ارسال',
          urgent: false
        });
      }

      if (has('tickets.view')) {
        const open = db.prepare(
          "SELECT COUNT(*) n FROM tickets WHERE status != 'CLOSED'"
        ).get().n;
        if (open) items.push({
          key: 'tickets', tab: 'tickets', count: open,
          label: 'تیکت مرجوعی باز', urgent: false
        });

        /* تیکتی که از مهلت پاسخ (۲۴ ساعت) گذشته — فوری است.
           این همان قولی است که در صفحه تماس به مشتری داده‌ایم. */
        const late = db.prepare(`
          SELECT COUNT(*) n FROM tickets
          WHERE status != 'CLOSED' AND sla_deadline IS NOT NULL
            AND sla_deadline < datetime('now')
        `).get().n;
        if (late) items.push({
          key: 'tickets_late', tab: 'tickets', count: late,
          label: 'تیکت از مهلت پاسخ گذشته', urgent: true
        });
      }

      if (has('reviews.moderate')) {
        const n = db.prepare(
          "SELECT COUNT(*) n FROM reviews WHERE status='PENDING'"
        ).get().n;
        if (n) items.push({
          key: 'reviews', tab: 'reviews', count: n,
          label: 'نظر در انتظار تأیید', urgent: false
        });
      }

      if (has('reports.stock')) {
        const n = db.prepare('SELECT COUNT(*) n FROM variants WHERE stock <= 5').get().n;
        if (n) items.push({
          key: 'low_stock', tab: 'products', count: n,
          label: 'کالای رو به اتمام', urgent: n > 20
        });
        const out = db.prepare('SELECT COUNT(*) n FROM variants WHERE stock = 0').get().n;
        if (out) items.push({
          key: 'out_of_stock', tab: 'products', count: out,
          label: 'کالای ناموجود', urgent: true
        });
      }

      if (has('system.logs')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM app_logs
          WHERE level='ERROR' AND logged_at >= datetime('now','-24 hours')
        `).get().n;
        if (n) items.push({
          key: 'errors', tab: 'tools', count: n,
          label: 'خطای سیستم در ۲۴ ساعت گذشته', urgent: n > 10
        });
      }

      /* ── آمادگی افتتاح ──
         فروشگاه بدون این‌ها هم بی‌خطا کار می‌کند، پس نقص تا
         نخستین بازرسی یا شکایت مشتری پنهان می‌ماند.
         فقط به کسی که می‌تواند درستش کند نشان داده می‌شود.

         تنها **اطلاعات تماس** سنجیده می‌شود، نه اطلاعات حقوقی.
         دلیلش: اینماد درج تلفن، نشانی و کد پستی را روی سایت
         الزامی کرده، ولی کد اقتصادی و شناسه ملی فقط روی «فاکتور
         رسمی» چاپ می‌شوند که اختیاری است.

         (خواسته مالک، مرداد ۱۴۰۵: «در فاکتور نیازی به درج
          اطلاعات حقوقی نداریم، خود ای‌نماد کفایت می‌کند.»)

         منطق تفصیلی در `/api/admin/readiness` است؛ اینجا فقط
         یک اعلان سبک برای دیده شدن. */
      if (has('settings.edit')) {
        const st = getSettings();
        const REQUIRED = {
          phone:       'تلفن',
          address:     'نشانی',
          postal_code: 'کد پستی'
        };
        const missing = Object.entries(REQUIRED)
          .filter(([k]) => !String(st[k] || '').trim())
          .map(([, label]) => label);

        if (missing.length) {
          items.push({
            key: 'legal_incomplete', tab: 'settings', count: missing.length,
            label: `اطلاعات تماس ناقص است — الزام اینماد (${missing.join('، ')})`,
            urgent: true
          });
        }
      }

      return sendJSON(200, {
        total: items.reduce((s, x) => s + x.count, 0),
        urgent: items.some(x => x.urgent),
        items
      });
    }

    // ═══════════ نقش‌ها، کارکنان، دسترسی (ماژول جدا) ═══════════
    if (await routeRbac.handle({
      method, pathname, req, res, sendJSON, can, logAudit, who,
      parseBody, db, appLog, perms, cleanText, normalizeDigits,
      getStaff, getStaffByUsername, listStaff, listRoles, getRole,
      hashPassword, verifyPassword,
      otp, notify, faNum, getToken, publicStaff
    })) return;

    /** سابقه کارها */

    // ═══════════ تنظیمات فروشگاه ═══════════
    /* ── بررسی آمادگی افتتاح ──
       یک نگاه واحد به همه چیزی که باید پیش از فروش واقعی درست
       باشد. تا پیش از این، تنها راه فهمیدن اینکه کلید پیامک یا
       شناسه درگاه درست است، ثبت سفارش واقعی بود — یعنی خرابی
       را **اولین مشتری** کشف می‌کرد.

       هیچ کلید یا رمزی برنگردانده نمی‌شود؛ فقط «ست شده / نشده»
       و چند نویسه آخر برای تشخیص. */

    /* آزمون واقعی سرویس‌ها — مسیر جدا دارد چون اثر جانبی دارد:
       پیامک آزمایشی از اعتبار حساب کم می‌کند. */

    if (pathname === '/api/admin/settings') {
      // خواندن و نوشتن مجوز جدا دارند: حسابدار باید اطلاعات حقوقی
      // را ببیند ولی نتواند عوضشان کند
      if (method === 'GET') {
        if (!can('settings.view')) return;
        return sendJSON(200, getSettings());
      }
      if (!can('settings.edit')) return;
      if (method === 'POST') {
        const b = await parseBody(req);
        const s = saveSettings(b);
        appLog('INFO', 'admin', 'تنظیمات فروشگاه به‌روز شد');

        /* اگر مقداری الگو را نداشت، `saveSettings` کنارش گذاشته.
           پیام «ذخیره شد» در آن حالت دروغ است — مدیر باید همان
           لحظه بفهمد، نه روزها بعد که ببیند نشان روی سایت نیست. */
        const FA = { enamad_id: 'شناسه نماد', enamad_code: 'کد امنیتی نماد' };
        const bad = s._rejected || [];
        if (bad.length) {
          return sendJSON(200, {
            message: `تنظیمات ذخیره شد، ولی ${bad.map(k => FA[k] || k).join(' و ')} پذیرفته نشد — قالب مقدار درست نیست.`,
            rejected: bad, settings: s
          });
        }
        return sendJSON(200, { message: 'تنظیمات ذخیره شد.', settings: s });
      }
    }

    // ═══════════ داده فاکتور و برچسب ═══════════

    // ═══════════ گزارش‌های فروش (ادمین) ═══════════

    /** داشبورد تحلیل بازدید — قیف خرید، جستجوها، رفتار مشتری */

    /** ساخت دوباره ویترین به‌صورت دستی */

    // ═══════════ مدیریت نظرات (ادمین) ═══════════

    // ═══════════ مدیریت کدهای تخفیف (ادمین) ═══════════

    // ═══════════ تیکت مرجوعی (ماژول جدا) ═══════════
    if (await routeTickets.handle({
      method, pathname, req, sendJSON, can, parseBody,
      db, cleanText, otp, notify, getCustomerToken,
      rateLimit, ip: reqIP, RL
    })) return;

    // ═══════════ مقالات ═══════════
    // ═══════════ مجله (ماژول جدا) ═══════════
    if (await routeArticles.handle({
      method, pathname, parsed, req, res,
      sendJSON, can, parseBody, db, appLog, slugify
    })) return;

    // ═══════════ خروجی CSV ═══════════

    // ═══════════ SEO ═══════════
    if (method === 'GET' && pathname === '/sitemap.xml') {
      const base = process.env.SITE_URL || 'https://yazdperfume.ir';
      const today = new Date().toISOString().slice(0, 10);

      /* صفحات ثابت. brands/terms/privacy/contact پیش‌تر جا افتاده بودند
         و گوگل راهی برای پیدا کردنشان جز پیمایش لینک‌ها نداشت.
         صفحات شخصی (سبد، حساب، علاقه‌مندی) عمداً نیستند — محتوای
         عمومی ندارند و ایندکس شدنشان بی‌معنی است. */
      const STATIC = [
        ['/', '1.0', 'daily'],
        /* سمپل اولویت بالا دارد: مانع اصلی خرید آنلاین عطر
           «نچشیده خریدن» است و این صفحه پاسخ همان است. */
        ['/samples', '0.9', 'weekly'],
        ['/why-us', '0.8', 'monthly'],
        ['/journal', '0.9', 'weekly'],
        ['/essences', '0.9', 'monthly'],
        ['/brands', '0.8', 'weekly'],
        ['/quiz', '0.8', 'monthly'],
        ['/terms', '0.4', 'yearly'],
        ['/privacy', '0.4', 'yearly'],
        ['/contact', '0.5', 'yearly']
      ];

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
      for (const [path, pri, freq] of STATIC) {
        xml += `  <url><loc>${base}${path}</loc>`
             + `<changefreq>${freq}</changefreq><priority>${pri}</priority></url>\n`;
      }
      /* ── فقط محصولاتی که واقعاً می‌شود سفارش داد ──
         sitemap یعنی «این‌ها را ایندکس کن». معرفی صفحه‌ای که
         محصولش را نمی‌توانیم تأمین کنیم، هم به بازدیدکننده
         بدقولی است هم به گوگل سیگنال «انبوه صفحه بی‌پشتوانه».

         محصولات UNAVAILABLE از سایت حذف نمی‌شوند — صفحه‌شان کار
         می‌کند، جستجوی داخلی پیدایشان می‌کند، و دکمه «خبرم کن»
         دارند. فقط به گوگل پیشنهادشان نمی‌دهیم.

         اولویت هم پویا شد: کالای موجود در انبار (۰٫۹) از کالای
         به‌سفارش (۰٫۷) مهم‌تر است. */
      db.prepare(`
        SELECT p.slug,
               (SELECT COALESCE(SUM(v.stock),0) FROM variants v
                 WHERE v.product_id = p.id AND ${publicVariantSql('v')} AND v.price_toman>0) AS stock
        FROM products p
        WHERE p.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS (
          SELECT 1 FROM variants v WHERE v.product_id=p.id AND ${publicVariantSql('v')}
          AND v.price_toman>0 AND (v.stock>0 OR p.supply_mode='MADE_TO_ORDER')
        )
      `).all().forEach(p => {
        const pri = p.stock > 0 ? '0.9' : '0.7';
        xml += `  <url><loc>${base}/perfume/${p.slug}</loc>`
             + `<changefreq>weekly</changefreq><priority>${pri}</priority></url>\n`;
      });
      db.prepare('SELECT slug, created_at FROM articles').all().forEach(a => {
        const mod = (a.created_at || '').slice(0, 10) || today;
        xml += `  <url><loc>${base}/journal/${a.slug}</loc>`
             + `<lastmod>${mod}</lastmod>`
             + `<changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
      });
      return sendBody(200, xml + '</urlset>', 'application/xml; charset=utf-8');
    }

    if (method === 'GET' && pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      const base = process.env.SITE_URL || 'https://yazdperfume.ir';
      return res.end(
        'User-agent: *\n' +
        'Allow: /\n' +
        'Disallow: /admin\n' +
        'Disallow: /api/\n' +
        // صفحات شخصی و چاپی — محتوای عمومی ندارند
        'Disallow: /account\n' +
        'Disallow: /cart\n' +
        'Disallow: /checkout\n' +
        'Disallow: /wishlist\n' +
        'Disallow: /login\n' +
        'Disallow: /invoice\n' +
        'Disallow: /label\n' +
        'Disallow: /payment/\n' +
        'Disallow: /offline\n' +
        `Sitemap: ${base}/sitemap.xml\n`);
    }

    /**
     * سرویس‌ورکر.
     *
     * چرا مسیر اختصاصی و نه سرو ساده از public:
     *   ۱) **هرگز نباید کش شود.** اگر مرورگر نسخه قدیمی sw.js را
     *      نگه دارد، کاربر تا مدت‌ها نسخه تازه سایت را نمی‌بیند و
     *      هیچ راهی برای رفعش نداری. این بدترین اشتباه رایج در
     *      PWA است.
     *   ۲) `Service-Worker-Allowed` تضمین می‌کند دامنه کنترل
     *      کل سایت باشد، نه فقط پوشه فایل.
     */
    if (method === 'GET' && pathname === '/sw.js') {
      const swPath = path.join(PUBLIC_DIR, 'sw.js');
      if (!fs.existsSync(swPath)) return sendJSON(404, { error: 'یافت نشد' });
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Service-Worker-Allowed': '/'
      });
      return res.end(fs.readFileSync(swPath));
    }

    if (method === 'GET' && pathname === '/api/health') {
      return sendJSON(200, {
        status: 'ok',
        db: DB_PATH,
        products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
        variants: db.prepare('SELECT COUNT(*) c FROM variants').get().c,
        payment_gateway: pay.gatewayName(),
        payment_live: pay.isLive(),
        sms_provider: otp.PROVIDER,
        sessions: db.prepare('SELECT COUNT(*) c FROM sessions').get().c,
        pending_orders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='PENDING'").get().c,
        pending_ttl_min: PENDING_TTL_MIN,
        errors_24h: db.prepare(
          "SELECT COUNT(*) c FROM app_logs WHERE level='ERROR' AND logged_at > datetime('now','-1 day')").get().c,
        uptime: Math.round(process.uptime())
      });
    }

    // ═══════════ صفحات ═══════════
    if (method === 'GET' && !pathname.startsWith('/api/')) {
      const pages = {
        '/': 'index.html',
        '/admin': 'admin.html',
        '/journal': 'journal.html',
        '/quiz': 'quiz.html',
        '/login': 'login.html',
        '/account': 'account.html',
        '/wishlist': 'wishlist.html',
        '/invoice': 'invoice.html',
        '/label': 'label.html',
        '/payment/result': 'payment-result.html',
        '/cart': 'cart.html',
        '/checkout': 'checkout.html',
        '/track': 'track.html',
        '/brands': 'brands.html',
        '/essences': 'essences.html',
        '/why-us': 'why-us.html',
        '/samples': 'samples.html',
        '/check': 'check.html',
        '/terms': 'terms.html',
        '/privacy': 'privacy.html',
        '/contact': 'contact.html',
        /* صفحه آفلاین — سرویس‌ورکر آن را در نصب کش می‌کند و وقتی
           شبکه نیست به‌جای صفحه خطای مرورگر نشان می‌دهد. */
        '/offline': 'offline.html'
      };

      /* ── یک صفحه، یک نشانی ──
         هم `/terms` و هم `/terms.html` همان محتوا را می‌دادند. برای گوگل
         این یعنی دو صفحه با محتوای تکراری، و اعتبار بین‌شان تقسیم می‌شد.
         نسخه `.html` با ۳۰۱ به نشانی رسمی هدایت می‌شود.
         (فاکتور و برچسب مستثنا هستند؛ در پنجره جدید باز می‌شوند و
          ایندکس نمی‌شوند.) */
      if (method === 'GET' && pathname.endsWith('.html')) {
        const clean = pathname.slice(0, -5);          // حذف «.html»
        const NO_REDIRECT = ['/invoice', '/label', '/404', '/payment-sandbox',
                             '/payment-result', '/check'];
        if (pages[clean] && !NO_REDIRECT.includes(clean)) {
          const qs = parsed.search || '';
          res.writeHead(301, { Location: clean + qs });
          return res.end();
        }
      }

      let file = pages[pathname];

      // صفحه محصول: /perfume/:slug — تنها اگر محصول وجود داشته باشد
      if (!file && pathname.startsWith('/perfume/')) {
        const pslug = pathname.replace('/perfume/', '').replace(/\/$/, '');
        const exists = db.prepare('SELECT 1 FROM products WHERE slug=? OR id=?')
          .get(pslug, pslug);
        if (exists) file = 'product.html';
      }
      /* صفحه دعوت‌نامه نظر: /review/:token
         خودِ صفحه بدون بررسی توکن سرو می‌شود و اعتبارسنجی را
         جاوااسکریپت از API می‌گیرد — چون توکن نامعتبر باید پیام
         مهربان ببیند نه ۴۰۴ خشک. صفحه `noindex` است. */
      if (!file && /^\/review\/[a-f0-9]{32}$/.test(pathname)) {
        file = 'review-invite.html';
      }
      // صفحه مقاله: /journal/:slug — تنها اگر مقاله واقعاً وجود داشته باشد
      if (!file && pathname.startsWith('/journal/')) {
        const aslug = pathname.replace('/journal/', '').replace(/\/$/, '');
        const exists = db.prepare('SELECT 1 FROM articles WHERE slug=? OR id=?')
          .get(aslug, aslug);
        if (exists) file = 'article.html';
      }
      // درگاه آزمایشی
      if (!file && pathname.startsWith('/payment/sandbox')) file = 'payment-sandbox.html';
      if (!file) file = pathname.replace(/^\//, '');

      /* ── تصاویر آپلودشده مقالات ──
         روی لیارا این‌ها در `/app/data/journal/` می‌نشینند نه در
         `public/`، چون تنها آن مسیر دیسک پایدار دارد. پس ریشه
         سرو برای همین یک پیشوند فرق می‌کند.

         محلی هر دو یکی‌اند و این شاخه بی‌اثر است. */
      let baseDir = PUBLIC_DIR;
      if (file.startsWith('images/journal/')) {
        baseDir = path.dirname(media.MEDIA_DIR);
        file = 'journal/' + path.basename(file);
      }

      const full = path.join(baseDir, file);
      if (!full.startsWith(baseDir)) { res.writeHead(403); return res.end('Forbidden'); }

      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        const ext = path.extname(full).toLowerCase();

        // تزریق متادیتا سمت سرور برای خزنده‌ها
        if (ext === '.html') {
          let html = fs.readFileSync(full, 'utf-8');
          try {
            if (pathname.startsWith('/perfume/')) {
              const slug = pathname.replace('/perfume/', '').replace(/\/$/, '');
              const row = db.prepare('SELECT * FROM products WHERE slug=? OR id=?').get(slug, slug);
              if (row) html = seo.productPage(html, attachVariants(parseProduct(row)));
            } else if (pathname === '/') {
              html = seo.homePage(html, {
                products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
                brands: db.prepare('SELECT COUNT(DISTINCT brand_fa) c FROM products').get().c
              });
            } else if (pathname.startsWith('/journal/')) {
              const aslug = pathname.replace('/journal/', '').replace(/\/$/, '');
              const art = db.prepare('SELECT * FROM articles WHERE slug=? OR id=?')
                .get(aslug, aslug);
              if (art) html = seo.articlePage(html, art);
            } else if (pathname === '/journal') {
              /* تازه‌ترین مقاله را همان‌طور می‌گیریم که فرانت
                 می‌گیرد: `/api/articles` با همین ORDER BY، و
                 عنصر اول فهرست.

                 نکته‌ای که با بررسی داده معلوم شد: همه مقاله‌های
                 اولیه `created_at` یکسان دارند، پس ترتیب صرفاً
                 با تاریخ قطعی نیست. `id` به‌عنوان شکننده تساوی
                 اضافه شد — هم اینجا هم در API — تا سرور و مرورگر
                 حتماً یک مقاله را «شاخص» بدانند. بدون این، preload
                 گاهی به تصویر اشتباه می‌خورد. */
              const top = db.prepare(
                'SELECT * FROM articles ORDER BY created_at DESC, id LIMIT 1'
              ).get();
              html = seo.journalPage(html, top || null);
            } else if (pathname === '/brands') {
              /* همان پرس‌وجویی که `/api/brands` می‌زند — تا فهرست
                 سمت سرور و سمت مرورگر یکی باشد و چیدمان نپرد.
                 محصولات غیرقابل تأمین شمرده نمی‌شوند: عدد کنار
                 نام برند باید همانی باشد که مشتری با کلیک
                 می‌بیند. */
              const brands = db.prepare(`
                SELECT brand_fa, brand_en, COUNT(*) AS count
                FROM products
                WHERE supply_mode != 'UNAVAILABLE'
                GROUP BY brand_fa, brand_en
                ORDER BY count DESC, brand_fa
              `).all();
              html = seo.brandsPage(html, brands);
            } else if (seo.hasSimple(pathname)) {
              html = seo.simplePage(html, pathname);
            }
          } catch (e) { appLog('WARN', 'seo', e.message, { path: pathname }); }

          return sendBody(200, html, 'text/html; charset=utf-8',
            { 'Cache-Control': 'public, max-age=300' });
        }

        // ارائه خودکار WebP به مرورگرهای پشتیبان (۵۰٪ سبک‌تر)
        let served = full, servedExt = ext;
        if (/\.(jpg|jpeg|png)$/.test(ext)) {
          const accept = req.headers.accept || '';
          if (accept.includes('image/webp')) {
            const webp = full.replace(/\.(jpg|jpeg|png)$/i, '.webp');
            if (fs.existsSync(webp)) { served = webp; servedExt = '.webp'; }
          }
        }

        const headers = { 'Content-Type': MIME[servedExt] || 'application/octet-stream' };
        if (/\.(woff2?|ttf)$/.test(servedExt)) {
          headers['Cache-Control'] = 'public, max-age=31536000, immutable';
          headers['Access-Control-Allow-Origin'] = '*';
        }
        if (/\.(jpg|jpeg|png|svg|webp|ico)$/.test(servedExt)) {
          headers['Cache-Control'] = 'public, max-age=604800, immutable';
          headers['Vary'] = 'Accept';
        }

        // فایل‌های متنی (CSS/JS/SVG/JSON) فشرده می‌شوند — تا ۷۵٪ سبک‌تر
        // فونت woff2 و تصاویر از قبل فشرده‌اند، دوباره فشرده کردنشان فقط CPU می‌سوزاند
        if (/\.(css|js|svg|json|xml|txt|map)$/.test(servedExt)) {
          headers['Cache-Control'] = headers['Cache-Control'] || 'public, max-age=3600';
          const txt = fs.readFileSync(served);
          if (acceptsGzip && txt.length > 1024) {
            return zlib.gzip(txt, { level: 6 }, (err, gz) => {
              if (err) { res.writeHead(200, headers); return res.end(txt); }
              headers['Content-Encoding'] = 'gzip';
              headers['Vary'] = headers['Vary'] ? headers['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
              res.writeHead(200, headers);
              res.end(gz);
            });
          }
          res.writeHead(200, headers);
          return res.end(txt);
        }

        res.writeHead(200, headers);
        return fs.createReadStream(served).pipe(res);
      }

      const notFound = path.join(PUBLIC_DIR, '404.html');
      if (fs.existsSync(notFound)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(notFound).pipe(res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('صفحه یافت نشد');
    }

    return sendJSON(404, { error: 'مسیر API یافت نشد' });

  } catch (err) {
    // خطای ورودی کاربر لاگ نمی‌شود تا لاگ خطاهای واقعی شلوغ نشود
    if (err instanceof BadRequest) {
      return sendJSON(400, { error: err.message });
    }
    appLog('ERROR', 'server', err.message, {
      path: pathname, method, ip: clientIP(req), stack: (err.stack || '').split('\n')[1]
    });
    return sendJSON(500, { error: 'خطای داخلی سرور' });
  }
});

/* وقتی زمان‌بند خودکار سفارش منقضی را آزاد می‌کند، منتظران خبردار شوند.
   بدون این، تنها مسیرهای دستی اطلاع می‌دادند. */
setStockFreedHandler(skus => notifyStockWatchers(skus, 'انقضای خودکار'));

/* ── تازه‌سازی بخش‌های خودکار صفحه اصلی ──
   «پرفروش‌ترین» و «محبوب‌ترین» از پیش محاسبه می‌شوند تا صفحه اصلی
   — پربازدیدترین صفحه سایت — هیچ GROUP BY سنگینی نزند.
   یک بار هنگام بالا آمدن، سپس هر ساعت. */
const SHOWCASE_HOURS = Math.max(1, parseInt(process.env.SHOWCASE_REFRESH_HOURS) || 1);
setTimeout(() => {
  try {
    const r = analytics.refreshTrending();
    appLog('INFO', 'analytics', 'ویترین ساخته شد', r);
  } catch (e) { appLog('ERROR', 'analytics', e.message); }
}, 3000).unref();

setInterval(() => {
  try { analytics.refreshTrending(); }
  catch (e) { appLog('ERROR', 'analytics', e.message); }
}, SHOWCASE_HOURS * 3600 * 1000).unref();

/* پاکسازی داده قدیمی — روزی یک بار.
   `events` از ابتدا پاک می‌شد، ولی `audit_log` نه: تابع
   `purgeAudit` نوشته و صادر شده بود ولی **هیچ‌جا صدا زده
   نمی‌شد** (ممیزی مرداد ۱۴۰۵).

   نرخ اندازه‌گیری‌شده در همین محیط: حدود ۳٬۱۰۰ ردیف در روز — که
   بیشترش از آزمون‌هاست، ولی سقفی نداشت. روی دیسک محدود لیارا،
   جدولی که فقط رشد می‌کند دیر یا زود مشکل‌ساز می‌شود.

   مدت نگهداشت از `AUDIT_KEEP_DAYS` می‌آید (پیش‌فرض ۹۰ روز، همان
   قراردادی که در FILE_INDEX مستند شده). خودِ `purgeAudit` این
   پیش‌فرض را مدیریت می‌کند، پس اینجا عددی تحمیل نمی‌شود. */
setInterval(() => {
  try { analytics.purge(); }
  catch (e) { appLog('ERROR', 'analytics', e.message); }
  try {
    const n = purgeAudit();
    if (n) appLog('INFO', 'maintenance', `${n} ردیف سابقه قدیمی پاک شد`);
  } catch (e) { appLog('ERROR', 'maintenance', e.message); }
}, 24 * 3600 * 1000).unref();

server.listen(PORT, () => {
  const p = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  const v = db.prepare('SELECT COUNT(*) c FROM variants').get().c;
  console.log('═'.repeat(55));
  console.log('🌸  عطر یزد | Yazd Perfume');
  console.log('═'.repeat(55));
  console.log(`   دیتابیس : ${DB_PATH}`);
  console.log(`   محصولات : ${p}   |   متغیرها: ${v}`);
  console.log(`   آدرس    : http://localhost:${PORT}/`);
  console.log(`   مجله    : http://localhost:${PORT}/journal`);
  console.log(`   کوییز   : http://localhost:${PORT}/quiz`);
  console.log(`   مدیریت  : http://localhost:${PORT}/admin`);
  console.log('═'.repeat(55));
});
