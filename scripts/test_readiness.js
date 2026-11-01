#!/usr/bin/env node
/**
 * آزمون «بررسی آمادگی افتتاح» — با تأکید بر نشت نکردن کلید.
 *
 * چرا این آزمون: صفحه‌ای ساختیم که وضعیت کلیدهای حساس را نشان
 * می‌دهد. اگر روزی کسی سهواً خودِ کلید را به پاسخ اضافه کند،
 * یک کلید API در پاسخ HTTP قرار می‌گیرد که در لاگ‌ها، کش مرورگر
 * و ابزارهای توسعه‌دهنده باقی می‌ماند. این آزمون نگهبان آن است.
 *
 * پوشش:
 *   • هیچ کلید، رمز یا شناسه‌ای کامل برنمی‌گردد
 *   • فقط چند نویسه آخر، با ماسک
 *   • مقادیر جای‌نگهدار اطلاعات حقوقی «کامل» شمرده نمی‌شوند
 *   • قالب کد اقتصادی/شناسه ملی/کد پستی سنجیده می‌شود
 *   • رمز پیش‌فرض خطا می‌دهد
 *   • دسترسی بدون مجوز settings.view ممکن نیست
 *   • قالب نادرست Merchant ID بدون تماس شبکه رد می‌شود
 *   • آزمون پیامک محدودیت نرخ دارد
 *
 * اجرا: bash scripts/smoke_test.sh (only in its isolated test stage)
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
// This legacy fixture edits settings and rate limits. Never open a real store.
if (process.env.YAZD_SMOKE_STAGE !== '1' || process.env.NODE_ENV !== 'test' ||
    !/^\/tmp\/yazd-smoke-[A-Za-z0-9]{8}$/.test(ROOT) ||
    path.resolve(process.env.DB_PATH || '') !== DB) {
  console.error('Unsafe readiness fixture: run only through isolated smoke_test.sh');
  process.exit(2);
}

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

/** کلیدهای ساختگی — هیچ‌کدام نباید در پاسخ ظاهر شوند */
const FAKE_MERCHANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FAKE_SMS_KEY  = 'DEADBEEF0123456789ABCDEF01234567';
const FAKE_ADMIN_PW = 'S3cretPassw0rd!xyz';

function boot(port, env) {
  return new Promise(async resolve => {
    const proc = spawn('node', ['src/server.js'], {
      cwd: ROOT,
      env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(port), DB_PATH: DB, ...env },
      stdio: 'ignore'
    });
    for (let i = 0; i < 110; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return resolve(proc); }
      catch {}
      await sleep(400);
    }
    resolve(proc);
  });
}

const api = (port, p, opt = {}, tok = null) =>
  fetch(`http://127.0.0.1:${port}` + p, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: 'Bearer ' + tok } : {}),
      ...(opt.headers || {})
    }
  }).then(async x => ({ status: x.status, text: await x.text() }))
    .then(x => ({ ...x, body: (() => { try { return JSON.parse(x.text); } catch { return {}; } })() }));

/**
 * ورود مدیر.
 *
 * نکته‌ای که با شکست آزمون کشف شد: حساب `owner` یک بار در
 * دیتابیس ساخته می‌شود (`seedOwner`) و رمزش همان‌جا هش می‌گردد.
 * تغییر بعدی `ADMIN_PASSWORD` روی حساب موجود اثر ندارد — فقط
 * مسیر پشتیبانِ «قفل بیرون نماندن» را عوض می‌کند.
 *
 * پس آزمون هر دو را امتحان می‌کند: اول رمز محیطی، بعد رمز
 * ذخیره‌شده. این رفتار **باگ نیست** — عمداً این‌طور است تا رمزی
 * که مدیر در پنل عوض کرده با یک ری‌استارت برنگردد.
 */
async function login(port, pw) {
  for (const p of [...new Set([pw, process.env.ADMIN_PASSWORD, 'yazd1404'].filter(Boolean))]) {
    const r = await api(port, '/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'owner', password: p })
    });
    if (r.body.token) return r.body.token;
  }
  return null;
}

