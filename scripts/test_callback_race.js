#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { withStock } = require('./lib/test_stock');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4402;
const BASE = `http://127.0.0.1:${PORT}`;
const N = parseInt(process.argv[2]) || 10;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

function cleanup() {
  const db = new Database(DB);
  db.prepare(
    "DELETE FROM order_status_log WHERE order_id IN " +
    "(SELECT order_id FROM orders WHERE customer_name LIKE 'cbrace%')"
  ).run();
  db.prepare(
    "DELETE FROM order_items WHERE order_id IN " +
    "(SELECT order_id FROM orders WHERE customer_name LIKE 'cbrace%')"
  ).run();
  db.prepare("DELETE FROM orders WHERE customer_name LIKE 'cbrace%'").run();
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
}

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch {}
    await sleep(500);
  }
  return false;
}

async function makeOrder(label, sku) {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: label,
      mobile: '09150000003',
      province: 'یزد', city: 'یزد',
      address: 'نشانی آزمایشی برای سنجش بازگشت از درگاه',
      items: [{ sku, quantity: 1 }]
    })
  });
  return res.json();
}

function stockOf(sku) {
  const db = new Database(DB, { readonly: true });
  const s = db.prepare('SELECT stock FROM variants WHERE sku=?').get(sku).stock;
  db.close();
  return s;
}

function orderState(oid) {
  const db = new Database(DB, { readonly: true });
  const o = db.prepare('SELECT status FROM orders WHERE order_id=?').get(oid);
  const logs = db.prepare(
    'SELECT status, COUNT(*) n FROM order_status_log WHERE order_id=? GROUP BY status'
  ).all(oid);
  db.close();
  return { status: o?.status, logs };
}

(async () => {
  console.log('\n  آزمون همزمانی بازگشت از درگاه\n');
  cleanup();

  const srv = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore'
  });
  let lease = null;
  const finish = code => {
    try { srv.kill('SIGKILL'); } catch {}
    try { if (lease) lease.restore(); } catch {}
    cleanup();
    process.exit(code);
  };

  if (!await waitForServer()) {
    console.error(r('  ✗ سرور بالا نیامد'));
    return finish(1);
  }

  lease = withStock(DB, 4, 200);

  const sku = lease.skus[0];
  if (!sku || stockOf(sku) !== 200) throw new Error('Physical stock fixture missing');

  const checks = [];

  console.log(d('  سناریو ۱ — کاربر در صفحه بانک انصراف داد'));
  const o1 = await makeOrder('cbrace-nok', sku);
  const stock1Before = stockOf(sku);

  await Promise.all(Array.from({ length: N }, () =>
    fetch(`${BASE}/payment/callback?order=${o1.order_id}&Authority=A1&Status=NOK`,
          { redirect: 'manual' }).catch(() => null)));

  const st1 = orderState(o1.order_id);
  const stock1After = stockOf(sku);
  const released = stock1After - stock1Before;

  console.log(`    وضعیت: ${st1.status}  ·  موجودی: ${stock1Before} → ${stock1After}`
    + d(`  (آزادسازی: ${released >= 0 ? '+' : ''}${released})`));
  const cancelLogs = (st1.logs.find(l => l.status === 'CANCELLED') || {}).n || 0;
  console.log(`    رکورد CANCELLED در لاگ: ${cancelLogs}`);

  checks.push(['انصراف: موجودی دقیقاً یک بار آزاد شد', released === 1]);
  checks.push(['انصراف: وضعیت CANCELLED', st1.status === 'CANCELLED']);
  checks.push(['انصراف: لاگ تکراری ندارد', cancelLogs <= 1]);

  console.log(d('\n  سناریو ۲ — پرداخت موفق'));
  const o2 = await makeOrder('cbrace-ok', sku);
  const stock2Before = stockOf(sku);

  await Promise.all(Array.from({ length: N }, () =>
    fetch(`${BASE}/payment/callback?order=${o2.order_id}&Authority=A2&Status=OK`,
          { redirect: 'manual' }).catch(() => null)));

  const st2 = orderState(o2.order_id);
  const stock2After = stockOf(sku);
  const delta2 = stock2After - stock2Before;

  console.log(`    وضعیت: ${st2.status}  ·  موجودی: ${stock2Before} → ${stock2After}`
    + d(`  (تغییر: ${delta2 >= 0 ? '+' : ''}${delta2})`));
  const paidLogs = (st2.logs.find(l => l.status === 'PAID') || {}).n || 0;
  const cancel2 = (st2.logs.find(l => l.status === 'CANCELLED') || {}).n || 0;
  console.log(`    رکورد PAID: ${paidLogs}  ·  CANCELLED: ${cancel2}`);

  const okPath = st2.status === 'PAID';
  checks.push([
    okPath ? 'موفق: موجودی دست‌نخورده ماند' : 'ناموفق: موجودی یک بار آزاد شد',
    okPath ? delta2 === 0 : delta2 === 1
  ]);
  checks.push(['وضعیت نهایی قطعی است', ['PAID', 'CANCELLED'].includes(st2.status)]);
  checks.push(['در وضعیت گذرا گیر نکرد', st2.status !== 'VERIFYING']);
  checks.push(['لاگ PAID تکراری ندارد', paidLogs <= 1]);
  checks.push(['لاگ CANCELLED تکراری ندارد', cancel2 <= 1]);

  console.log();
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}`);
    if (!pass) failed++;
  }

  console.log();
  console.log(failed === 0
    ? g('  مسیر بازگشت از درگاه idempotent است.\n')
    : r(`  ${failed} بررسی ناموفق.\n`));
  finish(failed === 0 ? 0 : 1);
})();
