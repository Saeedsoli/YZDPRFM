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
const PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

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
  /* پیامیتو نشانی از پیش تعریف‌شده دارد، پس فقط اعتبارنامه لازم
     است — نام کاربری به‌علاوه ApiKey (یا رمز عبور به‌عنوان جانشین). */
  if (PROVIDER === 'payamito') return !!(USERNAME && (API_KEY || PASSWORD));
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

/* ═══════════════════════════════════════════
   کدهای پلتفرم payamak-panel
   ═══════════════════════════════════════════
   پیامیتو، ملی پیامک، فراپیامک و چند سامانه دیگر روی همین
   زیرساخت‌اند و کدهای خطایشان یکسان است.

   چرا ترجمه لازم است: مدیر فروشگاه که «۲» می‌بیند نمی‌داند یعنی
   اعتبار تمام شده. با پیام فارسی، خودش می‌تواند رفعش کند بدون
   اینکه سراغ لاگ سرور برود. */
const PANEL_ERRORS = {
  '0':    'نام کاربری یا کلید وب‌سرویس اشتباه است.',
  '2':    'اعتبار پنل پیامک کافی نیست — شارژ کنید.',
  '3':    'از محدودیت ارسال روزانه گذشته‌اید.',
  '4':    'از محدودیت حجم ارسال گذشته‌اید.',
  '5':    'شماره فرستنده معتبر نیست — SMS_SENDER را بررسی کنید.',
  '6':    'سامانه پیامک در حال به‌روزرسانی است.',
  '7':    'متن پیامک حاوی کلمه فیلترشده است.',
  '9':    'ارسال از خط عمومی با وب‌سرویس ممکن نیست — خط اختصاصی لازم است.',
  '10':   'حساب کاربری پنل پیامک فعال نیست.',
  '11':   'پیامک ارسال نشد.',
  '12':   'مدارک حساب پنل پیامک کامل نیست.',
  '14':   'متن پیامک حاوی لینک است.',
  '15':   'ارسال گروهی بدون درج «لغو۱۱» ممکن نیست.',
  '16':   'شماره گیرنده یافت نشد.',
  '17':   'متن پیامک خالی است.',
  '18':   'شماره گیرنده نامعتبر است.',
  '35':   'شماره گیرنده در لیست سیاه مخابرات است — خط خدماتی لازم است.',
  '-110': 'پنل ApiKey می‌خواهد نه رمز عبور — از تنظیمات وب‌سرویس بگیرید.',
  '-109': 'IP سرور در پنل پیامک مجاز نشده است.',
  '-108': 'IP سرور به دلیل تلاش‌های ناموفق مسدود شده است.'
};

/**
 * آیا مقدار بازگشتی، شناسه ارسال موفق است یا کد خطا؟
 *
 * قاعده مستندات: «در صورت دریافت یک عدد بیش از ۱۵ رقم، ارسال
 * موفق بوده». هر عدد کوچک‌تر کد خطاست.
 *
 * چرا طول و نه علامت: کد خطای `35` مثبت است ولی خطاست. اگر فقط
 * «مثبت یعنی موفق» را ملاک بگیریم، «شماره در لیست سیاه» را
 * موفق می‌شماریم و مدیر هرگز نمی‌فهمد چرا مشتری پیامک نگرفت.
 */
function readPanelValue(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: false, message: 'پاسخ خالی از سرویس پیامک' };

  // شناسه ارسال — عدد بلند
  if (/^\d{10,}$/.test(v)) return { ok: true, recId: v };

  if (Object.prototype.hasOwnProperty.call(PANEL_ERRORS, v)) {
    return { ok: false, code: v, message: PANEL_ERRORS[v] };
  }
  if (/^-?\d+$/.test(v)) {
    return { ok: false, code: v, message: `کد خطای سرویس پیامک: ${v}` };
  }
  return { ok: false, message: `پاسخ ناشناخته از سرویس پیامک: ${v.slice(0, 60)}` };
}

