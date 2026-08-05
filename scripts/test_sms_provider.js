#!/usr/bin/env node
/**
 * آزمون لایه پیامک — با سرور جعلی، بدون ارسال واقعی.
 *
 * پس‌زمینه: سامانه از کاوه‌نگار به **پیامیتو** تغییر کرد. مستندات
 * فنی پیامیتو پشت لاگین پنل است و در دسترس نبود، پس به‌جای کد
 * حدسی، لایه‌ای ساخته شد که با متغیر محیطی قابل تنظیم است.
 *
 * این آزمون همان ادعا را می‌سنجد: **آیا واقعاً بدون تغییر کد
 * می‌شود به هر سامانه‌ای وصل شد؟**
 *
 * روش: یک سرور HTTP جعلی بالا می‌آید که نقش سامانه پیامک را بازی
 * می‌کند. درخواست‌های رسیده ثبت می‌شوند تا بررسی شود دقیقاً چه
 * چیزی و با چه قالبی فرستاده شده.
 *
 * پوشش:
 *   • حالت console هیچ درخواست شبکه‌ای نمی‌زند
 *   • قالب JSON، query و bearer هر سه کار می‌کنند
 *   • نام فیلدها با متغیر محیطی قابل تغییر است
 *   • قالب‌های مختلف پاسخ موفق/ناموفق درست تفسیر می‌شوند
 *   • خط اختصاصی (متن آزاد) و خدماتی (الگو) هر دو
 *   • شکست ارسال، کد OTP را ذخیره نمی‌کند
 *   • هیچ کلیدی در خروجی testConnection نشت نمی‌کند
 *   • send هرگز throw نمی‌کند
 *
 * اجرا: node scripts/test_sms_provider.js
 */
'use strict';

const http = require('http');
const path = require('path');
const { fork } = require('child_process');

const ROOT = path.dirname(__dirname);

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

/* ── سرور جعلی سامانه پیامک ──
   هر درخواست را ثبت می‌کند و پاسخ از پیش تعیین‌شده می‌دهد. */
const received = [];
let replyWith = { code: 200, body: '{"status":200,"message":"ok"}' };

const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    received.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
      json: (() => { try { return JSON.parse(body); } catch { return null; } })()
    });
    res.writeHead(replyWith.code, { 'Content-Type': 'application/json' });
    res.end(replyWith.body);
  });
});

const PORT = 4602;
const FAKE_URL = `http://127.0.0.1:${PORT}/send`;

/**
 * ماژول sms را در یک پروسه جدا با متغیرهای دلخواه اجرا می‌کند.
 *
 * چرا پروسه جدا: `sms.js` متغیرهای محیطی را هنگام بارگذاری
 * می‌خواند (const در سطح ماژول). تغییر `process.env` پس از
 * require هیچ اثری ندارد — این خودش تصمیم درستی است چون
 * پیکربندی نباید وسط کار عوض شود، ولی یعنی آزمون باید هر بار
 * پروسه تازه بسازد.
 */
function runWithEnv(env, script) {
  return new Promise(resolve => {
    const child = fork(path.join(__dirname, 'lib', '_sms_probe.js'), [script], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      silent: true
    });
    let out = '';
    child.stdout.on('data', c => out += c);
    child.stderr.on('data', c => out += c);
    child.on('exit', () => {
      let parsed = null;
      const m = out.match(/__RESULT__(.*)__END__/s);
      if (m) { try { parsed = JSON.parse(m[1]); } catch {} }
      resolve({ raw: out, result: parsed });
    });
  });
}

