#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { withStock } = require('./lib/test_stock');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4410;
const BASE = `http://127.0.0.1:${PORT}`;

const CODE_LIMIT = 'TESTCAP3';
const CODE_ONCE = 'TESTONCE';

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

function cleanup() {
  const db = new Database(DB);
  for (const c of [CODE_LIMIT, CODE_ONCE]) {
    db.prepare('DELETE FROM coupon_usage WHERE UPPER(code)=?').run(c);
    db.prepare('DELETE FROM coupons WHERE UPPER(code)=?').run(c);
  }
  db.prepare(
    "DELETE FROM order_status_log WHERE order_id IN " +
    "(SELECT order_id FROM orders WHERE customer_name LIKE 'cpn%')"
  ).run();
  db.prepare(
    "DELETE FROM order_items WHERE order_id IN " +
    "(SELECT order_id FROM orders WHERE customer_name LIKE 'cpn%')"
  ).run();
  db.prepare("DELETE FROM orders WHERE customer_name LIKE 'cpn%'").run();
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
}

function seedCoupons() {
  const db = new Database(DB);
  const ins = db.prepare(`INSERT INTO coupons
      (code, type, value, min_subtotal, max_discount, usage_limit,
       per_user_once, active, description)
      VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run(CODE_LIMIT, 'PERCENT', 10, 0, 500000, 3, 0, 1, 'آزمون ظرفیت');
  ins.run(CODE_ONCE, 'PERCENT', 10, 0, 500000, null, 1, 1, 'آزمون یک‌بار برای هر نفر');
  db.close();
}

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore'
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

async function orderAndPay(label, mobile, sku, code) {
  const created = await (await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: label, mobile,
      province: 'یزد', city: 'یزد',
      address: 'نشانی آزمایشی برای سنجش سقف کد تخفیف',
      coupon_code: code,
      items: [{ sku, quantity: 1 }]
    })
  })).json();

  if (!created.order_id) return { ok: false, error: created.error };

  const paid = await (await fetch(`${BASE}/api/payment/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: created.order_id, authority: 'c', result: 'success' })
  })).json();

  return {
    ok: !paid.error,
    order_id: created.order_id,
    discount: created.discount || 0
  };
}

function clearRateLimit() {
  const db = new Database(DB);
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
}

function usageCount(code) {
  const db = new Database(DB, { readonly: true });
  const n = db.prepare('SELECT COUNT(*) n FROM coupon_usage WHERE UPPER(code)=?')
    .get(code).n;
  const c = db.prepare('SELECT used_count FROM coupons WHERE UPPER(code)=?').get(code);
  db.close();
  return { rows: n, counter: c ? c.used_count : null };
}

(async () => {
  console.log('\n  آزمون سقف کد تخفیف\n');
  cleanup();
  seedCoupons();

  const srv = await boot();
  let stockLease = null;
  const finish = code => {
    try { srv.kill('SIGKILL'); } catch {}
    try { if (stockLease) stockLease.restore(); } catch {}
    cleanup();
    process.exit(code);
  };

  stockLease = withStock(DB, 1, 100, 'EDP');
  if (!stockLease.skus.length) { console.error('No sellable test variant'); return finish(1); }
  const v = { sku: stockLease.skus[0] };

  const checks = [];

  console.log(d(`  سناریو ۱ — کد «${CODE_LIMIT}» با ظرفیت ۳، ده سفارش هم‌زمان`));
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      orderAndPay(`cpn-cap-${i}`, `0912000${String(i).padStart(4, '0')}`, v.sku, CODE_LIMIT)
    )
  );
  const withDiscount = results.filter(x => x.discount > 0).length;
  const u1 = usageCount(CODE_LIMIT);
  console.log(`    سفارش با تخفیف: ${withDiscount}  ·  رکورد مصرف: ${u1.rows}  ·  شمارنده: ${u1.counter}`);
  checks.push([`ظرفیت ۳ رعایت شد (نه ${withDiscount})`, withDiscount <= 3]);
  checks.push(['شمارنده با رکوردها می‌خواند', u1.counter === u1.rows]);
  checks.push(['شمارنده از ظرفیت بیشتر نشد', u1.counter <= 3]);

  clearRateLimit();
  console.log(d(`\n  سناریو ۲ — کد «${CODE_ONCE}» یک‌بار برای هر نفر، ۵ سفارش هم‌زمان از یک شماره`));
  const same = '09123334444';
  const r2 = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      orderAndPay(`cpn-once-${i}`, same, v.sku, CODE_ONCE))
  );
  const got2 = r2.filter(x => x.discount > 0).length;
  const u2 = usageCount(CODE_ONCE);
  console.log(`    سفارش با تخفیف: ${got2}  ·  رکورد مصرف: ${u2.rows}`);
  checks.push([`یک کاربر فقط یک بار (نه ${got2})`, got2 === 1]);
  checks.push(['رکورد مصرف برای کاربر تکراری ساخته نشد', u2.rows === 1]);

  clearRateLimit();
  console.log(d('\n  سناریو ۳ — سفارش با کد تخفیف لغو می‌شود'));
  const dbR = new Database(DB);
  dbR.prepare('UPDATE coupons SET used_count=0 WHERE UPPER(code)=?').run(CODE_LIMIT);
  dbR.prepare('DELETE FROM coupon_usage WHERE UPPER(code)=?').run(CODE_LIMIT);
  dbR.close();

  const token = (await (await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || 'yazd1404' })
  })).json()).token;

  const o3 = await (await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'cpn-cancel', mobile: '09127778888',
      province: 'یزد', city: 'یزد',
      address: 'نشانی آزمایشی برای سنجش آزادسازی کد',
      coupon_code: CODE_LIMIT,
      items: [{ sku: v.sku, quantity: 1 }]
    })
  })).json();

  const afterReserve = usageCount(CODE_LIMIT);
  console.log(`    پس از ثبت سفارش  → شمارنده: ${afterReserve.counter}`);

  await fetch(`${BASE}/api/payment/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: o3.order_id, authority: 'x' })
  });
  await sleep(300);
  const afterCancel = usageCount(CODE_LIMIT);
  console.log(`    پس از پرداخت ناموفق → شمارنده: ${afterCancel.counter}`);

  checks.push(['ثبت سفارش ظرفیت را رزرو می‌کند', afterReserve.counter === 1]);
  checks.push(['پرداخت ناموفق ظرفیت را برمی‌گرداند', afterCancel.counter === 0]);

  console.log();
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}`);
    if (!pass) failed++;
  }

  console.log();
  console.log(failed === 0
    ? g('  سقف کد تخفیف رعایت می‌شود.\n')
    : r(`  ${failed} بررسی ناموفق — کد تخفیف بیش از ظرفیت مصرف می‌شود.\n`));
  finish(failed === 0 ? 0 : 1);
})();
