/**
 * عطر یزد | لایه ارسال پیامک — مستقل از ارائه‌دهنده
 * ---------------------------------------------------
 * پیش‌تر کد کاوه‌نگار مستقیم داخل `notify.js` و `otp.js` نوشته شده
 * بود. با تغییر سامانه به **پیامیتو** معلوم شد این کار اشتباه بود:
 * منطق یک ارائه‌دهنده در دو فایل تکرار شده و عوض کردنش یعنی دست
 * زدن به هر دو.
 *
 * حالا همه‌چیز اینجاست و `SMS_PROVIDER` تعیین می‌کند کدام مسیر
 * برود:
 *
 *   console   → متن در لاگ سرور چاپ می‌شود (پیش‌فرض توسعه)
 *   payamito  → سامانه پیامیتو
 *   kavenegar → کاوه‌نگار (نگه داشته شد؛ حذفش سودی نداشت)
 *   generic   → هر سامانه‌ای، با پیکربندی از متغیر محیطی
 *
 * ── چرا حالت `generic` وجود دارد ──
 * مستندات فنی پیامیتو (نشانی دقیق و نام پارامترها) پشت لاگین پنل
 * است و از بیرون در دسترس نبود. به‌جای نوشتن کدِ حدسی که ممکن
 * است کار نکند، مسیر پیش‌فرض `payamito` بر پایه رایج‌ترین الگوی
 * سامانه‌های ایرانی ساخته شد و **همه بخش‌هایش با متغیر محیطی
 * قابل تصحیح است**:
 *
 *   SMS_API_URL       نشانی کامل ارسال
 *   SMS_FIELD_TO      نام فیلد گیرنده     (پیش‌فرض: to)
 *   SMS_FIELD_TEXT    نام فیلد متن        (پیش‌فرض: text)
 *   SMS_FIELD_FROM    نام فیلد فرستنده    (پیش‌فرض: from)
 *   SMS_AUTH_MODE     query | json | bearer
 *
 * یعنی وقتی مستندات واقعی در دست بود، **بدون تغییر یک خط کد**
 * قابل تنظیم است. اگر کد حدسی می‌نوشتم و کار نمی‌کرد، اشکال‌یابی
 * روی سرور استقرار انجام می‌شد — جایی که هر آزمون یک پیامک واقعی
 * و یک ری‌استارت هزینه دارد.
 */

'use strict';

const https = require('https');
const http  = require('http');

const PROVIDER = (process.env.SMS_PROVIDER || 'console').toLowerCase();

/* اعتبارنامه — هیچ‌کدام در کد نیست، همه از محیط.
   `SMS_API_KEY` نام تاریخی است و برای سازگاری با پیکربندی موجود
   نگه داشته شد؛ در پیامیتو همان «کلید وب‌سرویس» است که جایگزین
   رمز عبور می‌شود. */
const USERNAME = process.env.SMS_USERNAME || '';
const PASSWORD = process.env.SMS_PASSWORD || '';
const API_KEY  = process.env.SMS_API_KEY  || '';
const SENDER   = process.env.SMS_SENDER   || '';   // شماره خط اختصاصی

/* الگو (پترن) — فقط برای خط خدماتی اشتراکی.
   اگر خالی باشد، متن آزاد از خط اختصاصی می‌رود. */
const OTP_PATTERN = process.env.SMS_OTP_PATTERN || '';

/* ── چرا نشانی پیش‌فرضی برای پیامیتو گذاشته نشد ──
   وسوسه‌انگیز بود که یک نشانی حدسی بگذاریم تا «کار کند». ولی
   نشانی غلط بدتر از نشانی خالی است: سامانه ساکت شکست می‌خورد و
   مدیر تصور می‌کند پیامک‌ها می‌روند. با نشانی خالی، بررسی آمادگی
   صریح می‌گوید «SMS_API_URL تنظیم نشده».

   مستندات پیامیتو پشت لاگین پنل است؛ وقتی در دست بود، فقط همین
   یک متغیر محیطی ست می‌شود. */
const API_URL   = process.env.SMS_API_URL || '';
const AUTH_MODE = (process.env.SMS_AUTH_MODE || 'json').toLowerCase();

const F_TO   = process.env.SMS_FIELD_TO   || 'to';
const F_TEXT = process.env.SMS_FIELD_TEXT || 'text';
const F_FROM = process.env.SMS_FIELD_FROM || 'from';

