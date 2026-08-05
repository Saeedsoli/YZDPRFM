#!/usr/bin/env node
/**
 * پاک‌سازی دیتابیس برای افتتاح — داده آزمونی می‌رود، کاتالوگ می‌ماند.
 *
 * چرا لازم است: دیتابیس فعلی پر از سفارش‌های آزمونی («سارا کریمی»)،
 * هزاران ردیف audit و لاگ است. اگر همین فایل روی سرور برود، فروشگاه
 * با سفارش‌های جعلی و شماره فاکتور از وسط شروع می‌کند.
 *
 * چه چیزی پاک می‌شود:
 *   سفارش‌ها، اقلام سفارش، تاریخچه وضعیت، مشتریان، نشست‌ها،
 *   نظرات، تیکت‌ها، علاقه‌مندی‌ها، هشدار موجودی، کد یکبارمصرف،
 *   لاگ‌ها، audit، رویدادهای تحلیلی، مصرف کوپن، شماره فاکتور
 *
 * چه چیزی می‌ماند:
 *   محصولات، واریانت‌ها، مقالات، برندها، نقش‌ها، مجوزها،
 *   تنظیمات فروشگاه، کوپن‌ها (خودِ تعریف، نه مصرف)
 *
 * کارمندان: با ‎--keep-staff نگه داشته می‌شوند، وگرنه همه جز
 * مدیر کل پاک می‌شوند.
 *
 * اجرا:
 *   node scripts/reset_for_launch.js --dry-run    # فقط گزارش
 *   node scripts/reset_for_launch.js --yes        # واقعاً پاک کن
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'yazd.db');

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run') || !args.includes('--yes');
const KEEP_STAFF = args.includes('--keep-staff');

if (!fs.existsSync(DB_PATH)) {
  console.log(r(`\n  دیتابیس یافت نشد: ${DB_PATH}\n`));
  process.exit(1);
}

/* جدول‌هایی که کاملاً خالی می‌شوند */
const WIPE = [
  'orders', 'order_items', 'order_status_log',
  'customers', 'sessions', 'reviews', 'tickets',
  'wishlist', 'stock_alerts', 'otp_codes',
  'app_logs', 'audit_log', 'events', 'trending',
  'coupon_usage', 'rate_limits'
];

/* جدول‌هایی که باید دست‌نخورده بمانند — اگر یکی خالی شد یعنی اشتباه شده */
const PRESERVE = ['products', 'variants', 'articles', 'roles', 'coupons'];

const db = new Database(DB_PATH);

console.log(`\n  ${DRY ? y('حالت گزارش (بدون تغییر)') : r('حالت اجرا — داده پاک می‌شود')}`);
console.log(d(`  دیتابیس: ${DB_PATH}\n`));

/* ── وضعیت فعلی ── */
const before = {};
const allTables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
).all().map(t => t.name);

for (const t of allTables) {
  before[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
}

console.log('  ── پاک می‌شود ──');
let totalWipe = 0;
for (const t of WIPE) {
  if (!(t in before)) continue;
  if (before[t] > 0) {
    console.log(`  ${String(before[t]).padStart(7)}  ${t}`);
    totalWipe += before[t];
  }
}
if (!totalWipe) console.log(d('        (چیزی برای پاک کردن نیست)'));

console.log('\n  ── دست‌نخورده می‌ماند ──');
for (const t of PRESERVE) {
  if (t in before) console.log(`  ${String(before[t]).padStart(7)}  ${t}`);
}

/* ── کارمندان ── */
const staff = db.prepare('SELECT id, username, role_key, display_name FROM staff').all();
console.log('\n  ── کارمندان ──');
for (const s of staff) {
  const isOwner = s.role_key === 'owner' || s.id === 1;
  const keep = KEEP_STAFF || isOwner;
  console.log(`  ${keep ? g('نگه') : r('پاک')}  ${s.username}  ${d(s.role_key + ' · ' + (s.display_name || ''))}`);
}

/* ── شماره فاکتور ── */
const invKeys = db.prepare(
  "SELECT key FROM settings WHERE key LIKE 'invoice_no:%' OR key='invoice_seq'"
).all();
console.log(`\n  ── شماره فاکتور ──\n  ${invKeys.length} کلید بازنشانی می‌شود ${d('(فاکتور بعدی از ۰۰۰۰۱)')}`);

if (DRY) {
  console.log(`\n  ${y('هیچ تغییری اعمال نشد.')}`);
  console.log(d('  برای اجرای واقعی:  node scripts/reset_for_launch.js --yes\n'));
  db.close();
  process.exit(0);
}

/* ── پشتیبان پیش از پاک‌سازی ── */
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = path.join(path.dirname(DB_PATH), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `pre-reset-${stamp}.db`);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
fs.copyFileSync(DB_PATH, backup);
console.log(`\n  ${g('پشتیبان گرفته شد:')} ${path.relative(ROOT, backup)}`);

/* ── پاک‌سازی ── */
const run = db.transaction(() => {
  db.pragma('foreign_keys = OFF');
  for (const t of WIPE) {
    if (t in before) db.prepare(`DELETE FROM "${t}"`).run();
  }
  if (!KEEP_STAFF) {
    db.prepare("DELETE FROM staff WHERE role_key != 'owner' AND id != 1").run();
  }
  db.prepare(
    "DELETE FROM settings WHERE key LIKE 'invoice_no:%' OR key='invoice_seq'"
  ).run();
  // شمارنده‌های AUTOINCREMENT هم صفر شوند
  db.prepare(
    `DELETE FROM sqlite_sequence WHERE name IN (${WIPE.map(() => '?').join(',')})`
  ).run(...WIPE);
  db.pragma('foreign_keys = ON');
});
run();

db.exec('VACUUM');

/* ── راستی‌آزمایی ── */
console.log('\n  ── پس از پاک‌سازی ──');
let problems = 0;

for (const t of WIPE) {
  if (!(t in before)) continue;
  const n = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
  if (n !== 0) { console.log(`  ${r('✗')} ${t} هنوز ${n} ردیف دارد`); problems++; }
}
if (!problems) console.log(`  ${g('✓')} همه جدول‌های موقت خالی شدند`);

for (const t of PRESERVE) {
  if (!(t in before)) continue;
  const n = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
  if (n !== before[t]) {
    console.log(`  ${r('✗')} ${t}: ${before[t]} → ${n}  (نباید عوض می‌شد!)`);
    problems++;
  }
}
if (!problems) console.log(`  ${g('✓')} کاتالوگ و تنظیمات دست‌نخورده ماندند`);

const nStaff = db.prepare('SELECT COUNT(*) c FROM staff').get().c;
console.log(`  ${g('✓')} ${nStaff} کارمند باقی ماند`);

const size = (fs.statSync(DB_PATH).size / 1048576).toFixed(1);
console.log(`  ${g('✓')} حجم دیتابیس: ${size}MB`);

db.close();

console.log(problems
  ? `\n  ${r(`${problems} مشکل — پشتیبان را بازگردانید:`)} node scripts/restore_backup.js\n`
  : `\n  ${g('دیتابیس آماده افتتاح است.')}\n`);

process.exit(problems ? 1 : 0);
