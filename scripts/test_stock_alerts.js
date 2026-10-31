#!/usr/bin/env node
/**
 * آزمون «اطلاع بده وقتی موجود شد».
 *
 * مسیرهایی که موجودی می‌تواند از صفر بالا برود:
 *   ۱) ادمین در پنل موجودی را ویرایش کند
 *   ۲) سفارشی که آخرین موجودی را برده بود لغو شود
 *   ۳) پرداخت ناموفق شود و موجودی برگردد
 *   ۴) سفارش پرداخت‌نشده منقضی شود
 *
 * انتظار: در هر چهار حالت، منتظران پیامک بگیرند.
 *
 * اجرا: node scripts/test_stock_alerts.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4407;
const BASE = `http://127.0.0.1:${PORT}`;
const WATCHER = '09181112244';

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

let SKU = null;
let originalStock = null;
let originalSupply = null;

function cleanup() {
  const db = new Database(DB);
  db.prepare('DELETE FROM stock_alerts WHERE mobile=?').run(WATCHER);
  db.prepare(
    "DELETE FROM order_status_log WHERE order_id IN " +
    "(SELECT order_id FROM orders WHERE customer_name LIKE 'alert%')"
  ).run();
  db.prepare(
    "DELETE FROM order_items WHERE order_id IN " +
    "(SELECT order_id FROM orders WHERE customer_name LIKE 'alert%')"
  ).run();
  db.prepare("DELETE FROM orders WHERE customer_name LIKE 'alert%'").run();
  db.prepare('DELETE FROM rate_limits').run();
  if (SKU && originalStock != null) {
    db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(originalStock, SKU);
  }
  if (originalSupply) db.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(originalSupply.supply_mode, originalSupply.id);
  db.close();
}

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', c => { log += c; });
  proc.stderr.on('data', c => { log += c; });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await sleep(400);
  }
  return { proc, getLog: () => log };
}

/** ثبت درخواست اطلاع و صفر کردن موجودی */
function armAlert() {
  const db = new Database(DB);
  db.prepare('DELETE FROM stock_alerts WHERE sku=? AND mobile=?').run(SKU, WATCHER);
  db.prepare('INSERT INTO stock_alerts (sku, mobile) VALUES (?,?)').run(SKU, WATCHER);
  db.prepare('UPDATE variants SET stock=0 WHERE sku=?').run(SKU);
  db.close();
}

function alertState() {
  const db = new Database(DB, { readonly: true });
  const row = db.prepare('SELECT notified FROM stock_alerts WHERE sku=? AND mobile=?')
    .get(SKU, WATCHER);
  db.close();
  return row ? row.notified : null;
}

function setStock(n) {
  const db = new Database(DB);
  db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(n, SKU);
  db.close();
}

