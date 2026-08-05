#!/usr/bin/env node
/**
 * آزمون ماژول سفارش‌های مدیریتی — گام ۲ تفکیک.
 *
 * چرا این آزمون از گام ۱ سخت‌گیرتر است:
 *   این بلوک سه چیز دارد که کاتالوگ نداشت —
 *     • **پول**: لغو سفارش موجودی برمی‌گرداند و کوپن آزاد می‌کند
 *     • **داده شخصی**: فاکتور و CSV نام و موبایل مشتری دارند
 *     • **دو مسیر دسترسی**: فاکتور هم مشتری هم کارمند
 *
 *   پس فقط «۲۰۰ برگشت» کافی نیست. باید اثر واقعی روی دیتابیس و
 *   مرز دسترسی هر دو نقش سنجیده شود.
 *
 * اجرا: node scripts/test_admin_orders.js
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { db } = require('../src/db');
const { makeStaff } = require('./lib/test_staff');

const PORT = process.env.PORT || 3000;
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

function api(p, opt = {}, token, extraHeaders) {
  return new Promise(res => {
    const body = opt.body || null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(extraHeaders || {})
      }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b, headers: x.headers });
      });
    });
    req.on('error', () => res({ status: 0, json: {}, raw: '' }));
    if (body) req.write(body);
    req.end();
  });
}

/** ساخت سفارش واقعی برای آزمون — با موجودی موقت */
function seedOrder(sku, qty = 1) {
  const v = db.prepare('SELECT * FROM variants WHERE sku=?').get(sku);
  const p = db.prepare('SELECT name_fa, brand_fa FROM products WHERE id=?')
              .get(v.product_id);
  const oid = 'YZD-TEST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const sub = v.price_toman * qty;
  const ship = 250000;
  db.transaction(() => {
    db.prepare(`INSERT INTO orders
      (order_id, created_at, customer_name, mobile, province, city,
       address, postal_code, subtotal, shipping_fee, total_paid,
       status, payment_gateway)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(oid, new Date().toISOString(), 'آزمون گام دو', '09121110044',
           'یزد', 'یزد', 'خیابان آزمون', '8913694865',
           sub, ship, sub + ship, 'PAID', 'sandbox');
    db.prepare(`INSERT INTO order_items
      (order_id, sku, product_name, unit_price, quantity, line_total)
      VALUES (?,?,?,?,?,?)`)
      .run(oid, sku, `${p.brand_fa} — ${p.name_fa}`, v.price_toman, qty, sub);
  })();
  return { oid, sku, qty, price: v.price_toman, stockBefore: v.stock };
}

function cleanOrder(oid) {
  db.prepare('DELETE FROM order_items WHERE order_id=?').run(oid);
  db.prepare('DELETE FROM order_status_log WHERE order_id=?').run(oid);
  db.prepare('DELETE FROM orders WHERE order_id=?').run(oid);
}

(async () => {
  console.log('\n  آزمون سفارش‌های مدیریتی — گام ۲ تفکیک\n');

  if ((await api('/api/health')).status !== 200) {
    console.log(r('  سرور بالا نیست.\n')); process.exit(1);
  }

  db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'login%'").run();

  const own = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  const OT = own.json.token;
  if (!OT) { console.log(r('  ورود مدیر ناموفق.\n')); process.exit(1); }

  const v0 = db.prepare('SELECT sku, stock FROM variants LIMIT 1').get();
  db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(20, v0.sku);
  const ord = seedOrder(v0.sku, 2);

  // ══ ۱) دسترس‌پذیری ══
  console.log(d('  دسترس‌پذیری مسیرها'));

  const list = await api('/api/orders?limit=5', {}, OT);
  add('GET /api/orders', list.status === 200,
      `${(list.json.orders || []).length} سفارش`);

  const hist = await api(`/api/orders/${ord.oid}/history`, {}, OT);
  add('GET /api/orders/:id/history', hist.status === 200,
      `${(hist.json.history || []).length} ردیف`);

  const inv = await api(`/api/orders/${ord.oid}/invoice`, {}, OT);
  add('GET /api/orders/:id/invoice', inv.status === 200,
      inv.json.invoice_no ? `فاکتور ${inv.json.invoice_no}` : '');

  const st = await api(`/api/orders/${ord.oid}/status`, {
    method: 'PUT', body: JSON.stringify({ status: 'PROCESSING' })
  }, OT);
  add('PUT /api/orders/:id/status', st.status === 200, st.json.message);

  const csv = await api('/api/admin/export/csv', {}, OT);
  add('GET /api/admin/export/csv', csv.status === 200,
      `${csv.raw.split('\n').length} خط`);
  add('CSV نوع محتوای درست دارد',
      /text\/csv/.test(csv.headers['content-type'] || ''),
      csv.headers['content-type']);
  add('CSV با BOM شروع می‌شود (اکسل فارسی)',
      csv.raw.charCodeAt(0) === 0xFEFF);

  // ══ ۲) پول — لغو سفارش ══
  console.log(d('\n  اثر مالی'));

  const stockBeforeCancel = db.prepare('SELECT stock FROM variants WHERE sku=?')
    .get(ord.sku).stock;
  const cancel = await api(`/api/orders/${ord.oid}/status`, {
    method: 'PUT', body: JSON.stringify({ status: 'CANCELLED', note: 'آزمون گام ۲' })
  }, OT);
  add('لغو سفارش پذیرفته شد', cancel.status === 200, cancel.json.message);

  const stockAfter = db.prepare('SELECT stock FROM variants WHERE sku=?')
    .get(ord.sku).stock;
  add('🔴 موجودی پس از لغو برمی‌گردد', stockAfter === stockBeforeCancel + ord.qty,
      `${stockBeforeCancel} → ${stockAfter} (انتظار +${ord.qty})`);

  const dbOrd = db.prepare('SELECT status FROM orders WHERE order_id=?').get(ord.oid);
  add('وضعیت در دیتابیس ثبت شد', dbOrd.status === 'CANCELLED', dbOrd.status);

  const logRows = db.prepare(
    'SELECT COUNT(*) c FROM order_status_log WHERE order_id=?').get(ord.oid).c;
  add('تاریخچه وضعیت ثبت می‌شود', logRows >= 2, `${logRows} ردیف`);

  // ══ ۳) داده شخصی ══
  console.log(d('\n  داده شخصی'));

  add('فاکتور نام و موبایل مشتری دارد',
      /آزمون گام دو/.test(JSON.stringify(inv.json)) &&
      /09121110044/.test(JSON.stringify(inv.json)));
  add('CSV شماره مشتری دارد', /09121110044/.test(csv.raw));

  /* شماره فاکتور فقط یک بار صادر می‌شود — درخواست دوم همان
     شماره را می‌دهد، نه شماره تازه. */
  const inv2 = await api(`/api/orders/${ord.oid}/invoice`, {}, OT);
  add('شماره فاکتور دوباره صادر نمی‌شود',
      inv2.json.invoice_no === inv.json.invoice_no,
      `${inv.json.invoice_no} = ${inv2.json.invoice_no}`);

  // ══ ۴) کنترل دسترسی ══
  console.log(d('\n  کنترل دسترسی'));

  for (const [p, m] of [['/api/orders', 'GET'],
                        ['/api/admin/export/csv', 'GET']]) {
    const res = await api(p, { method: m });
    if (res.status !== 401) {
      add(`${p} بدون ورود ۴۰۱`, false, `status ${res.status}`);
    }
  }
  add('مسیرهای مدیریتی بدون ورود ۴۰۱ می‌دهند', true);

  const wh = await makeStaff(api, OT, 'split-step2-wh', 'warehouse');
  if (!wh.token) {
    add('ساخت انباردار آزمایشی', false, wh.error || 'توکن نگرفت');
  } else {
    const canList = await api('/api/orders?limit=2', {}, wh.token);
    add('انباردار سفارش‌ها را می‌بیند', canList.status === 200);

    const canInv = await api(`/api/orders/${ord.oid}/invoice`, {}, wh.token);
    add('انباردار فاکتور را می‌بیند', canInv.status === 200);

    /* ── مهم‌ترین مرز این ماژول ──
       انباردار می‌تواند وضعیت را پیش ببرد، ولی **نمی‌تواند لغو
       کند** — چون لغو اثر مالی دارد (موجودی و کوپن). */
    const noCancel = await api(`/api/orders/${ord.oid}/status`, {
      method: 'PUT', body: JSON.stringify({ status: 'CANCELLED' })
    }, wh.token);
    add('🔴 انباردار سفارش را لغو نمی‌کند', noCancel.status === 403,
        `status ${noCancel.status}`);

    const noCsv = await api('/api/admin/export/csv', {}, wh.token);
    add('🔴 انباردار CSV مشتریان را نمی‌گیرد', noCsv.status === 403,
        `status ${noCsv.status}`);
    add('پاسخ ۴۰۳ کامل است نه نیمه‌کاره',
        !!noCsv.json.error && !/یافت نشد/.test(noCsv.json.error || ''),
        (noCsv.json.error || '').slice(0, 40));

    if (wh.id) await api(`/api/admin/staff/${wh.id}`, { method: 'DELETE' }, OT);
  }

  // ══ ۵) دسترسی مشتری به فاکتور خودش ══
  console.log(d('\n  دسترسی مشتری'));

  const M = '09121110044';
  db.prepare('DELETE FROM otp_codes WHERE mobile=?').run(M);
  db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'otp%'").run();
  await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ mobile: M }) });
  const row = db.prepare('SELECT code FROM otp_codes WHERE mobile=?').get(M);
  if (row) {
    const vr = await api('/api/auth/verify-code', {
      method: 'POST', body: JSON.stringify({ mobile: M, code: row.code })
    });
    const CH = { 'X-Customer-Token': vr.json.token };
    const mine = await api(`/api/orders/${ord.oid}/invoice`, {}, null, CH);
    add('مشتری فاکتور خودش را می‌بیند', mine.status === 200, `status ${mine.status}`);

    /* سفارش شخص دیگر نباید دیده شود — نشت داده شخصی */
    const other = seedOrder(v0.sku, 1);
    const notMine = await api(`/api/orders/${other.oid}/invoice`, {}, null, CH);
    db.prepare('UPDATE orders SET mobile=? WHERE order_id=?').run('09129998888', other.oid);
    const notMine2 = await api(`/api/orders/${other.oid}/invoice`, {}, null, CH);
    add('🔴 مشتری فاکتور دیگری را نمی‌بیند', notMine2.status === 403,
        `status ${notMine2.status}`);
    cleanOrder(other.oid);
  } else {
    add('چرخه ورود مشتری آزموده شد', false, 'کد یکبارمصرف ساخته نشد');
  }

  // ══ ۶) ورودی نامعتبر ══
  console.log(d('\n  ورودی نامعتبر'));

  const bad1 = await api('/api/orders/YZD-NAKOJA-9999/history', {}, OT);
  add('سفارش ناموجود ۴۰۴ می‌دهد', bad1.status === 404, `status ${bad1.status}`);

  const bad2 = await api(`/api/orders/${ord.oid}/status`, {
    method: 'PUT', body: JSON.stringify({ status: 'HACKED' })
  }, OT);
  add('وضعیت نامعتبر رد می‌شود', bad2.status === 400, `status ${bad2.status}`);

  const bad3 = await api('/api/orders/YZD-NAKOJA-9999/invoice', {}, OT);
  add('فاکتور سفارش ناموجود ۴۰۴', bad3.status === 404);

  // ══ ۷) مسیرهای همسایه ══
  console.log(d('\n  مسیرهای همسایه'));

  let nOk = true;
  for (const [p, want] of [
    ['/api/health', 200], ['/api/products?limit=2', 200],
    ['/api/admin/low-stock', 200], ['/api/admin/audit?limit=2', 200],
    ['/api/admin/backups', 200],
    /* پیگیری با شماره ناموجود ۲۰۰ با فهرست خالی می‌دهد، نه ۴۰۴ —
       نبود سفارش «خطا» نیست، نتیجهٔ خالی است. */
    ['/api/orders/track?order_id=x&mobile=09120000000', 200]
  ]) {
    const res = await api(p, {}, OT);
    if (res.status !== want) { nOk = false; console.log(d(`      ${p} → ${res.status} (انتظار ${want})`)); }
  }
  add('مسیرهای مجاور دست‌نخورده‌اند', nOk);

  // ══ ۸) ساختار ══
  console.log(d('\n  ساختار'));

  const ROOT = path.dirname(__dirname);
  const mod = fs.readFileSync(path.join(ROOT, 'src/routes/admin-orders.js'), 'utf8');
  const srv = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');

  add('قرارداد handle درست است',
      /async function handle\(ctx\)/.test(mod) && /module\.exports = \{ handle \}/.test(mod));
  add('sendJSON پوششی دارد (درس گام ۱)',
      /const sendJSON = \(code, data\) => \{ ctx\.sendJSON/.test(mod));
  add('پاسخ استریمی CSV هم true برمی‌گرداند',
      /res\.end\(\);\s*\n\s*return true;/.test(mod));
  add('هیچ can بدون return true نمانده',
      !/!can\('[^']+'\)\) return;/.test(mod));
  add('server.js ماژول را صدا می‌زند', /routeAdminOrders\.handle\(/.test(srv));
  add('POST /api/orders در server.js ماند (عمدی)',
      /pathname === '\/api\/orders'\)/.test(srv) &&
      /method === 'POST' && pathname === '\/api\/orders'/.test(srv));

  const n = srv.split('\n').length;
  add('server.js کوچک‌تر شد', n < 3800, `${n} خط`);

  // پاک‌سازی
  cleanOrder(ord.oid);
  db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(v0.stock, v0.sku);
  db.prepare('DELETE FROM customers WHERE mobile=?').run(M);

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  سفارش‌های مدیریتی سالم است.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
