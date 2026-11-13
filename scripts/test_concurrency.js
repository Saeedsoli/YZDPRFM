#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4400;
const BASE = `http://127.0.0.1:${PORT}`;
const N = parseInt(process.argv[2]) || 8;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const sleep = ms => new Promise(res => setTimeout(res, ms));

function cleanDb(sku, restoreStock, productId, restoreMode) {
  const db = new Database(DB);
  db.prepare(
    "DELETE FROM order_items WHERE order_id IN " +
    "(SELECT order_id FROM orders WHERE customer_name LIKE 'race%')"
  ).run();
  db.prepare("DELETE FROM orders WHERE customer_name LIKE 'race%'").run();
  db.prepare('DELETE FROM rate_limits').run();
  if (sku && restoreStock != null) {
    db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(restoreStock, sku);
  }

  if (productId && restoreMode) {
    db.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(restoreMode, productId);
  }
  db.close();
}

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {  }
    await sleep(500);
  }
  return false;
}

(async () => {
  console.log('\n  آزمون همزمانی موجودی\n');

  const db = new Database(DB);
  const v = db.prepare(
    'SELECT v.sku, v.stock, v.product_id FROM variants v LIMIT 1').get();
  const originalStock = v.stock;
  db.prepare('UPDATE variants SET stock=1 WHERE sku=?').run(v.sku);

  const originalMode = db.prepare(
    'SELECT supply_mode FROM products WHERE id=?').get(v.product_id).supply_mode;
  db.prepare("UPDATE products SET supply_mode='IN_STOCK' WHERE id=?").run(v.product_id);
  db.close();
  cleanDb();

  console.log(d(`  SKU: ${v.sku}  ·  موجودی تنظیم شد روی ۱`));

  const srv = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore',
    detached: false
  });

  const finish = (code) => {
    try { srv.kill('SIGKILL'); } catch {}
    cleanDb(v.sku, originalStock, v.product_id, originalMode);
    process.exit(code);
  };

  if (!await waitForServer()) {
    console.error(r('  ✗ سرور بالا نیامد'));
    return finish(1);
  }

  console.log(d(`  ارسال ${N} سفارش هم‌زمان…\n`));

  const body = i => JSON.stringify({
    customer_name: `race${i}`,
    mobile: '09130000001',
    province: 'یزد',
    city: 'یزد',
    address: 'نشانی آزمایشی برای سنجش همزمانی سفارش',
    items: [{ sku: v.sku, quantity: 1 }]
  });

  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      fetch(`${BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body(i + 1)
      })
        .then(async res => ({ status: res.status, json: await res.json() }))
        .catch(e => ({ status: 0, json: { error: 'شبکه: ' + e.message } }))
    )
  );

  const ok = results.filter(x => x.json.order_id);
  const rejected = results.filter(x => x.json.error);
  const netErr = results.filter(x => x.status === 0);

  const db2 = new Database(DB, { readonly: true });
  const stock = db2.prepare('SELECT stock FROM variants WHERE sku=?').get(v.sku).stock;
  const orderCount = db2.prepare(
    "SELECT COUNT(*) n FROM orders WHERE customer_name LIKE 'race%'"
  ).get().n;
  db2.close();

  console.log(`  موفق         : ${ok.length}`);
  console.log(`  رد شده       : ${rejected.length}`);
  if (netErr.length) console.log(r(`  خطای شبکه    : ${netErr.length}`));
  console.log(`  سفارش در DB  : ${orderCount}`);
  console.log(`  موجودی نهایی : ${stock}`);
  if (rejected.length) {
    console.log(d(`  نمونه پیام رد: ${String(rejected[0].json.error).slice(0, 70)}`));
  }

  const checks = [
    ['دقیقاً یک سفارش موفق', ok.length === 1],
    [`${N - 1} سفارش رد شد`, rejected.length === N - 1],
    ['موجودی منفی نشد', stock >= 0],
    ['سفارش اضافی در دیتابیس نیست', orderCount === ok.length],
    ['هیچ درخواستی بی‌پاسخ نماند', netErr.length === 0]
  ];

  console.log();
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}`);
    if (!pass) failed++;
  }

  console.log();
  if (failed === 0) {
    console.log(g('  همزمانی درست مدیریت می‌شود.\n'));
  } else {
    console.log(r(`  ${failed} بررسی ناموفق — فروش بیش از موجودی ممکن است.\n`));
  }
  finish(failed === 0 ? 0 : 1);
})();