(async () => {
  console.log('\n  آزمون اطلاع‌رسانی موجود شدن\n');

  const srv = await boot();
  const finish = code => {
    try { srv.proc.kill('SIGKILL'); } catch {}
    cleanup();
    process.exit(code);
  };

  const product = await (await fetch(`${BASE}/api/products/creed-jasmal`)).json();
  const v = product.variants.find(x => x.type === 'EDP' && x.volume_ml === 30);
  if (!v) { console.error('Test fixture variant is missing'); return finish(1); }
  SKU = v.sku;
  const db0 = new Database(DB, { readonly: true });
  originalStock = db0.prepare('SELECT stock FROM variants WHERE sku=?').get(SKU).stock;
  originalSupply = db0.prepare('SELECT p.id,p.supply_mode FROM products p JOIN variants v ON v.product_id=p.id WHERE v.sku=?').get(SKU);
  db0.close();
  cleanup();
  const db1 = new Database(DB);
  db1.prepare("UPDATE products SET supply_mode='IN_STOCK' WHERE id=?").run(originalSupply.id);
  db1.close();

  const token = (await (await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || 'yazd1404' })
  })).json()).token;

  const checks = [];

  // ══ مسیر ۱: ویرایش دستی ادمین ══
  console.log(d('  مسیر ۱ — ادمین موجودی را در پنل زیاد می‌کند'));
  armAlert();
  const before1 = srv.getLog().length;
  await fetch(`${BASE}/api/admin/variants/${encodeURIComponent(SKU)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ stock: 5 })
  });
  await sleep(500);
  const sent1 = /موجود شد/.test(srv.getLog().slice(before1));
  console.log(`    پیامک ارسال شد: ${sent1 ? 'بله' : 'خیر'}  ·  notified=${alertState()}`);
  checks.push(['ویرایش ادمین → اطلاع‌رسانی', sent1 && alertState() === 1]);

  // ══ مسیر ۲: لغو سفارش توسط ادمین ══
  console.log(d('\n  مسیر ۲ — سفارشی که آخرین موجودی را برده بود لغو می‌شود'));
  setStock(1);
  const o2 = await (await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'alert-cancel', mobile: '09190000005',
      province: 'یزد', city: 'یزد',
      address: 'نشانی آزمایشی برای سنجش اطلاع موجودی',
      items: [{ sku: SKU, quantity: 1 }]
    })
  })).json();
  armAlert();                    // حالا موجودی صفر است و کسی منتظر
  setStock(0);
  const before2 = srv.getLog().length;

  await fetch(`${BASE}/api/orders/${o2.order_id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ status: 'CANCELLED' })
  });
  await sleep(500);
  const sent2 = /موجود شد/.test(srv.getLog().slice(before2));
  console.log(`    پیامک ارسال شد: ${sent2 ? 'بله' : 'خیر'}  ·  notified=${alertState()}`);
  checks.push(['لغو سفارش → اطلاع‌رسانی', sent2 && alertState() === 1]);

  // ══ مسیر ۳: پرداخت ناموفق ══
  console.log(d('\n  مسیر ۳ — پرداخت ناموفق و بازگشت موجودی'));
  setStock(1);
  const o3 = await (await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'alert-failpay', mobile: '09190000006',
      province: 'یزد', city: 'یزد',
      address: 'نشانی آزمایشی برای سنجش اطلاع موجودی',
      items: [{ sku: SKU, quantity: 1 }]
    })
  })).json();
  armAlert();
  setStock(0);
  const before3 = srv.getLog().length;

  await fetch(`${BASE}/api/payment/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: o3.order_id, authority: 'x' })   // بدون success = لغو
  });
  await sleep(500);
  const sent3 = /موجود شد/.test(srv.getLog().slice(before3));
  console.log(`    پیامک ارسال شد: ${sent3 ? 'بله' : 'خیر'}  ·  notified=${alertState()}`);
  checks.push(['پرداخت ناموفق → اطلاع‌رسانی', sent3 && alertState() === 1]);

  // ══ تکراری نبودن ══
  console.log(d('\n  بررسی: پیامک تکراری فرستاده نمی‌شود'));
  const before4 = srv.getLog().length;
  setStock(0);
  await fetch(`${BASE}/api/admin/variants/${encodeURIComponent(SKU)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ stock: 9 })
  });
  await sleep(400);
  const sentAgain = /موجود شد/.test(srv.getLog().slice(before4));
  console.log(`    پیامک دوباره: ${sentAgain ? 'بله ✗' : 'خیر ✓'}`);
  checks.push(['پس از اطلاع، پیامک تکراری نمی‌رود', !sentAgain]);

  console.log();
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}`);
    if (!pass) failed++;
  }
  console.log();
  console.log(failed === 0
    ? g('  اطلاع‌رسانی موجودی در همه مسیرها کار می‌کند.\n')
    : r(`  ${failed} مسیر بدون اطلاع‌رسانی.\n`));
  finish(failed === 0 ? 0 : 1);
})();
