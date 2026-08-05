#!/usr/bin/env node
/**
 * بازیابی دیتابیس از نسخه پشتیبان.
 *
 * پشتیبان‌گیری خودکار از روز اول بود، اما راهی برای برگرداندن وجود
 * نداشت. داشتن پشتیبانی که بلد نیستی برگردانی، یعنی پشتیبان نداری.
 *
 * این ابزار عمداً محتاط است:
 *   ۱) فایل را پیش از هر کاری اعتبارسنجی می‌کند
 *   ۲) از وضعیت فعلی یک نسخه ایمنی می‌گیرد
 *   ۳) تفاوت آماری را نشان می‌دهد و تأیید می‌خواهد
 *   ۴) اگر جابه‌جایی شکست بخورد، خودکار برمی‌گرداند
 *
 * اجرا:
 *   node scripts/restore_backup.js --list
 *   node scripts/restore_backup.js data/backups/yazd-2026072518.db
 *   node scripts/restore_backup.js <file> --yes     # بدون پرسش
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.dirname(__dirname);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'yazd.db');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');

// جدول‌هایی که وجودشان نشانه سالم بودن نسخه است
const REQUIRED_TABLES = [
  'products', 'variants', 'orders', 'order_items',
  'coupons', 'reviews', 'articles', 'settings'
];

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`
};

function human(bytes) {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

/** آمار یک فایل دیتابیس؛ اگر خراب باشد خطا می‌دهد. */
function inspect(file) {
  const Database = require('better-sqlite3');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`بررسی سلامت ناموفق: ${integrity}`);
    }

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map(r => r.name);

    const missing = REQUIRED_TABLES.filter(t => !tables.includes(t));
    if (missing.length) {
      throw new Error(`جدول‌های ضروری نیستند: ${missing.join(', ')}`);
    }

    const count = t => {
      try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; }
      catch { return 0; }
    };

    return {
      ok: true,
      size: fs.statSync(file).size,
      tables: tables.length,
      products: count('products'),
      variants: count('variants'),
      orders: count('orders'),
      reviews: count('reviews'),
      articles: count('articles'),
      tickets: count('tickets')
    };
  } finally {
    db.close();
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log(c.yellow('  هیچ پوشه پشتیبانی وجود ندارد.'));
    console.log(c.dim(`  انتظار می‌رفت: ${BACKUP_DIR}`));
    return [];
  }
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const full = path.join(BACKUP_DIR, f);
      const st = fs.statSync(full);
      return { name: f, full, size: st.size, mtime: st.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) {
    console.log(c.yellow('  هنوز پشتیبانی گرفته نشده.'));
    return [];
  }

  console.log(c.bold(`\n  ${files.length} نسخه پشتیبان:\n`));
  files.forEach((f, i) => {
    let extra = '';
    try {
      const s = inspect(f.full);
      extra = c.dim(`${s.products} محصول · ${s.orders} سفارش`);
    } catch (e) {
      extra = c.red('خراب: ' + e.message.slice(0, 40));
    }
    console.log(`  ${String(i + 1).padStart(2)}. ${f.name}  `
      + c.dim(human(f.size).padStart(9))
      + `  ${f.mtime.toISOString().slice(0, 16).replace('T', ' ')}  ${extra}`);
  });
  console.log();
  return files;
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout
  });
  return new Promise(res =>
    rl.question(question, a => { rl.close(); res(a.trim()); }));
}

