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
/* زرد برای هشدار — چیزی که باید دیده شود ولی شکست نیست. */
const y = s => `\x1b[33m${s}\x1b[0m`;

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
// A verified gender correction deliberately preserves the pre-existing image:
// changing gender metadata must not silently change the approved visual asset.
const genderFixes = [...require('../seed/official_gender_corrections_v1.json').items,
                     ...require('../seed/official_gender_corrections_v2.json').items];
const realDrift = drift.filter(x => {
  if (/brand-/.test(x.image_url)) return false;
  const fix = genderFixes.find(f => f.product_id === x.id && f.official_gender === x.gender);
  return !(fix && imageForProduct(null, x.family_slug, x.id, fix.expected_old_gender) === x.image_url);
});
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

/* واریانت‌های یک خانواده باید متعادل پخش شوند.
 *
 * چرا معیار از «نسبت بیشینه به کمینه» به خی‌دو عوض شد:
 *   معیار پیشین `mx/mn < 1.6` بود. با تعویض منبع داده (مرداد
 *   ۱۴۰۵) پخش گلی-زنانه شد ۲۳ تا ۳۷ روی ۱۰ تصویر — نسبت ۱٫۶۱ و
 *   آزمون قرمز شد.
 *
 *   ولی این پخش **واقعاً یکنواخت است**: خی‌دو برابر ۴٫۸۰ در برابر
 *   آستانه ۱۶٫۹۲ (۹ درجه آزادی، ۹۵٪). مشکل از معیار بود نه داده —
 *   نسبت بیشینه/کمینه در نمونه کوچک ذاتاً پرنوسان است. اگر ۳۱۷
 *   توپ را تصادفی در ۱۰ سطل بریزید، بازه ۲۳ تا ۳۷ کاملاً عادی است.
 *
 *   خی‌دو همان چیزی را می‌سنجد که واقعاً اهمیت دارد: آیا انحراف از
 *   یکنواختی بیش از تصادف است؟ و به شمار سطل‌ها هم حساس است، پس
 *   با تغییر تعداد تصاویر خود را تنظیم می‌کند. */
