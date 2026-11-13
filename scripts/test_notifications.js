#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { makeStaff, cleanupStaff } = require('./lib/test_staff');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4425;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const USERS = ['n_wh', 'n_sup', 'n_ed', 'n_fresh'];

function cleanup() {
  const db = new Database(DB);
  cleanupStaff(db, USERS);
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

const login = (u, p) =>
  api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });

(async () => {
  console.log('\n  آزمون اعلان‌های پنل\n');
  cleanup();
  const srv = await boot();
  const db = new Database(DB);

  const checks = [];
  const add = (label, ok, note) => {
    console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
    checks.push(ok);
  };
  const finish = (aborted) => {
    try { srv.kill('SIGKILL'); } catch {}
    try { db.close(); } catch {}
    cleanup();
    const failed = checks.filter(x => !x).length;
    console.log();
    if (aborted) { console.log(r('  آزمون نیمه‌کاره رها شد.\n')); process.exit(1); }
    console.log(failed === 0
      ? g('  اعلان‌ها سالم‌اند.\n')
      : r(`  ${failed} بررسی ناموفق.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  const ol = await login(process.env.ADMIN_USERNAME || 'owner',
                         process.env.ADMIN_PASSWORD || 'yazd1404');
  if (!ol.json.token) {
    console.error(r('  ورود مدیر کل ناموفق: ' + JSON.stringify(ol.json)));
    return finish(true);
  }
  const OWNER = ol.json.token;

  console.log(d('  کنترل دسترسی'));

  const anon = await api('/api/admin/notifications');
  add('بدون ورود ۴۰۱ می‌گیرد', anon.status === 401, `کد ${anon.status}`);

  const ownerN = await api('/api/admin/notifications', {}, OWNER);
  add('مدیر کل اعلان می‌گیرد', ownerN.status === 200, `کد ${ownerN.status}`);
  add('پاسخ ساختار درست دارد',
      Array.isArray(ownerN.json.items) &&
      typeof ownerN.json.total === 'number' &&
      typeof ownerN.json.urgent === 'boolean');

  console.log(d('\n  تفکیک بر اساس نقش'));

  const WH  = (await makeStaff(api, OWNER, 'n_wh', 'warehouse')).token;
  const SUP = (await makeStaff(api, OWNER, 'n_sup', 'support')).token;
  const ED  = (await makeStaff(api, OWNER, 'n_ed', 'editor')).token;

  if (!WH || !SUP || !ED) {
    console.error(r('  ساخت کارکنان آزمایشی ناموفق'));
    return finish(true);
  }

  const keysOf = j => (j.items || []).map(x => x.key);

  const whN = await api('/api/admin/notifications', {}, WH);
  const supN = await api('/api/admin/notifications', {}, SUP);
  const edN = await api('/api/admin/notifications', {}, ED);

  add('انباردار اعلان تیکت نمی‌بیند',
      !keysOf(whN.json).some(k => k.startsWith('tickets')),
      keysOf(whN.json).join('، ') || 'هیچ');
  add('انباردار اعلان نظر نمی‌بیند',
      !keysOf(whN.json).includes('reviews'));

  add('پشتیبان اعلان موجودی نمی‌بیند',
      !keysOf(supN.json).some(k => k.includes('stock')),
      keysOf(supN.json).join('، ') || 'هیچ');

  add('محتوانویس اعلان سفارش نمی‌بیند',
      !keysOf(edN.json).includes('orders'),
      keysOf(edN.json).join('، ') || 'هیچ');
  add('محتوانویس اعلان تیکت نمی‌بیند',
      !keysOf(edN.json).some(k => k.startsWith('tickets')));

  for (const [name, res] of [['انباردار', whN], ['پشتیبان', supN], ['محتوانویس', edN]]) {
    if (keysOf(res.json).includes('errors')) {
      add(`${name} خطای سیستم نمی‌بیند`, false);
    }
  }
  add('هیچ نقش میانی خطای سیستم نمی‌بیند',
      ![whN, supN, edN].some(x => keysOf(x.json).includes('errors')));

  console.log(d('\n  صحت شمارش‌ها'));

  const realOrders = db.prepare(
    "SELECT COUNT(*) n FROM orders WHERE status IN ('PAID','PROCESSING')"
  ).get().n;
  const notifOrders = (ownerN.json.items || []).find(x => x.key === 'orders');
  add('شمارش سفارش با دیتابیس می‌خواند',
      (notifOrders ? notifOrders.count : 0) === realOrders,
      `${notifOrders ? notifOrders.count : 0} در برابر ${realOrders}`);

  const realTickets = db.prepare(
    "SELECT COUNT(*) n FROM tickets WHERE status != 'CLOSED'"
  ).get().n;
  const notifTickets = (ownerN.json.items || []).find(x => x.key === 'tickets');
  add('شمارش تیکت با دیتابیس می‌خواند',
      (notifTickets ? notifTickets.count : 0) === realTickets,
      `${notifTickets ? notifTickets.count : 0} در برابر ${realTickets}`);

  add('total برابر جمع اقلام است',
      ownerN.json.total === (ownerN.json.items || []).reduce((s, x) => s + x.count, 0));

  add('هیچ قلمی با شمارش صفر فرستاده نمی‌شود',
      (ownerN.json.items || []).every(x => x.count > 0));

  console.log(d('\n  علامت‌گذاری کار فوری'));

  const hasUrgentItem = (ownerN.json.items || []).some(x => x.urgent);
  add('پرچم urgent با اقلام هم‌خوان است',
      ownerN.json.urgent === hasUrgentItem,
      `urgent=${ownerN.json.urgent}`);

  const lateT = db.prepare(`
    SELECT COUNT(*) n FROM tickets
    WHERE status != 'CLOSED' AND sla_deadline IS NOT NULL
      AND sla_deadline < datetime('now')
  `).get().n;
  const notifLate = (ownerN.json.items || []).find(x => x.key === 'tickets_late');
  if (lateT > 0) {
    add('تیکت از مهلت گذشته فوری علامت می‌خورد',
        !!notifLate && notifLate.urgent === true, `${lateT} تیکت`);
  } else {
    add('بدون تیکت دیرکرد، قلم تیکت_دیرکرد نیست', !notifLate);
  }

  console.log(d('\n  هشدار آمادگی افتتاح'));

  const settingsRow = db.prepare(
    "SELECT value FROM settings WHERE key='postal_code'"
  ).get();
  const savedNid = settingsRow ? settingsRow.value : '';

  db.prepare("UPDATE settings SET value='' WHERE key='postal_code'").run();

  const withGap = await api('/api/admin/notifications', {}, OWNER);
  const legalItem = (withGap.json.items || []).find(x => x.key === 'legal_incomplete');
  add('نقص اطلاعات تماس هشدار می‌دهد', !!legalItem,
      legalItem ? legalItem.label : 'هشداری نیامد');
  add('این هشدار فوری علامت می‌خورد', legalItem?.urgent === true);
  add('هشدار به تب تنظیمات اشاره می‌کند', legalItem?.tab === 'settings');
  add('هشدار به الزام اینماد اشاره می‌کند',
      /اینماد/.test(legalItem?.label || ''));

  {
    const keep = {};
    for (const k of ['legal_name', 'economic_code', 'national_id', 'register_no']) {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
      keep[k] = row ? row.value : null;
      db.prepare('DELETE FROM settings WHERE key=?').run(k);
    }

    db.prepare("UPDATE settings SET value=? WHERE key='postal_code'").run(savedNid);

    const onlyLegalGone = await api('/api/admin/notifications', {}, OWNER);
    add('نبودِ اطلاعات حقوقی هشدار نمی‌سازد (اختیاری است)',
        !(onlyLegalGone.json.items || []).some(x => x.key === 'legal_incomplete'));

    for (const [k, v] of Object.entries(keep)) {
      if (v !== null) {
        db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(k, v);
      }
    }
    db.prepare("UPDATE settings SET value='' WHERE key='postal_code'").run();
  }

  const whGap = await api('/api/admin/notifications', {}, WH);
  add('انباردار هشدار تنظیمات نمی‌بیند',
      !(whGap.json.items || []).some(x => x.key === 'legal_incomplete'));

  db.prepare("UPDATE settings SET value=? WHERE key='postal_code'").run(savedNid);

  const afterFix = await api('/api/admin/notifications', {}, OWNER);
  add('با تکمیل اطلاعات تماس، هشدار برداشته می‌شود',
      !(afterFix.json.items || []).some(x => x.key === 'legal_incomplete'));

  console.log(d('\n  حساب با رمز اولیه'));

  const { nidFor, mobileFor } = require('./lib/test_staff');
  const freshNid = nidFor('n_fresh');
  const freshMobile = mobileFor('n_fresh');

  const createdFresh = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'تازه', last_name: 'وارد',
      national_id: freshNid, mobile: freshMobile, role_key: 'warehouse'
    })
  }, OWNER);
  const fresh = (await login(freshNid, createdFresh.json.temp_password)).json.token;
  if (fresh) {
    const fn = await api('/api/admin/notifications', {}, fresh);
    add('حساب با رمز اولیه اعلان نمی‌گیرد', fn.status === 403, `کد ${fn.status}`);
  } else {
    add('ساخت حساب رمز اولیه', false);
  }

  finish();
})();
