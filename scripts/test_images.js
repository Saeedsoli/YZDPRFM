#!/usr/bin/env node
/**
 * آزمون تصاویر محصول.
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) هیچ محصولی به تصویر ناموجود اشاره نمی‌کند (تصویر شکسته)
 *   ۲) هر تصویر JPG نسخه WebP و نسخه کوچک دارد
 *   ۳) تخصیص پایدار است — اجرای دوباره همان نتیجه را می‌دهد
 *   ۴) توزیع متعادل است (یک واریانت همه را نبلعد)
 *   ۵) نسخه کوچک واقعاً سبک‌تر است
 *   ۶) تنوع کاتالوگ از حد قابل قبول بهتر است
 *
 * اجرا: node scripts/test_images.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { db, imageForProduct } = require('../src/db');

const ROOT = path.dirname(__dirname);
const IMG = path.join(ROOT, 'public', 'images', 'products');

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

console.log('\n  آزمون تصاویر محصول\n');

// ══ ۱) تصویر شکسته ══
console.log(d('  یکپارچگی'));

const rows = db.prepare('SELECT id, image_url, family_slug, gender FROM products').all();
const missing = rows.filter(x =>
  !fs.existsSync(path.join(IMG, path.basename(x.image_url || ''))));

add('هیچ محصولی تصویر شکسته ندارد', missing.length === 0,
    missing.length ? missing[0].image_url : `${rows.length} محصول`);

// ══ ۲) نسخه‌های جانبی ══
const used = [...new Set(rows.map(x => x.image_url))];
const noWebp = used.filter(u =>
  !fs.existsSync(path.join(IMG, path.basename(u).replace(/\.jpg$/, '.webp'))));
add('همه تصاویر نسخه WebP دارند', noWebp.length === 0,
    noWebp.length ? noWebp[0] : `${used.length} تصویر`);

// نسخه کوچک فقط برای تصاویر تازه لازم است
const famUsed = used.filter(u => /\/fam-/.test(u));
const noSmall = famUsed.filter(u =>
  !fs.existsSync(path.join(IMG, path.basename(u).replace(/\.jpg$/, '-sm.jpg'))));
add('تصاویر تازه نسخه کوچک دارند', noSmall.length === 0,
    noSmall.length ? noSmall[0] : `${famUsed.length} تصویر`);

// ══ ۳) پایداری تخصیص ══
console.log(d('\n  پایداری'));

const drift = rows.filter(x =>
  imageForProduct(null, x.family_slug, x.id, x.gender) !== x.image_url
  && /\/fam-/.test(imageForProduct(null, x.family_slug, x.id, x.gender)));

// محصولاتی که برندشان تصویر اختصاصی دارد استثنا هستند
const realDrift = drift.filter(x => !/brand-/.test(x.image_url));
add('تخصیص پایدار است (اجرای دوباره تغییری نمی‌دهد)', realDrift.length === 0,
    realDrift.length ? `${realDrift.length} محصول جابه‌جا شد` : '');

// دو بار صدا زدن باید یکی باشد
const sample = rows.slice(0, 200);
const twice = sample.every(x =>
  imageForProduct(null, x.family_slug, x.id, x.gender) ===
  imageForProduct(null, x.family_slug, x.id, x.gender));
add('تابع تخصیص قطعی است', twice);

// ══ ۴) توزیع ══
console.log(d('\n  توزیع و تنوع'));

const dist = db.prepare(
  'SELECT image_url, COUNT(*) n FROM products GROUP BY image_url ORDER BY n DESC'
).all();

const biggest = dist[0];
add('بزرگ‌ترین گروه هم‌تصویر معقول است', biggest.n <= 400,
    `${biggest.n} محصول — ${path.basename(biggest.image_url)}`);

add('کاتالوگ دست‌کم ۱۵ تصویر متمایز دارد', dist.length >= 15,
    `${dist.length} تصویر`);

// واریانت‌های یک خانواده باید متعادل پخش شوند
const floral = dist.filter(x => /fam-floral-w-/.test(x.image_url));
if (floral.length > 1) {
  const mn = Math.min(...floral.map(x => x.n));
  const mx = Math.max(...floral.map(x => x.n));
  add('واریانت‌های یک خانواده متعادل‌اند', mx / mn < 1.6,
      `${mn} تا ${mx} محصول`);
}

// ══ ۵) حجم ══
console.log(d('\n  حجم فایل'));

let heavy = [];
for (const u of famUsed) {
  const big = path.join(IMG, path.basename(u));
  const small = big.replace(/\.jpg$/, '-sm.jpg');
  if (!fs.existsSync(small)) continue;
  const bs = fs.statSync(big).size, ss = fs.statSync(small).size;
  if (ss >= bs) heavy.push(path.basename(u));
}
add('نسخه کوچک واقعاً سبک‌تر است', heavy.length === 0,
    heavy.length ? heavy[0] : '');

const oversize = famUsed.filter(u =>
  fs.statSync(path.join(IMG, path.basename(u))).size > 250 * 1024);
add('هیچ تصویری بیش از ۲۵۰ کیلوبایت نیست', oversize.length === 0,
    oversize.length ? oversize[0] : '');

const smalls = famUsed
  .map(u => fs.statSync(path.join(IMG,
        path.basename(u).replace(/\.jpg$/, '-sm.jpg'))).size)
  .filter(Boolean);
if (smalls.length) {
  const avg = Math.round(smalls.reduce((a, b) => a + b, 0) / smalls.length / 1024);
  add('میانگین کارت زیر ۲۵ کیلوبایت است', avg < 25, `${avg}KB`);
}

// ══ ۶) هم‌خوانی VARIANT_COUNTS با فایل‌های روی دیسک ══
console.log(d('\n  هم‌خوانی پیکربندی'));

/* VARIANT_COUNTS در db.js دستی نگه داشته می‌شود. اگر عددی بزرگ‌تر
   از تعداد فایل‌های واقعی باشد، صدها محصول به تصویر ناموجود اشاره
   می‌کنند — دقیقاً همان اتفاقی که یک بار افتاد و ۷۲۴ محصول تصویر
   شکسته گرفتند. این بررسی جلوی تکرارش را می‌گیرد. */
