/**
 * عطر یزد | اطلاع‌رسانی داخلی — به کارکنان، نه مشتری
 * ═══════════════════════════════════════════════════
 *
 * ── مشکلی که این ماژول حل می‌کند ──
 * تا امروز هر اطلاع‌رسانی سایت **به مشتری** می‌رفت: تأیید سفارش،
 * ارسال مرسوله، پاسخ تیکت. برای فروشگاه هیچ‌چیز نمی‌رفت.
 *
 * یعنی اگر ساعت ۱۱ شب سفارشی ثبت می‌شد، تا وقتی کسی پنل را باز
 * نمی‌کرد هیچ‌کس خبر نداشت. پنل «اعلان‌ها» دارد، ولی آن هم فقط
 * وقتی دیده می‌شود که کسی وارد شود.
 *
 * برای فروشگاهی که تحویل ۳ تا ۷ روز وعده داده، یک شب تأخیر در
 * دیدن سفارش یعنی یک روز از آن وعده.
 *
 * ── طراحی: چه کسی چه خبری بگیرد ──
 * اطلاع‌رسانی بر پایه **مجوز** است نه نقش. هر رویداد یک مجوز
 * متناظر دارد و پیام به همه کارمندانی می‌رود که آن مجوز را دارند
 * و شماره موبایل ثبت‌شده دارند.
 *
 * چرا مجوز و نه نقش: اگر فردا نقش تازه‌ای ساخته شود که سفارش را
 * می‌بیند، خودبه‌خود خبردار می‌شود. با فهرست نقش ثابت، باید کد
 * عوض می‌شد — و کسی یادش نمی‌ماند.
 *
 * ── چهار قاعده ──
 *
 *   ۱) **هرگز جریان اصلی را متوقف نمی‌کند.** سفارش نباید به‌خاطر
 *      نرفتن پیامک شکست بخورد. همه‌جا `.catch()` دارد.
 *
 *   ۲) **ضد سیل.** اگر ده سفارش در یک دقیقه بیاید، ده پیامک
 *      پشت‌سرهم آزاردهنده است و اعتبار پنل را می‌سوزاند. سقف
 *      ساعتی برای هر نوع رویداد وجود دارد.
 *
 *   ۳) **ساعت آرام.** پیام غیرفوری بین ۲۳ تا ۷ صبح نگه داشته
 *      می‌شود. سفارش تازه فوری نیست؛ موجودی صفر شدن هم.
 *      استثنا: رویدادهایی که `urgent` علامت خورده‌اند.
 *
 *   ۴) **قابل خاموش کردن.** مدیری که نمی‌خواهد پیامک بگیرد باید
 *      بتواند خاموشش کند — `ALERTS_ENABLED=0` یا حذف موبایل.
 *
 * ── چرا ایمیل نیست ──
 * افزودن ایمیل یعنی وابستگی به SMTP، مدیریت صف، و برخورد با
 * اسپم. برای فروشگاهی که تیمش دو نفر است و هر دو موبایل دارند،
 * پیامک ساده‌تر و مطمئن‌تر است. اگر روزی لازم شد، `channels`
 * جای افزودنش را باز گذاشته.
 */

'use strict';

const sms = require('./sms');

/** آیا اطلاع‌رسانی داخلی روشن است؟ */
const ENABLED = String(process.env.ALERTS_ENABLED ?? '1') !== '0';

/** شماره‌های اضافی که همیشه خبر می‌گیرند — جدا با کاما */
const EXTRA = String(process.env.ALERTS_EXTRA_MOBILES || '')
  .split(',').map(s => s.trim()).filter(m => /^09\d{9}$/.test(m));

/* ساعت آرام — پیام غیرفوری در این بازه نگه داشته می‌شود.
   به وقت ایران محاسبه می‌شود، نه UTC سرور. */
const QUIET_FROM = Number(process.env.ALERTS_QUIET_FROM ?? 23);
const QUIET_TO   = Number(process.env.ALERTS_QUIET_TO   ?? 7);