async function restore(src, autoYes) {
  console.log(c.bold('\n  بازیابی دیتابیس\n'));

  if (!fs.existsSync(src)) {
    console.error(c.red(`  فایل پیدا نشد: ${src}`));
    process.exit(1);
  }

  // ── ۱) اعتبارسنجی نسخه پشتیبان ──
  console.log(c.dim('  بررسی نسخه پشتیبان…'));
  let from;
  try {
    from = inspect(src);
  } catch (e) {
    console.error(c.red(`  ✗ نسخه پشتیبان قابل استفاده نیست: ${e.message}`));
    console.error(c.dim('    بازیابی انجام نشد. دیتابیس فعلی دست‌نخورده است.'));
    process.exit(1);
  }

  // ── ۲) وضعیت فعلی ──
  let to = null;
  if (fs.existsSync(DB_PATH)) {
    try { to = inspect(DB_PATH); }
    catch { to = { ok: false }; }
  }

  const row = (label, a, b) => {
    const same = a === b;
    const arrow = same ? c.dim('=') : c.yellow('→');
    console.log(`  ${label.padEnd(12)} ${String(b ?? '—').padStart(8)}`
      + `  ${arrow}  ${String(a).padStart(8)}`
      + (same ? '' : c.dim(`   (${a - (b || 0) >= 0 ? '+' : ''}${a - (b || 0)})`)));
  };

  console.log(c.bold('\n  مقایسه:'));
  console.log(c.dim('                    فعلی        پشتیبان'));
  row('محصول', from.products, to?.products);
  row('متغیر', from.variants, to?.variants);
  row('سفارش', from.orders, to?.orders);
  row('نظر', from.reviews, to?.reviews);
  row('مقاله', from.articles, to?.articles);
  row('تیکت', from.tickets, to?.tickets);

  // ── ۳) هشدار درباره داده‌ای که از دست می‌رود ──
  if (to && to.orders > from.orders) {
    const lost = to.orders - from.orders;
    console.log(c.red(`\n  ⚠ هشدار: ${lost} سفارش از دست می‌رود.`));
    console.log(c.dim('    این سفارش‌ها پس از گرفتن این پشتیبان ثبت شده‌اند.'));
  }

  if (!autoYes) {
    const a = await ask(c.bold('\n  ادامه؟ ') + c.dim('(بنویسید «بله») '));
    if (a !== 'بله' && a.toLowerCase() !== 'yes') {
      console.log(c.dim('\n  لغو شد. هیچ تغییری اعمال نشد.\n'));
      process.exit(0);
    }
  }

  // ── ۴) نسخه ایمنی از وضعیت فعلی ──
  let safety = null;
  if (fs.existsSync(DB_PATH)) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
    safety = path.join(path.dirname(DB_PATH), `pre-restore-${stamp}.db`);
    fs.copyFileSync(DB_PATH, safety);
    console.log(c.dim(`\n  نسخه ایمنی: ${path.basename(safety)}`));
  }

  // ── ۵) جابه‌جایی ──
  try {
    // فایل‌های جانبی WAL باید پاک شوند وگرنه با دیتابیس تازه ناسازگارند
    for (const ext of ['-wal', '-shm']) {
      const f = DB_PATH + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    fs.copyFileSync(src, DB_PATH);

    // ── ۶) تأیید پس از بازیابی ──
    const after = inspect(DB_PATH);
    if (after.products !== from.products || after.orders !== from.orders) {
      throw new Error('آمار پس از بازیابی با نسخه پشتیبان نمی‌خواند');
    }

    console.log(c.green('\n  ✓ بازیابی انجام شد.'));
    console.log(`    ${after.products} محصول · ${after.variants} متغیر · ${after.orders} سفارش`);
    if (safety) {
      console.log(c.dim(`\n  اگر نتیجه درست نبود، برگردانید با:`));
      console.log(c.dim(`    node scripts/restore_backup.js ${safety} --yes`));
    }
    console.log(c.yellow('\n  سرور را ری‌استارت کنید تا تغییرات اعمال شود.\n'));
  } catch (e) {
    console.error(c.red(`\n  ✗ بازیابی شکست خورد: ${e.message}`));
    if (safety && fs.existsSync(safety)) {
      fs.copyFileSync(safety, DB_PATH);
      console.log(c.green('  ↩ وضعیت قبلی خودکار برگردانده شد.'));
    }
    process.exit(1);
  }
}

// ─────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--list') || args.length === 0) {
  const files = listBackups();
  if (files.length) {
    console.log(c.dim('  برای بازیابی:'));
    console.log(c.dim(`    node scripts/restore_backup.js ${files[0].full}\n`));
  }
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  بازیابی دیتابیس از نسخه پشتیبان

    node scripts/restore_backup.js --list          فهرست نسخه‌ها
    node scripts/restore_backup.js <file>          بازیابی با تأیید
    node scripts/restore_backup.js <file> --yes    بدون پرسش
`);
  process.exit(0);
}

restore(args[0], args.includes('--yes')).catch(e => {
  console.error(c.red('  خطا: ' + e.message));
  process.exit(1);
});