/** آیا اعتبارنامه لازم برای ارسال واقعی موجود است؟ */
function isConfigured() {
  if (PROVIDER === 'console') return false;
  if (PROVIDER === 'kavenegar') return !!API_KEY;
  // بقیه: یا کلید وب‌سرویس، یا نام کاربری و رمز
  return !!(API_KEY || (USERNAME && PASSWORD));
}

/* ═══════════════════════════════════════════
   درخواست HTTP — کوچک، بدون وابستگی بیرونی
   ═══════════════════════════════════════════ */

/**
 * @param {string} urlStr نشانی کامل
 * @param {object} opts   { method, headers, body }
 * @returns {Promise<{status:number, body:string, json:object|null}>}
 */
function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); }
    catch { return reject(new Error('نشانی سرویس پیامک نامعتبر است.')); }

    const lib = u.protocol === 'http:' ? http : https;
    const body = opts.body || null;

    const req = lib.request({
      host: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: opts.method || 'POST',
      headers: {
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(opts.headers || {})
      },
      timeout: 15000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, body: d, json });
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('سرویس پیامک پاسخ نداد')); });
    req.on('error', e => reject(new Error(`اتصال به سرویس پیامک برقرار نشد: ${e.message}`)));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * آیا پاسخ سرویس یعنی «موفق»؟
 *
 * سامانه‌های ایرانی قالب یکسانی ندارند: بعضی `{status:200}`
 * می‌دهند، بعضی `{RetStatus:1}`، بعضی فقط یک عدد مثبت به‌عنوان
 * شناسه ارسال. این تابع رایج‌ترین‌ها را می‌شناسد و در نهایت به
 * کد وضعیت HTTP برمی‌گردد.
 *
 * محافظه‌کارانه نوشته شده: در تردید، **ناموفق** فرض می‌شود.
 * پیامکی که فکر کنیم رفته ولی نرفته، بدتر از خطای صریح است.
 */
function looksSuccessful(res) {
  const j = res.json;

  if (j && typeof j === 'object') {
    // قالب کاوه‌نگار
    if (j.return && typeof j.return.status !== 'undefined') {
      return { ok: j.return.status === 200, message: j.return.message };
    }
    // قالب ملی‌پیامک و مشابه‌ها
    if (typeof j.RetStatus !== 'undefined') {
      return { ok: Number(j.RetStatus) === 1, message: j.StrRetStatus };
    }
    // قالب‌های ساده
    if (typeof j.status !== 'undefined') {
      const s = j.status;
      const ok = s === true || s === 200 || s === 1 || s === '200' || s === 'ok'
        || s === 'success';
      return { ok, message: j.message || j.error || null };
    }
    if (typeof j.success !== 'undefined') {
      return { ok: !!j.success, message: j.message || j.error || null };
    }
    if (typeof j.result !== 'undefined' && typeof j.result === 'boolean') {
      return { ok: j.result, message: j.message || null };
    }
    // فقط شناسه ارسال برگشته
    if (typeof j.recId !== 'undefined' || typeof j.messageId !== 'undefined') {
      return { ok: true, message: null };
    }
  }

  /* پاسخ متنی: بعضی سامانه‌ها فقط یک عدد می‌دهند. عدد مثبت یعنی
     شناسه ارسال؛ عدد منفی یا صفر یعنی خطا. */
  const t = String(res.body || '').trim();
  if (/^-?\d+$/.test(t)) {
    const n = Number(t);
    return { ok: n > 0, message: n <= 0 ? `کد خطای سرویس: ${n}` : null };
  }

  // آخرین مبنا: کد وضعیت HTTP
  return {
    ok: res.status >= 200 && res.status < 300,
    message: res.status >= 400 ? `پاسخ ${res.status} از سرویس` : null
  };
}

/* ═══════════════════════════════════════════
   ارسال
   ═══════════════════════════════════════════ */

/** کاوه‌نگار — مسیر قدیمی، دست‌نخورده نگه داشته شد */
async function sendKavenegar(mobile, text) {
  const q = new URLSearchParams({ receptor: mobile, message: text });
  if (SENDER) q.set('sender', SENDER);
  const res = await request(
    `https://api.kavenegar.com/v1/${API_KEY}/sms/send.json?${q}`,
    { method: 'GET' });
  return looksSuccessful(res);
}

