#!/usr/bin/env node
/**
 * ممیزی ریسک «محتوای انبوهِ کم‌تمایز» از دید گوگل
 * ══════════════════════════════════════════════
 *
 * چرا این اسکریپت وجود دارد
 * ─────────────────────────
 * گوگل محتوای هوش‌مصنوعی را جریمه نمی‌کند؛ سیاست رسمی‌اش
 * «scaled content abuse» است: تولید انبوه صفحه با ارزش کمِ
 * یکتا، «فارغ از اینکه چطور ساخته شده». پس معیارِ خطر برای ما
 * «AI بودن» نیست، این چهار عدد است:
 *
 *   ۱) چند صفحه داریم            → مقیاس
 *   ۲) هر صفحه چقدر متن یکتا دارد → تمایز
 *   ۳) چند صفحه واقعاً قابل خرید‌اند → دلیل وجود
 *   ۴) چند ادعای راستی‌آزمایی‌پذیرِ مشکوک داریم → E-E-A-T
 *
 * این اسکریپت هر چهار را می‌سنجد و به هر محصول یکی از سه رتبه
 * می‌دهد: A (آماده ایندکس) · B (نیازمند غنی‌سازی) · C (فعلاً
 * نباید ایندکس شود).
 *
 * هیچ چیزی را تغییر نمی‌دهد. فقط گزارش می‌دهد.
 *
 * اجرا:  node scripts/audit_seo_ai_risk.js [--json] [--list-a]
 */

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

/* ═════════════ داده ═════════════ */

const products = db.prepare(`
  SELECT p.*,
         (SELECT COUNT(*)           FROM variants v WHERE v.product_id = p.id) AS n_variants,
         (SELECT COALESCE(SUM(v.stock),0) FROM variants v WHERE v.product_id = p.id) AS total_stock,
         (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.status = 'APPROVED') AS n_reviews
  FROM products p
`).all();

const TOTAL = products.length;
const brandSet = new Set(products.map(p => String(p.brand_en || '').toLowerCase().trim()).filter(Boolean));

/* چند محصول با هر تصویر */
const imgUse = new Map();
for (const p of products) imgUse.set(p.image_url, (imgUse.get(p.image_url) || 0) + 1);

/* متن توصیفیِ یکتا: taste + accords + notes. اگر دو محصول
   دقیقاً یکی باشند، هیچ‌کدام «یکتا» حساب نمی‌شوند. */
const descKey = p => [
  p.taste || '', p.accords || '',
  p.notes_top || '', p.notes_middle || '', p.notes_base || ''
].join('|');
const descCount = new Map();
for (const p of products) {
  const k = descKey(p);
  descCount.set(k, (descCount.get(k) || 0) + 1);
}

/* ═════════════ سنجه‌های هر محصول ═════════════ */

function assess(p) {
  const notes = jsonArr(p.notes_top).length + jsonArr(p.notes_middle).length + jsonArr(p.notes_base).length;
  const accords = jsonArr(p.accords).join(' ');
  const uniqueText = String(p.taste || '').length + accords.length;
  const shared = imgUse.get(p.image_url) || 1;
  const dupDesc = (descCount.get(descKey(p)) || 1) > 1;
  const perfumerIsBrand = brandSet.has(String(p.perfumer || '').toLowerCase().trim());

  const flags = [];
  if (notes < 6)             flags.push('نُت کمتر از ۶');
  if (uniqueText < 90)       flags.push('متن یکتای کوتاه');
  if (dupDesc)               flags.push('متن تکراری با محصول دیگر');
  /* برچسب تصویر عمداً عددِ دقیق را در خود ندارد؛ وگرنه هر تصویر
     یک ردیف جدا در جدول تجمیع می‌سازد و گزارش خوانا نمی‌ماند. */
  if (shared > 20)           flags.push('تصویر مشترک با بیش از ۲۰ محصول');
  if (perfumerIsBrand)       flags.push('عطرساز = نام برند (راستی‌آزمایی‌نشده)');
  if (p.supply_mode === 'UNAVAILABLE') flags.push('غیرقابل تأمین');
  if (!p.n_variants)         flags.push('بدون واریانت/قیمت');

  const buyable = p.supply_mode !== 'UNAVAILABLE' && p.n_variants > 0;
  const inStock = p.total_stock > 0;

  /* رتبه‌بندی
     A: صفحه‌ای که همین امروز ارزش ایندکس دارد — قابل خرید،
        متن یکتا، تصویر نه چندان مشترک، ادعای مشکوک ندارد.
     B: محتوا قابل قبول است ولی دلیل وجود صفحه ضعیف است
        (موجود نیست یا تصویر عمومی) — با غنی‌سازی A می‌شود.
     C: صفحه‌ای که ایندکس شدنش به کل دامنه ضرر می‌زند. */
  let grade;
  if (!buyable || notes < 6 || dupDesc || uniqueText < 60) grade = 'C';
  else if (inStock && uniqueText >= 90 && shared <= 20 && !perfumerIsBrand && p.n_reviews > 0) grade = 'A';
  else grade = 'B';

  return { notes, uniqueText, shared, dupDesc, perfumerIsBrand, buyable, inStock, flags, grade };
}

