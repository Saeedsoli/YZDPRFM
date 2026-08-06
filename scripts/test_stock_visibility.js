#!/usr/bin/env node
/**
 * آزمون نمایش وضعیت موجودی — یافته اصلی ممیزی جعبه‌سیاه.
 *
 * چرا این آزمون:
 *
 *   فقط ۱ محصول از ۲۱۰۶ قابل خرید است (۰٫۰۵٪). کارت محصول این
 *   را نمی‌گفت: «مشاهده و خرید» می‌نوشت و قیمت نشان می‌داد.
 *   کاربر کلیک می‌کرد، به صفحه محصول می‌رفت، و آنجا دکمه
 *   خاکستری می‌دید. با این نسبت، چند بار تکرار می‌شد تا برود.
 *
 *   داده `in_stock` از قبل در پاسخ API بود — فقط استفاده نمی‌شد.
 *
 * پوشش:
 *   ۱) مرتب‌سازی — موجودها همیشه اول، در همه حالت‌ها
 *   ۲) فیلتر `in_stock=1` دقیق کار می‌کند
 *   ۳) کارت نشان ناموجودی دارد
 *   ۴) فیلتر با بقیه فیلترها ترکیب می‌شود
 *   ۵) صفحه‌بندی نمی‌شکند
 *   ۶) دسترس‌پذیری چیپ دوحالته
 *
 * اجرا: node scripts/test_stock_visibility.js   (سرور بالا)
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { db } = require('../src/db');

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
function api(p) {
  return new Promise(res => {
    http.get({ host: '127.0.0.1', port: PORT, path: enc(p) }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b });
      });
    }).on('error', () => res({ status: 0, json: {}, raw: '' }));
  });
}

(async () => {
  console.log();
  console.log(h('  آزمون نمایش وضعیت موجودی'));
  console.log(d('  ─────────────────────────────────────────────'));

  const realInStock = db.prepare(`
    SELECT COUNT(DISTINCT product_id) c FROM variants WHERE stock > 0
  `).get().c;
  const total = db.prepare('SELECT COUNT(*) c FROM products').get().c;

  console.log(d(`      واقعیت: ${realInStock} موجود از ${total} محصول`));

  // ─────────────── ۱) مرتب‌سازی
  console.log();
  console.log(h('  ۱) موجودها اول'));

  const first = await api('/api/products?limit=5');
  add('‎/api/products پاسخ ۲۰۰', first.status === 200);
  add('نخستین محصول موجود است',
      first.json.products?.[0]?.in_stock === true,
      'کاربر باید اول چیزی ببیند که بشود خرید');

  /* موجودها باید در **همه** مرتب‌سازی‌ها اول بیایند، نه فقط
     پیش‌فرض. کسی که «ارزان‌ترین» می‌خواهد، ارزان‌ترینِ قابل
     خرید را می‌خواهد. */
  for (const sort of ['price_asc', 'price_desc', 'name', 'brand']) {
    const res = await api(`/api/products?limit=3&sort=${sort}`);
    add(`مرتب‌سازی «${sort}» هم موجود را اول می‌آورد`,
        res.json.products?.[0]?.in_stock === true);
  }

  const searched = await api('/api/products?limit=5&q=' + encodeURIComponent('عطر'));
  add('در نتیجه جستجو هم رعایت می‌شود',
      searched.json.products.length === 0 ||
      searched.json.products[0].in_stock === true ||
      !searched.json.products.some(p => p.in_stock),
      `${searched.json.total} نتیجه`);

  // ─────────────── ۲) فیلتر
  console.log();
  console.log(h('  ۲) فیلتر «فقط موجودها»'));

  const filtered = await api('/api/products?limit=60&in_stock=1');
  add('فیلتر کار می‌کند', filtered.status === 200);
  add('شمار با دیتابیس می‌خواند',
      filtered.json.total === realInStock,
      `${filtered.json.total} = ${realInStock}`);
  add('هر محصول برگشتی واقعاً موجود است',
      filtered.json.products.every(p => p.in_stock === true),
      `${filtered.json.products.length} بررسی شد`);

  const unfiltered = await api('/api/products?limit=1');
  add('بدون فیلتر همه برمی‌گردند',
      unfiltered.json.total === total, `${unfiltered.json.total}`);

  add('مقدار نامعتبر فیلتر را فعال نمی‌کند',
      (await api('/api/products?limit=1&in_stock=yes')).json.total === total,
      'فقط in_stock=1 پذیرفته است');
  add('‎in_stock=0 هم فیلتر نمی‌کند',
      (await api('/api/products?limit=1&in_stock=0')).json.total === total);

  // ─────────────── ۳) ترکیب فیلترها
  console.log();
  console.log(h('  ۳) ترکیب با فیلترهای دیگر'));

  const combo = await api('/api/products?limit=20&in_stock=1&gender=men');
  const realCombo = db.prepare(`
    SELECT COUNT(DISTINCT p.id) c FROM products p
    JOIN variants v ON v.product_id = p.id
    WHERE v.stock > 0 AND p.gender = 'MEN'
  `).get().c;
  add('موجودی + جنسیت',
      combo.json.total === realCombo, `${combo.json.total} = ${realCombo}`);

  const comboFam = await api('/api/products?limit=20&in_stock=1&family=woody');
  add('موجودی + خانواده', comboFam.status === 200,
      `${comboFam.json.total} محصول`);

  const comboQ = await api('/api/products?limit=20&in_stock=1&q=' +
                           encodeURIComponent('کرید'));
  add('موجودی + جستجو', comboQ.status === 200 &&
      comboQ.json.products.every(p => p.in_stock === true),
      `${comboQ.json.total} نتیجه`);

  // ─────────────── ۴) صفحه‌بندی
  console.log();
  console.log(h('  ۴) صفحه‌بندی نمی‌شکند'));

  /* با JOIN، محصولی که چند واریانت موجود دارد چند بار می‌آمد و
     صفحه‌بندی به هم می‌ریخت. EXISTS این را حل می‌کند. */
  const p1 = await api('/api/products?limit=10&page=1');
  const p2 = await api('/api/products?limit=10&page=2');
  const ids1 = new Set(p1.json.products.map(x => x.id));
  const dup = p2.json.products.filter(x => ids1.has(x.id));
  add('صفحه دوم تکرار صفحه اول نیست', dup.length === 0,
      dup.length ? `${dup.length} تکراری` : 'بدون تکرار');

  const all = await api('/api/products?limit=60&in_stock=1');
  const uniq = new Set(all.json.products.map(x => x.id));
  add('هیچ محصولی دوبار نمی‌آید',
      uniq.size === all.json.products.length,
      `${uniq.size} یکتا از ${all.json.products.length}`);

  add('totalPages درست است',
      p1.json.totalPages === Math.ceil(total / 10),
      String(p1.json.totalPages));

  // ─────────────── ۵) کارت محصول
  console.log();
  console.log(h('  ۵) کارت محصول'));

  const ROOT = path.dirname(__dirname);
  const app = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/assets/theme.css'), 'utf8');

  add('کارت وضعیت موجودی را می‌خواند', /p\.in_stock === false/.test(app));
  add('برچسب «ناموجود» دارد', /class="card-out">ناموجود</.test(app));
  add('کلاس is-out روی کارت می‌نشیند', /is-out/.test(app));
  add('متن دکمه عوض می‌شود', /خبرم کن ←/.test(app));
  add('نوار پیش‌نمایش هم عوض می‌شود', /خبرم کن وقتی موجود شد/.test(app));
  add('برچسب تخفیف روی ناموجود نمی‌آید', /off > 0 && !out/.test(app),
      'تخفیف روی چیزی که نمی‌شود خرید، فریب است');
  add('‎aria-label وضعیت را می‌گوید', /ناموجود، اطلاع از موجود شدن/.test(app),
      'صفحه‌خوان هم بداند');

  add('استایل برچسب هست', /\.card-out\s*\{/.test(css));
  add('تصویر ناموجود کم‌رنگ می‌شود',
      /\.product-card\.is-out \.img-wrap img/.test(css));
  add('برچسب به hover وابسته نیست',
      !/\.product-card:hover \.card-out/.test(css),
      'روی موبایل hover نیست و برچسب باید دیده شود');

  // ─────────────── ۶) رابط فیلتر
  console.log();
  console.log(h('  ۶) رابط فیلتر در صفحه اصلی'));

  const idx = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  add('چیپ فیلتر هست', /id="stockChip"/.test(idx));
  add('‎aria-pressed دارد', /aria-pressed="false"/.test(idx),
      'دوحالته است نه انتخاب از چند گزینه');
  add('عنصر دکمه واقعی است', /<button type="button" class="stock-toggle"/.test(idx),
      'Enter و Space را مرورگر می‌دهد');
  add('کنار مرتب‌سازی است نه نوار اسکرولی',
      idx.indexOf('id="stockChip"') > idx.indexOf('id="catCount"') &&
      idx.indexOf('id="stockChip"') < idx.indexOf('id="sortSel"'),
      'در نوار فیلتر، بیرون از دید می‌افتاد');
  add('وضعیت در نشانی ذخیره می‌شود', /u\.set\('in_stock', '1'\)/.test(idx),
      'لینک قابل اشتراک');
  add('از نشانی خوانده می‌شود', /u\.get\('in_stock'\) === '1'/.test(idx));
  add('به API فرستاده می‌شود', /p\.set\('in_stock', '1'\)/.test(idx));
  add('رویداد جنسیت با data-g محدود شده',
      /#genderBar \.fchip\[data-g\]/.test(idx),
      'وگرنه کلیک روی چیپ موجودی، فیلتر جنسیت را می‌شکست');
  add('رنگ کلید از طلایی متمایز است',
      /\.stock-toggle\[aria-pressed="true"\]/.test(idx),
      'طلایی یعنی دسته؛ سبز یعنی وضعیت');
  add('ظاهر از aria-pressed می‌آید',
      !/sc\.classList\.toggle\('on'/.test(idx),
      'یک منبع حقیقت — ظاهر و دسترس‌پذیری واگرا نمی‌شوند');

  // ─────────────── ۷) صفحه محصول
  console.log();
  console.log(h('  ۷) صفحه محصول ناموجود'));

  const prod = fs.readFileSync(path.join(ROOT, 'public/product.html'), 'utf8');
  add('دکمه اطلاع‌رسانی هست', /notifyBtn/.test(prod));
  add('فقط وقتی ناموجود است نمایش می‌یابد', /if \(s <= 0\)/.test(prod));
  add('دکمه خرید غیرفعال می‌شود', /bb\.disabled = s <= 0/.test(prod));
  add('متن دکمه «ناموجود» می‌شود', /'ناموجود'/.test(prod));

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  وضعیت موجودی درست نمایش داده می‌شود.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
