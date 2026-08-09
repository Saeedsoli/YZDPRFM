#!/usr/bin/env node
/**
 * تعویض کامل کاتالوگ — جایگزینی محصولات و واریانت‌ها از seed تازه
 *
 * ═══════════════════════════════════════════════════════════
 * چرا این ابزار لازم شد
 * ═══════════════════════════════════════════════════════════
 * `seedIfEmpty()` در src/db.js فقط وقتی کار می‌کند که جدول
 * محصولات خالی باشد — عمدی و درست، چون نباید هر بار راه‌اندازی
 * سرور داده را بازنویسی کند.
 *
 * ولی تعویض منبع داده (مرداد ۱۴۰۵) یک عملیات یک‌باره است که باید
 * ۹۸٪ کاتالوگ را عوض کند و همزمان **داده تراکنشی را نگه دارد**:
 * سفارش‌ها، مشتریان، کارکنان، کوپن‌ها، مقالات، تیکت‌ها.
 *
 * ═══════════════════════════════════════════════════════════
 * 🔴 خطرِ اصلی: ارجاع‌های شکسته
 * ═══════════════════════════════════════════════════════════
 * جدول‌هایی که به محصول یا SKU ارجاع می‌دهند:
 *   order_items.sku      → سفارش‌های ثبت‌شده
 *   wishlist.product_id  → علاقه‌مندی مشتریان
 *   stock_alerts.sku     → درخواست «خبرم کن»
 *   reviews.product_id   → نظرات
 *   product_notes        → ایندکس نُت بویایی
 *   trending / events    → آمار بازدید
 *
 * با تعویض کاتالوگ، شناسه‌ها عوض می‌شوند و این ارجاع‌ها یتیم
 * می‌مانند. سیاست هر کدام جداگانه تصمیم گرفته شده — پایین‌تر
 * توضیح داده شده.
 *
 * اجرا:
 *   node scripts/replace_catalog.js --dry-run    # فقط گزارش
 *   node scripts/replace_catalog.js --yes        # اجرای واقعی
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const DRY = !process.argv.includes('--yes');

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const b = s => `\x1b[1m${s}\x1b[0m`;

const { db, buildNotesIndex, buildSearchIndex, insertProducts } =
  require(path.join(ROOT, 'src', 'db'));

const num = n => Number(n).toLocaleString('fa-IR');

function main() {
  console.log('\n' + b('  تعویض کاتالوگ — منبع ۲٬۱۱۱ عطر اصیل') + '\n');

  const seedFile = path.join(ROOT, 'seed', 'perfumes_catalogue_seed.json');
  if (!fs.existsSync(seedFile)) {
    console.error(r('  🔴 فایل seed نیست. اول این را بزنید:'));
    console.error('     python3 scripts/import_dataset_v2.py\n');
    process.exit(1);
  }

  const products = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  const variantCount = products.reduce((s, p) => s + (p.variants || []).length, 0);

  // ── وضعیت فعلی ──
  const before = {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    variants: db.prepare('SELECT COUNT(*) c FROM variants').get().c,
    stocked: db.prepare('SELECT COUNT(*) c FROM variants WHERE stock > 0').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    orderItems: db.prepare('SELECT COUNT(*) c FROM order_items').get().c,
    wishlist: db.prepare('SELECT COUNT(*) c FROM wishlist').get().c,
    alerts: db.prepare('SELECT COUNT(*) c FROM stock_alerts').get().c,
    reviews: db.prepare('SELECT COUNT(*) c FROM reviews').get().c,
    notes: db.prepare('SELECT COUNT(*) c FROM product_notes').get().c
  };

  console.log(b('  وضعیت فعلی'));
  console.log(`    محصول: ${num(before.products)} · واریانت: ${num(before.variants)}`
            + ` · موجودی‌دار: ${before.stocked}`);
  console.log(`    سفارش: ${before.orders} · اقلام: ${before.orderItems}`
            + ` · علاقه‌مندی: ${before.wishlist} · خبرم‌کن: ${before.alerts}`
            + ` · نظر: ${before.reviews}`);

  console.log('\n' + b('  منبع تازه'));
  console.log(`    محصول: ${num(products.length)} · واریانت: ${num(variantCount)}`);
  console.log(`    برند یکتا: ${new Set(products.map(p => p.inspired_brand_en)).size}`);

  /* ── موجودی: تنها چیزی که واقعاً باید نجات یابد ──
     مالک فقط ۲ واریانت موجودی‌دار دارد. اگر همان دو هم پاک شوند،
     فروشگاه صفر کالای قابل خرید می‌شود و آزمون خرید می‌شکند.
     با SKU تطبیق داده می‌شود؛ SKU از شناسه محصول ساخته می‌شود که
     عوض می‌شود، پس احتمال بازیابی کم است — ولی تلاش می‌کنیم و
     صادقانه گزارش می‌دهیم. */
  const oldStock = db.prepare(
    'SELECT sku, stock FROM variants WHERE stock > 0').all();

  console.log('\n' + b('  ارجاع‌های وابسته — سیاست هر کدام'));
  console.log(d('    order_items  → دست‌نخورده. سفارش ثبت‌شده سند مالی است؛'));
  console.log(d('                   نامِ محصول در خود ردیف ذخیره شده، پس فاکتور'));
  console.log(d('                   قدیمی حتی با حذف محصول درست نمایش داده می‌شود.'));
  console.log(d('    wishlist     → پاک می‌شود. اشاره به محصولی که دیگر نیست'));
  console.log(d('                   یعنی صفحه ۴۰۴ در حساب کاربری.'));
  console.log(d('    stock_alerts → پاک می‌شود. «خبرم کن» برای SKU ناموجود'));
  console.log(d('                   هرگز فعال نمی‌شود و فقط جدول را پر می‌کند.'));
  console.log(d('    reviews      → پاک می‌شود (الان صفر است).'));
  console.log(d('    product_notes→ بازسازی می‌شود از نُت‌های تازه.'));
  console.log(d('    trending     → پاک می‌شود. آمار بازدید محصول حذف‌شده'));
  console.log(d('                   ویترین را با کالای ناموجود پر می‌کند.'));

  if (DRY) {
    console.log('\n' + y('  حالت آزمایشی — هیچ تغییری اعمال نشد.'));
    console.log(d('  برای اجرای واقعی:  node scripts/replace_catalog.js --yes\n'));
    return;
  }

  // ═══ اجرای واقعی ═══
  console.log('\n' + b('  اجرا'));

  const tx = db.transaction(() => {
    // ۱) پاک‌سازی وابسته‌ها
    const delW = db.prepare('DELETE FROM wishlist').run().changes;
    const delA = db.prepare('DELETE FROM stock_alerts').run().changes;
    const delR = db.prepare('DELETE FROM reviews').run().changes;
    const delT = db.prepare('DELETE FROM trending').run().changes;
    const delN = db.prepare('DELETE FROM product_notes').run().changes;
    console.log(`    پاک شد — علاقه‌مندی ${delW} · خبرم‌کن ${delA}`
              + ` · نظر ${delR} · ترند ${delT} · نُت ${num(delN)}`);

    // ۲) کاتالوگ کهنه
    const delV = db.prepare('DELETE FROM variants').run().changes;
    const delP = db.prepare('DELETE FROM products').run().changes;
    console.log(`    کاتالوگ کهنه — ${num(delP)} محصول · ${num(delV)} واریانت`);

    // ۳) درج تازه — از همان تابع db.js تا منطق یکی باشد
    const seeded = insertProducts(products);
    console.log(`    کاتالوگ تازه — ${num(seeded.p)} محصول · ${num(seeded.v)} واریانت`);

    // ۴) بازگرداندن موجودی
    let restored = 0;
    for (const s of oldStock) {
      const hit = db.prepare('UPDATE variants SET stock=? WHERE sku=?')
                    .run(s.stock, s.sku);
      restored += hit.changes;
    }
    console.log(`    موجودی — ${restored} از ${oldStock.length} واریانت بازگردانده شد`);
    if (restored < oldStock.length) {
      console.log(d(`      (SKU از شناسه محصول ساخته می‌شود و شناسه‌ها عوض شدند —`));
      console.log(d(`       موجودی باید از پنل دوباره وارد شود)`));
    }
  });

  tx();

  // ۵) ایندکس‌ها — بیرون از تراکنش چون خودشان تراکنش دارند
  console.log('\n' + b('  بازسازی ایندکس'));
  buildNotesIndex();
  const nc = db.prepare('SELECT COUNT(*) c FROM product_notes').get().c;
  console.log(`    ایندکس نُت — ${num(nc)} ردیف`);

  if (typeof buildSearchIndex === 'function') {
    buildSearchIndex();
    const sc = db.prepare(
      "SELECT COUNT(*) c FROM products WHERE search_blob IS NOT NULL AND search_blob != ''").get().c;
    console.log(`    ایندکس جستجو — ${num(sc)} محصول`);
  }

  // ── تأیید نهایی ──
  const after = {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    variants: db.prepare('SELECT COUNT(*) c FROM variants').get().c,
    withPerfumer: db.prepare(
      "SELECT COUNT(*) c FROM products WHERE perfumer IS NOT NULL AND perfumer != ''").get().c,
    withYear: db.prepare('SELECT COUNT(*) c FROM products WHERE release_year IS NOT NULL').get().c,
    withUsd: db.prepare('SELECT COUNT(*) c FROM variants WHERE price_usd IS NOT NULL').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c
  };

  console.log('\n' + b('  نتیجه'));
  console.log(`    محصول: ${num(after.products)} · واریانت: ${num(after.variants)}`);
  console.log(`    با نام عطار: ${num(after.withPerfumer)} · با سال عرضه: ${num(after.withYear)}`);
  console.log(`    با قیمت دلاری: ${num(after.withUsd)}`);
  console.log(`    سفارش‌ها دست‌نخورده: ${after.orders}`);

  const ok = after.products === products.length
          && after.variants === variantCount
          && after.orders === before.orders;
  console.log('\n' + (ok ? g('  ✓ تعویض کاتالوگ کامل شد.\n')
                         : r('  🔴 اعداد نمی‌خوانند — بررسی کنید.\n')));
  process.exit(ok ? 0 : 1);
}

main();
