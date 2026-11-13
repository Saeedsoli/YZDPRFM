#!/usr/bin/env node

'use strict';

const { db, buildSearchIndex } = require('../src/db');

const DRY = process.argv.includes('--dry');
const g = s => `\x1b[32m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const CONNECTORS = new Set(['د', 'دو', 'دِ', 'آو', 'او', 'له', 'لا',
  'میس', 'مای', 'مستر', 'مون', 'لو', 'بلو', 'تق',
  'پاشا', 'ویاژ', 'لنستان', 'ماست', 'هوم']);

function stripBrand(name, brand) {
  if (!name || !brand) return name;

  const words = String(name).split(/\s+/).filter(Boolean);
  const bi = words.indexOf(brand);
  if (bi > 0 && CONNECTORS.has(words[bi - 1])) return name;

  let out = name;

  const patterns = [
    new RegExp('^' + esc(brand) + '\\s*[-—–]\\s*', 'u'),
    new RegExp('^' + esc(brand) + '\\s+', 'u'),
    new RegExp('\\s+' + esc(brand) + '$', 'u'),
    new RegExp('\\s*[-—–]\\s*' + esc(brand) + '$', 'u')
  ];

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

    if (c.title_fa_display) {
      const t = c.title_fa_display.split(c.name_fa).join(c.next);
      if (t !== c.title_fa_display) updTitle.run(t, c.id);
    }
  }
})();

console.log(`\n  ${changes.length} نام محصول اصلاح شد.`);

buildSearchIndex(true);
console.log(`  ایندکس جستجو بازسازی شد.\n`);