const rows = products.map(p => ({ p, a: assess(p) }));

/* ═════════════ تجمیع ═════════════ */

const grades = { A: 0, B: 0, C: 0 };
for (const r of rows) grades[r.a.grade]++;

const flagCount = new Map();
for (const r of rows) for (const f of r.a.flags) flagCount.set(f, (flagCount.get(f) || 0) + 1);

const avgUnique = Math.round(rows.reduce((s, r) => s + r.a.uniqueText, 0) / TOTAL);
const buyableN  = rows.filter(r => r.a.buyable).length;
const inStockN  = rows.filter(r => r.a.inStock).length;
const reviewedN = rows.filter(r => r.p.n_reviews > 0).length;

const articles = db.prepare('SELECT slug, title, LENGTH(content) len FROM articles').all();
const staticPages = 10; // فهرست STATIC در sitemap
const indexable = staticPages + TOTAL + articles.length;

/* نسبت طلایی: چند درصد از صفحاتِ ایندکس‌شدنی، صفحهٔ «بی‌دلیل»اند */
const thinRatio = Number(pct(grades.C, indexable));

const report = {
  totals: { products: TOTAL, articles: articles.length, staticPages, indexableUrls: indexable },
  grades,
  signals: {
    avgUniqueTextChars: avgUnique,
    buyable: buyableN,
    inStock: inStockN,
    withApprovedReview: reviewedN,
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

/* ═════════════ چاپ ═════════════ */

const line = '─'.repeat(64);
const h = t => console.log(`\n${t}\n${line}`);

console.log('\n╔' + '═'.repeat(62) + '╗');
console.log('║  ممیزی ریسک محتوای انبوه از دید گوگل — عطر یزد');
console.log('╚' + '═'.repeat(62) + '╝');

h('۱) مقیاس — چند نشانی به گوگل معرفی می‌کنیم');
console.log(`  محصول ............... ${fa(TOTAL)}`);
console.log(`  مقاله ............... ${fa(articles.length)}`);
console.log(`  صفحه ثابت ........... ${fa(staticPages)}`);
console.log(`  مجموع در sitemap .... ${fa(indexable)}`);
console.log(`  → ${pct(TOTAL, indexable)}٪ از کل سایت، صفحه محصولِ تولیدشده از یک دیتاست است.`);

h('۲) تمایز — هر صفحه چقدر متن یکتا دارد');
console.log(`  میانگین متن یکتا (taste + accords) ... ${fa(avgUnique)} نویسه`);
console.log(`  تصویر یکتا ........................... ${fa(imgUse.size)} فایل`);
console.log(`  میانگین محصول به ازای هر تصویر ....... ${fa(report.signals.avgProductsPerImage)}`);
console.log(`  پرمصرف‌ترین تصویر .................... ${fa(report.signals.maxProductsPerImage)} محصول`);

h('۳) دلیل وجود — چند صفحه واقعاً قابل خرید است');
console.log(`  قابل سفارش .......... ${fa(buyableN)}  (${pct(buyableN, TOTAL)}٪)`);
console.log(`  موجود در انبار ...... ${fa(inStockN)}  (${pct(inStockN, TOTAL)}٪)`);
console.log(`  دارای نظر تأییدشده .. ${fa(reviewedN)}  (${pct(reviewedN, TOTAL)}٪)`);

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
if (grades.A === 0)
  verdict.push('🔴 هیچ صفحه محصولی امروز واجد شرایط رتبه A نیست.');
if (inStockN / TOTAL < 0.05)
  verdict.push(`🔴 کمتر از ۵٪ محصولات موجودند (${fa(inStockN)} از ${fa(TOTAL)}). از دید گوگل یعنی هزاران صفحه بدون امکان معامله.`);
if (report.signals.avgProductsPerImage > 20)
  verdict.push(`🔴 هر تصویر به‌طور میانگین روی ${fa(report.signals.avgProductsPerImage)} صفحه تکرار می‌شود — سیگنال قوی «صفحه قالبی».`);
if (avgUnique < 200)
  verdict.push(`🟠 میانگین ${fa(avgUnique)} نویسه متن یکتا برای هر صفحه؛ آستانه امنِ عملی حدود ۳۰۰ نویسه است.`);
if (thinRatio > 30)
  verdict.push(`🔴 ${fa(thinRatio)}٪ از نشانی‌های sitemap در رتبه C هستند. این نسبت، سیگنال کیفیتِ کلِ دامنه را پایین می‌کشد.`);
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
