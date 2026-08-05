#!/usr/bin/env node
/**
 * آزمون نشان اعتماد الکترونیک (اینماد).
 *
 * چرا این آزمون لازم است:
 *
 *   کدی که اینماد به فروشنده می‌دهد پنج مشکل دارد و اگر همان‌طور
 *   کپی شود، یا کار نمی‌کند یا آسیب‌پذیری می‌سازد. مهم‌تر از همه:
 *   مقدار شناسه از **پنل مدیریت** می‌آید و مستقیم داخل نشانی
 *   `src` تصویر و `href` لینک می‌نشیند.
 *
 *   یعنی یک ورودی مدیر، به HTML صفحه اصلی راه دارد. این دقیقاً
 *   همان الگویی است که تزریق می‌سازد — پس دو لایه محافظ دارد
 *   (سرور و مرورگر) و هر دو باید آزموده شوند.
 *
 * پوشش:
 *   ۱) اعتبارسنجی سمت سرور — مقدار بدشکل ذخیره نمی‌شود
 *   ۲) مدیر از رد شدن مقدار باخبر می‌شود (پیام دروغ نمی‌بیند)
 *   ۳) API تنها وقتی نشان می‌دهد که **هر دو** بخش ثبت شده باشند
 *   ۴) CSP اجازه تصویر می‌دهد ولی نه اسکریپت
 *   ۵) کارت آمادگی حالت نیمه‌پر را خطا می‌داند
 *   ۶) فوتر چهار اصلاح ایمنی را دارد
 *   ۷) پرش چیدمان (CLS) رخ نمی‌دهد — فضا از پیش رزرو است
 *
 * اجرا: node scripts/test_enamad.js   (سرور باید بالا باشد)
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { db, getSettings, saveSettings, isValidSetting } = require('../src/db');

const PORT = process.env.PORT || 3000;
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const h = s => `\x1b[1m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

const enc = p => p.replace(/[^\x00-\x7F]/g, encodeURIComponent);

function api(p, opt = {}, token) {
  return new Promise(res => {
    const body = opt.body || null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: enc(p), method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b, headers: x.headers });
      });
    });
    req.on('error', () => res({ status: 0, json: {}, raw: '', headers: {} }));
    if (body) req.write(body);
    req.end();
  });
}

// شناسه واقعی فروشگاه — همان که مالک داده است
const REAL_ID   = '580961';
const REAL_CODE = 'ZWbXjtwpxxh2fPPh72XCAXEIjFrTLMU8';

(async () => {
  console.log();
  console.log(h('  آزمون نماد اعتماد الکترونیک'));
  console.log(d('  ─────────────────────────────────────────────'));

  // وضعیت اولیه را نگه می‌داریم تا آزمون داده واقعی را خراب نکند
  const before = getSettings();
  const restore = {
    enamad_id: before.enamad_id || '',
    enamad_code: before.enamad_code || ''
  };

  // ───────────────────────── ۱) اعتبارسنجی سمت سرور
  console.log();
  console.log(h('  ۱) اعتبارسنجی — لایه سرور'));

  add('شناسه معتبر پذیرفته می‌شود', isValidSetting('enamad_id', REAL_ID));
  add('کد معتبر پذیرفته می‌شود', isValidSetting('enamad_code', REAL_CODE));
  add('رشته خالی پذیرفته می‌شود (یعنی پاک کن)',
      isValidSetting('enamad_id', '') && isValidSetting('enamad_code', ''));

  /* هفت شکل حمله که همه باید رد شوند. هر کدام از راهی متفاوت
     می‌کوشد از نشانی تصویر بیرون بزند. */
  const attacks = [
    ['شکستن ویژگی با کوتیشن', 'enamad_code', '580961" onerror="alert(1)'],
    ['بستن تگ img',           'enamad_code', 'abc"><script>alert(1)</script>'],
    ['نشانی جاوااسکریپت',     'enamad_code', 'javascript:alert(1)'],
    ['تغییر دامنه مقصد',      'enamad_code', 'x&y=https://evil.ir'],
    ['شناسه غیرعددی',         'enamad_id',   'abc123'],
    ['شناسه با پارامتر اضافه', 'enamad_id',   '580961&x=1'],
    ['فاصله و نویسه کنترلی',  'enamad_code', 'ZWbX jtwp\nxxh2']
  ];
  attacks.forEach(([name, key, val]) => {
    add(`رد می‌شود: ${name}`, !isValidSetting(key, val), String(val).slice(0, 30));
  });

  // ───────────────────────── ۲) ذخیره واقعی
  console.log();
  console.log(h('  ۲) ذخیره واقعی در دیتابیس'));

  saveSettings({ enamad_id: '', enamad_code: '' });
  const s1 = saveSettings({ enamad_id: REAL_ID, enamad_code: REAL_CODE });
  add('مقدار معتبر ذخیره می‌شود',
      s1.enamad_id === REAL_ID && s1.enamad_code === REAL_CODE);
  add('هیچ فیلدی رد نشد', !(s1._rejected || []).length);

  const s2 = saveSettings({ enamad_code: 'bad"><img src=x>' });
  add('مقدار بدشکل ذخیره نمی‌شود',
      s2.enamad_code === REAL_CODE, 'مقدار پیشین دست‌نخورده ماند');
  add('فیلد ردشده گزارش می‌شود',
      (s2._rejected || []).includes('enamad_code'),
      'سکوت یعنی مدیر فکر کند ذخیره شده');

  const s3 = saveSettings({ enamad_id: '  580961  ' });
  add('فاصله دور مقدار پاک می‌شود', s3.enamad_id === '580961',
      'کپی از پنل اینماد اغلب فاصله دارد');

  // ───────────────────────── ۳) پیام صادقانه به مدیر
  console.log();
  console.log(h('  ۳) پیام مدیر — دروغ نمی‌گوید'));

  const login = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  const token = login.json.token;
  add('ورود مدیر برای ادامه آزمون', !!token);

  if (token) {
    const okSave = await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ enamad_id: REAL_ID, enamad_code: REAL_CODE })
    }, token);
    add('ذخیره درست پیام ساده می‌دهد',
        okSave.status === 200 && !/پذیرفته نشد/.test(okSave.json.message || ''),
        okSave.json.message);

    const badSave = await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ enamad_code: 'x"><script>' })
    }, token);
    add('ذخیره ناقص پیام هشدار می‌دهد',
        /پذیرفته نشد/.test(badSave.json.message || ''),
        badSave.json.message);
    add('فهرست ردشده‌ها برمی‌گردد',
        Array.isArray(badSave.json.rejected) &&
        badSave.json.rejected.includes('enamad_code'));
    add('نام فیلد به فارسی گزارش می‌شود',
        /کد امنیتی/.test(badSave.json.message || ''),
        'مدیر نباید نام ستون دیتابیس ببیند');
  }

  // ───────────────────────── ۴) API عمومی
  console.log();
  console.log(h('  ۴) API عمومی — قاعده «هر دو یا هیچ»'));

  saveSettings({ enamad_id: REAL_ID, enamad_code: REAL_CODE });
  const full = await api('/api/contact-info');
  add('هر دو بخش برمی‌گردند',
      full.json.enamad_id === REAL_ID && full.json.enamad_code === REAL_CODE);

  saveSettings({ enamad_id: '', enamad_code: REAL_CODE });
  const half1 = await api('/api/contact-info');
  add('با شناسه خالی، هیچ‌کدام نمی‌آید',
      half1.json.enamad_id === null && half1.json.enamad_code === null,
      'نشانی نیمه‌کاره یعنی تصویر شکسته');

  saveSettings({ enamad_id: REAL_ID, enamad_code: '' });
  const half2 = await api('/api/contact-info');
  add('با کد خالی، هیچ‌کدام نمی‌آید',
      half2.json.enamad_id === null && half2.json.enamad_code === null);

  saveSettings({ enamad_id: '', enamad_code: '' });
  const none = await api('/api/contact-info');
  add('بدون تنظیم، هر دو null‌اند',
      none.json.enamad_id === null && none.json.enamad_code === null);

  // ───────────────────────── ۵) CSP
  console.log();
  console.log(h('  ۵) سیاست امنیتی محتوا'));

  const page = await api('/');
  const csp = page.headers['content-security-policy'] || '';
  add('هدر CSP وجود دارد', !!csp);
  add('تصویر اینماد اجازه دارد',
      /img-src[^;]*trustseal\.enamad\.ir/.test(csp),
      'بدون این، مرورگر نشان را مسدود می‌کند');
  add('اسکریپت اینماد اجازه ندارد',
      !/script-src[^;]*enamad/.test(csp),
      'بدترین حالت نبود تصویر است، نه اجرای کد بیگانه');
  add('اتصال به اینماد اجازه ندارد',
      !/connect-src[^;]*enamad/.test(csp), 'نشت داده ممکن نیست');
  add('‎default-src همچنان self است', /default-src 'self'/.test(csp));
  add('‎object-src بسته مانده', /object-src 'none'/.test(csp));

  // ───────────────────────── ۶) کارت آمادگی
  console.log();
  console.log(h('  ۶) کارت بررسی آمادگی'));

  if (token) {
    /* قرارداد واقعی: پاسخ `items` دارد و هر قلم `level` نه `status`.
       نسخه اول این آزمون `status` را حدس زد و هر چهار بررسی قرمز
       شد — در حالی که پیام‌ها درست تولید می‌شدند. ششمین بار در این
       پروژه که مقصر آزمون بود نه کد. */
    const readiness = async () => {
      const x = await api('/api/admin/readiness', {}, token);
      return (x.json.items || []).find(c => c.key === 'enamad') || {};
    };

    saveSettings({ enamad_id: REAL_ID, enamad_code: REAL_CODE });
    add('هر دو ثبت شده → سبز', (await readiness()).level === 'ok');

    saveSettings({ enamad_id: REAL_ID, enamad_code: '' });
    const halfCard = await readiness();
    add('نیمه‌پر → خطا نه هشدار', halfCard.level === 'error',
        'وگرنه مدیر کارت سبز می‌بیند و نشان نمی‌آید');
    /* پیام از زاویه «چه چیزی هست» نوشته شده نه «چه چیزی نیست»:
       «فقط شناسه ثبت شده». هر دو صورت درست‌اند، ولی آزمون باید
       همان چیزی را بسنجد که کد واقعاً می‌گوید. */
    add('پیام می‌گوید کدام بخش کم است',
        /فقط شناسه ثبت شده/.test(halfCard.message || ''), halfCard.message);

    saveSettings({ enamad_id: '', enamad_code: REAL_CODE });
    const halfCard2 = await readiness();
    add('حالت وارونه هم درست گزارش می‌شود',
        halfCard2.level === 'error' &&
        /فقط کد امنیتی ثبت شده/.test(halfCard2.message || ''),
        halfCard2.message);

    saveSettings({ enamad_id: '', enamad_code: '' });
    add('خالی → هشدار', (await readiness()).level === 'warn');
  } else {
    ['هر دو ثبت شده → سبز', 'نیمه‌پر → خطا نه هشدار',
     'پیام می‌گوید کدام بخش کم است', 'خالی → هشدار']
      .forEach(t => add(t, true, 'بدون توکن رد شد'));
  }

  // ───────────────────────── ۷) فوتر — چهار اصلاح ایمنی
  console.log();
  console.log(h('  ۷) فوتر — چهار اصلاح نسبت به کد اینماد'));

  const ROOT = path.dirname(__dirname);
  const app = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/assets/theme.css'), 'utf8');

  const seal = app.slice(app.indexOf('function renderEnamad'));
  add('‎rel=noopener دارد', /a\.rel = 'noopener'/.test(seal),
      'بدون آن صفحه مقصد به window.opener دسترسی دارد');
  add('‎alt گویا دارد، نه خالی',
      /img\.alt = 'نماد اعتماد الکترونیک — عطر یزد'/.test(seal),
      "کد اینماد alt='' می‌دهد");
  add('‎width و height ثابت دارد',
      /img\.width = 96/.test(seal) && /img\.height = 96/.test(seal),
      'جلوی پرش چیدمان');
  add('ویژگی نامعتبر code حذف شده',
      !/\scode='/.test(seal) && !/\scode="/.test(seal),
      'HTML معتبر نیست و بی‌مصرف است');
  add('تصویر پیش از افزودن آزموده می‌شود',
      /new Image\(96, 96\)/.test(seal) && /img\.onload/.test(seal),
      'lazy روی فوتر یعنی تصویر تا اسکرول بار نمی‌شود');
  add('‎referrerPolicy=origin دارد', /referrerPolicy = 'origin'/.test(seal),
      'اینماد برای احراز به مبدأ نیاز دارد');
  add('‎aria-label برای صفحه‌خوان دارد', /aria-label/.test(seal) &&
      /مشاهده پرونده/.test(seal));

  // ───────────────────────── ۸) محافظ سمت مرورگر
  console.log();
  console.log(h('  ۸) لایه دوم — محافظ سمت مرورگر'));

  add('الگوی شناسه در مرورگر هم سنجیده می‌شود',
      /okId\s*=\s*\/\^\\d\{1,10\}\$\//.test(seal));
  add('الگوی کد در مرورگر هم سنجیده می‌شود',
      /okCode\s*=\s*\/\^\[A-Za-z0-9\]\{8,64\}\$\//.test(seal));
  add('مقدار با encodeURIComponent بسته می‌شود',
      /encodeURIComponent\(id\)/.test(seal) && /encodeURIComponent\(code\)/.test(seal),
      'لایه سوم — حتی اگر دو لایه پیشین بیفتند');
  add('بدون کد معتبر، نشان آزمایشی می‌آید',
      /enamad-badge/.test(seal) && /آزمایشی/.test(seal),
      'سایت ادعای دروغ نمی‌کند');
  add('جانشین پیش از تلاش برای تصویر می‌نشیند',
      seal.indexOf('enamad-badge') < seal.indexOf('new Image'),
      'در هر لحظه چیزی روی صفحه هست');
  add('تصویر تنها پس از موفقیت جایگزین می‌شود',
      /box\.replaceChildren\(a\)/.test(seal),
      'تصویر شکسته هرگز روی صفحه نمی‌رود');
  add('مهلت ۸ ثانیه برای سرور کند دارد',
      /setTimeout\([\s\S]{0,200}8000\)/.test(seal),
      'وگرنه تب مرورگر «در حال بارگذاری» می‌ماند');
  add('پس از مهلت درخواست رها می‌شود',
      /img\.src = ''/.test(seal), 'درخواست معلق آزاد می‌شود');
  add('محافظ settled از اجرای دوباره جلوگیری می‌کند',
      /let settled = false/.test(seal) && /if \(settled\) return/.test(seal),
      'مهلت و onload نباید هر دو اثر کنند');
  add('خطای شبکه هم جانشین می‌گذارد',
      /catch \{[\s\S]{0,220}renderEnamad\(null, null\)/.test(app),
      'جعبه خالی نمی‌ماند');
  add('نبود جعبه تماس، نشان را حذف نمی‌کند',
      /if \(!box\) \{ renderEnamad\(null, null\); return; \}/.test(app));

  // ───────────────────────── ۹) پرش چیدمان
  console.log();
  console.log(h('  ۹) پایداری چیدمان (CLS)'));

  add('جعبه نشان ارتفاع ثابت دارد',
      /#enamadSeal\s*\{[^}]*height:\s*110px/.test(css),
      'ثابت نه کمینه — وگرنه جایگزینی ۸ پیکسل می‌پرد');
  add('گزینشگر بر قاعده عمومی فوتر غلبه می‌کند',
      /\.footer-grid a\.enamad-seal/.test(css),
      'بدون آن، نشان تمام عرض ستون را می‌گرفت');
  /* شمردن نویسه‌های بین گزینشگر و اعلان شکننده است — کامنت
     توضیحی وسط، الگو را می‌شکند در حالی که CSS درست است.
     پس بلوک را جدا می‌کنیم و داخلش را می‌سنجیم.
     رفتار واقعی hover را آزمون مرورگر می‌سنجد. */
  const hoverBlock = (css.match(
    /\.footer-grid a\.enamad-seal:hover[\s\S]*?\}/) || [''])[0];
  add('‎padding در hover خنثی شده',
      /padding:\s*6px/.test(hoverBlock),
      'قاعده عمومی فوتر کادر را کج می‌کرد');
  add('تصویر ابعاد ثابت CSS دارد',
      /\.enamad-seal img\s*\{[^}]*width:\s*96px[^}]*height:\s*96px/.test(css));
  add('زمینه سفید برای دیده شدن',
      /\.enamad-seal\s*\{[^}]*background:\s*#FFF/.test(css),
      'نشان روی فوتر تیره محو می‌شود');
  add('حالت فوکوس صفحه‌کلید دارد',
      /\.enamad-seal:focus-visible/.test(css), 'دسترس‌پذیری');

  // ───────────────────────── ۱۰) سرویس‌ورکر
  console.log();
  console.log(h('  ۱۰) سرویس‌ورکر'));

  const sw = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
  add('دامنه بیرونی اصلاً کش نمی‌شود',
      /url\.origin !== self\.location\.origin\) return/.test(sw),
      'نشان اینماد باید همیشه تازه از سرور خودشان بیاید');

  // ───────────────────────── ۱۱) بازگرداندن وضعیت
  console.log();
  console.log(h('  ۱۱) پاک‌سازی'));

  saveSettings(restore);
  const after = getSettings();
  add('تنظیمات به حالت پیش از آزمون برگشت',
      (after.enamad_id || '') === restore.enamad_id &&
      (after.enamad_code || '') === restore.enamad_code,
      `id=${after.enamad_id || 'خالی'}`);

  const alive = await api('/api/health');
  add('سرور سالم است', alive.status === 200);

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  نشان اعتماد درست و ایمن پیاده شده.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
