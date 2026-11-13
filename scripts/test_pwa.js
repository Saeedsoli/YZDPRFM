#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.dirname(__dirname);
const PUB = path.join(ROOT, 'public');
const PORT = process.env.PORT || 3000;
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

function get(p) {
  return new Promise(res => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: b }));
    }).on('error', () => res({ status: 0, headers: {}, body: '' }));
  });
}

(async () => {
  console.log('\n  آزمون PWA\n');

  console.log(d('  Manifest'));

  const mfPath = path.join(PUB, 'site.webmanifest');
  add('فایل manifest وجود دارد', fs.existsSync(mfPath));

  let mf = {};
  try { mf = JSON.parse(fs.readFileSync(mfPath, 'utf8')); } catch {}
  add('JSON معتبر است', !!mf.name);

  for (const k of ['name', 'short_name', 'start_url', 'display',
                   'background_color', 'theme_color', 'icons']) {
    add(`میدان ${k} دارد`, mf[k] != null && mf[k] !== '');
  }
  add('display برابر standalone است', mf.display === 'standalone');
  add('زبان و جهت فارسی ثبت شده', mf.lang === 'fa' && mf.dir === 'rtl');
  add('scope و id تعریف شده‌اند', !!mf.scope && !!mf.id);
  add('میان‌بر تعریف شده', Array.isArray(mf.shortcuts) && mf.shortcuts.length >= 2,
      `${(mf.shortcuts || []).length} میان‌بر`);

  console.log(d('\n  آیکن‌ها'));

  const icons = mf.icons || [];
  const bySize = s => icons.filter(i => i.sizes === s);
  add('آیکن ۱۹۲ و ۵۱۲ دارد',
      bySize('192x192').length > 0 && bySize('512x512').length > 0);

  const maskable = icons.filter(i => (i.purpose || '').includes('maskable'));
  const anyOnly = icons.filter(i => i.purpose === 'any');
  add('آیکن maskable جدا تعریف شده', maskable.length >= 2,
      `${maskable.length} maskable`);
  add('آیکن any جدا تعریف شده', anyOnly.length >= 2, `${anyOnly.length} any`);

  const combined = icons.filter(i => (i.purpose || '').includes('any') &&
                                      (i.purpose || '').includes('maskable'));
  add('هیچ آیکنی هم‌زمان any و maskable نیست', combined.length === 0,
      combined.length ? combined[0].src : '');

  for (const i of icons) {
    const f = path.join(PUB, i.src.replace(/^\//, ''));
    if (!fs.existsSync(f)) { add(`فایل ${i.src} موجود است`, false); }
  }
  add('همه فایل‌های آیکن روی دیسک هستند',
      icons.every(i => fs.existsSync(path.join(PUB, i.src.replace(/^\//, '')))));

  console.log(d('\n  سرویس‌ورکر'));

  const swPath = path.join(PUB, 'sw.js');
  add('فایل sw.js وجود دارد', fs.existsSync(swPath));
  const sw = fs.existsSync(swPath) ? fs.readFileSync(swPath, 'utf8') : '';

  add('نسخه‌بندی کش دارد', /CACHE_VERSION\s*=/.test(sw));
  add('کش قدیمی در activate پاک می‌شود',
      /activate/.test(sw) && /caches\.delete/.test(sw));
  add('فقط GET را رهگیری می‌کند', /method\s*!==\s*'GET'/.test(sw));
  add('فقط دامنه خودی', /origin\s*!==\s*self\.location\.origin/.test(sw));

  add('🔴 مسیر /api/ هرگز کش نمی‌شود', /\^\\\/api\\\//.test(sw) || /\/\^\\\/api/.test(sw),
      'الگوی NEVER_CACHE');

  const mustExclude = ['admin', 'account', 'invoice', 'label',
                       'checkout', 'payment', 'login', 'perfume', 'review', 'track', 'wishlist'];
  const missing = mustExclude.filter(p => !new RegExp(`\\/\\^\\\\\\/${p}`).test(sw));
  add('صفحات حساس مستثنا شده‌اند', missing.length === 0,
      missing.length ? `جا افتاده: ${missing.join('، ')}` : `${mustExclude.length} مسیر`);

  add('سقف کش تصویر دارد', /IMG_LIMIT/.test(sw) && /trimCache/.test(sw));
  add('نصب با شکست یک فایل نمی‌شکند',
      !/addAll\(/.test(sw), 'به‌جای addAll از put تکی');
  add('صفحه آفلاین در پوسته کش می‌شود', /'\/offline'/.test(sw));

  console.log(d('\n  سرو شدن'));

  const health = await get('/api/health');
  if (health.status !== 200) {
    add('سرور در دسترس است', false, 'سرور بالا نیست — بخش شبکه رد شد');
  } else {
    const swRes = await get('/sw.js');
    add('sw.js با ۲۰۰ سرو می‌شود', swRes.status === 200);
    add('نوع محتوا جاوااسکریپت است',
        /javascript/.test(swRes.headers['content-type'] || ''));

    add('🔴 sw.js هرگز کش نمی‌شود',
        /no-store/.test(swRes.headers['cache-control'] || ''),
        swRes.headers['cache-control']);
    add('دامنه کنترل کل سایت است',
        swRes.headers['service-worker-allowed'] === '/');

    const mfRes = await get('/site.webmanifest');
    add('manifest سرو می‌شود', mfRes.status === 200);

    const offRes = await get('/offline');
    add('صفحه آفلاین سرو می‌شود', offRes.status === 200);
    add('صفحه آفلاین از ایندکس گوگل بیرون است',
        /noindex/.test(offRes.body));
    add('اسکریپت آفلاین در shell cache است',
        /\/assets\/csp-actions\.js/.test(offRes.body) && /\/assets\/csp-actions\.js/.test(swRes.body),
        'رویداد بدون inline handler و قابل دسترسی آفلاین');
    add('صفحه آفلاین راه بازگشت می‌دهد',
        /location\.reload|href="\/"/.test(offRes.body));

    const rb = await get('/robots.txt');
    add('offline در robots مستثنا شده', /Disallow: \/offline/.test(rb.body));

    for (const ic of ['/icon-maskable-192.png', '/icon-maskable-512.png']) {
      const res = await get(ic);
      if (res.status !== 200) add(`${ic} سرو می‌شود`, false, `status ${res.status}`);
    }
    add('آیکن‌های maskable سرو می‌شوند', true);
  }

  console.log(d('\n  ناحیه امن maskable'));

  let pil = true;
  try { require('child_process').execSync('python3 -c "import PIL"', { stdio: 'ignore' }); }
  catch { pil = false; }

  if (pil) {

    const tmp = path.join(require('os').tmpdir(), 'yazd_safe_zone.py');
    fs.writeFileSync(tmp, [
      'import sys, numpy as np',
      'from PIL import Image, ImageDraw',
      'def outside(p):',
      '    im = Image.open(p).convert("RGBA"); W,H = im.size',
      '    m = Image.new("L",(W,H),0)',
      '    r = int(W*0.4)',
      '    ImageDraw.Draw(m).ellipse([W//2-r,H//2-r,W//2+r,H//2+r], fill=255)',
      '    a = np.array(im); bg = a[0,0,:3].astype(int)',
      '    content = (np.abs(a[:,:,:3].astype(int)-bg).sum(axis=2) > 30)',
      '    safe = np.array(m) > 128',
      '    t = content.sum()',
      '    return 0.0 if t==0 else (content & ~safe).sum()/t*100',
      'for f in sys.argv[1:]:',
      '    print("%.1f" % outside(f))'
    ].join('\n'));

    try {
      const out = require('child_process').execSync(
        `python3 ${tmp} ${path.join(PUB, 'icon-maskable-192.png')} ` +
        `${path.join(PUB, 'icon-maskable-512.png')}`,
        { encoding: 'utf8' }).trim().split('\n').map(Number);
      add('آیکن maskable ۱۹۲ در ناحیه امن است', out[0] < 2, `${out[0]}% بیرون`);
      add('آیکن maskable ۵۱۲ در ناحیه امن است', out[1] < 2, `${out[1]}% بیرون`);

      const anyOut = require('child_process').execSync(
        `python3 ${tmp} ${path.join(PUB, 'icon-512.png')}`,
        { encoding: 'utf8' }).trim();
      console.log(d(`      آیکن any: ${anyOut}% بیرون — برای purpose:any مشکلی نیست`));
    } catch (e) {
      add('بررسی ناحیه امن اجرا شد', false, String(e.message).slice(0, 60));
    }
  } else {
    console.log(d('      PIL نصب نیست — بررسی ناحیه امن رد شد'));
  }

  console.log(d('\n  سیم‌کشی رابط'));

  const app = fs.readFileSync(path.join(PUB, 'assets/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUB, 'assets/theme.css'), 'utf8');

  add('ماژول YazdPWA تعریف شده', /const YazdPWA\s*=/.test(app));
  add('سرویس‌ورکر ثبت می‌شود', /serviceWorker\.register\('\/sw\.js'/.test(app));
  add('ثبت پس از load انجام می‌شود',
      /addEventListener\('load'[\s\S]{0,120}YazdPWA\.register/.test(app));
  add('روی HTTP غیرمحلی ثبت نمی‌شود',
      /protocol !== 'https:'/.test(app));
  add('خطای ثبت سایت را نمی‌شکند', /\.catch\(\(\)\s*=>/.test(app));
  add('دعوت نصب پس از رد شدن تکرار نمی‌شود',
      /DISMISS_DAYS/.test(app) && /_dismissed/.test(app));
  add('بنر خودکار مرورگر مهار می‌شود',
      /beforeinstallprompt/.test(app) && /preventDefault/.test(app));
  add('استایل دعوت نصب هست', /\.pwa-install/.test(css));
  add('در حالت نصب‌شده پنهان می‌شود',
      /display-mode: standalone/.test(css));
  add('دکمه‌ها focus-visible دارند', /\.pwa-yes:focus-visible/.test(css));

  const idx = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  add('manifest در صفحه لینک شده', /rel="manifest"/.test(idx));
  add('theme-color تعریف شده', /name="theme-color"/.test(idx));

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  PWA درست پیکربندی شده.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