/**
 * ارسال عمومی — پیامیتو و هر سامانه دیگری.
 *
 * سه شیوه احراز هویت پشتیبانی می‌شود چون سامانه‌های ایرانی هر سه
 * را به کار می‌برند:
 *   json   → اعتبارنامه داخل بدنه JSON
 *   query  → اعتبارنامه در نشانی (query string)
 *   bearer → کلید در هدر Authorization
 */
async function sendGeneric(mobile, text) {
  if (!API_URL) {
    return { ok: false, message: 'نشانی سرویس پیامک (SMS_API_URL) تنظیم نشده است.' };
  }

  const payload = { [F_TO]: mobile, [F_TEXT]: text };
  if (SENDER) payload[F_FROM] = SENDER;

  if (AUTH_MODE === 'query') {
    const q = new URLSearchParams(payload);
    if (USERNAME) q.set('username', USERNAME);
    if (PASSWORD) q.set('password', PASSWORD);
    if (API_KEY)  q.set('apikey', API_KEY);
    const sep = API_URL.includes('?') ? '&' : '?';
    const res = await request(`${API_URL}${sep}${q}`, { method: 'GET' });
    return looksSuccessful(res);
  }

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (AUTH_MODE === 'bearer' && API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
  } else {
    if (USERNAME) payload.username = USERNAME;
    if (PASSWORD) payload.password = PASSWORD;
    if (API_KEY)  payload.apikey = API_KEY;
  }

  const res = await request(API_URL, {
    method: 'POST', headers, body: JSON.stringify(payload)
  });
  return looksSuccessful(res);
}

/**
 * ارسال پیامک.
 *
 * **هرگز throw نمی‌کند.** پیامک نباید جریان اصلی را متوقف کند —
 * سفارشی که ثبت شده نباید به‌خاطر نرفتن پیامک شکست بخورد.
 *
 * @returns {Promise<{ok:boolean, message?:string, logged?:boolean}>}
 */
