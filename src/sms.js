'use strict';

const https = require('https');
const http  = require('http');

const PROVIDER = (process.env.SMS_PROVIDER || 'console').toLowerCase();
const PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

const USERNAME = process.env.SMS_USERNAME || '';
const PASSWORD = process.env.SMS_PASSWORD || '';
const API_KEY  = process.env.SMS_API_KEY  || '';
const SENDER   = process.env.SMS_SENDER   || '';

const OTP_PATTERN = process.env.SMS_OTP_PATTERN || '';

const API_URL   = process.env.SMS_API_URL || '';
const AUTH_MODE = (process.env.SMS_AUTH_MODE || 'json').toLowerCase();

const F_TO   = process.env.SMS_FIELD_TO   || 'to';
const F_TEXT = process.env.SMS_FIELD_TEXT || 'text';
const F_FROM = process.env.SMS_FIELD_FROM || 'from';

function isConfigured() {
  if (PROVIDER === 'console') return false;
  if (PROVIDER === 'kavenegar') return !!API_KEY;

  if (PROVIDER === 'payamito') return !!(USERNAME && (API_KEY || PASSWORD));

  return !!(API_KEY || (USERNAME && PASSWORD));
}

function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); }
    catch { return reject(new Error('نشانی سرویس پیامک نامعتبر است.')); }

    if (!['http:', 'https:'].includes(u.protocol) || (PRODUCTION && u.protocol !== 'https:')) {
      return reject(new Error('نشانی سرویس پیامک در محیط تولید باید HTTPS باشد.'));
    }
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

function readPanelValue(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: false, message: 'پاسخ خالی از سرویس پیامک' };

  if (/^\d{10,}$/.test(v)) return { ok: true, recId: v };

  if (Object.prototype.hasOwnProperty.call(PANEL_ERRORS, v)) {
    return { ok: false, code: v, message: PANEL_ERRORS[v] };
  }
  if (/^-?\d+$/.test(v)) {
    return { ok: false, code: v, message: `کد خطای سرویس پیامک: ${v}` };
  }
  return { ok: false, message: `پاسخ ناشناخته از سرویس پیامک: ${v.slice(0, 60)}` };
}

function looksSuccessful(res) {
  if (!Number.isInteger(res.status) || res.status < 200 || res.status >= 300) {
    return { ok: false, message: 'پاسخ HTTP سرویس پیامک موفق نبود.' };
  }
  const j = res.json;

  if (j && typeof j === 'object') {

    if (j.return && typeof j.return.status !== 'undefined') {
      return { ok: j.return.status === 200, message: j.return.message };
    }

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

    if (typeof j.status !== 'undefined') {
      const s = j.status;
      const ok = s === true || s === 200 || s === 1 || s === '200' || s === 'ok'
        || s === 'success';
      return { ok, message: j.message || j.error || null };
    }
    if (typeof j.success !== 'undefined') {
      return { ok: j.success === true, message: j.message || j.error || null };
    }
    if (typeof j.result !== 'undefined' && typeof j.result === 'boolean') {
      return { ok: j.result, message: j.message || null };
    }

    if (typeof j.recId !== 'undefined' || typeof j.messageId !== 'undefined') {
      return { ok: true, message: null };
    }
  }

  const t = String(res.body || '').trim();
  if (/^-?\d+$/.test(t)) return readPanelValue(t);

  if (res.status >= 400) {
    return { ok: false, message: `سرویس پیامک پاسخ ${res.status} داد` };
  }
  return {
    ok: false,
    message: 'پاسخ سرویس پیامک قابل تفسیر نبود — ارسال تأیید نشد.'
  };
}

async function sendKavenegar(mobile, text) {
  const q = new URLSearchParams({ receptor: mobile, message: text });
  if (SENDER) q.set('sender', SENDER);
  const res = await request(
    `https://api.kavenegar.com/v1/${API_KEY}/sms/send.json?${q}`,
    { method: 'GET' });
  return looksSuccessful(res);
}

const PANEL_BASE = process.env.SMS_PANEL_BASE
  || 'https://rest.payamak-panel.com/api/SendSMS';

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

async function sendPanel(mobile, text) {
  if (!USERNAME || !(API_KEY || PASSWORD)) {
    return { ok: false, message: 'نام کاربری یا کلید وب‌سرویس پیامک تنظیم نشده است.' };
  }
  if (!SENDER) {
    return { ok: false, message: 'شماره خط فرستنده (SMS_SENDER) تنظیم نشده است.' };
  }
  return postPanel('/SendSMS', { to: mobile, from: SENDER, text });
}

async function sendPanelOtp(mobile, code) {
  if (!USERNAME || !(API_KEY || PASSWORD)) {
    return { ok: false, message: 'اعتبارنامه سرویس پیامک تنظیم نشده است.' };
  }
  return postPanel('/SendOtp', { to: mobile, from: SENDER || '', code });
}

async function sendPanelPattern(mobile, args, bodyId) {
  if (!bodyId) return { ok: false, message: 'شناسه الگو (bodyId) تنظیم نشده است.' };
  const text = Array.isArray(args) ? args.join(';') : String(args);
  return postPanel('/BaseServiceNumber', { to: mobile, text, bodyId });
}

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

async function send(mobile, text, tag = 'SMS') {
  if (!mobile || !/^09\d{9}$/.test(mobile)) {
    return { ok: false, message: 'شماره موبایل نامعتبر' };
  }

  if (PROVIDER === 'console' || !isConfigured()) {
    if (PRODUCTION) return { ok: false, message: 'سامانه پیامک واقعی هنوز آماده نیست.' };

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

const PATTERNS = {
  otp:     process.env.SMS_PATTERN_OTP     || process.env.SMS_OTP_PATTERN || '',
  order:   process.env.SMS_PATTERN_ORDER   || '',
  shipped: process.env.SMS_PATTERN_SHIPPED || '',
  stock:   process.env.SMS_PATTERN_STOCK   || ''
};

function patternFor(kind) {
  return PATTERNS[kind] || '';
}

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

      if (r.ok) return { ...r, line: 'service' };
      console.error(`  [${tag}] خط خدماتی رد کرد (${r.message}) — تلاش با خط اختصاصی`);
    } catch (e) {
      console.error(`  [${tag}] خطای خط خدماتی: ${e.message}`);
    }
  }

  const r = await send(mobile, text, tag);
  return { ...r, line: 'dedicated' };
}

const d_ = s => `\x1b[2m(${s})\x1b[0m`;

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

  if (PROVIDER === 'payamito') {
    try {
      const otpPattern = patternFor('otp');
      if (otpPattern) return await sendPanelPattern(mobile, [code], otpPattern);
      if (String(process.env.SMS_USE_SENDOTP || '1') === '1') {
        return await sendPanelOtp(mobile, code);
      }
    } catch (e) { return { ok: false, message: e.message }; }
  }

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

  return send(mobile, `عطر یزد\nکد ورود شما: ${code}\nاین کد تا ۲ دقیقه معتبر است.`, 'OTP');
}

function mask(v) {
  return v ? '••••' + String(v).slice(-4) : null;
}

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

  _internals: { looksSuccessful, readPanelValue, PANEL_ERRORS, formBody }
};
