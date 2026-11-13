const crypto = require('crypto');
const store = require('./db');
const sms = require('./sms');
const phoneVerification = require('./customer-phone-verification');

const OTP_TTL      = 2 * 60 * 1000;
const RESEND_GAP   = 60 * 1000;
const MAX_ATTEMPTS = 5;
const SESSION_TTL  = 30 * 24 * 3600 * 1000;

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

async function deliveryAvailable() {
  if (String(process.env.NODE_ENV||'').trim().toLowerCase() !== 'production') return true;
  try { const r=await sms.testConnection();return !!(r && r.ok && r.live); } catch { return false; }
}

async function requestCode(rawMobile) {
  if (!phoneVerification.ready(store.db)) return {ok:false,error:'سامانه تأیید شماره هنوز آماده نیست.'};
  const mobile = normalizeMobile(rawMobile);
  if (!isValidMobile(mobile)) {
    return { ok: false, error: 'شماره موبایل معتبر نیست.' };
  }

  const pending = 'pending:' + crypto.randomBytes(24).toString('hex');
  const reserved = store.db.transaction(() => {
    const now = Date.now(), prev = store.otpGet(mobile);
    if (prev && now - prev.lastSent < RESEND_GAP) {
      const wait = Math.ceil((RESEND_GAP - (now - prev.lastSent)) / 1000);
      return { ok:false, error:`تا ارسال مجدد ${wait} ثانیه صبر کنید.`, retry_after:wait };
    }
    store.otpSave(mobile, {code:pending, expires:now + RESEND_GAP, lastSent:now, attempts:0});
    return {ok:true,prev};
  }).immediate();
  if (!reserved.ok) return reserved;
  const code = String(crypto.randomInt(10000, 100000));
  let r;
  try { r = await sms.sendOtp(mobile, code); }
  catch { r = {ok:false}; }
  const committed = store.db.transaction(() => {
    const current=store.otpGet(mobile);
    if (!current || current.code !== pending) return false;
    if (!r || !r.ok) {

      const prev=reserved.prev;
      if (prev && /^\d{5}$/.test(prev.code) && prev.expires > Date.now()) store.otpSave(mobile,prev);
      else store.otpDelete(mobile);
      return false;
    }
    const now=Date.now();
    store.otpSave(mobile,{code,expires:now + OTP_TTL,lastSent:now,attempts:0});
    return true;
  }).immediate();
  if (!committed) {
    return { ok:false, error: String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ? 'ارسال پیامک انجام نشد. دوباره تلاش کنید.' : ((r && r.message) || 'ارسال پیامک انجام نشد. دوباره تلاش کنید.') };
  }

  return {
    ok: true, mobile, ttl: OTP_TTL / 1000,

    ...(r.logged ? { dev_hint: 'کد در لاگ سرور چاپ شد' } : {})
  };
}

function consumeCode(rawMobile, inputCode) {
  return store.db.transaction(()=>{
    if (!phoneVerification.ready(store.db)) return {ok:false,error:'سامانه تأیید شماره هنوز آماده نیست.'};
    const mobile=normalizeMobile(rawMobile);
    if(!isValidMobile(mobile))return {ok:false,error:'شماره موبایل معتبر نیست.'};
    const rec=store.otpGet(mobile);
    if(!rec)return {ok:false,error:'ابتدا درخواست کد بدهید.'};
    if(Date.now()>rec.expires){store.otpDelete(mobile);return {ok:false,error:'کد منقضی شده است. دوباره درخواست دهید.'};}

    if(/^pending:[a-f0-9]{48}$/.test(rec.code))return {ok:false,error:'ارسال کد هنوز در حال انجام است. کمی صبر کنید.'};
    if(rec.attempts>=MAX_ATTEMPTS){store.otpDelete(mobile);return {ok:false,error:'تعداد تلاش بیش از حد. دوباره درخواست دهید.'};}
    const clean=String(inputCode||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s/g,'').trim();
    const expected=String(rec.code||'');
    const valid=/^\d{5}$/.test(clean)&&/^\d{5}$/.test(expected)&&crypto.timingSafeEqual(Buffer.from(clean),Buffer.from(expected));
    if(!valid){store.otpBumpAttempts(mobile);const left=MAX_ATTEMPTS-(rec.attempts+1);return {ok:false,error:left>0?`کد نادرست است. ${left} تلاش باقی مانده.`:'تعداد تلاش بیش از حد. دوباره درخواست دهید.'};}
    store.otpDelete(mobile);return {ok:true,mobile};
  }).immediate();
}

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

function mobileFromToken(token) {
  if (!phoneVerification.ready(store.db)) return null;
  const s = store.readSession(token, 'CUSTOMER_VERIFIED');
  if (!s || !phoneVerification.verified(store.db,s.subject)) return null;
  const customer=store.getCustomer(s.subject);
  return customer && !customer.active ? null : s.subject;
}

function destroySession(token) { store.destroySession(token); }

module.exports = {
  requestCode, deliveryAvailable, consumeCode, verifyCode, mobileFromToken, destroySession,
  normalizeMobile, isValidMobile, SESSION_TTL,
  get PROVIDER() { return sms.PROVIDER; }
};