async function send(mobile, text, tag = 'SMS') {
  if (!mobile || !/^09\d{9}$/.test(mobile)) {
    return { ok: false, message: 'شماره موبایل نامعتبر' };
  }

  if (PROVIDER === 'console' || !isConfigured()) {
    /* حالت لاگ — متن در خروجی سرور چاپ می‌شود.
       عمداً واضح و قاب‌دار است تا در انبوه لاگ گم نشود. */
    console.log(`\n  ┌─ [${tag}] → ${mobile}`);
    String(text).split('\n').forEach(l => console.log(`  │ ${l}`));
    console.log(`  └─────────────────────────\n`);
    return { ok: true, logged: true };
  }

  try {
    const r = PROVIDER === 'kavenegar'
      ? await sendKavenegar(mobile, text)
      : await sendGeneric(mobile, text);
    return r;
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * ارسال کد یکبار مصرف.
 *
 * دو مسیر دارد چون نوع خط تعیین‌کننده است:
 *
 *   • **خط اختصاصی** (پیش‌فرض): متن آزاد می‌رود. ساده و بدون
 *     پیش‌نیاز، ولی به شماره‌های بلک‌لیست نمی‌رسد.
 *
 *   • **خط خدماتی اشتراکی** (`SMS_OTP_PATTERN` پر باشد): فقط
 *     متغیرها فرستاده می‌شوند و متن از الگوی از پیش تعریف‌شده در
 *     پنل ساخته می‌شود. به بلک‌لیست هم می‌رسد.
 *
 * مالک فروشگاه خط اختصاصی دارد، ولی هر دو پشتیبانی می‌شود چون
 * ممکن است بعداً خط خدماتی هم بگیرد.
 */
async function sendOtp(mobile, code) {
  if (PROVIDER === 'console' || !isConfigured()) {
    console.log(`\n  [OTP] ${mobile} → کد ورود: ${code}\n`);
    return { ok: true, logged: true };
  }

  if (PROVIDER === 'kavenegar') {
    const tpl = process.env.SMS_TEMPLATE || 'yazd-otp';
    try {
      const res = await request(
        `https://api.kavenegar.com/v1/${API_KEY}/verify/lookup.json`
        + `?receptor=${mobile}&token=${code}&template=${tpl}`, { method: 'GET' });
      return looksSuccessful(res);
    } catch (e) { return { ok: false, message: e.message }; }
  }

  // مسیر الگو — خط خدماتی اشتراکی
  if (OTP_PATTERN) {
    const url = process.env.SMS_PATTERN_URL || API_URL;
    if (!url) return { ok: false, message: 'نشانی سرویس الگو تنظیم نشده است.' };
    try {
      const payload = {
        [F_TO]: mobile,
        bodyId: OTP_PATTERN,
        [F_TEXT]: String(code)
      };
      if (USERNAME) payload.username = USERNAME;
      if (PASSWORD) payload.password = PASSWORD;
      if (API_KEY)  payload.apikey = API_KEY;
      const res = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      return looksSuccessful(res);
    } catch (e) { return { ok: false, message: e.message }; }
  }

  // خط اختصاصی — متن آزاد
  return send(mobile, `عطر یزد\nکد ورود شما: ${code}\nاین کد تا ۲ دقیقه معتبر است.`, 'OTP');
}

/* ═══════════════════════════════════════════
   بررسی سلامت — بدون افشای کلید
   ═══════════════════════════════════════════ */

/** ماسک کردن یک راز: فقط چهار نویسه آخر */
function mask(v) {
  return v ? '••••' + String(v).slice(-4) : null;
}

/**
 * وضعیت پیکربندی + آزمون واقعی اختیاری.
 *
 * @param {string} [mobile] اگر بدهید، یک پیامک آزمایشی واقعی می‌رود
 */
async function testConnection(mobile) {
  const keyHint = mask(API_KEY) || mask(PASSWORD);

  const base = {
    provider: PROVIDER,
    key_set: !!(API_KEY || PASSWORD),
    key_hint: keyHint,
    username_set: !!USERNAME,
    sender: SENDER || null,
    line_type: OTP_PATTERN ? 'خدماتی اشتراکی (الگو)' : 'اختصاصی (متن آزاد)',
    api_url: API_URL || null
  };

  if (PROVIDER === 'console') {
    return {
      ...base, ok: true, live: false,
      message: 'حالت آزمایشی — پیامک‌ها فقط در لاگ سرور چاپ می‌شوند.',
      hint: 'برای ارسال واقعی: SMS_PROVIDER=payamito و اعتبارنامه را ست کنید.'
    };
  }

  if (!isConfigured()) {
    return {
      ...base, ok: false, live: false,
      message: `ارائه‌دهنده «${PROVIDER}» انتخاب شده ولی اعتبارنامه ناقص است.`,
      hint: 'SMS_API_KEY یا (SMS_USERNAME و SMS_PASSWORD) لازم است.'
    };
  }

  if (PROVIDER !== 'kavenegar' && !API_URL) {
    return {
      ...base, ok: false, live: false,
      message: 'نشانی سرویس (SMS_API_URL) تنظیم نشده است.',
      hint: 'نشانی وب‌سرویس را از پنل پیامیتو بردارید و ست کنید.'
    };
  }

  /* بدون شماره آزمایشی، فقط پیکربندی بررسی می‌شود.
     چرا تماس شبکه‌ای نمی‌زنیم: برخلاف کاوه‌نگار که مسیر رایگان
     «اعتبار حساب» دارد، برای سامانه عمومی نمی‌دانیم کدام مسیر
     بی‌هزینه است. زدن یک درخواست کور ممکن است پیامک بفرستد. */
  if (!mobile) {
    return {
      ...base, ok: true, live: true,
      message: 'پیکربندی کامل است. برای آزمون واقعی، شماره خودتان را وارد کنید.',
      hint: 'یک پیامک واقعی ارسال می‌شود و از اعتبار حساب کم می‌کند.'
    };
  }

  const r = await send(mobile,
    'عطر یزد — پیامک آزمایشی. اگر این را دریافت کردید، پیکربندی درست است.',
    'TEST');

  return {
    ...base,
    ok: !!r.ok, live: true,
    test_sms: r.ok ? 'sent' : 'failed',
    test_error: r.ok ? undefined : r.message,
    message: r.ok
      ? 'پیامک آزمایشی ارسال شد — گوشی‌تان را بررسی کنید.'
      : `ارسال ناموفق: ${r.message || 'خطای نامشخص'}`
  };
}

module.exports = {
  send, sendOtp, testConnection, isConfigured,
  PROVIDER, SENDER, OTP_PATTERN, API_URL
};
