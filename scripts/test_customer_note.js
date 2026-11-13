#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4498;
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

const MARK = 'TSTNOTE';
const SKU = 'YZD-0001-EDP-030';
let prevStock = 0;
let prevSupply = null;

function cleanup() {
  const db = new Database(DB);
  db.prepare(`DELETE FROM order_items WHERE order_id IN
    (SELECT order_id FROM orders WHERE customer_name LIKE '${MARK}%')`).run();
  db.prepare(`DELETE FROM order_status_log WHERE order_id IN
    (SELECT order_id FROM orders WHERE customer_name LIKE '${MARK}%')`).run();
  db.prepare(`DELETE FROM orders WHERE customer_name LIKE '${MARK}%'`).run();
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
}

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

const api = (p, opt = {}, tok = null) =>
  fetch(BASE + p, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: 'Bearer ' + tok } : {}),
      ...(opt.headers || {})
    }
  }).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) }));

(async () => {
  console.log('\n  آزمون یادداشت مشتری و برچسب پستی\n');
  cleanup();

  {
    const db = new Database(DB);
    prevStock = db.prepare('SELECT stock FROM variants WHERE sku=?').get(SKU).stock;
    prevSupply = db.prepare('SELECT p.id,p.supply_mode FROM products p JOIN variants v ON v.product_id=p.id WHERE v.sku=?').get(SKU);
    db.prepare('UPDATE variants SET stock=10 WHERE sku=?').run(SKU);
    db.prepare("UPDATE products SET supply_mode='IN_STOCK' WHERE id=?").run(prevSupply.id);
    db.close();
  }

  const srv = await boot();

  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    try {
      const db = new Database(DB);
      db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(prevStock, SKU);
      if (prevSupply) db.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(prevSupply.supply_mode, prevSupply.id);
      db.close();
    } catch {}
    cleanup();
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('یادداشت مشتری و برچسب درست کار می‌کنند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    const login = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: process.env.ADMIN_USERNAME || 'owner',
        password: process.env.ADMIN_PASSWORD || 'yazd1404'
      })
    });
    const TOK = login.body.token;
    add('ورود مدیر', !!TOK);
    if (!TOK) return finish();

    console.log('\n  ── یادداشت مشتری: زنجیره کامل ──');

    const NOTE = 'فاکتور رسمی لازم دارم. کادوپیچ شود.';
    const base = {
      customer_name: `${MARK} خریدار`, mobile: '09121110044',
      province: 'تهران', city: 'تهران',
      address: 'خیابان آزمایشی، کوچه دوم، پلاک ۱۰',
      postal_code: '1234509876',
      items: [{ sku: SKU, quantity: 1 }]
    };

    let oid = null;
    {
      const o = await api('/api/orders', {
        method: 'POST', body: JSON.stringify({ ...base, customer_note: NOTE })
      });
      add('ثبت سفارش با یادداشت', o.status === 201, `status ${o.status} ${o.body.error || ''}`);
      oid = o.body.order_id || o.body.order?.order_id;
      if (!oid) return finish();

      const db = new Database(DB);
      const row = db.prepare('SELECT customer_note, admin_note FROM orders WHERE order_id=?').get(oid);
      db.close();
      add('یادداشت در دیتابیس ذخیره شد', row.customer_note === NOTE, row.customer_note);

      add('از یادداشت داخلی کارکنان جداست', row.admin_note == null);
    }

    {
      const list = await api('/api/orders?limit=20', {}, TOK);
      const mine = (list.body.orders || []).find(x => x.order_id === oid);
      add('یادداشت در فهرست پنل می‌آید', mine?.customer_note === NOTE);
    }

    {
      const db = new Database(DB);
      db.prepare("UPDATE orders SET status='PAID' WHERE order_id=?").run(oid);
      db.close();
      const inv = await api(`/api/orders/${oid}/invoice`, {}, TOK);
      add('یادداشت در داده فاکتور می‌آید',
        inv.body.order?.customer_note === NOTE);
    }

    {

      const o2 = await api('/api/orders', {
        method: 'POST', body: JSON.stringify({ ...base, mobile: '09121110055' })
      });
      const oid2 = o2.body.order_id || o2.body.order?.order_id;
      const db = new Database(DB);
      const row = db.prepare('SELECT customer_note FROM orders WHERE order_id=?').get(oid2);
      db.close();
      add('سفارش بدون یادداشت، NULL می‌گیرد', row.customer_note == null);
    }

    {

      const XSS = '<img src=x onerror=alert(1)>فاکتور رسمی می‌خواهم';
      const o3 = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ ...base, mobile: '09121110066', customer_note: XSS })
      });
      const oid3 = o3.body.order_id || o3.body.order?.order_id;
      const db = new Database(DB);
      const row = db.prepare('SELECT customer_note FROM orders WHERE order_id=?').get(oid3);
      db.close();
      add('کد مخرب در یادداشت خنثی می‌شود',
        !/<img|onerror/i.test(row.customer_note || ''),
        (row.customer_note || '').slice(0, 40));
    }

    {

      const LONG = 'الف '.repeat(400);
      const o4 = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ ...base, mobile: '09121110077', customer_note: LONG })
      });
      add('یادداشت خیلی بلند رد نمی‌شود بلکه بریده می‌شود',
        o4.status === 201, `status ${o4.status}`);
      const oid4 = o4.body.order_id || o4.body.order?.order_id;
      if (oid4) {
        const db = new Database(DB);
        const row = db.prepare('SELECT customer_note FROM orders WHERE order_id=?').get(oid4);
        db.close();
        add('طول یادداشت به ۵۰۰ محدود شد',
          (row.customer_note || '').length <= 500, `${(row.customer_note || '').length} نویسه`);
      }
    }

    console.log('\n  ── برچسب پستی ──');

    {
      const lab = fs.readFileSync(path.join(ROOT, 'public/label.html'), 'utf8');
      add('کد رهگیری از برچسب حذف شد', !/tracking_code/.test(lab));
      add('بارکد همیشه شماره سفارش است', /const code = o\.order_id/.test(lab));
      add('برچسب توضیح کاربرد بارکد را می‌دهد', /اسکن در انبار/.test(lab));
      add('نام تحویل‌گیرنده روی برچسب می‌آید', /sender_person/.test(lab));
      add('نشانی فرستنده می‌ماند', /st\.address/.test(lab));
      add('کد پستی فرستنده می‌ماند', /st\.postal_code/.test(lab));
    }

    {
      const inv = fs.readFileSync(path.join(ROOT, 'public/invoice.html'), 'utf8');
      add('کد رهگیری از فاکتور هم حذف شد',
        !/o\.tracking_code \? `<div class="row"><b>کد رهگیری/.test(inv));
      add('یادداشت مشتری روی فاکتور چاپ می‌شود', /cust-note-box/.test(inv));
    }

    console.log('\n  ── کد رهگیری فقط داخلی ──');

    {

      const TRK = 'TSTTRK123456789';
      await api(`/api/orders/${oid}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'PROCESSING' })
      }, TOK);
      const up = await api(`/api/orders/${oid}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'SHIPPED', tracking_code: TRK })
      }, TOK);
      add('ثبت کد رهگیری در پنل کار می‌کند',
        up.status === 200, `status ${up.status} ${up.body.error || ''}`);

      const db = new Database(DB);
      const row = db.prepare('SELECT tracking_code FROM orders WHERE order_id=?').get(oid);
      db.close();
      add('کد رهگیری در دیتابیس ذخیره شد', row.tracking_code === TRK, row.tracking_code);

      const trk = fs.readFileSync(path.join(ROOT, 'public/track.html'), 'utf8');
      add('صفحه پیگیری مشتری کد رهگیری را نشان می‌دهد',
        /tracking_code/.test(trk));
    }

    console.log('\n  ── اطلاعات تماس واقعی ──');

    {
      const ci = await api('/api/contact-info');
      add('شماره موبایل ثبت شده', /^09\d{9}$/.test(ci.body.phone || ''), ci.body.phone);
      add('پرچم واتس‌اپ فعال است', ci.body.phone_whatsapp === true);
      add('نشانی واقعی ثبت شده',
        (ci.body.address || '').includes('قیام'), ci.body.address);
      add('کد پستی ۱۰ رقمی ثبت شده',
        /^\d{10}$/.test(ci.body.postal_code || ''), ci.body.postal_code);
    }

    {
      const app = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
      add('فوتر لینک واتس‌اپ دارد', /wa\.me\/98/.test(app));

      add('صفر ابتدایی با کد کشور جایگزین می‌شود', /digits\.slice\(1\)/.test(app));
      add('لینک واتس‌اپ فقط برای موبایل ساخته می‌شود',
        /\^09\\\\d\{9\}\$|isMobile/.test(app));
    }

    console.log('\n  ── رابط تسویه و پنل ──');

    {
      const chk = fs.readFileSync(path.join(ROOT, 'public/checkout.html'), 'utf8');
      add('فیلد یادداشت در فرم تسویه هست', /id="fNote"/.test(chk));
      add('یادداشت به سرور فرستاده می‌شود', /customer_note:/.test(chk));
      add('اختیاری بودنش گفته شده', /توضیحات سفارش[\s\S]{0,120}اختیاری/.test(chk));
      add('نمونه کاربرد داده شده (فاکتور رسمی)', /فاکتور رسمی/.test(chk));
      add('شمارنده نویسه دارد', /noteCount/.test(chk));

      const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
      add('پنل یادداشت را در جدول نشان می‌دهد', /cust-note/.test(adm));
      add('یادداشت در پنل برجسته است (استایل جدا)', /\.cust-note \{/.test(adm));
      add('فیلد نام تحویل‌گیرنده در تنظیمات هست', /sPerson/.test(adm));
    }

  } catch (e) {
    add('اجرای آزمون بدون خطای غیرمنتظره', false, e.message);
  }

  finish();
})();
