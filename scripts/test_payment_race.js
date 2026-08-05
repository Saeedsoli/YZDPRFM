#!/usr/bin/env node
/**
 * آزمون همزمانی پرداخت — آیا یک سفارش دو بار تأیید می‌شود؟
 *
 * چرا مهم است؟
 *   درگاه بانکی گاهی callback را دو بار می‌فرستد (تلاش مجدد شبکه).
 *   اگر تأیید پرداخت idempotent نباشد، ممکن است موجودی دو بار کم
 *   شود، دو پیامک برود، یا سفارش دو بار در گزارش فروش بیاید.
 *
 * روش: یک سفارش می‌سازیم و N بار هم‌زمان verify می‌زنیم.
 *      تنها اولی باید موفق باشد؛ بقیه «قبلاً پرداخت شده».
 *
 * اجرا: node scripts/test_payment_race.js [تعداد]
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { withStock } = require('./lib/test_stock');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4401;
const BASE = `http://127.0.0.1:${PORT}`;
const N = parseInt(process.argv[2]) || 10;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

function cleanup() {
  const db = new Database(DB);
  db.prepare(
    "DELETE FROM order_items WHERE order_id IN " +
    "(SELECT order_id FROM orders WHERE customer_name = 'payrace')"
  ).run();
  db.prepare("DELETE FROM orders WHERE customer_name = 'payrace'").run();
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
}

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; }
    catch {}
    await sleep(500);
  }
  return false;
}

(async () => {
  console.log('\n  آزمون همزمانی تأیید پرداخت\n');
  cleanup();

  const srv = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore'
  });
  let lease = null;
  const finish = code => {
    try { srv.kill('SIGKILL'); } catch {}
    try { if (lease) lease.restore(); } catch {}   // موجودی به حالت اول
    cleanup();
    process.exit(code);
  };

  if (!await waitForServer()) {
    console.error(r('  ✗ سرور بالا نیامد'));
    return finish(1);
  }

  /* موجودی موقت — موجودی تولید عمداً صفر است (کالا تا تأیید انبار
     نباید فروخته شود)، پس آزمون موجودی خودش را می‌سازد. */
  lease = withStock(DB, 4, 200);

  // ── ساخت یک سفارش ──
  const cat = await (await fetch(`${BASE}/api/products?limit=1&full=1`)).json();
  const variant = cat.products[0].variants.find(x => lease.skus.includes(x.sku))
                || cat.products[0].variants.find(x => x.stock > 2)
                || cat.products[0].variants[0];

  const created = await (await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'payrace',
      mobile: '09140000002',
      province: 'یزد', city: 'یزد',
      address: 'نشانی آزمایشی برای سنجش همزمانی پرداخت',
      items: [{ sku: variant.sku, quantity: 1 }]
    })
  })).json();

  if (!created.order_id) {
    console.error(r('  ✗ ساخت سفارش ناموفق: ' + JSON.stringify(created).slice(0, 90)));
    return finish(1);
  }
  console.log(d(`  سفارش: ${created.order_id}  ·  ${created.total_payable.toLocaleString()} تومان`));

  const db0 = new Database(DB, { readonly: true });
  const stockBefore = db0.prepare('SELECT stock FROM variants WHERE sku=?')
    .get(variant.sku).stock;
  db0.close();
  console.log(d(`  موجودی پیش از پرداخت: ${stockBefore}`));
  console.log(d(`  ارسال ${N} تأیید پرداخت هم‌زمان…\n`));

  // ── N تأیید هم‌زمان برای همان سفارش ──
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      fetch(`${BASE}/api/payment/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: created.order_id,
          authority: 'race-test',
          result: 'success'      // درگاه آزمایشی بدون این، لغو را شبیه‌سازی می‌کند
        })
      })
        .then(async res => ({ status: res.status, json: await res.json() }))
        .catch(e => ({ status: 0, json: { error: e.message } }))
    )
  );

  /* «قبلاً پرداخت شده» با کد ۲۰۰ برمی‌گردد و رفتار درستی است —
     درگاه که callback را دوباره می‌فرستد نباید خطا ببیند.
     پس معیار واقعی تعداد پاسخ ۲۰۰ نیست، بلکه این است که فقط یک
     تأیید *واقعی* اتفاق افتاده باشد. */
  const firstTime = results.filter(x =>
    x.status === 200 && !x.json.error && !/قبلاً/.test(x.json.message || ''));
  const alreadyDone = results.filter(x =>
    x.status === 200 && /قبلاً/.test(x.json.message || ''));
  const refused = results.filter(x => x.json.error);

  // ── وضعیت پس از آزمون ──
  const db = new Database(DB, { readonly: true });
  const order = db.prepare('SELECT * FROM orders WHERE order_id=?').get(created.order_id);
  const stockAfter = db.prepare('SELECT stock FROM variants WHERE sku=?')
    .get(variant.sku).stock;
  const logCount = db.prepare(
    "SELECT COUNT(*) n FROM order_status_log WHERE order_id=? AND status='PAID'"
  ).get(created.order_id).n;
  db.close();

  console.log(`  تأیید واقعی    : ${firstTime.length}`);
  console.log(`  «قبلاً پرداخت»  : ${alreadyDone.length}`);
  console.log(`  رد شده (۴۰۹)   : ${refused.length}`);
  console.log(`  وضعیت سفارش    : ${order.status}`);
  console.log(`  موجودی پس از آن: ${stockAfter}  ${d(`(کاهش: ${stockBefore - stockAfter})`)}`);
  console.log(`  رکورد PAID در لاگ: ${logCount}`);
  if (refused.length) {
    console.log(d(`  نمونه پیام رد  : ${String(refused[0].json.error).slice(0, 66)}`));
  }

  /* دو مسیر ممکن‌اند و هر دو باید idempotent باشند:
       PAID      → پرداخت تأیید شد، موجودی نباید برگردد
       CANCELLED → پرداخت رد شد، موجودی باید دقیقاً یک بار برگردد */
  const paidPath = order.status === 'PAID';
  const delta = stockBefore - stockAfter;

  const checks = [
    ['تنها یک تأیید واقعی رخ داد', firstTime.length === 1],
    [`${N - 1} درخواست دیگر بی‌اثر ماندند`,
      alreadyDone.length + refused.length === N - 1],
    ['وضعیت نهایی قطعی است', ['PAID', 'CANCELLED'].includes(order.status)],
    [paidPath ? 'موجودی برنگشت (پرداخت موفق)' : 'موجودی دقیقاً یک بار برگشت',
      paidPath ? delta === 0 : delta === -1],
    ['لاگ وضعیت تکراری ندارد', logCount <= 1],
    ['سفارش در وضعیت گذرا گیر نکرد', order.status !== 'VERIFYING']
  ];

  console.log();
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}`);
    if (!pass) failed++;
  }

  console.log();
  console.log(failed === 0
    ? g('  تأیید پرداخت idempotent است.\n')
    : r(`  ${failed} بررسی ناموفق — پرداخت تکراری ممکن است.\n`));
  finish(failed === 0 ? 0 : 1);
})();
