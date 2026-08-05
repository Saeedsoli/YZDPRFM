#!/usr/bin/env node
/**
 * آزمون همزمانی شماره سفارش.
 *
 * پیشینه: بنچمارک تیر ۱۴۰۵ نشان داد شماره سفارش فقط از
 * `Date.now()` ساخته می‌شد. دقت آن میلی‌ثانیه است، پس دو خریدار
 * همزمان شماره یکسان می‌گرفتند و دومی با خطای دیتابیس رد می‌شد:
 *
 *     UNIQUE constraint failed: orders.order_id
 *
 * مشتری فقط «خطای داخلی سرور» می‌دید. نرخ شکست اندازه‌گیری‌شده:
 *   ۲ خریدار همزمان → ۲۲٪ · ۵ خریدار → ۳۵٪
 *
 * این آزمون همان شرایط را بازمی‌سازد و مطمئن می‌شود دیگر تکرار
 * نشود. اگر روزی کسی تولید شماره را «ساده‌سازی» کند، اینجا
 * قرمز می‌شود.
 *
 * اجرا: node scripts/test_order_id_race.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { withStock } = require('./lib/test_stock');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4441;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

const MARK = 'آزمون‌همزمانی‌شماره';

function cleanup() {
  const db = new Database(DB);
  const ids = db.prepare('SELECT order_id FROM orders WHERE customer_name LIKE ?')
    .all(MARK + '%').map(x => x.order_id);
  const tx = db.transaction(() => {
    for (const id of ids) {
      db.prepare('DELETE FROM order_items WHERE order_id=?').run(id);
      db.prepare('DELETE FROM order_status_log WHERE order_id=?').run(id);
      db.prepare('DELETE FROM orders WHERE order_id=?').run(id);
    }
    db.prepare('DELETE FROM rate_limits').run();
  });
  tx();
  db.close();
  return ids.length;
}

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      BACKUP_DISABLED: '1',
      PORT: String(PORT),
      DB_PATH: DB,
      // سقف نرخ برداشته می‌شود تا خودِ منطق شماره سنجیده شود،
      // نه محافظِ ضد ربات. محافظ در test_rate_limit جدا آزموده می‌شود.
      RL_ORDER_LIMIT: '100000'
    },
    stdio: 'ignore'
  });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

/** یک سفارش می‌فرستد و نتیجه خام را برمی‌گرداند */
async function placeOrder(i, sku) {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: `${MARK} ${i}`,
      first_name: 'آزمون', last_name: `شماره${i}`,
      mobile: '0918' + String(3000000 + i).slice(-7),
      province: 'یزد', city: 'یزد',
      address: 'نشانی آزمون همزمانی شماره سفارش برای بررسی یکتایی',
      postal_code: '8916100000',
      items: [{ sku, quantity: 1 }]
    })
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, orderId: body.order_id, body };
}

