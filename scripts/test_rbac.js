#!/usr/bin/env node
/**
 * آزمون نقش‌ها و مجوزها (RBAC).
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) هر نقش فقط به کارهای مجازش دسترسی دارد
 *   ۲) تلاش بدون مجوز ۴۰۳ می‌گیرد و در سابقه ثبت می‌شود
 *   ۳) کارمند نمی‌تواند خودش را ارتقا دهد
 *   ۴) آخرین مدیر کل حذف یا غیرفعال نمی‌شود
 *   ۵) تغییر نقش بلافاصله اثر می‌کند (بدون ورود دوباره)
 *   ۶) غیرفعال کردن حساب فوراً دسترسی را قطع می‌کند
 *   ۷) رمز با scrypt هش می‌شود و در پاسخ‌ها لو نمی‌رود
 *
 * اجرا: node scripts/test_rbac.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { makeStaff, cleanupStaff, nidFor, mobileFor } = require('./lib/test_staff');
const { withStock } = require('./lib/test_stock');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4413;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const TEST_USERS = ['t_support', 't_wh', 't_editor', 't_extra', 't_sup2'];

function cleanup() {
  const db = new Database(DB);
  cleanupStaff(db, TEST_USERS);
  db.prepare("DELETE FROM roles WHERE key='t_custom'").run();
  db.prepare('DELETE FROM rate_limits').run();
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

const api = (p, opt = {}, token = null) =>
  fetch(BASE + p, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opt.headers || {})
    }
  }).then(async res => ({ status: res.status, json: await res.json().catch(() => ({})) }));

const login = (username, password) =>
  api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) });

(async () => {
  console.log('\n  آزمون نقش‌ها و مجوزها\n');
  cleanup();

  const srv = await boot();
  // First catalog result must be a sellable fixture, not a newly sourced draft.
  const stockLease = withStock(DB, 4, 20);
  const checks = [];
  const add = (label, pass) => {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}`);
    checks.push(pass);
  };
  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    try { stockLease.restore(); } catch {}
    cleanup();
    const failed = checks.filter(x => !x).length;
    console.log();
    console.log(failed === 0
      ? g('  سامانه نقش‌ها درست کار می‌کند.\n')
      : r(`  ${failed} بررسی ناموفق.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  // ══ ورود مدیر کل ══
  const ownerLogin = await login(process.env.ADMIN_USERNAME || 'owner',
                                 process.env.ADMIN_PASSWORD || 'yazd1404');
  if (!ownerLogin.json.token) {
    console.error(r('  ✗ ورود مدیر کل ناموفق: ' + JSON.stringify(ownerLogin.json)));
    return finish();
  }
  const OWNER = ownerLogin.json.token;
  console.log(d(`  مدیر کل وارد شد · ${ownerLogin.json.user.permissions.length} مجوز\n`));
  add('مدیر کل همه مجوزها را دارد', ownerLogin.json.user.permissions.length >= 30);
  add('رمز در پاسخ ورود لو نمی‌رود',
    !JSON.stringify(ownerLogin.json).match(/pass_hash|pass_salt/));

  // ══ ساخت کارکنان آزمایشی ══
  console.log(d('\n  ساخت کارکنان با نقش‌های مختلف'));
  /* makeStaff کل چرخه را انجام می‌دهد: ساخت با کد ملی، ورود با
     رمز موقت (موبایل بدون صفر)، و تغییر اجباری رمز. */
  const s1 = await makeStaff(api, OWNER, 't_support', 'support');
  const s2 = await makeStaff(api, OWNER, 't_wh', 'warehouse');
  const s3 = await makeStaff(api, OWNER, 't_editor', 'editor');
  const s4 = await makeStaff(api, OWNER, 't_sup2', 'support');
  add('کارمند ساخته می‌شود', !!(s1.token && s2.token && s3.token));

  // کد ملی تکراری باید رد شود
  const dup = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'تکراری', last_name: 'آزمایشی',
      national_id: s1.nid, mobile: '09120001111', role_key: 'support'
    })
  }, OWNER);
  add('کد ملی تکراری رد می‌شود', dup.status === 409);

  const weak = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'x', last_name: 'y', national_id: '123',
      mobile: '09120002222', role_key: 'support'
    })
  }, OWNER);
  add('کد ملی کوتاه رد می‌شود', weak.status === 400);

  const sup = s1.token, wh = s2.token, ed = s3.token, sup2 = s4.token;
  add('کارکنان می‌توانند وارد شوند', !!(sup && wh && ed));

  const wrongPass = await login(s1.nid, 'wrongpass');
  add('رمز نادرست رد می‌شود', wrongPass.status === 401);

  // ══ مجوزها ══
  console.log(d('\n  بررسی مرزهای دسترسی'));

  const supOrders = await api('/api/orders', {}, sup);
  add('پشتیبان سفارش‌ها را می‌بیند', supOrders.status === 200);

  const supReports = await api('/api/admin/reports', {}, sup);
  add('پشتیبان گزارش فروش را نمی‌بیند (۴۰۳)', supReports.status === 403);

  const supPrice = await api('/api/admin/variants/YZD-0001-EDP-010', {
    method: 'PUT', body: JSON.stringify({ price_toman: 1 })
  }, sup);
  add('پشتیبان قیمت را عوض نمی‌کند (۴۰۳)', supPrice.status === 403);

  const whStock = await api('/api/admin/variants/YZD-0001-EDP-010', {
    method: 'PUT', body: JSON.stringify({ stock: 42 })
  }, wh);
  add('انباردار موجودی را عوض می‌کند', whStock.status === 200);

  const whExport = await api('/api/admin/export/csv', {}, wh);
  add('انباردار خروجی CSV نمی‌گیرد (۴۰۳)', whExport.status === 403);

  const edOrders = await api('/api/orders', {}, ed);
  add('محتوانویس سفارش‌ها را نمی‌بیند (۴۰۳)', edOrders.status === 403);

  const edArticle = await api('/api/articles', {
    method: 'POST',
    body: JSON.stringify({ title: 'مقاله آزمایشی نقش', category: 'guide',
                           excerpt: 'خلاصه', content: 'متن آزمایشی' })
  }, ed);
  add('محتوانویس مقاله می‌نویسد', edArticle.status === 201);
  if (edArticle.json.id || edArticle.json.slug) {
    const dbx = new Database(DB);
    dbx.prepare('DELETE FROM articles WHERE title=?').run('مقاله آزمایشی نقش');
    dbx.close();
  }

  // ══ یک مسیر، چند عمل با مجوز متفاوت ══
  console.log(d('\n  تفکیک عملیات درون یک مسیر'));

  /* این‌ها حفره‌های واقعی بودند: مسیر ویرایش کالا فقط
     products.stock را می‌سنجید، پس انباردار می‌توانست قیمت را هم
     عوض کند. مسیر تغییر وضعیت فقط orders.status را می‌سنجید، پس
     پشتیبان می‌توانست سفارش را لغو کند. */
  const catalog = await (await fetch(`${BASE}/api/products?limit=1&full=1`)).json();
  const sku = catalog.products[0].variants[0].sku;
  const priceBefore = catalog.products[0].variants[0].price_toman;

  const whPrice = await api(`/api/admin/variants/${encodeURIComponent(sku)}`, {
    method: 'PUT', body: JSON.stringify({ price_toman: 1 })
  }, wh);
  const dbP = new Database(DB, { readonly: true });
  const priceAfter = dbP.prepare('SELECT price_toman FROM variants WHERE sku=?').get(sku).price_toman;
  dbP.close();
  add('انباردار قیمت را عوض نمی‌کند (۴۰۳)',
    whPrice.status === 403 && priceAfter === priceBefore);

  if (priceAfter !== priceBefore) {
    const fix = new Database(DB);
    fix.prepare('UPDATE variants SET price_toman=? WHERE sku=?').run(priceBefore, sku);
    fix.close();
  }

  const whStockOnly = await api(`/api/admin/variants/${encodeURIComponent(sku)}`, {
    method: 'PUT', body: JSON.stringify({ stock: 77 })
  }, wh);
  add('انباردار موجودی را عوض می‌کند (بدون قیمت)', whStockOnly.status === 200);

  // پشتیبان: پیشبرد بله، لغو خیر
  const testOrder = await api('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'rbac_order', mobile: '09121118888',
      province: 'یزد', city: 'یزد',
      address: 'نشانی آزمایشی برای بررسی تفکیک مجوز',
      items: [{ sku, quantity: 1 }]
    })
  });
  const oid = testOrder.json.order_id;

  if (oid) {
    const supCancel = await api(`/api/orders/${oid}/status`, {
      method: 'PUT', body: JSON.stringify({ status: 'CANCELLED' })
    }, sup2);
    add('پشتیبان سفارش را لغو نمی‌کند (۴۰۳)', supCancel.status === 403);

    // پرداخت تا بتوان وضعیت را جلو برد
    await api('/api/payment/verify', {
      method: 'POST',
      body: JSON.stringify({ order_id: oid, authority: 'x', result: 'success' })
    });
    const supAdvance = await api(`/api/orders/${oid}/status`, {
      method: 'PUT', body: JSON.stringify({ status: 'PROCESSING' })
    }, sup2);
    add('پشتیبان وضعیت را جلو می‌برد', supAdvance.status === 200);

    const ownerCancel = await api(`/api/orders/${oid}/status`, {
      method: 'PUT', body: JSON.stringify({ status: 'CANCELLED' })
    }, OWNER);
    add('مدیر کل می‌تواند لغو کند', ownerCancel.status === 200);

    const dbo = new Database(DB);
    dbo.prepare('DELETE FROM order_status_log WHERE order_id=?').run(oid);
    dbo.prepare('DELETE FROM order_items WHERE order_id=?').run(oid);
    dbo.prepare('DELETE FROM orders WHERE order_id=?').run(oid);
    dbo.close();
  }

  // فاکتور: محتوانویس نباید نشانی مشتریان را ببیند
  const anyOrder = await api('/api/orders', {}, OWNER);
  const someOid = (anyOrder.json.orders || [])[0]?.order_id;
  if (someOid) {
    const edInvoice = await api(`/api/orders/${someOid}/invoice`, {}, ed);
    add('محتوانویس فاکتور را نمی‌بیند (۴۰۳)', edInvoice.status === 403);
    const supInvoice = await api(`/api/orders/${someOid}/invoice`, {}, sup2);
    add('پشتیبان فاکتور را می‌بیند', supInvoice.status === 200);
  }

  // ══ جلوگیری از ارتقای خود ══
  console.log(d('\n  جلوگیری از ارتقای دسترسی'));

  const supMakeStaff = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({ national_id: '6939636187', display_name: 'x',
                           role_key: 'owner', password: 'testpass123' })
  }, sup);
  add('پشتیبان کارمند اضافه نمی‌کند (۴۰۳)', supMakeStaff.status === 403);

  const supMakeRole = await api('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify({ key: 't_custom', name: 'نقش دزدی',
                           permissions: ['roles.manage'] })
  }, sup);
  add('پشتیبان نقش نمی‌سازد (۴۰۳)', supMakeRole.status === 403);

  // ══ نقش سفارشی ══
  console.log(d('\n  نقش سفارشی'));
  const newRole = await api('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify({
      key: 't_custom', name: 'ناظر گزارش',
      description: 'فقط گزارش‌ها را می‌بیند',
      permissions: ['reports.sales', 'reports.stock', 'orders.view']
    })
  }, OWNER);
  add('مدیر کل نقش سفارشی می‌سازد', newRole.status === 201);

  const badRole = await api('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify({ key: 't_bad', name: 'x', permissions: ['fake.permission'] })
  }, OWNER);
  add('مجوز ناشناخته رد می‌شود', badRole.status === 400);

  const lockOwner = await api('/api/admin/roles/owner', {
    method: 'PUT', body: JSON.stringify({ permissions: ['orders.view'] })
  }, OWNER);
  add('مجوزهای مدیر کل قفل است (۴۰۳)', lockOwner.status === 403);

  // ══ تغییر نقش بلافاصله اثر کند ══
  console.log(d('\n  اثر فوری تغییرات'));
  const supId = (await api('/api/admin/staff', {}, OWNER))
    .json.staff.find(x => x.username === nidFor('t_support')).id;

  await api(`/api/admin/staff/${supId}`, {
    method: 'PUT', body: JSON.stringify({ role_key: 't_custom' })
  }, OWNER);

  const afterRoleChange = await api('/api/admin/reports', {}, sup);
  add('تغییر نقش بدون ورود دوباره اثر می‌کند', afterRoleChange.status === 200);

  // ══ غیرفعال کردن ══
  await api(`/api/admin/staff/${supId}`, {
    method: 'PUT', body: JSON.stringify({ active: false })
  }, OWNER);
  const afterDisable = await api('/api/orders', {}, sup);
  add('غیرفعال کردن فوراً دسترسی را قطع می‌کند', afterDisable.status === 401);

  // ══ محافظت از آخرین مدیر کل ══
  console.log(d('\n  محافظت از مدیر کل'));
  const ownerId = (await api('/api/admin/staff', {}, OWNER))
    .json.staff.find(x => x.role_key === 'owner').id;

  const selfDisable = await api(`/api/admin/staff/${ownerId}`, {
    method: 'PUT', body: JSON.stringify({ active: false })
  }, OWNER);
  add('مدیر کل خودش را غیرفعال نمی‌کند', selfDisable.status >= 400);

  const selfDelete = await api(`/api/admin/staff/${ownerId}`, { method: 'DELETE' }, OWNER);
  add('مدیر کل خودش را حذف نمی‌کند', selfDelete.status >= 400);

  const roleInUse = await api('/api/admin/roles/t_custom', { method: 'DELETE' }, OWNER);
  add('نقش در حال استفاده حذف نمی‌شود (۴۰۹)', roleInUse.status === 409);

  const builtinDel = await api('/api/admin/roles/support', { method: 'DELETE' }, OWNER);
  add('نقش پیش‌فرض حذف نمی‌شود (۴۰۳)', builtinDel.status === 403);

  // ══ سابقه ══
  console.log(d('\n  سابقه کارها'));
  const audit = await api('/api/admin/audit?limit=200', {}, OWNER);
  const entries = audit.json.entries || [];
  add('سابقه ثبت می‌شود', entries.length > 0);

  const denied = entries.filter(e => e.allowed === 0);
  add('تلاش‌های رد شده هم ثبت می‌شوند', denied.length >= 4);

  /* نام کاربری حالا کد ملی است، پس پیشوند 't_' دیگر معنا ندارد.
     بررسی می‌کنیم کد ملی کارکنان آزمایشی در سابقه باشد. */
  const testNids = TEST_USERS.map(nidFor);
  const hasUser = entries.some(e => e.username && testNids.includes(e.username));
  add('نام کارمند در سابقه هست', hasUser);

  const viewLogged = entries.some(e => e.action === 'orders.view');
  add('حتی مشاهده هم ثبت می‌شود', viewLogged);

  // ══ رمز در دیتابیس ══
  const dbc = new Database(DB, { readonly: true });
  const row = dbc.prepare('SELECT pass_hash, pass_salt FROM staff WHERE username=?')
    .get(nidFor('t_wh'));
  dbc.close();
  add('رمز به شکل خام ذخیره نمی‌شود',
    row && row.pass_hash.length === 128 && !row.pass_hash.includes('testpass'));

  const staffList = await api('/api/admin/staff', {}, OWNER);
  add('هش رمز در API لو نمی‌رود',
    !JSON.stringify(staffList.json).match(/pass_hash|pass_salt/));

  finish();
})();