/**
 * آیا پاسخ سرویس یعنی «موفق»؟
 *
 * ── درس مستندات پیامیتو ──
 * «بسیاری از خطاهای کاربردی داخل بدنه پاسخ و همراه **HTTP 200**
 * برمی‌گردند؛ فقط وضعیت HTTP را معیار موفقیت قرار ندهید.»
 *
 * نسخه پیشین این تابع در نهایت به کد HTTP برمی‌گشت — یعنی
 * «نام کاربری اشتباه است» را **موفق** می‌شمرد. نتیجه در عمل:
 * مدیر فکر می‌کرد پیامک‌ها می‌روند، مشتری هیچ کدی نمی‌گرفت، و
 * هیچ خطایی هم در لاگ نبود.
 *
 * حالا HTTP فقط برای تشخیص **خرابی شبکه** به کار می‌رود، نه
 * موفقیت ارسال. اگر بدنه قابل تفسیر نباشد، ناموفق فرض می‌شود.
 *
 * محافظه‌کارانه: در تردید، **ناموفق**. پیامکی که فکر کنیم رفته
 * ولی نرفته، بدتر از خطای صریح است.
 */
function looksSuccessful(res) {
  const j = res.json;

  if (j && typeof j === 'object') {
    // قالب کاوه‌نگار
    if (j.return && typeof j.return.status !== 'undefined') {
      return { ok: j.return.status === 200, message: j.return.message };
    }
    /* قالب payamak-panel (پیامیتو، ملی پیامک، …)
       `RetStatus: 1` یعنی درخواست پذیرفته شد، ولی `Value` هنوز
       می‌تواند کد خطا باشد — پس هر دو بررسی می‌شوند. */
    if (typeof j.RetStatus !== 'undefined') {
      const accepted = Number(j.RetStatus) === 1;
      if (!accepted) {
        return {
          ok: false,
          message: j.StrRetStatus || `وضعیت ${j.RetStatus} از سرویس پیامک`
        };
      }
      if (typeof j.Value !== 'undefined') {
        const v = readPanelValue(j.Value);
        return { ok: v.ok, message: v.message || j.StrRetStatus || null };
      }
      return { ok: true, message: j.StrRetStatus || null };
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

  /* پاسخ متنی — سرویس SOAP و بعضی مسیرهای REST فقط یک عدد
     برمی‌گردانند. همان قاعده طول عدد اعمال می‌شود. */
  const t = String(res.body || '').trim();
  if (/^-?\d+$/.test(t)) return readPanelValue(t);

  /* ── چرا اینجا دیگر به HTTP برنمی‌گردیم ──
     رسیدن به این نقطه یعنی پاسخ نه JSON شناخته‌شده بود نه عدد.
     پیش‌تر در این حالت `HTTP 200` را «موفق» می‌شمردیم؛ ولی
     مستندات صریح می‌گوید خطاها هم با ۲۰۰ می‌آیند. پس ۲۰۰ هیچ
     چیزی درباره موفقیت ارسال نمی‌گوید.

     HTTP فقط برای تشخیص خرابی شبکه یا سرویس به کار می‌رود. */
  if (res.status >= 400) {
    return { ok: false, message: `سرویس پیامک پاسخ ${res.status} داد` };
  }
  return {
    ok: false,
    message: 'پاسخ سرویس پیامک قابل تفسیر نبود — ارسال تأیید نشد.'
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

/* ═══════════════════════════════════════════
   پیامیتو — پلتفرم payamak-panel
   ═══════════════════════════════════════════
   نشانی و قالب از مستندات رسمی گرفته شده، نه حدس:
   `rest.payamak-panel.com/api/SendSMS/SendSMS`

   ── چرا REST و نه SOAP ──
   سرویس هر دو را می‌دهد. SOAP نیازمند تولید Client از WSDL یا
   ساخت دستی پاکت XML است. این پروژه عمداً یک وابستگی npm دارد و
   افزودن کتابخانه SOAP برای کاری که با فرم ساده انجام می‌شود،
   خلاف همان اصل است.

   ── نکته `password` ──
   مستندات می‌گوید در این فیلد **ApiKey** بخش تنظیمات وب‌سرویس
   قرار می‌گیرد، نه رمز ورود پنل. کد خطای ‎-110 دقیقاً همین را
   می‌گوید. برای همین `API_KEY` اولویت دارد و `PASSWORD` جانشین
   است.
*/
const PANEL_BASE = process.env.SMS_PANEL_BASE
  || 'https://rest.payamak-panel.com/api/SendSMS';

/** بدنه `x-www-form-urlencoded` — این سرویس JSON نمی‌پذیرد */
function formBody(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function postPanel(path, fields) {
  const url = API_URL && path === '/SendSMS' ? API_URL : `${PANEL_BASE}${path}`;
  const body = formBody({
    username: USERNAME,
    // ApiKey جای رمز عبور می‌نشیند — الزام سرویس
    password: API_KEY || PASSWORD,
    ...fields
  });
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body
  });
  return looksSuccessful(res);
}

/** ارسال ساده از خط اختصاصی */
async function sendPanel(mobile, text) {
  if (!USERNAME || !(API_KEY || PASSWORD)) {
    return { ok: false, message: 'نام کاربری یا کلید وب‌سرویس پیامک تنظیم نشده است.' };
  }
  if (!SENDER) {
    return { ok: false, message: 'شماره خط فرستنده (SMS_SENDER) تنظیم نشده است.' };
  }
  return postPanel('/SendSMS', { to: mobile, from: SENDER, text });
}

/**
 * ارسال کد یکبارمصرف با متد `SendOtp`.
 *
 * سامانه خودش متن را می‌سازد، پس نیازی به الگوی تأییدشده نیست.
 * برای فروشگاهی که تازه راه افتاده این مسیر سریع‌ترین است.
 */
async function sendPanelOtp(mobile, code) {
  if (!USERNAME || !(API_KEY || PASSWORD)) {
    return { ok: false, message: 'اعتبارنامه سرویس پیامک تنظیم نشده است.' };
  }
  return postPanel('/SendOtp', { to: mobile, from: SENDER || '', code });
}

/**
 * ارسال از خط خدماتی اشتراکی — متد `BaseServiceNumber`.
 *
 * ── چرا این مسیر مهم است ──
 * پیامک از خط اختصاصی به شماره‌های داخل **لیست سیاه مخابرات**
 * نمی‌رسد (کد خطای ۳۵). برای پیام تبلیغاتی قابل تحمل است، ولی
 * برای **کد ورود** فاجعه است: مشتری که در لیست سیاه باشد هرگز
 * نمی‌تواند وارد حسابش شود و هیچ راه دیگری هم ندارد.
 *
 * خط خدماتی این محدودیت را ندارد. نیازمند الگوی تأییدشده در پنل
 * است که شناسه‌اش `bodyId` نام دارد.
 *
 * قالب متن: `arg1;arg2;arg3` — آرگومان‌های الگو با نقطه‌ویرگول.
 */
async function sendPanelPattern(mobile, args, bodyId) {
  if (!bodyId) return { ok: false, message: 'شناسه الگو (bodyId) تنظیم نشده است.' };
  const text = Array.isArray(args) ? args.join(';') : String(args);
  return postPanel('/BaseServiceNumber', { to: mobile, text, bodyId });
}

/**
 * ارسال عمومی — هر سامانه دیگری.
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
    if (PRODUCTION) return { ok: false, message: 'سامانه پیامک واقعی هنوز آماده نیست.' };
    /* حالت لاگ — متن در خروجی سرور چاپ می‌شود.
       عمداً واضح و قاب‌دار است تا در انبوه لاگ گم نشود. */
    console.log(`\n  ┌─ [${tag}] → ${mobile}`);
    String(text).split('\n').forEach(l => console.log(`  │ ${l}`));
    console.log(`  └─────────────────────────\n`);
    return { ok: true, logged: true };
  }

  try {
    if (PROVIDER === 'kavenegar') return await sendKavenegar(mobile, text);
    if (PROVIDER === 'payamito')  return await sendPanel(mobile, text);
    return await sendGeneric(mobile, text);
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/* ═══════════════════════════════════════════
   انتخاب خط بر پایه اهمیت پیام
   ═══════════════════════════════════════════

   فروشگاه هر دو نوع خط دارد و هر کدام محدودیت خودش را:

     خط اختصاصی (5000…)
       ✅ متن آزاد، بدون نیاز به تأیید الگو
       ❌ به شماره‌های داخل **لیست سیاه مخابرات** نمی‌رسد

     خط خدماتی اشتراکی
       ✅ به همه می‌رسد، حتی لیست سیاه
       ❌ فقط الگوی از پیش تأییدشده؛ متن آزاد ممکن نیست

   ── چرا انتخاب باید خودکار باشد ──
   حدود ۱۰ تا ۱۵ درصد شماره‌های ایرانی در لیست سیاه مخابرات‌اند
   (کاربرانی که تبلیغات را مسدود کرده‌اند). برای پیام تبلیغاتی
   مهم نیست، ولی برای این دو دسته فاجعه است:

     • **کد ورود** — مشتری بلک‌لیست هرگز نمی‌تواند وارد شود
     • **وضعیت سفارش** — کسی که پول داده باید خبردار شود

   پس هر پیام یک «اهمیت» دارد و اگر الگوی متناظرش تعریف شده
   باشد، از خط خدماتی می‌رود. وگرنه خط اختصاصی — که بهتر از
   نفرستادن است.

   هر الگو با یک متغیر محیطی به `bodyId` پنل وصل می‌شود:
     SMS_PATTERN_OTP        کد ورود
     SMS_PATTERN_ORDER      ثبت سفارش
     SMS_PATTERN_SHIPPED    ارسال مرسوله
     SMS_PATTERN_STOCK      موجود شدن کالا
*/
const PATTERNS = {
  otp:     process.env.SMS_PATTERN_OTP     || process.env.SMS_OTP_PATTERN || '',
  order:   process.env.SMS_PATTERN_ORDER   || '',
  shipped: process.env.SMS_PATTERN_SHIPPED || '',
  stock:   process.env.SMS_PATTERN_STOCK   || ''
};

/** آیا برای این نوع پیام، الگوی خدماتی تعریف شده؟ */
function patternFor(kind) {
  return PATTERNS[kind] || '';
}

/**
 * ارسال با انتخاب خودکار خط.
 *
 * @param {string}   mobile
 * @param {string}   kind   نوع پیام — کلید جدول PATTERNS
 * @param {string[]} args   متغیرهای الگو (برای خط خدماتی)
 * @param {string}   text   متن کامل (برای خط اختصاصی)
 */
async function sendSmart(mobile, kind, args, text, tag = 'SMS') {
  if (!mobile || !/^09\d{9}$/.test(mobile)) {
    return { ok: false, message: 'شماره موبایل نامعتبر' };
  }

  if (PROVIDER === 'console' || !isConfigured()) {
    if (PRODUCTION) return { ok: false, message: 'سامانه پیامک واقعی هنوز آماده نیست.' };
    const line = patternFor(kind) ? 'خدماتی' : 'اختصاصی';
    console.log(`\n  ┌─ [${tag}] → ${mobile}   ${d_(line)}`);
    String(text).split('\n').forEach(l => console.log(`  │ ${l}`));
    console.log(`  └─────────────────────────\n`);
    return { ok: true, logged: true };
  }

  const bodyId = patternFor(kind);
  if (bodyId && PROVIDER === 'payamito') {
    try {
      const r = await sendPanelPattern(mobile, args, bodyId);
      /* اگر خط خدماتی به هر دلیلی رد کرد (الگو تأیید نشده،
         اعتبار خدماتی تمام شده)، به خط اختصاصی برمی‌گردیم.
         پیام رسیده بهتر از پیام نرسیده است — حتی اگر به همه
         نرسد. */
      if (r.ok) return { ...r, line: 'service' };
      console.error(`  [${tag}] خط خدماتی رد کرد (${r.message}) — تلاش با خط اختصاصی`);
    } catch (e) {
      console.error(`  [${tag}] خطای خط خدماتی: ${e.message}`);
    }
  }

  const r = await send(mobile, text, tag);
  return { ...r, line: 'dedicated' };
}

/** برچسب کم‌رنگ برای لاگ — بدون وابستگی بیرونی */
const d_ = s => `\x1b[2m(${s})\x1b[0m`;

/**
 * ارسال کد یکبار مصرف.
 *
 * دو مسیر دارد چون نوع خط تعیین‌کننده است:
 *
 *   • **خط اختصاصی** (پیش‌فرض): متن آزاد می‌رود. ساده و بدون
 *     پیش‌نیاز، ولی به شماره‌های بلک‌لیست نمی‌رسد.
 *
 *   • **خط خدماتی اشتراکی** (`SMS_PATTERN_OTP` پر باشد): فقط
 *     متغیرها فرستاده می‌شوند و متن از الگوی از پیش تعریف‌شده در
 *     پنل ساخته می‌شود. به بلک‌لیست هم می‌رسد.
 */
async function sendOtp(mobile, code) {
  if (PROVIDER === 'console' || !isConfigured()) {
    if (PRODUCTION) return { ok: false, message: 'سامانه پیامک واقعی هنوز آماده نیست.' };
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

  /* ── پیامیتو: سه مسیر، به ترتیب اولویت ──

     ۱) الگوی خدماتی — اگر `SMS_OTP_PATTERN` ست شده باشد.
        تنها مسیری که به شماره‌های داخل لیست سیاه مخابرات هم
        می‌رسد. برای کد ورود مهم است: مشتری بلک‌لیست‌شده وگرنه
        هرگز نمی‌تواند وارد حسابش شود.

     ۲) متد `SendOtp` — سامانه خودش متن را می‌سازد، بدون نیاز
        به الگوی تأییدشده. سریع‌ترین راه راه‌اندازی.

     ۳) متن آزاد از خط اختصاصی — واپسین چاره. */
  if (PROVIDER === 'payamito') {
    try {
      const otpPattern = patternFor('otp');
      if (otpPattern) return await sendPanelPattern(mobile, [code], otpPattern);
      if (String(process.env.SMS_USE_SENDOTP || '1') === '1') {
        return await sendPanelOtp(mobile, code);
      }
    } catch (e) { return { ok: false, message: e.message }; }
  }

  // مسیر الگوی عمومی — سامانه‌های دیگر
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
      ...base, ok: !PRODUCTION, live: false,
      message: PRODUCTION ? 'پیامک آزمایشی در محیط تولید غیرفعال است.' : 'حالت آزمایشی — پیامک‌ها فقط در لاگ سرور چاپ می‌شوند.',
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

  /* پیامیتو نشانی رسمی دارد و در کد ثبت شده، پس `SMS_API_URL`
     برایش الزامی نیست. آنچه لازم است شماره خط فرستنده است —
     بدون آن سرویس کد خطای ۵ می‌دهد. */
  if (PROVIDER === 'payamito' && !SENDER && !OTP_PATTERN) {
    return {
      ...base, ok: false, live: false,
      message: 'شماره خط فرستنده (SMS_SENDER) تنظیم نشده است.',
      hint: 'شماره خط اختصاصی را از پنل پیامیتو بردارید، یا الگوی خدماتی تعریف کنید.'
    };
  }

  if (!['kavenegar', 'payamito'].includes(PROVIDER) && !API_URL) {
    return {
      ...base, ok: false, live: false,
      message: 'نشانی سرویس (SMS_API_URL) تنظیم نشده است.',
      hint: 'نشانی وب‌سرویس را از پنل سامانه پیامکی بردارید و ست کنید.'
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
  send, sendOtp, sendSmart, testConnection, isConfigured,
  patternFor, PATTERNS,
  PROVIDER, SENDER, OTP_PATTERN, API_URL,
  /* برای آزمون — تفسیر پاسخ سرویس بدون نیاز به تماس واقعی.
     بدون این، تنها راه سنجیدن منطق خطا فرستادن پیامک واقعی بود. */
  _internals: { looksSuccessful, readPanelValue, PANEL_ERRORS, formBody }
};
