#!/usr/bin/env node

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'yazd.db');
const db = new Database(DB_PATH, { readonly: true });

const JSON_OUT = process.argv.includes('--json');
const LIST_A = process.argv.includes('--list-a');

const fa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const pct = (a, b) => b ? ((a / b) * 100).toFixed(1) : '0.0';

function jsonArr(s) {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

const products = db.prepare(`
  SELECT p.*,
         (SELECT COUNT(*)           FROM variants v WHERE v.product_id = p.id) AS n_variants,
         (SELECT COALESCE(SUM(v.stock),0) FROM variants v WHERE v.product_id = p.id) AS total_stock,
         (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.status = 'APPROVED') AS n_reviews
  FROM products p
`).all();

const TOTAL = products.length;
const brandSet = new Set(products.map(p => String(p.brand_en || '').toLowerCase().trim()).filter(Boolean));

const imgUse = new Map();
for (const p of products) imgUse.set(p.image_url, (imgUse.get(p.image_url) || 0) + 1);

const descKey = p => [
  p.taste || '', p.accords || '',
  p.notes_top || '', p.notes_middle || '', p.notes_base || ''
].join('|');
const descCount = new Map();
for (const p of products) {
  const k = descKey(p);
  descCount.set(k, (descCount.get(k) || 0) + 1);
}

const makerCount = new Map();
for (const p of products) {
  if (!p.maker_note) continue;
  makerCount.set(p.maker_note, (makerCount.get(p.maker_note) || 0) + 1);
}

function assess(p) {
  const notes = jsonArr(p.notes_top).length + jsonArr(p.notes_middle).length + jsonArr(p.notes_base).length;
  const accords = jsonArr(p.accords).join(' ');

  const makerLen = String(p.maker_note || '').length;
  const uniqueText = String(p.taste || '').length + accords.length + makerLen;
  const shared = imgUse.get(p.image_url) || 1;
  const dupDesc = (descCount.get(descKey(p)) || 1) > 1;
  const perfumerIsBrand = brandSet.has(String(p.perfumer || '').toLowerCase().trim());
  const dupMaker = makerLen > 0 && (makerCount.get(p.maker_note) || 1) > 1;

  const flags = [];
  if (notes < 6)             flags.push('نُت کمتر از ۶');
  if (uniqueText < 200)      flags.push('متن یکتای کوتاه');
  if (dupDesc)               flags.push('متن تکراری با محصول دیگر');
  if (!makerLen)             flags.push('بدون یادداشت عطرساز');
  if (dupMaker)              flags.push('یادداشت عطرساز تکراری');

  if (shared > 20)           flags.push('تصویر مشترک با بیش از ۲۰ محصول');
  if (perfumerIsBrand)       flags.push('عطرساز = نام برند (راستی‌آزمایی‌نشده)');
  if (p.supply_mode === 'UNAVAILABLE') flags.push('غیرقابل تأمین');
  if (!p.n_variants)         flags.push('بدون واریانت/قیمت');

  const buyable = p.supply_mode !== 'UNAVAILABLE' && p.n_variants > 0;
  const inStock = p.total_stock > 0;

  let grade;
  if (!buyable || notes < 6 || dupDesc || uniqueText < 150) grade = 'C';
  else if (inStock && uniqueText >= 300 && makerLen > 0 && !dupMaker
           && shared <= 20 && !perfumerIsBrand) grade = 'A';
  else grade = 'B';

  return { notes, uniqueText, makerLen, shared, dupDesc, dupMaker,
           perfumerIsBrand, buyable, inStock, flags, grade };
}

const rows = products.map(p => ({ p, a: assess(p) }));

const grades = { A: 0, B: 0, C: 0 };
for (const r of rows) grades[r.a.grade]++;

const flagCount = new Map();
for (const r of rows) for (const f of r.a.flags) flagCount.set(f, (flagCount.get(f) || 0) + 1);

const avgUnique = Math.round(rows.reduce((s, r) => s + r.a.uniqueText, 0) / TOTAL);
const buyableN  = rows.filter(r => r.a.buyable).length;
const inStockN  = rows.filter(r => r.a.inStock).length;
const reviewedN = rows.filter(r => r.p.n_reviews > 0).length;

const articles = db.prepare('SELECT slug, title, LENGTH(content) len FROM articles').all();
const staticPages = 10;

const orderable = products.filter(p => p.supply_mode !== 'UNAVAILABLE').length;
const indexable = staticPages + orderable + articles.length;

const thinRatio = Number(pct(grades.C, indexable));

const report = {
  totals: { products: TOTAL, articles: articles.length, staticPages, indexableUrls: indexable },
  grades,
  signals: {
    avgUniqueTextChars: avgUnique,
    buyable: buyableN,
    inStock: inStockN,
    withApprovedReview: reviewedN,
    withMakerNote: rows.filter(r => r.a.makerLen > 0).length,
    uniqueMakerNotes: new Set(products.map(x => x.maker_note).filter(Boolean)).size,
    uniqueImages: imgUse.size,
    maxProductsPerImage: Math.max(...imgUse.values()),
    avgProductsPerImage: Math.round(TOTAL / imgUse.size)
  },
  flags: [...flagCount.entries()].sort((a, b) => b[1] - a[1]),
  thinRatioPercent: thinRatio
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const line = '─'.repeat(64);
const h = t => console.log(`\n${t}\n${line}`);

console.log('\n╔' + '═'.repeat(62) + '╗');
console.log('║  ممیزی ریسک محتوای انبوه از دید گوگل — عطر یزد');
console.log('╚' + '═'.repeat(62) + '╝');

h('۱) مقیاس — چند نشانی به گوگل معرفی می‌کنیم');
console.log(`  محصول در کاتالوگ .... ${fa(TOTAL)}`);
console.log(`  از آن، قابل سفارش ... ${fa(orderable)}  (${pct(orderable, TOTAL)}٪)`);
console.log(`  مقاله ............... ${fa(articles.length)}`);
console.log(`  صفحه ثابت ........... ${fa(staticPages)}`);
console.log(`  مجموع در sitemap .... ${fa(indexable)}`);
if (orderable) {
  console.log(`  → ${pct(orderable, indexable)}٪ از نشانی‌های معرفی‌شده، صفحه محصول است.`);
} else {
  console.log('  → هیچ محصولی هنوز تأیید نشده؛ sitemap فقط صفحات ثابت و مجله را دارد.');
  console.log('    (این حالت درست است — پیش‌فرض تا تأیید مالک UNAVAILABLE است.)');
}

h('۲) تمایز — هر صفحه چقدر متن یکتا دارد');
console.log(`  میانگین متن یکتا (taste + accords) ... ${fa(avgUnique)} نویسه`);
console.log(`  تصویر یکتا ........................... ${fa(imgUse.size)} فایل`);
console.log(`  میانگین محصول به ازای هر تصویر ....... ${fa(report.signals.avgProductsPerImage)}`);
console.log(`  پرمصرف‌ترین تصویر .................... ${fa(report.signals.maxProductsPerImage)} محصول`);

h('۳) دلیل وجود — چند صفحه واقعاً قابل خرید است');
console.log(`  قابل سفارش .......... ${fa(buyableN)}  (${pct(buyableN, TOTAL)}٪)`);
console.log(`  موجود در انبار ...... ${fa(inStockN)}  (${pct(inStockN, TOTAL)}٪)`);
console.log(`  دارای نظر تأییدشده .. ${fa(reviewedN)}  (${pct(reviewedN, TOTAL)}٪)`);
console.log(`  یادداشت عطرساز ...... ${fa(report.signals.withMakerNote)}  (${pct(report.signals.withMakerNote, TOTAL)}٪)`);
console.log(`  یادداشت یکتا ........ ${fa(report.signals.uniqueMakerNotes)}`);

h('۴) رتبه‌بندی آمادگی ایندکس');
console.log(`  A — آماده ایندکس .......... ${fa(grades.A).padStart(5)}  (${pct(grades.A, TOTAL)}٪)`);
console.log(`  B — نیازمند غنی‌سازی ....... ${fa(grades.B).padStart(5)}  (${pct(grades.B, TOTAL)}٪)`);
console.log(`  C — فعلاً نباید ایندکس شود . ${fa(grades.C).padStart(5)}  (${pct(grades.C, TOTAL)}٪)`);

h('۵) پرتکرارترین دلایل کسر امتیاز');
for (const [f, n] of report.flags) {
  console.log(`  ${String(fa(n)).padStart(6)}  ${f}`);
}

h('۶) حکم');
const verdict = [];
if (orderable && grades.A === 0)
  verdict.push('🔴 هیچ صفحه محصولِ قابل سفارشی واجد شرایط رتبه A نیست.');
if (orderable && inStockN / TOTAL < 0.05)
  verdict.push(`🔴 کمتر از ۵٪ محصولات موجودند (${fa(inStockN)} از ${fa(TOTAL)}). از دید گوگل یعنی هزاران صفحه بدون امکان معامله.`);
if (report.signals.avgProductsPerImage > 20)
  verdict.push(`🔴 هر تصویر به‌طور میانگین روی ${fa(report.signals.avgProductsPerImage)} صفحه تکرار می‌شود — سیگنال قوی «صفحه قالبی».`);
if (avgUnique < 200)
  verdict.push(`🟠 میانگین ${fa(avgUnique)} نویسه متن یکتا برای هر صفحه؛ آستانه امنِ عملی حدود ۳۰۰ نویسه است.`);
if (orderable && thinRatio > 30)
  verdict.push(`🔴 ${fa(thinRatio)}٪ از نشانی‌های sitemap در رتبه C هستند. این نسبت، سیگنال کیفیتِ کلِ دامنه را پایین می‌کشد.`);
if (!orderable)
  verdict.push('🟡 هیچ محصولی هنوز برای فروش تأیید نشده. تا آن زمان، ریسک سئویی صفر است چون صفحه‌ای به گوگل معرفی نمی‌شود — ولی فروشی هم نیست. راهنما: docs/ACTIVATING_PRODUCTS.md');
if (!verdict.length) verdict.push('🟢 نسبت‌ها در محدوده امن است.');
verdict.forEach(v => console.log('  ' + v));

console.log('\n  نکته: هیچ‌کدام از این‌ها «جریمه AI» نیست. همه‌شان همان');
console.log('  چیزی است که سیاست scaled content abuse می‌سنجد — و اگر');
console.log('  محتوا را انسان هم نوشته بود، دقیقاً همین‌ها سنجیده می‌شد.\n');

if (LIST_A) {
  h('فهرست محصولات رتبه A');
  rows.filter(r => r.a.grade === 'A').forEach(r =>
    console.log(`  ${r.p.slug}  —  ${r.p.brand_fa} ${r.p.name_fa}`));
}

db.close();