(async () => {
  console.log('\n  آزمون همزمانی شماره سفارش\n');

  const removed = cleanup();
  if (removed) console.log(d(`  ${removed} سفارش آزمونی قبلی پاک شد\n`));

  // ۲۵ واریانت با موجودی ۹۹۹ — کافی برای ۱۳۸ سفارش این آزمون
  const stockLease = withStock(DB, 25, 999);

  const srv = await boot();

  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    try { stockLease.restore(); } catch {}
    const n = cleanup();
    console.log(d(`\n  ${n} سفارش آزمونی پاک شد`));
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `  ${g('شماره سفارش زیر بار همزمان یکتا می‌ماند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    /* موجودی موقت. از تیر ۱۴۰۵ موجودی تولید صفر است، پس آزمون
       باید موجودی خودش را بسازد و در پایان برگرداند. */
    const skus = stockLease.skus;
    if (!skus.length) { add('SKU برای آزمون', false); return finish(); }

    const first = await placeOrder(1, skus[0]);
    add('سفارش تکی ثبت می‌شود', first.status === 201 && !!first.orderId,
      first.orderId || JSON.stringify(first.body).slice(0, 70));

    if (first.orderId) {
      add('شماره الگوی YZD-<زمان>-<تصادفی> دارد',
        /^YZD-[A-Z0-9]+-[A-Z0-9]{4}$/.test(first.orderId), first.orderId);
      add('شماره از الگوی صفحه تماس رد می‌شود',
        /^YZD-[A-Z0-9-]{4,}$/i.test(first.orderId));
    }

    // ── دو خریدار دقیقاً همزمان (سناریوی اصلی باگ) ──
    {
      const [a, b] = await Promise.all([
        placeOrder(101, skus[1 % skus.length]),
        placeOrder(102, skus[2 % skus.length])
      ]);
      const both = a.status === 201 && b.status === 201;
      add('دو خریدار همزمان، هر دو موفق', both,
        `${a.status} / ${b.status}`);
      add('شماره‌هایشان متفاوت است', a.orderId !== b.orderId,
        `${a.orderId} ≠ ${b.orderId}`);
    }

    // ── موج سنگین: ۶۰ سفارش کاملاً موازی ──
    {
      const N = 60;
      const jobs = Array.from({ length: N }, (_, i) =>
        placeOrder(200 + i, skus[i % skus.length]));
      const results = await Promise.all(jobs);

      const ok = results.filter(x => x.status === 201);
      const err500 = results.filter(x => x.status === 500);
      const ids = ok.map(x => x.orderId);
      const uniq = new Set(ids);

      add(`${N} سفارش موازی — همه موفق`, ok.length === N,
        `${ok.length}/${N} موفق · ${err500.length} خطای ۵۰۰`);
      add('هیچ شماره تکراری تولید نشد', uniq.size === ids.length,
        `${uniq.size} یکتا از ${ids.length}`);
      add('هیچ خطای ۵۰۰ رخ نداد', err500.length === 0,
        err500.length ? JSON.stringify(err500[0].body).slice(0, 60) : 'پاک');

      // هر شماره باید واقعاً در دیتابیس باشد
      const db = new Database(DB, { readonly: true });
      const found = ids.filter(id =>
        db.prepare('SELECT 1 FROM orders WHERE order_id=?').get(id));
      db.close();
      add('همه سفارش‌ها واقعاً ذخیره شدند', found.length === ids.length,
        `${found.length}/${ids.length}`);
    }

    // ── سه موج پشت سر هم (فشار پیوسته) ──
    {
      const allIds = [];
      let fails = 0;
      for (let wave = 0; wave < 3; wave++) {
        const res = await Promise.all(
          Array.from({ length: 25 }, (_, i) =>
            placeOrder(500 + wave * 25 + i, skus[i % skus.length])));
        for (const x of res) {
          if (x.status === 201) allIds.push(x.orderId); else fails++;
        }
      }
      add('۷۵ سفارش در ۳ موج — بدون شکست', fails === 0, `${fails} ناموفق`);
      add('هر ۷۵ شماره یکتا', new Set(allIds).size === allIds.length,
        `${new Set(allIds).size}/${allIds.length}`);
    }

    // ── موجودی درست کم شده باشد ──
    {
      const db = new Database(DB, { readonly: true });
      const n = db.prepare(
        'SELECT COUNT(*) c FROM orders WHERE customer_name LIKE ?').get(MARK + '%').c;
      const items = db.prepare(`
        SELECT COUNT(*) c FROM order_items oi
        JOIN orders o ON o.order_id = oi.order_id
        WHERE o.customer_name LIKE ?`).get(MARK + '%').c;
      db.close();
      add('هر سفارش دقیقاً یک قلم دارد', items === n, `${items} قلم برای ${n} سفارش`);
    }

  } catch (e) {
    add('اجرای آزمون بدون خطا', false, e.message);
  }

  finish();
})();
