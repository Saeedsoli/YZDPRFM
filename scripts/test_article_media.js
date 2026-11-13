#!/usr/bin/env node

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const media = require('../src/media');

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
        ...(opt.raw ? {} : { 'Content-Type': 'application/json' }),
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opt.headers || {})
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

const REAL_PNG = fs.readFileSync(path.join(__dirname,'../public/icon-192.png'));
const REAL_JPEG = fs.readFileSync(path.join(__dirname,'../public/images/products/variant-sample.jpg'));
const REAL_WEBP = fs.readFileSync(path.join(__dirname,'../public/images/products/variant-sample.webp'));

(async () => {
  console.log();
  console.log(h('  آزمون رسانه مقالات'));
  console.log(d('  ─────────────────────────────────────────────'));

  console.log();
  console.log(h('  ۱) تشخیص قالب از محتوا، نه پسوند'));

  const { detectFormat, safeName } = media._internals;

  add('PNG واقعی شناخته می‌شود', detectFormat(REAL_PNG)?.ext === 'png');
  add('JPEG واقعی شناخته می‌شود', detectFormat(REAL_JPEG)?.ext === 'jpg');
  add('WebP واقعی شناخته می‌شود', detectFormat(REAL_WEBP)?.ext === 'webp');
  add('سربرگ JPEG بدون تصویر رد می‌شود',
      detectFormat(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])) === null);
  add('سربرگ WebP بدون تصویر رد می‌شود',
      detectFormat(Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP')])) === null);

  const evilHtml = Buffer.from('<html><script>alert(document.cookie)</script></html>');
  add('🔴 HTML با پسوند jpg رد می‌شود', detectFormat(evilHtml) === null,
      'وگرنه XSS در دامنه خودمان');

  add('SVG رد می‌شود',
      detectFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')) === null,
      'SVG می‌تواند اسکریپت داشته باشد');
  add('PDF رد می‌شود', detectFormat(Buffer.from('%PDF-1.4 xxxxxxxx')) === null);
  add('فایل خالی رد می‌شود', detectFormat(Buffer.alloc(0)) === null);
  add('فایل خیلی کوتاه رد می‌شود', detectFormat(Buffer.from([0xFF, 0xD8])) === null);

  console.log();
  console.log(h('  ۲) نام‌سازی — پیمایش مسیر ناممکن'));

  const attacks = [
    ['../../../etc/passwd', 'بیرون رفتن از پوشه'],
    ['..\\..\\windows\\sys', 'جداکننده ویندوز'],
    ['a/b/c.jpg', 'مسیر تودرتو'],
    ['<script>x</script>', 'تگ اسکریپت'],
    ['file"onload="x', 'شکستن ویژگی'],
    ['\u0000null.jpg', 'بایت صفر']
  ];
  let allSafe = true;
  for (const [inp, label] of attacks) {
    const n = safeName(inp, 'jpg');
    const bad = n.includes('/') || n.includes('\\') || n.includes('..') ||
                n.includes('<') || n.includes('"') || n.includes('\u0000');
    if (bad) { allSafe = false; console.log(d(`        ${label} → ${n}`)); }
  }
  add('هیچ حمله‌ای در نام باقی نمی‌ماند', allSafe, `${attacks.length} الگو`);
  add('نام فارسی به لاتین امن تبدیل می‌شود',
      /^[a-z0-9-]+\.jpg$/.test(safeName('عکس عطر من', 'jpg')),
      safeName('عکس عطر من', 'jpg'));
  add('نام‌ها یکتا هستند',
      safeName('x', 'jpg') !== safeName('x', 'jpg'), 'زمان + تصادفی');
  add('پسوند از قالب واقعی می‌آید',
      safeName('photo.exe', 'png').endsWith('.png'),
      'نه از نام کاربر');

  console.log();
  console.log(h('  ۳) شناسه ویدیوی آپارات'));

  add('نشانی معمولی', media.aparatId('https://www.aparat.com/v/abc123XY') === 'abc123XY');
  add('کد جاسازی',
      media.aparatId('https://www.aparat.com/video/video/embed/videohash/qq11ww/vt/frame') === 'qq11ww');
  add('نحو کوتاه خودمان', media.aparatId('aparat/xyz789') === 'xyz789');
  add('فقط شناسه', media.aparatId('abcde12345') === 'abcde12345');

  add('🔴 دامنه بیگانه رد می‌شود',
      media.aparatId('https://evil.ir/v/abc') === null,
      'وگرنه iframe به هر جایی می‌رفت');
  add('تگ اسکریپت رد می‌شود', media.aparatId('<script>alert(1)</script>') === null);
  add('نشانی javascript رد می‌شود', media.aparatId('javascript:alert(1)') === null);
  add('ورودی خالی رد می‌شود', media.aparatId('') === null);
  add('نشانی جاسازی درست ساخته می‌شود',
      media.aparatEmbed('abc123').startsWith('https://www.aparat.com/video/video/embed/'));

  console.log();
  console.log(h('  ۴) مسیرهای API'));

  const noAuth = await api('/api/admin/media');
  add('بدون ورود ۴۰۱ یا ۴۰۳', [401, 403].includes(noAuth.status), String(noAuth.status));

  const login = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  const token = login.json.token;
  add('ورود مدیر', !!token);

  if (!token) {
    console.log(r('\n  بدون توکن ادامه ممکن نیست.\n'));
    process.exit(1);
  }

  const listRes = await api('/api/admin/media', {}, token);
  add('فهرست رسانه ۲۰۰ می‌دهد', listRes.status === 200);
  add('تصاویر موجود پروژه برمی‌گردند',
      Array.isArray(listRes.json.stock) && listRes.json.stock.length > 0,
      `${listRes.json.stock?.length} تصویر`);
  add('سقف حجم اعلام می‌شود', listRes.json.max_mb > 0, `${listRes.json.max_mb} مگابایت`);
  add('نسخه‌های -sm در فهرست نیستند',
      !(listRes.json.stock || []).some(x => /-sm\.jpg$/.test(x.name)),
      'وگرنه فهرست دو برابر و بی‌فایده می‌شد');

  console.log();
  console.log(h('  ۵) آپلود و حذف واقعی'));

  const upEvil = await api('/api/admin/media', {
    method: 'POST', raw: true,
    headers: { 'Content-Type': 'image/jpeg', 'X-File-Name': 'evil.jpg' },
    body: evilHtml
  }, token);
  add('🔴 HTML با نام jpg ذخیره نمی‌شود', upEvil.status === 400,
      (upEvil.json.error || '').slice(0, 46));

  const spoof = await api('/api/admin/media', {
    method:'POST',raw:true,headers:{'Content-Type':'image/jpeg','X-File-Name':'spoof.jpg'},
    body:Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0,2]),evilHtml,Buffer.from([0xff,0xd9])])
  },token);
  add('سربرگ تصویری جعلی ذخیره نمی‌شود',spoof.status===400);
  const polyglot = await api('/api/admin/media', {
    method:'POST',raw:true,headers:{'Content-Type':'image/png','X-File-Name':'polyglot.png'},
    body:Buffer.concat([REAL_PNG,evilHtml])
  },token);
  add('داده اضافه پس از پایان تصویر رد می‌شود',polyglot.status===400);

  const upOk = await api('/api/admin/media', {
    method: 'POST', raw: true,
    headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('عکس آزمون.png') },
    body: REAL_PNG
  }, token);
  add('تصویر واقعی ذخیره می‌شود', upOk.status === 201, upOk.json.name);
  add('نشانی برگردانده می‌شود',
      (upOk.json.url || '').startsWith('/images/journal/'));

  const savedName = upOk.json.name;
  if (savedName) {
    const onDisk = path.join(media.MEDIA_DIR, savedName);
    add('فایل واقعاً روی دیسک است', fs.existsSync(onDisk));
    add('نام فارسی امن شده', /^[a-z0-9-]+\.png$/.test(savedName), savedName);

    const fetched = await api(upOk.json.url);
    add('از وب قابل دسترس است', fetched.status === 200);

    add('در فهرست دیده می‌شود',
        (await api('/api/admin/media', {}, token)).json.uploaded
          .some(x => x.name === savedName));

    const delRes = await api('/api/admin/media/' + savedName, { method: 'DELETE' }, token);
    add('حذف کار می‌کند', delRes.status === 200);
    add('از دیسک پاک شد', !fs.existsSync(onDisk));
  } else {
    ['فایل واقعاً روی دیسک است', 'نام فارسی امن شده', 'از وب قابل دسترس است',
     'در فهرست دیده می‌شود', 'حذف کار می‌کند', 'از دیسک پاک شد']
      .forEach(t => add(t, false, 'آپلود ناموفق بود'));
  }

  const delEvil = await api('/api/admin/media/' + encodeURIComponent('../../src/db.js'),
                            { method: 'DELETE' }, token);
  add('🔴 حذف با مسیر بیرونی رد می‌شود', delEvil.status === 404,
      'basename مسیر را می‌بُرد');
  add('فایل بیرونی سالم است', fs.existsSync(path.join(__dirname, '..', 'src', 'db.js')));

  console.log();
  console.log(h('  ۶) رندر در صفحه مقاله'));

  const ROOT = path.dirname(__dirname);
  const art = fs.readFileSync(path.join(ROOT, 'public/article.html'), 'utf8');

  add('الگوی رسانه تعریف شده', /const MEDIA_RE\s*=/.test(art));
  add('سه نوع پشتیبانی می‌شود', /عکس\|ویدیو\|نقل/.test(art));
  add('نام فایل با فهرست سفید سنجیده می‌شود', /SAFE_FILE/.test(art));
  add('شناسه آپارات در مرورگر هم بررسی می‌شود', /aparatIdOf/.test(art));
  add('توضیح تصویر esc می‌شود', /esc\(caption/.test(art));
  add('تصویر ناموجود قاب را حذف می‌کند', /closest\('figure'\)\.remove\(\)/.test(art),
      'تصویر شکسته بدتر از نبودنش است');
  add('iframe فقط از آپارات', /aparat\.com\/video\/video\/embed/.test(art));
  add('نسبت ثابت برای CLS', /aspect-ratio:\s*16\s*\/\s*9/.test(art));
  add('تصویر lazy بار می‌شود', /loading="lazy"/.test(art));

  console.log();
  console.log(h('  ۷) سیاست امنیتی'));

  const page = await api('/journal');
  const csp = page.headers['content-security-policy'] || '';
  add('‏frame-src تعریف شده', /frame-src/.test(csp));
  add('آپارات اجازه iframe دارد', /frame-src[^;]*aparat\.com/.test(csp),
      'بدون این، قاب سیاه می‌ماند');
  add('اسکریپت آپارات اجازه ندارد', !/script-src[^;]*aparat/.test(csp),
      'iframe در بافت جدا اجرا می‌شود');
  add('‏default-src همچنان self', /default-src 'self'/.test(csp));

  console.log();
  console.log(h('  ۸) پنل مدیریت'));

  const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  add('دکمه آپلود هست', /uploadArticleImage/.test(adm));
  add('کشوی تصویر موجود هست', /insertPickedImage/.test(adm));
  add('دکمه ویدیو هست', /insertAparat/.test(adm));
  add('دکمه نقل‌قول هست', /insertQuote/.test(adm));
  add('انتخاب کاور اضافه شد', /id="aCover"/.test(adm));
  add('درج در محل مکان‌نما', /insertAtCursor/.test(adm),
      'نه انتهای متن');
  add('نام فایل کدگذاری می‌شود', /encodeURIComponent\(file\.name\)/.test(adm),
      'نام فارسی سرآیند را می‌شکند');
  add('حجم پیش از ارسال بررسی می‌شود', /max_mb.*1024.*1024/.test(adm),
      'کاربر منتظر آپلود ناموفق نمی‌ماند');

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  رسانه مقالات امن و درست کار می‌کند.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