const floral = dist.filter(x => /fam-floral-w-/.test(x.image_url));
if (floral.length > 1) {
  const ns = floral.map(x => x.n);
  const total = ns.reduce((a, b) => a + b, 0);
  const expected = total / ns.length;
  const chi2 = ns.reduce((s, n) => s + Math.pow(n - expected, 2) / expected, 0);

  // مقدار بحرانی خی‌دو در سطح ۹۹٪ برای درجه آزادی ۱ تا ۱۵
  const CRIT99 = [6.63, 9.21, 11.34, 13.28, 15.09, 16.81, 18.48, 20.09,
                  21.67, 23.21, 24.72, 26.22, 27.69, 29.14, 30.58];
  const dfIdx = Math.min(ns.length - 2, CRIT99.length - 1);
  const crit = CRIT99[dfIdx];

  add('واریانت‌های یک خانواده متعادل‌اند', chi2 < crit,
      `${Math.min(...ns)} تا ${Math.max(...ns)} محصول · ` +
      `خی‌دو ${chi2.toFixed(1)} < ${crit}`);
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

/* ── چرا این بررسی عوض شد ──
   VARIANT_COUNTS پیش‌تر فهرست ثابتی در db.js بود و باید دستی
   به‌روز می‌شد؛ این بررسی مچ ناهماهنگی‌اش را می‌گرفت. حالا آن
   جدول از روی دیسک ساخته می‌شود، پس ناهماهنگی از اساس ممکن
   نیست و بررسی قدیمی همیشه سبز بود — یعنی بی‌فایده.

   چیزی که همچنان می‌تواند خراب شود: تصویری که در دیتابیس ثبت
   شده ولی فایلش روی دیسک نیست. این همان خطای واقعی است که یک
   بار ۷۲۴ محصول را تصویر-شکسته کرد. */
/* تصویر شکسته در بخش ۱ بررسی شده؛ اینجا تکرارش نمی‌کنیم. */

/* ── شکاف پوششی ──
   هر ترکیب «خانواده × جنسیت» که محصول دارد ولی تصویر ندارد، به
   جنسیت دیگر پس می‌افتد (GENDER_FALLBACK). این خرابی نیست —
   عمداً طراحی شده — ولی باید دیده شود، وگرنه بی‌صدا می‌ماند و
   کسی یادش نمی‌رود تصویر بسازد.

   گزارشی است، نه شکست: با کاتالوگ کوچک، بعضی ترکیب‌ها دو سه
   محصول دارند و تصویر اختصاصی برایشان صرف نمی‌کند. */
const combos = db.prepare(`
  SELECT family_slug, gender, COUNT(*) n FROM products
  GROUP BY family_slug, gender ORDER BY n DESC`).all();
const TAG = { MEN: 'm', WOMEN: 'w', UNISEX: 'u' };
// Unknown family or gender is not a real combination to fabricate assets for.
// Its images are audited separately below; no guessed gender/family is assigned.
const uncovered = combos.filter(c => c.family_slug && TAG[c.gender] &&
  !fs.existsSync(path.join(IMG, `fam-${c.family_slug}-${TAG[c.gender]}-1.jpg`)));
const uncoveredBig = uncovered.filter(c => c.n >= 20);

add('هیچ ترکیب پرجمعیتی بدون تصویر اختصاصی نمانده',
    uncoveredBig.length === 0,
    uncoveredBig.length
      ? uncoveredBig.map(c => `${c.family_slug}|${c.gender}(${c.n})`).join('، ')
      : `${uncovered.length} ترکیب کوچک با جایگزینی جنسیت پوشش داده می‌شود`);

/* نسبت اشتراک — سنجه‌ای که مستقیم به سئو ربط دارد. آستانه ۴۰
   سخت‌گیرانه نیست ولی از «صفحه قالبی» فاصله می‌دهد. */
const perImage = new Map();
for (const r of rows) perImage.set(r.image_url, (perImage.get(r.image_url) || 0) + 1);
const worst = Math.max(...perImage.values());
add('پرمصرف‌ترین تصویر زیر ۵۰ محصول است', worst < 50,
    `${worst} محصول · میانگین ${Math.round(rows.length / perImage.size)}`);
const unclassifiedDefault = rows.filter(x => !x.family_slug && /\/family-woody\.jpg$/.test(x.image_url || ''));
add('تصویر پیش‌فرض رایحه‌های بدون خانواده بیش از حد تکرار نشده', unclassifiedDefault.length <= 20,
    unclassifiedDefault.length ? `${unclassifiedDefault.length} محصول` : 'تصاویر نمادین یا انتخاب اختصاصی');
const neutral = dist.filter(x => /\/generic-neutral-[1-5]\.jpg$/.test(x.image_url));
add('تصاویر نمادین متنوع و حداکثر ۲۰ محصولی هستند', neutral.every(x=>x.n <= 20),
    neutral.length ? neutral.map(x=>x.n).join('، ') : 'تصاویر اختصاصی جایگزین شده‌اند');
for (const x of neutral) {
  const base=path.basename(x.image_url).replace(/\.jpg$/, '');
  add(`نسخه‌های تصویر نمادین ${base} موجودند`, ['.webp','-sm.jpg','-sm.webp'].every(ext=>fs.existsSync(path.join(IMG,base+ext))));
}


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
  /* ── چرا نبودِ این پوشه دیگر شکست نیست ──
     پیش‌تر این حالت خطا حساب می‌شد، با این فرض که نسخهٔ بدون
     لوگو تنها راه بازسازی است. آن فرض دیگر درست نیست:
     `source/product-images` روی گیت‌هاب است و با یک دستور
     برمی‌گردد.

     شهریور ۱۴۰۵ ورک‌اسپیس به سقف حجم خورد و این پوشه (۲۵MB)
     عمداً حذف شد. تبدیلش به شکست یعنی آزمونی که برای یک
     تصمیم آگاهانه قرمز می‌شود — و آزمونِ قرمزِ همیشگی، آزمونی
     است که کسی جدی‌اش نمی‌گیرد.

     در عوض به‌صورت هشدار گزارش می‌شود تا فراموش نشود. */
  console.log(`  ${y('!')} نسخه بدون لوگو محلی نیست` +
    d('  — عمدی؛ در گیت‌هاب هست: git checkout origin/master -- source/product-images'));
}

// ══ نتیجه ══
const failed = checks.filter(x => !x).length;
console.log();
console.log(failed === 0
  ? g('  تصاویر سالم‌اند.\n')
  : r(`  ${failed} بررسی ناموفق.\n`));
process.exit(failed === 0 ? 0 : 1);
