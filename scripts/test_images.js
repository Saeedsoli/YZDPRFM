#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { db, imageForProduct } = require('../src/db');

const ROOT = path.dirname(__dirname);
const IMG = path.join(ROOT, 'public', 'images', 'products');

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const y = s => `\x1b[33m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

console.log('\n  آزمون تصاویر محصول\n');

console.log(d('  یکپارچگی'));

const rows = db.prepare('SELECT id, image_url, family_slug, gender FROM products').all();
const missing = rows.filter(x =>
  !fs.existsSync(path.join(IMG, path.basename(x.image_url || ''))));

add('هیچ محصولی تصویر شکسته ندارد', missing.length === 0,
    missing.length ? missing[0].image_url : `${rows.length} محصول`);

const used = [...new Set(rows.map(x => x.image_url))];
const noWebp = used.filter(u =>
  !fs.existsSync(path.join(IMG, path.basename(u).replace(/\.jpg$/, '.webp'))));
add('همه تصاویر نسخه WebP دارند', noWebp.length === 0,
    noWebp.length ? noWebp[0] : `${used.length} تصویر`);

const famUsed = used.filter(u => /\/fam-/.test(u));
const noSmall = famUsed.filter(u =>
  !fs.existsSync(path.join(IMG, path.basename(u).replace(/\.jpg$/, '-sm.jpg'))));
add('تصاویر تازه نسخه کوچک دارند', noSmall.length === 0,
    noSmall.length ? noSmall[0] : `${famUsed.length} تصویر`);

console.log(d('\n  پایداری'));

const drift = rows.filter(x =>
  imageForProduct(null, x.family_slug, x.id, x.gender) !== x.image_url
  && /\/fam-/.test(imageForProduct(null, x.family_slug, x.id, x.gender)));

const genderFixes = [...require('../seed/official_gender_corrections_v1.json').items,
                     ...require('../seed/official_gender_corrections_v2.json').items];
const realDrift = drift.filter(x => {
  if (/brand-/.test(x.image_url)) return false;
  const fix = genderFixes.find(f => f.product_id === x.id && f.official_gender === x.gender);

  const legacy = require('../seed/secondary_reference_prices_v28.json').items.find(f => f.product_id === x.id && f.reference_gender === x.gender);
  const oldGender = fix?.expected_old_gender || legacy?.expected_fields.gender;
  return !(oldGender && imageForProduct(null, x.family_slug, x.id, oldGender) === x.image_url);
});
add('تخصیص پایدار است (اجرای دوباره تغییری نمی‌دهد)', realDrift.length === 0,
    realDrift.length ? `${realDrift.length} محصول جابه‌جا شد` : '');

const sample = rows.slice(0, 200);
const twice = sample.every(x =>
  imageForProduct(null, x.family_slug, x.id, x.gender) ===
  imageForProduct(null, x.family_slug, x.id, x.gender));
add('تابع تخصیص قطعی است', twice);

console.log(d('\n  توزیع و تنوع'));

const dist = db.prepare(
  'SELECT image_url, COUNT(*) n FROM products GROUP BY image_url ORDER BY n DESC'
).all();

const biggest = dist[0];
add('بزرگ‌ترین گروه هم‌تصویر معقول است', biggest.n <= 400,
    `${biggest.n} محصول — ${path.basename(biggest.image_url)}`);

add('کاتالوگ دست‌کم ۱۵ تصویر متمایز دارد', dist.length >= 15,
    `${dist.length} تصویر`);

const floral = dist.filter(x => /fam-floral-w-/.test(x.image_url));
if (floral.length > 1) {
  const ns = floral.map(x => x.n);
  const total = ns.reduce((a, b) => a + b, 0);
  const expected = total / ns.length;
  const chi2 = ns.reduce((s, n) => s + Math.pow(n - expected, 2) / expected, 0);

  const CRIT99 = [6.63, 9.21, 11.34, 13.28, 15.09, 16.81, 18.48, 20.09,
                  21.67, 23.21, 24.72, 26.22, 27.69, 29.14, 30.58];
  const dfIdx = Math.min(ns.length - 2, CRIT99.length - 1);
  const crit = CRIT99[dfIdx];

  add('واریانت‌های یک خانواده متعادل‌اند', chi2 < crit,
      `${Math.min(...ns)} تا ${Math.max(...ns)} محصول · ` +
      `خی‌دو ${chi2.toFixed(1)} < ${crit}`);
}

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

console.log(d('\n  هم‌خوانی پیکربندی'));

const combos = db.prepare(`
  SELECT family_slug, gender, COUNT(*) n FROM products
  GROUP BY family_slug, gender ORDER BY n DESC`).all();
const TAG = { MEN: 'm', WOMEN: 'w', UNISEX: 'u' };

const uncovered = combos.filter(c => c.family_slug && TAG[c.gender] &&
  !fs.existsSync(path.join(IMG, `fam-${c.family_slug}-${TAG[c.gender]}-1.jpg`)));
const uncoveredBig = uncovered.filter(c => c.n >= 20);

add('هیچ ترکیب پرجمعیتی بدون تصویر اختصاصی نمانده',
    uncoveredBig.length === 0,
    uncoveredBig.length
      ? uncoveredBig.map(c => `${c.family_slug}|${c.gender}(${c.n})`).join('، ')
      : `${uncovered.length} ترکیب کوچک با جایگزینی جنسیت پوشش داده می‌شود`);

const perImage = new Map();
for (const r of rows) perImage.set(r.image_url, (perImage.get(r.image_url) || 0) + 1);
const worst = Math.max(...perImage.values());
add('پرمصرف‌ترین تصویر زیر ۵۰ محصول است', worst < 50,
    `${worst} محصول · میانگین ${Math.round(rows.length / perImage.size)}`);
const unclassifiedDefault = rows.filter(x => !x.family_slug && /\/family-woody\.jpg$/.test(x.image_url || ''));
add('تصویر پیش‌فرض رایحه‌های بدون خانواده بیش از حد تکرار نشده', unclassifiedDefault.length <= 20,
    unclassifiedDefault.length ? `${unclassifiedDefault.length} محصول` : 'تصاویر نمادین یا انتخاب اختصاصی');
const neutral = dist.filter(x => /\/generic-neutral-[1-7]\.jpg$/.test(x.image_url));
add('تصاویر نمادین متنوع و حداکثر ۲۰ محصولی هستند', neutral.every(x=>x.n <= 20),
    neutral.length ? neutral.map(x=>x.n).join('، ') : 'تصاویر اختصاصی جایگزین شده‌اند');
for (const x of neutral) {
  const base=path.basename(x.image_url).replace(/\.jpg$/, '');
  add(`نسخه‌های تصویر نمادین ${base} موجودند`, ['.webp','-sm.jpg','-sm.webp'].every(ext=>fs.existsSync(path.join(IMG,base+ext))));
}

console.log(d('\n  لوگوی برند روی بطری'));

const NOLOGO = path.join(ROOT, 'source', 'product-images');
if (fs.existsSync(NOLOGO)) {
  const stamped = [], unstamped = [];
  for (const u of used) {
    const name = path.basename(u);
    const orig = path.join(NOLOGO, name);
    if (!fs.existsSync(orig)) continue;

    const a = fs.readFileSync(orig), b = fs.readFileSync(path.join(IMG, name));
    (a.equals(b) ? unstamped : stamped).push(name);
  }
  add('همه تصاویر محصول لوگو خورده‌اند', unstamped.length === 0,
      unstamped.length ? unstamped.join('، ') : `${stamped.length} تصویر`);
} else {

  console.log(`  ${y('!')} نسخه بدون لوگو محلی نیست` +
    d('  — عمدی؛ در گیت‌هاب هست: git checkout origin/master -- source/product-images'));
}

const failed = checks.filter(x => !x).length;
console.log();
console.log(failed === 0
  ? g('  تصاویر سالم‌اند.\n')
  : r(`  ${failed} بررسی ناموفق.\n`));
process.exit(failed === 0 ? 0 : 1);
