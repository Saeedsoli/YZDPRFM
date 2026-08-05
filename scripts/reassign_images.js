#!/usr/bin/env node
/**
 * بازتخصیص تصاویر محصولات روی دیتابیس موجود.
 *
 * چرا لازم است:
 *   `seedIfEmpty()` تنها روی دیتابیس خالی اجرا می‌شود. فروشگاهی که
 *   از قبل کار می‌کند، تصاویر تازه را نمی‌گیرد مگر اینکه ستون
 *   image_url به‌روز شود.
 *
 * ایمنی:
 *   • تخصیص پایدار است (هش شناسه) — اجرای دوباره نتیجه یکسان می‌دهد
 *   • فقط وقتی فایل تصویر واقعاً روی دیسک باشد نوشته می‌شود
 *   • --dry فقط گزارش می‌دهد و چیزی تغییر نمی‌دهد
 *
 * اجرا:
 *   node scripts/reassign_images.js --dry
 *   node scripts/reassign_images.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { db, imageForProduct } = require('../src/db');

const ROOT = path.dirname(__dirname);
const IMG_DIR = path.join(ROOT, 'public', 'images', 'products');
const DRY = process.argv.includes('--dry');

const g = s => `\x1b[32m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const exists = new Map();
function fileExists(url) {
  if (exists.has(url)) return exists.get(url);
  const ok = fs.existsSync(path.join(IMG_DIR, path.basename(url)));
  exists.set(url, ok);
  return ok;
}

const rows = db.prepare(
  'SELECT id, brand_en, family_slug, gender, image_url FROM products'
).all();

let changed = 0, skipped = 0, same = 0;
const perImage = new Map();

const upd = db.prepare('UPDATE products SET image_url=? WHERE id=?');

db.transaction(() => {
  for (const r of rows) {
    const next = imageForProduct(r.brand_en, r.family_slug, r.id, r.gender);

    if (!fileExists(next)) { skipped++; continue; }   // فایل هنوز ساخته نشده
    perImage.set(next, (perImage.get(next) || 0) + 1);

    if (next === r.image_url) { same++; continue; }
    if (!DRY) upd.run(next, r.id);
    changed++;
  }
})();

console.log(`\n  ${DRY ? y('حالت آزمایشی — چیزی تغییر نکرد') : g('بازتخصیص انجام شد')}\n`);
console.log(`  محصولات بررسی‌شده : ${rows.length}`);
console.log(`  تغییر کرد          : ${changed}`);
console.log(`  از قبل درست بود    : ${same}`);
console.log(`  رد شد (فایل نیست)  : ${skipped}`);

console.log(`\n  ${d('پراکندگی تصاویر:')}`);
[...perImage.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([img, n]) =>
    console.log(`    ${String(n).padStart(4)}  ${path.basename(img)}`));

// بزرگ‌ترین گروه پس از تخصیص — معیار موفقیت
const worst = Math.max(...db.prepare(
  'SELECT COUNT(*) n FROM products GROUP BY image_url'
).all().map(r => r.n));
console.log(`\n  بزرگ‌ترین گروه هم‌تصویر: ${worst} محصول\n`);
