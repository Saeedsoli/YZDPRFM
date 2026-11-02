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
const phoneVerification = require('./customer-phone-verification');

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

// Configuration-only check; it does not send an SMS or prove delivery.
async function deliveryAvailable() {
  if (String(process.env.NODE_ENV||'').trim().toLowerCase() !== 'production') return true;
  try { const r=await sms.testConnection();return !!(r && r.ok && r.live); } catch { return false; }
}

/** درخواست ارسال کد */
async function requestCode(rawMobile) {
  if (!phoneVerification.ready(store.db)) return {ok:false,error:'سامانه تأیید شماره هنوز آماده نیست.'};
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

/** Consume a code only within an immediate SQLite transaction. */
function consumeCode(rawMobile, inputCode) {
  return store.db.transaction(()=>{
    if (!phoneVerification.ready(store.db)) return {ok:false,error:'سامانه تأیید شماره هنوز آماده نیست.'};
    const mobile=normalizeMobile(rawMobile);
    if(!isValidMobile(mobile))return {ok:false,error:'شماره موبایل معتبر نیست.'};
    const rec=store.otpGet(mobile);
    if(!rec)return {ok:false,error:'ابتدا درخواست کد بدهید.'};
    if(Date.now()>rec.expires){store.otpDelete(mobile);return {ok:false,error:'کد منقضی شده است. دوباره درخواست دهید.'};}
    if(rec.attempts>=MAX_ATTEMPTS){store.otpDelete(mobile);return {ok:false,error:'تعداد تلاش بیش از حد. دوباره درخواست دهید.'};}
    const clean=String(inputCode||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s/g,'').trim();
    const expected=String(rec.code||'');
    const valid=/^\d{5}$/.test(clean)&&/^\d{5}$/.test(expected)&&crypto.timingSafeEqual(Buffer.from(clean),Buffer.from(expected));
    if(!valid){store.otpBumpAttempts(mobile);const left=MAX_ATTEMPTS-(rec.attempts+1);return {ok:false,error:left>0?`کد نادرست است. ${left} تلاش باقی مانده.`:'تعداد تلاش بیش از حد. دوباره درخواست دهید.'};}
    store.otpDelete(mobile);return {ok:true,mobile};
  }).immediate();
}

/** Verify ownership and issue a session that cannot be confused with legacy sessions. */
function verifyCode(rawMobile, inputCode) {
  return store.db.transaction(()=>{
    const check=consumeCode(rawMobile,inputCode);if(!check.ok)return check;
    const customer=store.getCustomer(check.mobile);
    if(customer&&!customer.active)return {ok:false,error:'حساب شما غیرفعال شده است.'};
    phoneVerification.markVerified(store.db,check.mobile,false);
    const token=store.createSession('CUSTOMER_VERIFIED',check.mobile,SESSION_TTL);
    return {ok:true,token,mobile:check.mobile};
  }).immediate();
}

/** بازگرداندن شماره موبایل از توکن */
function mobileFromToken(token) {
  if (!phoneVerification.ready(store.db)) return null;
  const s = store.readSession(token, 'CUSTOMER_VERIFIED');
  if (!s || !phoneVerification.verified(store.db,s.subject)) return null;
  const customer=store.getCustomer(s.subject);
  return customer && !customer.active ? null : s.subject;
}

function destroySession(token) { store.destroySession(token); }

// پاکسازی کدهای منقضی در db.js انجام می‌شود (هر ۵ دقیقه)

module.exports = {
  requestCode, deliveryAvailable, consumeCode, verifyCode, mobileFromToken, destroySession,
  normalizeMobile, isValidMobile, SESSION_TTL,
  get PROVIDER() { return sms.PROVIDER; }
};