/**
 * ساعت فعلی به وقت تهران.
 *
 * سرور لیارا ممکن است UTC باشد. اگر مستقیم `getHours()` بگیریم،
 * «ساعت آرام» سه ساعت و نیم جابه‌جا می‌شود و پیام نیمه‌شب
 * فرستاده می‌شود — دقیقاً همان چیزی که می‌خواستیم جلویش را
 * بگیریم.
 */
function tehranHour() {
  try {
    return Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran', hour: 'numeric', hour12: false
    }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

function inQuietHours() {
  const h = tehranHour();
  // بازه‌ای که از نیمه‌شب می‌گذرد (۲۳ تا ۷)
  return QUIET_FROM > QUIET_TO
    ? (h >= QUIET_FROM || h < QUIET_TO)
    : (h >= QUIET_FROM && h < QUIET_TO);
}

/* ═══════════════════════════════════════════
   ضد سیل
   ═══════════════════════════════════════════
   در حافظه نگه داشته می‌شود، نه دیتابیس. با هر ری‌استارت پاک
   می‌شود و این اشکالی ندارد: بدترین حالت چند پیامک اضافه پس از
   ری‌استارت است، نه از دست رفتن اطلاع‌رسانی. */
const sentLog = new Map();   // kind → [timestamp, …]

/** سقف پیش‌فرض هر نوع رویداد در ساعت */
const HOURLY_CAP = Number(process.env.ALERTS_HOURLY_CAP ?? 12);

function underCap(kind, cap = HOURLY_CAP) {
  const now = Date.now();
  const hour = 3600e3;
  const list = (sentLog.get(kind) || []).filter(t => now - t < hour);
  if (list.length >= cap) { sentLog.set(kind, list); return false; }
  list.push(now);
  sentLog.set(kind, list);
  return true;
}

/* ═══════════════════════════════════════════
   رویدادها
   ═══════════════════════════════════════════
   هر رویداد می‌گوید چه کسی خبر بگیرد (`perm`)، چقدر فوری است، و
   متن پیام چیست.

   `urgent: true` یعنی ساعت آرام را نادیده بگیرد — فقط برای
   چیزهایی که واقعاً نمی‌توانند تا صبح صبر کنند. */
const EVENTS = {
  /** سفارش تازه — مهم‌ترین رویداد فروشگاه */
  newOrder: {
    perm: 'orders.view',
    urgent: false,
    cap: 20,
    text: o =>
`عطر یزد — سفارش تازه
شماره: ${o.order_id}
مبلغ: ${faNum(money(o.total_paid))} تومان
${o.customer_name || ''} ${o.city ? '· ' + o.city : ''}`.trim()
  },

  /** پرداخت ناموفق پس از رزرو موجودی — نشانه احتمالی مشکل درگاه */
  paymentFailed: {
    perm: 'orders.view',
    urgent: false,
    cap: 6,
    text: o =>
`عطر یزد — پرداخت ناموفق
سفارش ${o.order_id} پرداخت نشد و موجودی آزاد شد.`
  },

  /** کالای رو به اتمام */
  lowStock: {
    perm: 'products.edit',
    urgent: false,
    cap: 4,
    text: d =>
`عطر یزد — موجودی رو به اتمام
${faNum(d.count)} کالا کمتر از ${faNum(d.threshold)} عدد مانده.
پنل → کالاهای رو به اتمام`
  },

  /** تیکت مرجوعی تازه — مهلت پاسخ ۲۴ ساعت است */
  newTicket: {
    perm: 'tickets.view',
    urgent: false,
    cap: 10,
    text: t =>
`عطر یزد — درخواست مرجوعی
تیکت ${t.ticket_id}
مهلت پاسخ: ۲۴ ساعت`
  },

  /** نظر تازه در انتظار تأیید */
  newReview: {
    perm: 'reviews.moderate',
    urgent: false,
    cap: 4,
    text: r =>
`عطر یزد — نظر تازه
${faNum(r.count)} نظر در انتظار بررسی است.`
  },

  /** تلاش ناموفق ورود به پنل — نشانه احتمالی حمله */
  securityAlert: {
    perm: 'staff.view',
    urgent: true,
    cap: 3,
    text: d =>
`عطر یزد — هشدار امنیتی
${faNum(d.count)} تلاش ناموفق ورود به پنل از ${d.ip || 'نشانی ناشناس'}.`
  }
};

/* ═══════════════════════════════════════════
   کمکی
   ═══════════════════════════════════════════ */

const faNum = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const money = n => Number(n || 0).toLocaleString('en-US');

/**
 * گیرندگان یک رویداد.
 *
 * ── چرا `require` داخل تابع ──
 * `db.js` این ماژول را نمی‌شناسد ولی ممکن است در آینده بشناسد.
 * بارگذاری تنبل، حلقه وابستگی را ناممکن می‌کند.
 */
function recipients(perm) {
  const out = new Set(EXTRA);
  try {
    const { db } = require('./db');
    const { roleHas } = require('./permissions');

    const staff = db.prepare(
      'SELECT display_name, mobile, role_key FROM staff WHERE active = 1'
    ).all();

    for (const s of staff) {
      if (!s.mobile || !/^09\d{9}$/.test(s.mobile)) continue;
      const role = db.prepare('SELECT permissions FROM roles WHERE key = ?')
        .get(s.role_key);
      if (!role) continue;
      let perms = [];
      try { perms = JSON.parse(role.permissions || '[]'); } catch {}
      if (perms.includes('*') || perms.includes(perm)) out.add(s.mobile);
    }
  } catch (e) {
    // خواندن کارکنان نباید اطلاع‌رسانی را بشکند
    console.error('  [ALERT] خواندن گیرندگان ناموفق:', e.message);
  }
  return [...out];
}

/* ═══════════════════════════════════════════
   ارسال
   ═══════════════════════════════════════════ */

/**
 * اطلاع‌رسانی یک رویداد به مسئولانش.
 *
 * **هرگز throw نمی‌کند و هرگز منتظر نمی‌ماند.** فراخوان می‌تواند
 * بدون `await` صدایش بزند.
 *
 * @param {string} kind کلید EVENTS
 * @param {object} data داده‌ای که به قالب پیام می‌رود
 * @returns {Promise<{sent:number, skipped?:string}>}
 */
async function fire(kind, data = {}) {
  const ev = EVENTS[kind];
  if (!ev) return { sent: 0, skipped: 'رویداد ناشناخته' };
  if (!ENABLED) return { sent: 0, skipped: 'خاموش' };

  if (!ev.urgent && inQuietHours()) {
    return { sent: 0, skipped: 'ساعت آرام' };
  }
  if (!underCap(kind, ev.cap)) {
    return { sent: 0, skipped: 'سقف ساعتی' };
  }

  const to = recipients(ev.perm);
  if (!to.length) return { sent: 0, skipped: 'گیرنده‌ای ندارد' };

  let text;
  try { text = ev.text(data); }
  catch (e) { return { sent: 0, skipped: 'ساخت متن ناموفق: ' + e.message }; }

  let sent = 0;
  for (const mobile of to) {
    try {
      const r = await sms.send(mobile, text, 'اطلاع داخلی');
      if (r.ok) sent++;
    } catch { /* یک گیرنده نباید بقیه را متوقف کند */ }
  }
  return { sent, total: to.length };
}

/** نسخه بی‌صدا — برای فراخوانی از مسیر داغ */
function fireAsync(kind, data) {
  fire(kind, data).catch(() => {});
}

/** وضعیت پیکربندی — برای کارت بررسی آمادگی */
function status() {
  const withMobile = (() => {
    try {
      const { db } = require('./db');
      return db.prepare(
        "SELECT COUNT(*) c FROM staff WHERE active=1 AND mobile IS NOT NULL AND mobile <> ''"
      ).get().c;
    } catch { return 0; }
  })();

  return {
    enabled: ENABLED,
    events: Object.keys(EVENTS).length,
    staff_with_mobile: withMobile,
    extra_mobiles: EXTRA.length,
    quiet_hours: `${faNum(QUIET_FROM)} تا ${faNum(QUIET_TO)}`,
    in_quiet_now: inQuietHours(),
    hourly_cap: HOURLY_CAP,
    reachable: withMobile + EXTRA.length
  };
}

module.exports = {
  fire, fireAsync, status, recipients,
  EVENTS, ENABLED,
  _internals: { inQuietHours, underCap, tehranHour, sentLog }
};
