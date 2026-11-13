#!/usr/bin/env node

'use strict';

const http = require('http');
const path = require('path');
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

function api(p, opt = {}, token) {
  return new Promise(res => {
    const body = opt.body || null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b });
      });
    });
    req.on('error', () => res({ status: 0, json: {}, raw: '' }));
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  console.log('\n  آزمون کاتالوگ مدیریتی — گام ۱ تفکیک\n');

  const health = await api('/api/health');
  if (health.status !== 200) {
    console.log(r('  سرور بالا نیست.\n'));
    process.exit(1);
  }

  const own = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  const OT = own.json.token;
  if (!OT) { console.log(r('  ورود مدیر ناموفق.\n')); process.exit(1); }

  const v0 = db.prepare('SELECT sku, price_toman, stock FROM variants LIMIT 1').get();
  const p0 = db.prepare(
    'SELECT p.id, p.slug FROM products p JOIN variants v ON v.product_id=p.id WHERE v.sku=?'
  ).get(v0.sku);

  console.log(d('  دسترس‌پذیری مسیرها'));

  const vRes = await api(`/api/admin/variants/${encodeURIComponent(v0.sku)}`, {
    method: 'PUT', body: JSON.stringify({ stock: v0.stock })
  }, OT);
  add('PUT /api/admin/variants/:sku', vRes.status === 200, `status ${vRes.status}`);

  const pRes = await api(`/api/admin/products/${encodeURIComponent(p0.id)}`, {
    method: 'PUT', body: JSON.stringify({})
  }, OT);
  add('PUT /api/admin/products/:id', pRes.status === 200, `status ${pRes.status}`);

  const lowRes = await api('/api/admin/low-stock?threshold=5', {}, OT);
  add('GET /api/admin/low-stock', lowRes.status === 200,
      `${(lowRes.json.items || []).length} قلم`);

  const logRes = await api('/api/admin/logs?limit=5', {}, OT);
  add('GET /api/admin/logs', logRes.status === 200,
      `${(logRes.json.logs || []).length} ردیف`);

  const mRes = await api('/api/admin/maintenance', { method: 'POST', body: '{}' }, OT);
  add('POST /api/admin/maintenance', mRes.status === 200, mRes.json.message);

  const rxRes = await api('/api/admin/reindex', { method: 'POST', body: '{}' }, OT);
  add('POST /api/admin/reindex', rxRes.status === 200,
      `${rxRes.json.products} محصول · ${rxRes.json.note_rows} نُت`);

  console.log(d('\n  اثر روی داده'));

  const newStock = (v0.stock || 0) + 7;
  await api(`/api/admin/variants/${encodeURIComponent(v0.sku)}`, {
    method: 'PUT', body: JSON.stringify({ stock: newStock })
  }, OT);
  const after = db.prepare('SELECT stock, price_toman FROM variants WHERE sku=?').get(v0.sku);
  add('تغییر موجودی واقعاً ذخیره شد', after.stock === newStock,
      `${v0.stock} → ${after.stock}`);

  const newPrice = v0.price_toman + 1000;
  await api(`/api/admin/variants/${encodeURIComponent(v0.sku)}`, {
    method: 'PUT', body: JSON.stringify({ price_toman: newPrice })
  }, OT);
  const after2 = db.prepare('SELECT price_toman FROM variants WHERE sku=?').get(v0.sku);
  add('تغییر قیمت واقعاً ذخیره شد', after2.price_toman === newPrice,
      `${v0.price_toman} → ${after2.price_toman}`);

  db.prepare('UPDATE variants SET stock=?, price_toman=? WHERE sku=?')
    .run(v0.stock, v0.price_toman, v0.sku);

  console.log(d('\n  ورودی نامعتبر'));

  const bad1 = await api(`/api/admin/variants/${encodeURIComponent(v0.sku)}`, {
    method: 'PUT', body: JSON.stringify({ stock: -5 })
  }, OT);
  add('موجودی منفی رد می‌شود', bad1.status === 400, `status ${bad1.status}`);

  const bad2 = await api(`/api/admin/variants/${encodeURIComponent(v0.sku)}`, {
    method: 'PUT', body: JSON.stringify({ price_toman: 'abc' })
  }, OT);
  add('قیمت غیرعددی رد می‌شود', bad2.status === 400, `status ${bad2.status}`);

  const bad3 = await api('/api/admin/variants/SKU-NAKOJA', {
    method: 'PUT', body: JSON.stringify({ stock: 1 })
  }, OT);
  add('SKU ناموجود ۴۰۴ می‌دهد', bad3.status === 404);

  const bad4 = await api(`/api/admin/products/${encodeURIComponent(p0.id)}`, {
    method: 'PUT', body: JSON.stringify({ price_change_percent: 9999 })
  }, OT);
  add('درصد تغییر خارج از بازه رد می‌شود', bad4.status === 400);

  console.log(d('\n  کنترل دسترسی'));

  for (const p of ['/api/admin/low-stock', '/api/admin/logs']) {
    const res = await api(p);
    if (res.status !== 401) add(`${p} بدون ورود ۴۰۱ می‌دهد`, false, `status ${res.status}`);
  }
  add('مسیرهای خواندنی بدون ورود ۴۰۱ می‌دهند', true);

  const noAuthPost = await api('/api/admin/reindex', { method: 'POST', body: '{}' });
  add('بازسازی ایندکس بدون ورود ۴۰۱ می‌دهد', noAuthPost.status === 401);

  const wh = await makeStaff(api, OT, 'split-step1-wh', 'warehouse');
  if (!wh.token) {
    add('ساخت انباردار آزمایشی', false, wh.error || 'توکن نگرفت');
  } else {
    const okStock = await api(`/api/admin/variants/${encodeURIComponent(v0.sku)}`, {
      method: 'PUT', body: JSON.stringify({ stock: v0.stock })
    }, wh.token);
    add('انباردار موجودی را تغییر می‌دهد', okStock.status === 200,
        `status ${okStock.status}`);

    const noPrice = await api(`/api/admin/variants/${encodeURIComponent(v0.sku)}`, {
      method: 'PUT', body: JSON.stringify({ price_toman: v0.price_toman + 500 })
    }, wh.token);
    add('انباردار قیمت را نمی‌تواند', noPrice.status === 403,
        `status ${noPrice.status}`);

    const noLogs = await api('/api/admin/logs', {}, wh.token);
    add('انباردار لاگ سیستم را نمی‌بیند', noLogs.status === 403,
        `status ${noLogs.status}`);

    const noReindex = await api('/api/admin/reindex',
      { method: 'POST', body: '{}' }, wh.token);
    add('انباردار ایندکس را بازسازی نمی‌کند', noReindex.status === 403);

    const okLow = await api('/api/admin/low-stock', {}, wh.token);
    add('انباردار گزارش موجودی را می‌بیند', okLow.status === 200);

    add('پاسخ ۴۰۳ سالم و کامل است',
        !!noPrice.json.error && !/يافت نشد|یافت نشد/.test(noPrice.json.error || ''),
        (noPrice.json.error || '').slice(0, 40));

    if (wh.id) await api(`/api/admin/staff/${wh.id}`, { method: 'DELETE' }, OT);
  }

  console.log(d('\n  سابقه کارها'));

  const before = db.prepare(
    "SELECT COUNT(*) c FROM audit_log WHERE action='products.stock'").get().c;
  await api(`/api/admin/variants/${encodeURIComponent(v0.sku)}`, {
    method: 'PUT', body: JSON.stringify({ stock: (v0.stock || 0) + 3 })
  }, OT);
  const afterN = db.prepare(
    "SELECT COUNT(*) c FROM audit_log WHERE action='products.stock'").get().c;
  add('تغییر موجودی در سابقه ثبت می‌شود', afterN > before,
      `${before} → ${afterN}`);

  db.prepare('UPDATE variants SET stock=?, price_toman=? WHERE sku=?')
    .run(v0.stock, v0.price_toman, v0.sku);

  console.log(d('\n  مسیرهای همسایه'));

  const neighbours = [
    ['/api/health', 200],
    ['/api/products?limit=2', 200],
    ['/api/notes?limit=3', 200],
    ['/api/admin/audit?limit=3', 200],
    ['/api/admin/readiness', 200],
    ['/api/contact-info', 200]
  ];
  let nOk = true;
  for (const [p, want] of neighbours) {
    const res = await api(p, {}, OT);
    if (res.status !== want) { nOk = false; console.log(d(`      ${p} → ${res.status}`)); }
  }
  add('مسیرهای مجاور دست‌نخورده‌اند', nOk, `${neighbours.length} مسیر`);

  console.log(d('\n  ساختار'));

  const fs = require('fs');
  const ROOT = path.dirname(__dirname);
  const mod = fs.readFileSync(path.join(ROOT, 'src/routes/admin-catalog.js'), 'utf8');
  const srv = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');

  add('ماژول قرارداد handle را دارد',
      /async function handle\(ctx\)/.test(mod) && /module\.exports = \{ handle \}/.test(mod));
  add('در پایان false برمی‌گرداند', /return false;\s*\/\//.test(mod));
  add('همه can ها true برمی‌گردانند',
      !/!can\('[^']+'\)\) return;/.test(mod),
      'در ماژول `return;` یعنی پاسخ گم می‌شود');
  add('server.js ماژول را صدا می‌زند',
      /routeAdminCatalog\.handle\(/.test(srv));
  add('بلوک قدیمی از server.js رفته',
      !/مدیریت محصول و موجودی \(ادمین\)/.test(srv));

  const srvLines = srv.split('\n').length;
  add('server.js کوچک‌تر شد', srvLines < 4000, `${srvLines} خط`);

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  کاتالوگ مدیریتی سالم است.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
