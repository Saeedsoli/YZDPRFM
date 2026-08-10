#!/usr/bin/env node
/**
 * حذف تکرار نام برند از نام محصول.
 *
 * مسئله:
 *   کارت محصول با `fullName()` ساخته می‌شود: «برند — نام». اگر نام
 *   محصول خودش نام برند را داشته باشد، نتیجه می‌شود:
 *
 *     «پنهالیگونز — پنهالیگونز ابسولو»
 *     «آمواج — آمواج اینترلود»
 *
 *   ۹۷۶ محصول از ۲٬۱۰۶ این مشکل را داشتند — یعنی تقریباً نیمی از
 *   کاتالوگ نام برند را دوبار نشان می‌داد.
 *
 * چرا خودکار حل نمی‌شد:
 *   `cleanProductName()` در db.js فقط پیشوند «برند - » را حذف
 *   می‌کرد. اما نام برند می‌تواند وسط یا آخر باشد («عود پنهالیگونز»)
 *   یا بدون خط تیره اول بیاید («پنهالیگونز ابسولو»).
 *
 * محافظت:
 *   اگر حذف برند نام را خالی یا خیلی کوتاه کند، دست نمی‌خورد.
 *   مثلاً محصولی به نام «آمواج» تنها، باید «آمواج» بماند.
 *
 * اجرا:
 *   node scripts/fix_duplicate_brand_in_name.js --dry
 *   node scripts/fix_duplicate_brand_in_name.js
 */
'use strict';

const { db, buildSearchIndex } = require('../src/db');

const DRY = process.argv.includes('--dry');
const g = s => `\x1b[32m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

/** حذف نام برند از نام محصول، با حفظ خوانایی */
/* حرف‌های اضافه‌ای که برند را جزء لاینفک نام می‌کنند.
   بدون این، «مون گرلن» به «مون» و «بلو د شنل» به «بلو د»
   تبدیل می‌شود — نام محصول نابود می‌شود.
   همان فهرست test_brand_names.js و fix_seed_brand_names.py؛
   واگرا شدنشان یعنی دیتابیس و seed نام متفاوت می‌گیرند. */
const CONNECTORS = new Set(['د', 'دو', 'دِ', 'آو', 'او', 'له', 'لا',
  'میس', 'مای', 'مستر', 'مون', 'لو', 'بلو', 'تق',
  'پاشا', 'ویاژ', 'لنستان', 'ماست', 'هوم']);

function stripBrand(name, brand) {
  if (!name || !brand) return name;

  // اگر واژه پیش از برند حرف اضافه باشد، برند بخشی از نام است
  const words = String(name).split(/\s+/).filter(Boolean);
  const bi = words.indexOf(brand);
  if (bi > 0 && CONNECTORS.has(words[bi - 1])) return name;

  let out = name;

  // «برند ایکس» → «ایکس»   |   «ایکس برند» → «ایکس»
  const patterns = [
    new RegExp('^' + esc(brand) + '\\s*[-—–]\\s*', 'u'),   // برند - ایکس
    new RegExp('^' + esc(brand) + '\\s+', 'u'),             // برند ایکس
    new RegExp('\\s+' + esc(brand) + '$', 'u'),             // ایکس برند
    new RegExp('\\s*[-—–]\\s*' + esc(brand) + '$', 'u')     // ایکس - برند
  ];

  /* فقط الگویی که واقعاً منطبق شود اعمال می‌شود.
     نسخه اول شرط `next.length >= 2` را می‌سنجید ولی نمی‌سنجید که
     الگو اصلاً تغییری داده یا نه — پس همان الگوی اول (که منطبق
     نمی‌شد) رشته دست‌نخورده را برمی‌گرداند و حلقه می‌شکست. */
  for (const re of patterns) {
    if (!re.test(out)) continue;
    const next = out.replace(re, '').trim();
    if (next && next.length >= 2) { out = next; break; }
  }

  return out.replace(/\s{2,}/g, ' ').trim();
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const rows = db.prepare(`
  SELECT id, brand_fa, name_fa, title_fa_display
  FROM products
  WHERE brand_fa IS NOT NULL AND name_fa LIKE '%' || brand_fa || '%'
`).all();

console.log(`\n  ${DRY ? y('حالت آزمایشی') : g('حذف تکرار نام برند')}\n`);
console.log(`  ${rows.length} محصول بررسی می‌شود\n`);

const changes = [];
const skipped = [];

for (const p of rows) {
  const next = stripBrand(p.name_fa, p.brand_fa);
  if (next === p.name_fa) { skipped.push(p); continue; }
  if (!next || next.length < 2) { skipped.push(p); continue; }
  changes.push({ ...p, next });
}

// نمونه
for (const c of changes.slice(0, 8)) {
  console.log(`  ${d(c.brand_fa + ' — ' + c.name_fa)}`);
  console.log(`  ${g(c.brand_fa + ' — ' + c.next)}\n`);
}

console.log(`  تغییر می‌کند : ${changes.length}`);
console.log(`  دست‌نخورده  : ${skipped.length}  ${d('(حذف برند نام را خالی می‌کرد)')}`);

if (skipped.length) {
  console.log(`\n  ${d('نمونه دست‌نخورده:')}`);
  skipped.slice(0, 3).forEach(p =>
    console.log(`    ${p.brand_fa} — ${p.name_fa}`));
}

if (DRY) {
  console.log(`\n  برای اعمال بدون --dry اجرا کنید.\n`);
  process.exit(0);
}

const updName = db.prepare('UPDATE products SET name_fa=? WHERE id=?');
const updTitle = db.prepare('UPDATE products SET title_fa_display=? WHERE id=?');

db.transaction(() => {
  for (const c of changes) {
    updName.run(c.next, c.id);
    // عنوان نمایشی هم باید همگام شود
    if (c.title_fa_display) {
      const t = c.title_fa_display.split(c.name_fa).join(c.next);
      if (t !== c.title_fa_display) updTitle.run(t, c.id);
    }
  }
})();

console.log(`\n  ${changes.length} نام محصول اصلاح شد.`);

/* ایندکس جستجو بازسازی می‌شود. نام برند همچنان در ایندکس هست
   (از ستون brand_fa)، پس جستجوی «پنهالیگونز ابسولو» کار می‌کند. */
buildSearchIndex(true);
console.log(`  ایندکس جستجو بازسازی شد.\n`);
