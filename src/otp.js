/**
 * عطر یزد | ورود مشتری با رمز یکبار مصرف
 * ----------------------------------------
 * ارسال واقعی در `sms.js` است — این فایل فقط چرخه عمر کد را
 * مدیریت می‌کند: ساخت، ذخیره، مهلت، شمارش تلاش نادرست.
 *
 * پیش‌تر کد کاوه‌نگار مستقیم اینجا نوشته شده بود و در `notify.js`
 * تکرار می‌شد. با تغییر سامانه به پیامیتو، آن ساختار به لایه
 * مشترک منتقل شد.
 *
 * تنظیم ارائه‌دهنده: متغیرهای `SMS_*` — جزئیات در `src/sms.js`
 */

const crypto = require('crypto');
const store = require('./db');
const sms = require('./sms');

const OTP_TTL      = 2 * 60 * 1000;   // اعتبار کد: ۲ دقیقه
const RESEND_GAP   = 60 * 1000;       // فاصله ارسال مجدد: ۶۰ ثانیه
const MAX_ATTEMPTS = 5;               // حداکثر تلاش نادرست
const SESSION_TTL  = 30 * 24 * 3600 * 1000; // نشست مشتری: ۳۰ روز

/* کدهای در انتظار در دیتابیس نگهداری می‌شوند، نه در حافظه.
   دلیل: ری‌استارت سرور (deploy یا کرش) نباید کد کاربری را که همین
   الان پیامک گرفته باطل کند. */

function normalizeMobile(input) {
  let m = String(input || '')
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[^\d]/g, '');
  if (m.startsWith('98'))  m = '0' + m.slice(2);
  if (m.startsWith('+98')) m = '0' + m.slice(3);
  if (m.length === 10 && m.startsWith('9')) m = '0' + m;
  return m;
}

function isValidMobile(m) { return /^09\d{9}$/.test(m); }

/** درخواست ارسال کد */
async function requestCode(rawMobile) {
  const mobile = normalizeMobile(rawMobile);
  if (!isValidMobile(mobile)) {
    return { ok: false, error: 'شماره موبایل معتبر نیست.' };
  }

  const prev = store.otpGet(mobile);
  if (prev && Date.now() - prev.lastSent < RESEND_GAP) {
    const wait = Math.ceil((RESEND_GAP - (Date.now() - prev.lastSent)) / 1000);
    return { ok: false, error: `تا ارسال مجدد ${wait} ثانیه صبر کنید.`, retry_after: wait };
  }

  const code = String(crypto.randomInt(10000, 99999));

  /* ترتیب مهم است: اول ارسال، بعد ذخیره.
     اگر ارسال شکست بخورد نباید کد ذخیره بماند، وگرنه کاربر تا
     ۲ دقیقه در «صبر کنید» گیر می‌کند بی‌آنکه پیامکی گرفته باشد. */
  const r = await sms.sendOtp(mobile, code);
  if (!r.ok) {
    return { ok: false, error: String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ? 'ارسال پیامک انجام نشد. دوباره تلاش کنید.' : (r.message || 'ارسال پیامک انجام نشد. دوباره تلاش کنید.') };
  }

  store.otpSave(mobile, {
    code, expires: Date.now() + OTP_TTL, lastSent: Date.now(), attempts: 0
  });

  return {
    ok: true, mobile, ttl: OTP_TTL / 1000,
    // فقط در حالت لاگ — به فرانت می‌گوید کد در خروجی سرور است
    ...(r.logged ? { dev_hint: 'کد در لاگ سرور چاپ شد' } : {})
  };
}

/** بررسی کد و ساخت نشست */
function verifyCode(rawMobile, inputCode) {
  const mobile = normalizeMobile(rawMobile);
  const rec = store.otpGet(mobile);

  if (!rec) return { ok: false, error: 'ابتدا درخواست کد بدهید.' };
  if (Date.now() > rec.expires) {
    store.otpDelete(mobile);
    return { ok: false, error: 'کد منقضی شده است. دوباره درخواست دهید.' };
  }
  if (rec.attempts >= MAX_ATTEMPTS) {
    store.otpDelete(mobile);
    return { ok: false, error: 'تعداد تلاش بیش از حد. دوباره درخواست دهید.' };
  }

  const clean = String(inputCode || '')
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s/g, '')
    .trim();

  /* مقایسه زمان‌ثابت — جلوگیری از حدس کد از روی تفاوت زمان پاسخ.
     کد فقط ۵ رقم است، پس این محافظت ارزان و بجاست. */
  const a = Buffer.from(clean.padEnd(8, '\0'));
  const b = Buffer.from(String(rec.code).padEnd(8, '\0'));
  if (clean.length !== String(rec.code).length || !crypto.timingSafeEqual(a, b)) {
    store.otpBumpAttempts(mobile);
    const left = MAX_ATTEMPTS - (rec.attempts + 1);
    return {
      ok: false,
      error: left > 0
        ? `کد نادرست است. ${left} تلاش باقی مانده.`
        : 'تعداد تلاش بیش از حد. دوباره درخواست دهید.'
    };
  }

  store.otpDelete(mobile);
  const token = store.createSession('CUSTOMER', mobile, SESSION_TTL);
  return { ok: true, token, mobile };
}

/** بازگرداندن شماره موبایل از توکن */
function mobileFromToken(token) {
  const s = store.readSession(token, 'CUSTOMER');
  return s ? s.subject : null;
}

function destroySession(token) { store.destroySession(token); }

// پاکسازی کدهای منقضی در db.js انجام می‌شود (هر ۵ دقیقه)

module.exports = {
  requestCode, verifyCode, mobileFromToken, destroySession,
  normalizeMobile, isValidMobile, SESSION_TTL,
  get PROVIDER() { return sms.PROVIDER; }
};
