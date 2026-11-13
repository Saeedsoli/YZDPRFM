#!/usr/bin/env node

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'yazd.db');
const SEED = path.join(ROOT, 'seed', 'perfumes_catalogue_seed.json');

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const args = process.argv.slice(2);
const DRY = !args.includes('--yes');

const NEW_VOLUME = { HAIR_MIST: 150, BODY_SPLASH: 150 };

const TYPE_CODE = { HAIR_MIST: 'HM', BODY_SPLASH: 'BS' };

console.log(`\n  ${DRY ? y('حالت گزارش (بدون تغییر)') : r('حالت اجرا')}`);
console.log(d(`  دیتابیس: ${DB_PATH}\n`));

const db = new Database(DB_PATH);

const before = db.prepare(`
  SELECT type, type_label, volume_ml, COUNT(*) n,
         MIN(stock) mn, MAX(stock) mx
  FROM variants GROUP BY type, volume_ml ORDER BY type, volume_ml`).all();

console.log('  ── وضعیت فعلی ──');
for (const x of before) {
  console.log(`  ${String(x.type).padEnd(13)} ${String(x.volume_ml).padStart(4)}ml ` +
    `${String(x.n).padStart(6)} ردیف   موجودی ${x.mn}..${x.mx}`);
}

const toResize = db.prepare(`
  SELECT sku, product_id, type, volume_ml FROM variants
  WHERE type IN ('HAIR_MIST','BODY_SPLASH')`).all()
  .filter(v => v.volume_ml !== NEW_VOLUME[v.type]);

console.log(`\n  ── تغییر حجم ──`);
console.log(`  ${toResize.length} واریانت باید به ۱۵۰ میل تبدیل شود`);
if (toResize.length) {
  const sample = toResize.slice(0, 2);
  for (const v of sample) {
    const newSku = v.sku.replace(
      new RegExp(`-${TYPE_CODE[v.type]}-\\d+$`),
      `-${TYPE_CODE[v.type]}-150`);
    console.log(d(`     ${v.sku}  →  ${newSku}`));
  }
}

const usedSkus = new Set(
  db.prepare('SELECT DISTINCT sku FROM order_items').all().map(x => x.sku));
const blocked = toResize.filter(v => usedSkus.has(v.sku));
if (blocked.length) {
  console.log(y(`  ${blocked.length} واریانت در سفارش‌های قبلی ارجاع دارد —`));
  console.log(y('  حجمشان عوض می‌شود ولی SKU دست‌نخورده می‌ماند تا فاکتورها نشکنند.'));
}

const nonZero = db.prepare('SELECT COUNT(*) c FROM variants WHERE stock != 0').get().c;
console.log(`\n  ── موجودی ──`);
console.log(`  ${nonZero} واریانت موجودی غیرصفر دارد → همه صفر می‌شوند`);

if (DRY) {
  console.log(`\n  ${y('هیچ تغییری اعمال نشد.')}`);
  console.log(d('  اجرای واقعی:  node scripts/apply_stock_and_volume.js --yes\n'));
  db.close();
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = path.join(path.dirname(DB_PATH), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `pre-stock-${stamp}.db`);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
fs.copyFileSync(DB_PATH, backup);
console.log(`\n  ${g('پشتیبان:')} ${path.relative(ROOT, backup)}`);

let renamed = 0, resized = 0;
db.transaction(() => {
  for (const v of toResize) {
    const nv = NEW_VOLUME[v.type];
    const newSku = v.sku.replace(
      new RegExp(`-${TYPE_CODE[v.type]}-\\d+$`), `-${TYPE_CODE[v.type]}-${nv}`);

    if (usedSkus.has(v.sku) || newSku === v.sku) {
      db.prepare('UPDATE variants SET volume_ml=? WHERE sku=?').run(nv, v.sku);
    } else {

      const clash = db.prepare('SELECT 1 FROM variants WHERE sku=?').get(newSku);
      if (clash) {
        db.prepare('UPDATE variants SET volume_ml=? WHERE sku=?').run(nv, v.sku);
      } else {
        db.prepare('UPDATE variants SET sku=?, volume_ml=? WHERE sku=?')
          .run(newSku, nv, v.sku);
        renamed++;
      }
    }
    resized++;
  }

  db.prepare('UPDATE variants SET stock = 0').run();
})();

let seedFixed = 0;
if (fs.existsSync(SEED)) {
  const raw = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const items = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
  for (const p of items) {
    for (const v of (p.variants || [])) {
      if (NEW_VOLUME[v.type] && v.volume_ml !== NEW_VOLUME[v.type]) {
        const code = TYPE_CODE[v.type];
        if (v.sku) v.sku = v.sku.replace(new RegExp(`-${code}-\\d+$`),
                                         `-${code}-${NEW_VOLUME[v.type]}`);
        v.volume_ml = NEW_VOLUME[v.type];
      }
      if (v.stock !== 0) { v.stock = 0; seedFixed++; }
    }
  }
  fs.writeFileSync(SEED, JSON.stringify(raw));
  console.log(`  ${g('seed هماهنگ شد:')} ${seedFixed} واریانت`);
}

console.log('\n  ── پس از تغییر ──');
const after = db.prepare(`
  SELECT type, volume_ml, COUNT(*) n, MIN(stock) mn, MAX(stock) mx
  FROM variants GROUP BY type, volume_ml ORDER BY type, volume_ml`).all();
for (const x of after) {
  console.log(`  ${String(x.type).padEnd(13)} ${String(x.volume_ml).padStart(4)}ml ` +
    `${String(x.n).padStart(6)} ردیف   موجودی ${x.mn}..${x.mx}`);
}

let bad = 0;
const nz = db.prepare('SELECT COUNT(*) c FROM variants WHERE stock != 0').get().c;
if (nz) { console.log(r(`  ✗ ${nz} واریانت هنوز موجودی غیرصفر دارد`)); bad++; }

const wrongVol = db.prepare(`
  SELECT COUNT(*) c FROM variants
  WHERE (type='HAIR_MIST' OR type='BODY_SPLASH') AND volume_ml != 150`).get().c;
if (wrongVol) { console.log(r(`  ✗ ${wrongVol} واریانت حجمش ۱۵۰ نشد`)); bad++; }

const orphan = db.prepare(`
  SELECT COUNT(*) c FROM order_items oi
  WHERE NOT EXISTS (SELECT 1 FROM variants v WHERE v.sku = oi.sku)`).get().c;
if (orphan) { console.log(y(`  ! ${orphan} قلم سفارش به SKU حذف‌شده اشاره دارد`)); }

db.close();

console.log(bad
  ? `\n  ${r('مشکل — پشتیبان را بازگردانید')}\n`
  : `\n  ${g('انجام شد.')} ${resized} واریانت ۱۵۰ میل · ${renamed} SKU تازه · همه موجودی‌ها صفر\n`);
process.exit(bad ? 1 : 0);
