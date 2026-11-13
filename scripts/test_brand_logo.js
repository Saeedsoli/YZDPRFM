#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.dirname(__dirname);
const PUB = path.join(ROOT, 'public');
const BRAND = path.join(ROOT, 'source', 'brand');
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
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, x => {
      const chunks = [];
      x.on('data', c => chunks.push(c));
      x.on('end', () => res({
        code: x.statusCode,
        headers: x.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', () => res({ code: 0, headers: {}, body: Buffer.alloc(0) }));
    req.setTimeout(8000, () => { req.destroy(); res({ code: 0, headers: {}, body: Buffer.alloc(0) }); });
  });
}

const read = p => fs.readFileSync(p, 'utf8');

function svgBox(file) {
  const m = read(file).match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return m ? { w: +m[1], h: +m[2] } : null;
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

(async () => {
  console.log('\n  آزمون هویت لوگوی برند\n');

  console.log(d('  زنجیره بازتولید'));

  const SRC = path.join(BRAND, 'logo.png');
  add('فایل مرجع source/brand/logo.png هست', fs.existsSync(SRC));

  const derived = ['logo-mark.png', 'logo-mark.svg', 'logo-wordmark.png',
    'logo-wordmark.svg', 'logo-lockup.png', 'logo-lockup.svg'];
  const missing = derived.filter(n => !fs.existsSync(path.join(BRAND, n)));
  add('همه مشتقات برند ساخته شده‌اند', missing.length === 0,
      missing.length ? missing.join('، ') : `${derived.length} فایل`);

  add('اسکریپت بازتولید هست', fs.existsSync(path.join(ROOT, 'scripts', 'make_brand_assets.py')),
      'make_brand_assets.py');

  if (fs.existsSync(SRC)) {
    const srcTime = fs.statSync(SRC).mtimeMs;
    const stale = derived.filter(n => {
      const p = path.join(BRAND, n);
      return fs.existsSync(p) && fs.statSync(p).mtimeMs < srcTime - 1000;
    });
    add('مشتقات از مرجع تازه‌ترند', stale.length === 0,
        stale.length ? `کهنه: ${stale.join('، ')} — make_brand_assets.py را بزنید` : '');
  }

  console.log(d('\n  دارایی‌های سایت'));

  const assets = [
    ['/images/brand-mark-light.svg', 'image/svg+xml'],
    ['/images/brand-mark-dark.svg', 'image/svg+xml'],
    ['/images/brand-lockup-light.svg', 'image/svg+xml'],
    ['/images/brand-lockup-dark.svg', 'image/svg+xml'],
    ['/images/brand_logo.png', 'image/png'],
    ['/images/brand-logo-og.png', 'image/png'],
    ['/favicon.ico', 'image/x-icon'],
    ['/favicon-32.png', 'image/png'],
    ['/apple-touch-icon.png', 'image/png'],
    ['/icon-192.png', 'image/png'],
    ['/icon-512.png', 'image/png'],
    ['/icon-maskable-192.png', 'image/png'],
    ['/icon-maskable-512.png', 'image/png']
  ];

  for (const [url, mime] of assets) {
    const res = await get(url);
    const ok = res.code === 200 && String(res.headers['content-type'] || '').includes(mime.split('/')[1]);
    add(`${url}`, ok, res.code === 200 ? `${(res.body.length / 1024).toFixed(1)}KB` : `کد ${res.code}`);
  }

  console.log(d('\n  ارجاع‌های مرده'));

  const scanDirs = [PUB, path.join(ROOT, 'src')];
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'products', 'journal', 'fonts'].includes(e.name)) walk(p);
      } else if (/\.(html|js|css|json|webmanifest)$/.test(e.name)) {
        files.push(p);
      }
    }
  })(PUB);
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(path.join(ROOT, 'src'));

  const dead = [];
  const refRe = /['"`(]\/(images\/brand[\w-]*\.(?:png|svg|jpg|webp)|favicon[\w-]*\.(?:ico|png)|icon-[\w-]*\.png|apple-touch-icon\.png)/g;
  for (const f of files) {
    const txt = read(f);
    let m;
    while ((m = refRe.exec(txt)) !== null) {
      if (!fs.existsSync(path.join(PUB, m[1]))) {
        dead.push(`${path.relative(ROOT, f)} → /${m[1]}`);
      }
    }
  }
  add('هیچ ارجاع لوگوی مرده‌ای نیست', dead.length === 0,
      dead.length ? dead.slice(0, 3).join(' · ') : `${files.length} فایل بررسی شد`);

  console.log(d('\n  نسبت ابعاد اعلامی — پیشگیری از CLS'));

  const markBox = svgBox(path.join(PUB, 'images', 'brand-mark-light.svg'));
  const trueRatio = markBox ? markBox.w / markBox.h : 0;

  const TOL = 0.02;
  const imgRe = /<img[^>]*src="([^"]*brand[^"]*)"[^>]*>/g;
  const tplRe = /<img src="\$\{logo\}"[^>]*>/g;
  let bad = [];

  for (const f of files) {
    const txt = read(f);
    for (const re of [imgRe, tplRe]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt)) !== null) {
        const tag = m[0];
        const w = +(tag.match(/width="(\d+)"/) || [])[1];
        const h = +(tag.match(/height="(\d+)"/) || [])[1];
        if (!w || !h) {
          bad.push(`${path.basename(f)}: بدون width/height`);
          continue;
        }

        if (!/brand-mark|\$\{logo\}/.test(tag)) continue;
        const dev = Math.abs(w / h - trueRatio) / trueRatio;
        if (dev > TOL) {
          bad.push(`${path.basename(f)}: ${w}×${h} انحراف ${(dev * 100).toFixed(1)}%`);
        }
      }
    }
  }
  add('نسبت ابعاد اعلامی با فایل می‌خواند', bad.length === 0,
      bad.length ? bad.join(' · ') : `نسبت واقعی ${trueRatio.toFixed(4)}`);

  console.log(d('\n  تضاد رنگ'));

  const lightSvg = read(path.join(PUB, 'images', 'brand-mark-light.svg'));
  const darkSvg = read(path.join(PUB, 'images', 'brand-mark-dark.svg'));
  add('نسخه light رنگ روشن دارد', /fill="#F7F4EF"/i.test(lightSvg), '#F7F4EF');
  add('نسخه dark رنگ تیره دارد', /fill="#231F20"/i.test(darkSvg), '#231F20');
  add('دو نسخه واقعاً فرق دارند', lightSvg !== darkSvg);

  const appJs = read(path.join(PUB, 'assets', 'app.js'));
  add('هدر (زمینه تیره) نسخه light می‌گیرد',
      /const logo = '\/images\/brand-mark-light\.svg'/.test(appJs));

  const offline = read(path.join(PUB, 'offline.html'));
  add('صفحه آفلاین نسخه light می‌گیرد روی کادر تیره',
      /brand-mark-light\.svg/.test(offline) && /\.off-mark\{[^}]*var\(--obsidian\)/.test(offline));

  console.log(d('\n  اشتراک‌گذاری و داده ساخت‌یافته'));

  const seo = read(path.join(ROOT, 'src', 'seo.js'));
  add('schema.org به لوگوی پس‌زمینه‌دار اشاره می‌کند',
      /brand-logo-og\.png/.test(seo) && !/brand_logo\.png/.test(seo),
      'شفافیت را شبکه‌های اجتماعی سفید می‌کنند');

  const ogPath = path.join(PUB, 'images', 'brand-logo-og.png');
  const ogSize = pngSize(ogPath);
  add('لوگوی اشتراک‌گذاری مربع و دست‌کم ۱۱۲ پیکسل است',
      ogSize && ogSize.w === ogSize.h && ogSize.w >= 112,
      ogSize ? `${ogSize.w}×${ogSize.h}` : 'خوانده نشد');

  console.log(d('\n  سرویس‌ورکر'));

  const sw = read(path.join(PUB, 'sw.js'));
  const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  add('لوگوی برداری در پوسته کش هست', /brand-mark-light\.svg/.test(shell),
      'صفحه آفلاین بدون آن لوگو ندارد');

  const ver = (sw.match(/CACHE_VERSION = '([^']+)'/) || [])[1];
  add('نسخه کش پس از تعویض لوگو بالا رفته', /^yazd-v(\d+)$/.test(ver || '') && Number(ver.match(/^yazd-v(\d+)$/)[1]) >= 5,
      `فعلی: ${ver}`);

  console.log(d('\n  حکاکی روی بطری'));

  const embossSrc = read(path.join(ROOT, 'scripts', 'emboss_logo.py'));
  add('حکاکی از نشان استفاده می‌کند نه لاک‌آپ',
      /logo-mark\.png/.test(embossSrc),
      'لاک‌آپ روی بطری برچسب شلوغ می‌شود');

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  هویت لوگو یکدست است.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