(async () => {
  console.log('\n  آزمون لایه پیامک (با سرور جعلی)\n');

  await new Promise(res => fake.listen(PORT, '127.0.0.1', res));

  const finish = () => {
    fake.close();
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('لایه پیامک با هر سامانه‌ای کار می‌کند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    // ═══════════════════════════════════
    console.log('  ── حالت پیش‌فرض (console) ──');

    {
      received.length = 0;
      const { result } = await runWithEnv({ SMS_PROVIDER: 'console' }, 'send');
      add('ارسال در حالت console موفق گزارش می‌شود', result?.ok === true);
      add('پرچم logged گذاشته می‌شود', result?.logged === true);
      add('هیچ درخواست شبکه‌ای زده نمی‌شود', received.length === 0,
        `${received.length} درخواست`);
    }

    // ═══════════════════════════════════
    console.log('\n  ── ارسال با قالب JSON (پیش‌فرض) ──');

    /* از ۱۴ مرداد ۱۴۰۵، `payamito` قرارداد اختصاصی خودش را دارد
       (نشانی ثابت، فرم urlencoded). این بخش رفتار **لایه عمومی**
       را می‌سنجد — یعنی سازگاری با هر سامانه دلخواه — پس باید
       `generic` باشد نه `payamito`. */
    const baseEnv = {
      SMS_PROVIDER: 'generic',
      SMS_API_URL: FAKE_URL,
      SMS_USERNAME: 'testuser',
      SMS_PASSWORD: 'testpass',
      SMS_SENDER: '3000123456'
    };

    {
      received.length = 0;
      replyWith = { code: 200, body: '{"status":200,"message":"ok"}' };
      const { result } = await runWithEnv(baseEnv, 'send');

      add('ارسال موفق گزارش می‌شود', result?.ok === true, result?.message);
      add('دقیقاً یک درخواست زده شد', received.length === 1);

      const req = received[0];
      add('روش POST است', req?.method === 'POST');
      add('نوع محتوا JSON است',
        (req?.headers['content-type'] || '').includes('application/json'));
      add('شماره گیرنده فرستاده شد', req?.json?.to === '09121234567', req?.json?.to);
      add('متن پیام فرستاده شد', typeof req?.json?.text === 'string' && req.json.text.length > 0);
      add('شماره خط فرستاده شد', req?.json?.from === '3000123456');
      add('نام کاربری فرستاده شد', req?.json?.username === 'testuser');
      add('رمز فرستاده شد', req?.json?.password === 'testpass');
    }

    // ═══════════════════════════════════
    console.log('\n  ── نام فیلدها قابل تغییر است ──');

    {
      /* ادعای اصلی این معماری: اگر مستندات واقعی نام دیگری داشت،
         بدون تغییر کد قابل تنظیم است. */
      received.length = 0;
      const { result } = await runWithEnv({
        ...baseEnv,
        SMS_FIELD_TO: 'receptor',
        SMS_FIELD_TEXT: 'message',
        SMS_FIELD_FROM: 'lineNumber'
      }, 'send');

      add('ارسال با نام فیلد سفارشی موفق است', result?.ok === true);
      const j = received[0]?.json || {};
      add('فیلد گیرنده تغییر نام داد', j.receptor === '09121234567' && !j.to);
      add('فیلد متن تغییر نام داد', typeof j.message === 'string' && !j.text);
      add('فیلد خط تغییر نام داد', j.lineNumber === '3000123456' && !j.from);
    }

    // ═══════════════════════════════════
    console.log('\n  ── قالب query (اعتبارنامه در نشانی) ──');

    {
      received.length = 0;
      const { result } = await runWithEnv({
        ...baseEnv, SMS_AUTH_MODE: 'query'
      }, 'send');

      add('ارسال با قالب query موفق است', result?.ok === true);
      const req = received[0];
      add('روش GET است', req?.method === 'GET', req?.method);
      const q = new URLSearchParams((req?.url || '').split('?')[1] || '');
      add('گیرنده در نشانی هست', q.get('to') === '09121234567');
      add('نام کاربری در نشانی هست', q.get('username') === 'testuser');
      add('بدنه خالی است', !req?.body);
    }

    // ═══════════════════════════════════
    console.log('\n  ── قالب bearer (کلید در هدر) ──');

    {
      received.length = 0;
      const { result } = await runWithEnv({
        SMS_PROVIDER: 'generic', SMS_API_URL: FAKE_URL,
        SMS_API_KEY: 'SECRETKEY123456', SMS_AUTH_MODE: 'bearer'
      }, 'send');

      add('ارسال با قالب bearer موفق است', result?.ok === true);
      const req = received[0];
      add('کلید در هدر Authorization است',
        req?.headers.authorization === 'Bearer SECRETKEY123456');
      /* حیاتی: در حالت bearer نباید کلید در بدنه هم تکرار شود. */
      add('کلید در بدنه تکرار نشده', !req?.json?.apikey && !req?.json?.password);
    }

    // ═══════════════════════════════════
    console.log('\n  ── تفسیر قالب‌های مختلف پاسخ ──');

    const RESPONSES = [
      ['{"status":200}',                     true,  'status عددی'],
      ['{"status":"ok"}',                    true,  'status متنی'],
      ['{"success":true}',                   true,  'success بولی'],
      ['{"RetStatus":1,"StrRetStatus":"Ok"}', true, 'قالب ملی‌پیامک'],
      ['{"return":{"status":200}}',          true,  'قالب کاوه‌نگار'],
      ['{"recId":123456}',                   true,  'شناسه ارسال'],
      /* ── تغییر عمدی، ۱۴ مرداد ۱۴۰۵ ──
         مستندات payamak-panel: «در صورت دریافت یک عدد بیش از ۱۵
         رقم، ارسال موفق بوده». عدد کوتاه **کد خطاست** نه شناسه.
         نمونه‌اش کد ۳۵ (لیست سیاه) که مثبت است ولی خطاست.
         پیش‌تر «هر عدد مثبت = موفق» بود و کد ۳۵ را موفق می‌شمرد. */
      ['1234567',                            false, 'عدد کوتاه = کد خطا'],
      ['1234567890123456',                   true,  'شناسه ۱۶ رقمی'],
      ['{"status":0,"message":"اعتبار کافی نیست"}', false, 'status صفر'],
      ['{"success":false,"error":"کلید نامعتبر"}',  false, 'success نادرست'],
      ['{"RetStatus":-1}',                   false, 'RetStatus منفی'],
      ['-10',                                false, 'عدد منفی خام']
    ];

    for (const [body, expectOk, label] of RESPONSES) {
      received.length = 0;
      replyWith = { code: 200, body };
      const { result } = await runWithEnv(baseEnv, 'send');
      add(`${label} → ${expectOk ? 'موفق' : 'ناموفق'}`,
        result?.ok === expectOk, `پاسخ: ${body.slice(0, 34)}`);
    }

    {
      received.length = 0;
      replyWith = { code: 500, body: 'Internal Error' };
      const { result } = await runWithEnv(baseEnv, 'send');
      add('خطای ۵۰۰ سرور ناموفق شمرده می‌شود', result?.ok === false);
      add('پیام خطا برمی‌گردد', !!result?.message, result?.message);
    }

    {
      /* سرویس در دسترس نباشد — نباید throw کند */
      received.length = 0;
      const { result } = await runWithEnv({
        ...baseEnv, SMS_API_URL: 'http://127.0.0.1:1/nope'
      }, 'send');
      add('سرویس در دسترس نباشد، throw نمی‌کند', result !== null);
      add('و ناموفق گزارش می‌شود', result?.ok === false, result?.message);
    }

    replyWith = { code: 200, body: '{"status":200}' };

    // ═══════════════════════════════════
    console.log('\n  ── کد یکبار مصرف ──');

    {
      received.length = 0;
      const { result } = await runWithEnv(baseEnv, 'otp');
      add('OTP با خط اختصاصی متن آزاد می‌فرستد', result?.ok === true);
      const txt = received[0]?.json?.text || '';
      add('کد داخل متن هست', txt.includes('12345'), txt.slice(0, 46));
      add('نام برند در متن هست', txt.includes('عطر یزد'));
      add('مهلت اعتبار ذکر شده', /دقیقه/.test(txt));
    }

    {
      /* خط خدماتی اشتراکی — فقط متغیر می‌رود نه متن کامل */
      received.length = 0;
      const { result } = await runWithEnv({
        ...baseEnv, SMS_OTP_PATTERN: 'yazd-login-42'
      }, 'otp');
      add('OTP با الگو کار می‌کند', result?.ok === true);
      const j = received[0]?.json || {};
      add('شناسه الگو فرستاده شد', j.bodyId === 'yazd-login-42', j.bodyId);
      add('فقط کد فرستاده شد نه متن کامل',
        j.text === '12345', j.text);
    }

    {
      /* شکست ارسال نباید کد را ذخیره کند */
      received.length = 0;
      replyWith = { code: 200, body: '{"status":0,"message":"اعتبار کافی نیست"}' };
      const { result } = await runWithEnv(baseEnv, 'otp');
      add('OTP در صورت شکست ارسال، ناموفق است', result?.ok === false);
      add('پیام خطای سرویس منتقل می‌شود',
        /اعتبار/.test(result?.message || ''), result?.message);
      replyWith = { code: 200, body: '{"status":200}' };
    }

    // ═══════════════════════════════════
    console.log('\n  ── بررسی سلامت بدون نشت کلید ──');

    {
      const SECRET = 'TOPSECRETAPIKEY98765';
      const { result, raw } = await runWithEnv({
        ...baseEnv, SMS_API_KEY: SECRET, SMS_PASSWORD: 'MySecretPass123'
      }, 'health');

      add('وضعیت برمی‌گردد', !!result);
      add('کلید کامل در خروجی نیست', !JSON.stringify(result || {}).includes(SECRET));
      add('رمز کامل در خروجی نیست',
        !JSON.stringify(result || {}).includes('MySecretPass123'));
      add('نیمی از کلید هم نیامده',
        !JSON.stringify(result || {}).includes(SECRET.slice(0, 10)));
      add('اشاره‌گر فقط ۴ نویسه آخر است',
        result?.key_hint === '••••' + SECRET.slice(-4), result?.key_hint);
      add('نام ارائه‌دهنده گزارش می‌شود', result?.provider === 'generic',
        result?.provider);
      add('نوع خط گزارش می‌شود', /اختصاصی/.test(result?.line_type || ''),
        result?.line_type);
      add('شماره خط گزارش می‌شود', result?.sender === '3000123456');
      add('در خروجی خام هم کلید نیست', !raw.includes(SECRET));
    }

    {
      const { result } = await runWithEnv({
        SMS_PROVIDER: 'generic', SMS_API_URL: FAKE_URL
      }, 'health');
      add('بدون اعتبارنامه، ناقص گزارش می‌شود', result?.ok === false);
      add('راهنمای رفع داده می‌شود', !!result?.hint, result?.hint);
    }

    {
      const { result } = await runWithEnv({
        SMS_PROVIDER: 'payamito', SMS_API_KEY: 'x'.repeat(20)
      }, 'health');
      add('بدون نشانی سرویس، خطا می‌دهد', result?.ok === false);
      /* پیامیتو نشانی رسمی در کد دارد، پس `SMS_API_URL` برایش
         الزامی نیست. آنچه کم است اعتبارنامه است و پیام باید
         همان را بگوید. */
      add('خطا علت واقعی را می‌گوید',
        /اعتبارنامه|SMS_API_URL|فرستنده/.test(result?.message || ''),
        result?.message);
    }

    {
      const { result } = await runWithEnv({ SMS_PROVIDER: 'console' }, 'health');
      add('حالت console سالم گزارش می‌شود', result?.ok === true && result?.live === false);
      add('راهنمای فعال‌سازی پیامیتو داده می‌شود',
        /payamito/i.test(result?.hint || ''), result?.hint);
    }

    // ═══════════════════════════════════
    console.log('\n  ── سازگاری با کد موجود ──');

    {
      const fs = require('fs');
      const notify = fs.readFileSync(path.join(ROOT, 'src/notify.js'), 'utf8');
      const otp = fs.readFileSync(path.join(ROOT, 'src/otp.js'), 'utf8');

      add('notify.js دیگر کد ارائه‌دهنده ندارد',
        !/kavenegar|api\.kavenegar/.test(notify));
      add('otp.js دیگر کد ارائه‌دهنده ندارد',
        !/kavenegar|api\.kavenegar/.test(otp));
      add('هر دو از لایه مشترک استفاده می‌کنند',
        /require\('\.\/sms'\)/.test(notify) && /require\('\.\/sms'\)/.test(otp));

      const srv = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
      add('سرور به نام ارائه‌دهنده خاص گره نخورده',
        !/PROVIDER === 'kavenegar'/.test(srv));

      const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
      add('پنل هم به نام خاص گره نخورده',
        !/provider === 'kavenegar'/.test(adm));
    }

  } catch (e) {
    add('اجرای آزمون بدون خطای غیرمنتظره', false, e.message);
  }

  finish();
})();