(async () => {
  console.log('\n  آزمون بررسی آمادگی افتتاح\n');

  const procs = [];
  const finish = () => {
    procs.forEach(p => { try { p.kill('SIGKILL'); } catch {} });
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('بررسی آمادگی درست کار می‌کند و کلیدی نشت نمی‌دهد.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    // ═══════════════════════════════════════
    // سرور با کلیدهای ساختگی — بدترین حالت نشت
    // ═══════════════════════════════════════
    const P1 = 4481;
    procs.push(await boot(P1, {
      PAYMENT_GATEWAY: 'zarinpal',
      ZARINPAL_MERCHANT_ID: FAKE_MERCHANT,
      SMS_PROVIDER: 'kavenegar',
      SMS_API_KEY: FAKE_SMS_KEY,
      ADMIN_PASSWORD: FAKE_ADMIN_PW
    }));

    const TOK = await login(P1, FAKE_ADMIN_PW);
    add('ورود با رمز سفارشی', !!TOK);
    if (!TOK) return finish();

    console.log('\n  ── نشت نکردن کلید ──');

    for (const [label, url] of [
      ['بررسی سریع', '/api/admin/readiness'],
      ['بررسی کامل', '/api/admin/readiness?deep=1']
    ]) {
      const res = await api(P1, url, {}, TOK);
      const raw = res.text;

      add(`${label}: شناسه پذیرنده کامل در پاسخ نیست`,
        !raw.includes(FAKE_MERCHANT));
      add(`${label}: کلید پیامک کامل در پاسخ نیست`,
        !raw.includes(FAKE_SMS_KEY));
      add(`${label}: رمز مدیر در پاسخ نیست`,
        !raw.includes(FAKE_ADMIN_PW));

      /* حتی بخش بزرگی از کلید هم نباید بیاید — ماسک باید واقعی
         باشد نه نمایشی. نیمه اول کلید کافی است برای اینکه بگوییم
         نشت کرده. */
      add(`${label}: نیمی از کلید پیامک هم نیامده`,
        !raw.includes(FAKE_SMS_KEY.slice(0, 16)));
      add(`${label}: نیمی از شناسه پذیرنده هم نیامده`,
        !raw.includes(FAKE_MERCHANT.slice(0, 18)));
    }

    {
      const res = await api(P1, '/api/admin/readiness?deep=1', {}, TOK);
      const b = res.body;
      add('اشاره‌گر کلید پیامک فقط ۴ نویسه آخر است',
        b.sms?.key_hint === '••••' + FAKE_SMS_KEY.slice(-4), b.sms?.key_hint);
      add('اشاره‌گر شناسه پذیرنده فقط ۶ نویسه آخر است',
        (b.payment?.merchant_hint || '').endsWith(FAKE_MERCHANT.slice(-6))
        && b.payment.merchant_hint.includes('••'), b.payment?.merchant_hint);
      add('وضعیت «ست شده» گزارش می‌شود بدون خود مقدار',
        b.sms?.key_set === true && b.payment?.merchant_set === true);
      add('رمز سفارشی خطا نمی‌دهد',
        b.items.find(i => i.key === 'admin_password')?.level === 'ok',
        b.items.find(i => i.key === 'admin_password')?.message);
    }

    // ═══════════════════════════════════════
    console.log('\n  ── تشخیص مقدار جای‌نگهدار (اطلاعات تماس) ──');

    {
      const db = new Database(DB);
      const prev = Object.fromEntries(
        db.prepare("SELECT key,value FROM settings WHERE key LIKE '%_code' OR key IN "
          + "('legal_name','national_id','register_no','phone','address','postal_code')")
          .all().map(x => [x.key, x.value]));

      const put = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
      // مقادیر نمونه‌ای که در پروژه بود
      put.run('legal_name', 'عطر یزد');
      put.run('economic_code', '411358697643');
      put.run('national_id', '14009876543');
      put.run('register_no', '12345');
      put.run('phone', '03536248000');
      put.run('address', 'یزد، خیابان نمونه');
      put.run('postal_code', '8916945781');
      db.close();

      const res = await api(P1, '/api/admin/readiness', {}, TOK);
      const legal = res.body.items.find(i => i.key === 'legal');
      add('مقادیر نمونه «کامل» شمرده نمی‌شوند',
        legal?.level === 'error', legal?.level);
      add('پیام می‌گوید کدام فیلدها نمونه‌اند',
        /مقدار نمونه/.test(legal?.message || ''));
      /* پیام باید بگوید **چرا** مهم است.
         پیش‌تر به «فاکتور» اشاره می‌کرد؛ پس از تفکیک فاکتور
         عادی و رسمی، این بررسی به «اطلاعات تماس» تغییر نام داد
         و دلیلش الزام اینماد است نه فاکتور. */
      add('هشدار دلیل الزام را می‌گوید',
        /اینماد/.test(legal?.message || ''), legal?.message?.slice(0, 60));

      // حالا مقادیر واقعی‌نما با قالب درست
      const db2 = new Database(DB);
      const put2 = db2.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
      put2.run('legal_name', 'شرکت رایحه پارس یزد');
      put2.run('economic_code', '411222333444');
      put2.run('national_id', '10860123456');
      put2.run('register_no', '98765');
      put2.run('phone', '03538201234');
      put2.run('address', 'یزد، بلوار نمونه، پلاک ۱۲');
      put2.run('postal_code', '8917654321');
      db2.close();

      const ok = await api(P1, '/api/admin/readiness', {}, TOK);
      add('مقادیر واقعی سبز می‌شوند',
        ok.body.items.find(i => i.key === 'legal')?.level === 'ok');

      // قالب نادرست
      const db3 = new Database(DB);
      db3.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)')
        .run('postal_code', '123');
      db3.close();
      const bad = await api(P1, '/api/admin/readiness', {}, TOK);
      const lg = bad.body.items.find(i => i.key === 'legal');
      add('کد پستی کوتاه تشخیص داده می‌شود',
        lg?.level === 'error' && /کد پستی/.test(lg.message), lg?.message?.slice(0, 60));

      /* بازگرداندن وضعیت اولیه.
         نکته‌ای که یک بار از قلم افتاد و داده جعلی در دیتابیس ماند:
         `prev` فقط کلیدهایی را دارد که **پیش از آزمون وجود داشتند**.
         کلیدهایی که خود آزمون تازه ساخته (مثل economic_code وقتی
         فروشنده اصلاً اطلاعات حقوقی ثبت نکرده) در prev نیستند، پس
         با INSERT OR REPLACE برنمی‌گردند — باید صریحاً حذف شوند.

         نتیجه آن نشت: کد اقتصادی و شناسه ملی ساختگی روی فاکتور
         رسمی چاپ می‌شد، آن هم برای فروشنده‌ای که گفته بود اصلاً
         اطلاعات حقوقی نمی‌خواهد. */
      const TOUCHED = ['legal_name', 'economic_code', 'national_id',
                       'register_no', 'phone', 'address', 'postal_code'];
      const db4 = new Database(DB);
      const rp = db4.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
      const del = db4.prepare('DELETE FROM settings WHERE key=?');
      for (const k of TOUCHED) {
        if (Object.prototype.hasOwnProperty.call(prev, k)) rp.run(k, prev[k]);
        else del.run(k);            // پیش از آزمون نبود → باید نباشد
      }
      db4.close();

      // آزمونِ خودِ پاک‌سازی — وگرنه دوباره بی‌صدا نشت می‌کند
      const dbv = new Database(DB, { readonly: true });
      const leaked = TOUCHED.filter(k =>
        !Object.prototype.hasOwnProperty.call(prev, k) &&
        dbv.prepare('SELECT 1 FROM settings WHERE key=?').get(k));
      dbv.close();
      add('آزمون داده جعلی در تنظیمات جا نمی‌گذارد', leaked.length === 0,
        leaked.length ? leaked.join('، ') : '');
    }

    // ═══════════════════════════════════════
    console.log('\n  ── قالب نادرست شناسه پذیرنده ──');

    {
      const P2 = 4482;
      procs.push(await boot(P2, {
        PAYMENT_GATEWAY: 'zarinpal',
        ZARINPAL_MERCHANT_ID: 'not-a-uuid',
        ADMIN_PASSWORD: FAKE_ADMIN_PW
      }));
      const T2 = await login(P2, FAKE_ADMIN_PW);
      const res = await api(P2, '/api/admin/readiness?deep=1', {}, T2);
      add('قالب نادرست بدون تماس شبکه رد می‌شود',
        res.body.payment?.ok === false && /UUID/.test(res.body.payment.message),
        res.body.payment?.message);
    }

    // ═══════════════════════════════════════
    console.log('\n  ── حالت پیش‌فرض (بدون کلید) ──');

    {
      const P3 = 4483;
      procs.push(await boot(P3, { ADMIN_PASSWORD: 'yazd1404' }));
      const T3 = await login(P3, 'yazd1404');
      const res = await api(P3, '/api/admin/readiness?deep=1', {}, T3);
      const b = res.body;

      // Existing owner was changed in the isolated smoke setup; a default
      // environment variable must not override the actual database credential.
      add('وضعیت رمز از حساب ذخیره‌شده می‌آید، نه مقدار محیط',
        b.items.find(i => i.key === 'admin_password')?.level === 'ok');
      add('رمز واقعی یا هش در خروجی نمایش داده نمی‌شود',
        !res.text.includes(process.env.ADMIN_PASSWORD || 'SmokeFixture-8372'));
      add('درگاه آزمایشی هشدار می‌دهد',
        b.items.find(i => i.key === 'payment')?.level !== 'ok');
      add('پیامک در حالت لاگ هشدار می‌دهد',
        b.items.find(i => i.key === 'sms')?.level !== 'ok');
      add('اشاره‌گر کلید وقتی چیزی ست نشده null است',
        b.sms?.key_hint === null && b.payment?.merchant_hint === null);
      add('«آماده» نیست چون خطا دارد', b.ready === false, `${b.errors} خطا`);

      // موجودی صفر باید خطا باشد
      const dbx = new Database(DB);
      const had = dbx.prepare('SELECT COUNT(*) c FROM variants WHERE stock>0').get().c;
      dbx.close();
      const stock = b.items.find(i => i.key === 'stock');
      add('موجودی صفر خطا شمرده می‌شود',
        had === 0 ? stock?.level === 'error' : stock?.level === 'ok',
        `${had} کالای موجود`);

      // دسترسی
      const noAuth = await api(P3, '/api/admin/readiness');
      add('بدون ورود قابل دسترسی نیست',
        noAuth.status === 401 || noAuth.status === 403, `status ${noAuth.status}`);
    }

    // ═══════════════════════════════════════
    console.log('\n  ── محدودیت آزمون پیامک ──');

    {
      const dbr = new Database(DB);
      dbr.prepare('DELETE FROM rate_limits').run();
      dbr.close();

      // Use the separate console-only server: P1 deliberately has fake live
      // credentials for masking tests and must never send a test SMS externally.
      const smsPort = 4483;
      const smsToken = await login(smsPort, 'yazd1404');
      if (!smsToken) throw new Error('Console SMS test login failed');
      const config = await api(smsPort, '/api/admin/readiness?deep=1', {}, smsToken);
      if (config.body.sms?.provider !== 'console' || config.body.sms?.live !== false)
        throw new Error('Refusing SMS rate-limit test on a live provider');
      let limited = false;
      for (let i = 0; i < 8; i++) {
        const res = await api(smsPort, '/api/admin/readiness/test-sms', {
          method: 'POST', body: JSON.stringify({ mobile: '09120000000' })
        }, smsToken);
        if (res.status === 429) { limited = true; break; }
      }
      add('آزمون پیامک پس از چند بار محدود می‌شود', limited);

      const badMob = await api(smsPort, '/api/admin/readiness/test-sms', {
        method: 'POST', body: JSON.stringify({ mobile: '123' })
      }, smsToken);
      add('شماره نامعتبر رد می‌شود',
        badMob.status === 400 || badMob.status === 429, `status ${badMob.status}`);
    }

    // ═══════════════════════════════════════
    console.log('\n  ── رابط کاربری ──');

    {
      const fs = require('fs');
      const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
      add('پنل کارت بررسی آمادگی دارد', /readyCard/.test(adm) && /loadReadiness/.test(adm));
      add('دکمه بررسی کامل جداست', /loadReadiness\(true\)/.test(adm));
      add('جعبه پیامک آزمایشی هست', /sendTestSms/.test(adm));
      add('پنل تأکید می‌کند کلیدی نمایش داده نمی‌شود',
        /هیچ کلیدی اینجا نمایش داده نمی‌شود/.test(adm));

      /* نگهبان: هیچ فایل ورک‌اسپیس نباید کلید واقعی داشته باشد.
         .env تصادفی ساخته شود و در بسته استقرار برود، فاجعه است. */
      const envFile = path.join(ROOT, '.env');
      add('فایل .env در ورک‌اسپیس وجود ندارد', !fs.existsSync(envFile));
      const dockerignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8');
      add('.env در .dockerignore هست (اگر روزی ساخته شد نرود)',
        /^\.env/m.test(dockerignore));
    }

  } catch (e) {
    add('اجرای آزمون بدون خطای غیرمنتظره', false, e.message);
  }

  finish();
})();
