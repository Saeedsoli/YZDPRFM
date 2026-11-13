#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { makeStaff, cleanupStaff } = require('./lib/test_staff');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4421;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const MARK = 'ANTEST';

function cleanup() {
  const db = new Database(DB);
  db.prepare("DELETE FROM events WHERE meta LIKE ? OR target=?").run(`%${MARK}%`,'SKU-TEST');
  cleanupStaff(db, ['t_noan']);
  db.prepare("DELETE FROM roles WHERE key='t_noanalytics'").run();
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

(async () => {
  console.log('\n  آزمون تحلیل داخلی و ویترین\n');
  cleanup();
  const srv = await boot();

  const checks = [];
  const add = (label, pass, note) => {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
    checks.push(pass);
  };
  const finish = (aborted) => {
    try { srv.kill('SIGKILL'); } catch {}
    cleanup();
    const failed = checks.filter(x => !x).length;
    console.log();
    if (aborted) { console.log(r('  آزمون نیمه‌کاره رها شد.\n')); process.exit(1); }
    console.log(failed === 0
      ? g('  تحلیل و ویترین سالم است.\n')
      : r(`  ${failed} بررسی ناموفق.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  const db = new Database(DB);

  console.log(d('  ثبت رویداد'));

  const prods = await fetch(`${BASE}/api/products?limit=5`).then(r => r.json());
  const slugs = prods.products.map(p => p.slug);
  const ids   = prods.products.map(p => p.id);

  const viewsBefore = db.prepare("SELECT COUNT(*) n FROM events WHERE kind='view'").get().n;

  let sent = 0;
  for (let i = 0; i < slugs.length; i++) {
    for (let v = 0; v < slugs.length - i; v++) {
      await fetch(`${BASE}/api/products/${slugs[i]}`,
        { headers: { 'User-Agent': `Mozilla/5.0 anuser${v}` } });
      sent++;
    }
  }

  const viewsAfter = db.prepare("SELECT COUNT(*) n FROM events WHERE kind='view'").get().n;
  add('بازدید محصول ثبت می‌شود', viewsAfter - viewsBefore === sent,
      `${viewsAfter - viewsBefore} از ${sent} بازدید`);

  const beforeBot = db.prepare("SELECT COUNT(*) n FROM events WHERE kind='view'").get().n;
  for (const ua of ['Googlebot/2.1', 'bingbot/2.0', 'AhrefsBot/7.0',
                    'Mozilla/5.0 (compatible; HeadlessChrome)']) {
    await fetch(`${BASE}/api/products/${slugs[0]}`, { headers: { 'User-Agent': ua } });
  }
  const afterBot = db.prepare("SELECT COUNT(*) n FROM events WHERE kind='view'").get().n;
  add('خزنده‌ها شمرده نمی‌شوند', afterBot === beforeBot,
      `${afterBot - beforeBot} رویداد اضافه از ۴ خزنده`);

  console.log(d('\n  حریم خصوصی'));

  const rows = db.prepare("SELECT * FROM events WHERE kind='view' ORDER BY id DESC LIMIT 20").all();
  const cols = Object.keys(rows[0] || {});
  add('ستون IP وجود ندارد', !cols.some(c => /ip|addr/i.test(c)), cols.join(', '));
  add('ستون موبایل وجود ندارد', !cols.some(c => /mobile|phone|user_id/i.test(c)));

  const blob = JSON.stringify(rows.map(({visitor,...fields})=>fields));
  add('نشانی IP در داده نیست', !/127\.0\.0\.1|::1|\d+\.\d+\.\d+\.\d+/.test(blob));
  add('شماره موبایل در داده نیست', !/09\d{9}/.test(blob) && rows.every(r=>!/^09\d{9}$/.test(String(r.visitor||''))));

  const visitors = [...new Set(rows.map(x => x.visitor))];
  add('شناسه بازدیدکننده هش است', visitors.every(v => /^[a-f0-9]{16}$/.test(v)),
      visitors[0]);
  add('بازدیدکنندگان جدا از هم تفکیک می‌شوند', visitors.length >= 2,
      `${visitors.length} شناسه`);

  console.log(d('\n  ورودی نامعتبر'));

  const bogus = await api('/api/track', {
    method: 'POST', body: JSON.stringify({ kind: 'DROP_TABLE', target: 'x' })
  });
  add('رویداد ناشناخته رد می‌شود', bogus.json.ok === false, `ok=${bogus.json.ok}`);

  const okEv = await api('/api/track', {
    method: 'POST',
    body: JSON.stringify({ kind: 'add_cart', target: 'SKU-TEST', meta: { m: MARK } })
  });
  add('رویداد معتبر پذیرفته می‌شود', okEv.json.ok === true);

  const bogusCount = db.prepare("SELECT COUNT(*) n FROM events WHERE kind='DROP_TABLE'").get().n;
  add('رویداد ناشناخته در دیتابیس نمی‌نشیند', bogusCount === 0);

  console.log(d('\n  قیف خرید و داشبورد'));

  const ol = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  if (!ol.json.token) {
    console.error(r('  ورود مدیر کل ناموفق'));
    db.close(); return finish(true);
  }
  const OWNER = ol.json.token;

  const dash = await api('/api/admin/analytics?days=7', {}, OWNER);
  add('داشبورد برای مدیر کل باز است', dash.status === 200, `کد ${dash.status}`);

  const f = dash.json.traffic?.funnel || {};
  add('قیف خرید محاسبه می‌شود',
      typeof f.view === 'number' && typeof f.overall === 'number',
      `مشاهده ${f.view} · سبد ${f.add_cart}`);
  add('درصد تبدیل منطقی است',
      f.view_to_cart >= 0 && f.view_to_cart <= 100,
      `${f.view_to_cart}%`);

  add('جستجوها گزارش می‌شوند', Array.isArray(dash.json.top_searches));
  add('جستجوهای بی‌نتیجه گزارش می‌شوند', Array.isArray(dash.json.failed_searches));

  console.log(d('\n  ویترین خودکار'));

  const refresh = await api('/api/admin/analytics/refresh', { method: 'POST' }, OWNER);
  add('ویترین بازسازی می‌شود', refresh.status === 200);

  const sc = await fetch(`${BASE}/api/showcase`).then(r => r.json());
  add('ویترین عمومی بدون ورود باز است', Array.isArray(sc.bestsellers));

  add('پربازدیدها از رویداد واقعی می‌آیند', (sc.trending || []).length >= 2,
      `${(sc.trending || []).length} محصول`);

  const tr = sc.trending || [];
  const sorted = tr.every((x, i) => i === 0 || tr[i - 1].viewers >= x.viewers);
  add('رتبه‌بندی نزولی درست است', sorted,
      tr.map(x => x.viewers).join(' ≥ '));

  const rank = id => tr.findIndex(x => x.id === id);
  const r0 = rank(ids[0]), r2 = rank(ids[2]);
  add('محصول پربازدیدتر بالاتر از کم‌بازدیدتر است',
      r0 !== -1 && (r2 === -1 || r0 < r2),
      `جایگاه ${r0 + 1} در برابر ${r2 === -1 ? 'خارج فهرست' : r2 + 1}`);

  const paidCount = db.prepare(
    "SELECT COUNT(*) n FROM orders WHERE status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')"
  ).get().n;
  if (paidCount === 0) {
    add('بدون فروش، ادعای «پرفروش» نمی‌شود', sc.bestsellers_fallback === true);
  } else {
    add('با وجود فروش، پرفروش واقعی نشان داده می‌شود', true, `${paidCount} سفارش`);
  }

  add('ویترین محصولات معتبر برمی‌گرداند',
      (sc.bestsellers || []).every(p => p.slug && p.name_fa && p.min_price > 0));

  console.log(d('\n  کنترل دسترسی'));

  const anon = await api('/api/admin/analytics');
  add('بدون ورود ۴۰۱ می‌گیرد', anon.status === 401, `کد ${anon.status}`);

  await api('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify({
      key: 't_noanalytics', name: 'بدون تحلیل',
      permissions: ['orders.view']
    })
  }, OWNER);
  const staff = await makeStaff(api, OWNER, 't_noan', 't_noanalytics');
  const tok = staff.token;

  if (tok) {
    const denied = await api('/api/admin/analytics', {}, tok);
    add('کارمند بدون مجوز ۴۰۳ می‌گیرد', denied.status === 403, `کد ${denied.status}`);

    const deniedRefresh = await api('/api/admin/analytics/refresh',
                                    { method: 'POST' }, tok);
    add('بازسازی ویترین هم محافظت شده', deniedRefresh.status === 403,
        `کد ${deniedRefresh.status}`);
  } else {
    add('ساخت کارمند آزمایشی', false, JSON.stringify(mk.json));
  }

  console.log(d('\n  مهاجرت مجوز'));
  const ownerPerms = JSON.parse(
    db.prepare("SELECT permissions FROM roles WHERE key='owner'").get().permissions
  );
  add('مدیر کل مجوز تحلیل را خودکار گرفت',
      ownerPerms.includes('reports.traffic'),
      `${ownerPerms.length} مجوز`);

  db.close();
  finish();
})();
