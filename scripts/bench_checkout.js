#!/usr/bin/env node

'use strict';

const BASE = process.env.BASE || 'http://localhost:3000';
const CONCURRENCY = parseInt(process.argv[2]) || 20;
const TOTAL = parseInt(process.argv[3]) || 400;

const g = s => `\x1b[32m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
}

function stats(name, lat, errors, elapsedMs) {
  const n = lat.length;
  if (!n) { console.log(`  ${r('✗')} ${name}: همه ناموفق`); return null; }
  const avg = lat.reduce((a, b) => a + b, 0) / n;
  const rps = (n / (elapsedMs / 1000));
  const row = (l, v) => `${l.padEnd(9)}${String(v).padStart(8)}`;
  console.log(`\n  ${name}`);
  console.log(d('  ' + '─'.repeat(52)));
  console.log('  ' + row('میانگین', avg.toFixed(1) + ' ms') +
              row('  صدک۵۰', pct(lat, 50) + ' ms') +
              row('  صدک۹۵', pct(lat, 95) + ' ms'));
  console.log('  ' + row('صدک۹۹', pct(lat, 99) + ' ms') +
              row('  بیشینه', Math.max(...lat) + ' ms') +
              row('  نرخ', rps.toFixed(0) + '/s'));
  console.log('  ' + row('موفق', n) + row('  خطا', errors));
  return { name, avg, p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99),
           max: Math.max(...lat), rps, ok: n, errors };
}

async function pool(items, limit, worker) {
  const results = [];
  let idx = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function timed(fn) {
  const t0 = process.hrtime.bigint();
  try {
    const ok = await fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return { ok, ms };
  } catch (e) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return { ok: false, ms, err: e.message };
  }
}

(async () => {
  console.log(`\n  بنچمارک مسیر خرید`);
  console.log(d(`  ${CONCURRENCY} کاربر همزمان · ${TOTAL} سفارش · ${BASE}\n`));

  const catalog = await fetch(`${BASE}/api/products?limit=60`).then(r => r.json());
  const list = catalog.products || catalog.items || [];
  const skus = [];
  for (const p of list) {
    const det = await fetch(`${BASE}/api/products/${p.slug}`).then(r => r.json());
    for (const v of (det.variants || [])) {
      if (v.stock > TOTAL / 4) skus.push(v.sku);
    }
    if (skus.length > 40) break;
  }
  if (!skus.length) {
    console.log(r('  هیچ SKU با موجودی کافی پیدا نشد.'));
    process.exit(1);
  }
  console.log(d(`  ${skus.length} SKU با موجودی کافی\n`));

  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const dbp = process.env.DB_PATH ||
      path.join(path.dirname(__dirname), 'data', 'yazd.db');
    const dbw = new Database(dbp);
    dbw.prepare('DELETE FROM rate_limits').run();
    dbw.close();
    console.log(d('  قفل نرخ پاک شد (سقف ۱۰ سفارش/۱۰دقیقه برای هر IP دست‌نخورده می‌ماند)\n'));
  } catch (e) {
    console.log(y('  هشدار: قفل نرخ پاک نشد — ' + e.message + '\n'));
  }

  const jobs = Array.from({ length: TOTAL }, (_, i) => i);
  const summary = [];

  {
    const lat = []; let err = 0;
    const t0 = Date.now();
    await pool(jobs, CONCURRENCY, async (i) => {
      const res = await timed(async () => {
        const r2 = await fetch(`${BASE}/api/cart/calculate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ sku: skus[i % skus.length], quantity: 1 }],
            province: i % 3 === 0 ? 'یزد' : 'تهران',
            city: i % 3 === 0 ? 'یزد' : 'تهران'
          })
        });
        return r2.ok;
      });
      if (res.ok) lat.push(Math.round(res.ms)); else err++;
    });
    summary.push(stats('۱) محاسبه سبد', lat, err, Date.now() - t0));
  }

  const orderIds = [];
  {
    const lat = []; let err = 0;
    const errSamples = [];
    const byStatus = {};
    const t0 = Date.now();
    await pool(jobs, CONCURRENCY, async (i) => {

      const mob = '0912' + String(1000000 + i).slice(-7);
      const res = await timed(async () => {
        const r2 = await fetch(`${BASE}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name: `آزمون بار ${i}`,
            first_name: 'آزمون', last_name: `بار${i}`,
            mobile: mob,
            province: 'یزد', city: 'یزد',
            address: 'نشانی آزمون بار برای سنجش کارایی سامانه',
            postal_code: '8916100000',
            items: [{ sku: skus[i % skus.length], quantity: 1 }]
          })
        });
        const j = await r2.json().catch(() => ({}));
        if (r2.ok && j.order_id) { orderIds.push({ id: j.order_id, mobile: mob }); return true; }
        byStatus[r2.status] = (byStatus[r2.status] || 0) + 1;
        if (errSamples.length < 3) errSamples.push(`${r2.status} ${JSON.stringify(j).slice(0, 90)}`);
        return false;
      });
      if (res.ok) lat.push(Math.round(res.ms)); else err++;
    });
    summary.push(stats('۲) ثبت سفارش (نوشتن)', lat, err, Date.now() - t0));
    if (Object.keys(byStatus).length) {
      const label = { 429: 'محدودیت نرخ (محافظت عمدی)', 500: 'خطای سرور (باگ)',
                      400: 'ورودی نامعتبر', 409: 'تداخل' };
      console.log(d('    تفکیک خطا:'));
      for (const [code, n] of Object.entries(byStatus)) {
        const isBug = code === '500';
        const line = `      ${code} × ${n}  ${label[code] || ''}`;
        console.log(isBug ? r(line) : d(line));
      }
      console.log(d('    نمونه: ' + errSamples[0]));
    }
  }

  if (orderIds.length) {
    const lat = []; let err = 0;
    const t0 = Date.now();
    await pool(orderIds, CONCURRENCY, async (o) => {
      const res = await timed(async () => {
        const r2 = await fetch(`${BASE}/api/orders/track?mobile=${encodeURIComponent(o.mobile)}&order_id=${encodeURIComponent(o.id)}`);
        return r2.ok;
      });
      if (res.ok) lat.push(Math.round(res.ms)); else err++;
    });
    summary.push(stats('۳) پیگیری سفارش', lat, err, Date.now() - t0));
  }

  console.log(`\n  ${'─'.repeat(54)}`);
  const totalOrders = orderIds.length;
  const orderStat = summary.find(s => s && s.name.includes('ثبت سفارش'));
  if (orderStat) {
    console.log(`  ${totalOrders} سفارش واقعی ثبت شد`);
    console.log(`  ظرفیت تخمینی: ${g(Math.round(orderStat.rps * 60) + ' سفارش در دقیقه')}` +
                d(`  (${orderStat.rps.toFixed(1)}/ثانیه)`));
    const slow = orderStat.p99;
    console.log(`  بدترین تجربه (صدک۹۹): ${slow < 1000 ? g(slow + ' ms') : y(slow + ' ms')}`);
  }
  console.log('');

  if (process.env.BENCH_JSON) {
    require('fs').writeFileSync(process.env.BENCH_JSON,
      JSON.stringify({ concurrency: CONCURRENCY, total: TOTAL, summary }, null, 2));
  }
})();