const dbSrc = fs.readFileSync(path.join(ROOT, 'src', 'db.js'), 'utf8');
const block = dbSrc.match(/const VARIANT_COUNTS = \{([\s\S]*?)\};/);
let mismatch = [];
if (block) {
  const re = /'([a-z-]+)\|([A-Z]+)':\s*(\d+)/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const [, fam, gen, cnt] = m;
    const g = { MEN: 'm', WOMEN: 'w', UNISEX: 'u' }[gen];
    for (let i = 1; i <= +cnt; i++) {
      const f = `fam-${fam}-${g}-${i}.jpg`;
      if (!fs.existsSync(path.join(IMG, f))) mismatch.push(f);
    }
  }
}
add('VARIANT_COUNTS با فایل‌های موجود می‌خواند', mismatch.length === 0,
    mismatch.length ? `${mismatch.length} فایل نیست: ${mismatch[0]}` : '');

// ══ ۷) لوگوی برند ══
console.log(d('\n  لوگوی برند روی بطری'));

/* هر تصویری که به محصول وصل است باید لوگو خورده باشد.
   نسخه بدون لوگو در .imgraw/nologo/ نگه داشته می‌شود، پس اگر
   فایلی آنجا هست ولی خروجی با آن یکسان مانده، یعنی حک نشده. */
const NOLOGO = path.join(ROOT, 'source', 'product-images');
if (fs.existsSync(NOLOGO)) {
  const stamped = [], unstamped = [];
  for (const u of used) {
    const name = path.basename(u);
    const orig = path.join(NOLOGO, name);
    if (!fs.existsSync(orig)) continue;
    // اگر بایت‌به‌بایت یکسان باشد، حکاکی انجام نشده
    const a = fs.readFileSync(orig), b = fs.readFileSync(path.join(IMG, name));
    (a.equals(b) ? unstamped : stamped).push(name);
  }
  add('همه تصاویر محصول لوگو خورده‌اند', unstamped.length === 0,
      unstamped.length ? unstamped.join('، ') : `${stamped.length} تصویر`);
} else {
  add('نسخه بدون لوگو برای بازسازی نگه داشته شده', false,
      'پوشه .imgraw/nologo پیدا نشد');
}

// ══ نتیجه ══
const failed = checks.filter(x => !x).length;
console.log();
console.log(failed === 0
  ? g('  تصاویر سالم‌اند.\n')
  : r(`  ${failed} بررسی ناموفق.\n`));
process.exit(failed === 0 ? 0 : 1);
