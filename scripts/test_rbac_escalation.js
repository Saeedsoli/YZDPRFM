#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { makeStaff, cleanupStaff, nidFor, mobileFor } = require('./lib/test_staff');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4415;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const TEST_USERS = ['t_hr', 't_rm', 't_owner2', 't_fresh'];
const TEST_ROLES = ['t_hrrole', 't_rmrole', 't_weak'];

function cleanup() {
  const db = new Database(DB);
  cleanupStaff(db, TEST_USERS);
  for (const k of TEST_ROLES) db.prepare('DELETE FROM roles WHERE key=?').run(k);
  db.prepare('DELETE FROM rate_limits').run();
  db.close();

  const { db: liveDb, hashPassword } = require('../src/db');
  const { hash, salt } = hashPassword(process.env.ADMIN_PASSWORD || 'yazd1404');
  liveDb.prepare(
    'UPDATE staff SET pass_hash=?, pass_salt=?, must_change=0, active=1 WHERE username=?'
  ).run(hash, salt, process.env.ADMIN_USERNAME || 'owner');
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
  console.log('\n  آزمون نفوذ: ارتقای خودخواسته کارکنان\n');
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

    if (aborted) {
      console.log(r('  آزمون نیمه‌کاره رها شد — نتیجه معتبر نیست.\n'));
      process.exit(1);
    }
    console.log(failed === 0
      ? g('  هیچ راه ارتقای خودخواسته‌ای باز نیست.\n')
      : r(`  ${failed} راه نفوذ باز است.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  const OWNER_USER = process.env.ADMIN_USERNAME || 'owner';
  const OWNER_PASS = process.env.ADMIN_PASSWORD || 'yazd1404';

  const ol = await login(OWNER_USER, OWNER_PASS);
  if (!ol.json.token) {
    console.error(r('  ورود مدیر کل ناموفق: ' + JSON.stringify(ol.json)));
    return finish(true);
  }
  const OWNER = ol.json.token;
  const ownerId = ol.json.user.id;

  await api('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify({
      key: 't_hrrole', name: 'مدیر کارکنان آزمایشی',
      permissions: ['orders.view', 'staff.view', 'staff.manage']
    })
  }, OWNER);

  await api('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify({
      key: 't_rmrole', name: 'مدیر نقش‌های آزمایشی',
      permissions: ['orders.view', 'staff.view', 'roles.manage']
    })
  }, OWNER);

  await api('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify({
      key: 't_weak', name: 'نقش کم‌قدرت آزمایشی',
      permissions: ['orders.view']
    })
  }, OWNER);

  const hr    = await makeStaff(api, OWNER, 't_hr', 't_hrrole');
  const rm    = await makeStaff(api, OWNER, 't_rm', 't_rmrole');
  const ow2   = await makeStaff(api, OWNER, 't_owner2', 'owner');
  const fresh = await makeStaff(api, OWNER, 't_fresh', 't_weak');

  if (!hr.id || !rm.id || !ow2.id || !fresh.id) {
    console.error(r('  ساخت کارکنان آزمایشی ناموفق'));
    console.error(JSON.stringify({ hr, rm, ow2, fresh }, null, 1));
    return finish(true);
  }

  const hrId = hr.id, rmId = rm.id, ow2Id = ow2.id;
  const HR = hr.token, RM = rm.token;

  console.log(d('\n  ۱) مدیر کارکنان رمز مدیر کل را بازنشانی می‌کند'));

  const reset = await api(`/api/admin/staff/${ownerId}`, {
    method: 'PUT', body: JSON.stringify({ password: 'HijackedPass1' })
  }, HR);
  add('بازنشانی رمز مدیر کل رد می‌شود', reset.status === 403,
      `کد ${reset.status}`);

  const hijack = await login(OWNER_USER, 'HijackedPass1');
  add('رمز جدید مهاجم کار نمی‌کند', !hijack.json.token,
      hijack.json.token ? 'مهاجم وارد شد!' : '');

  const ownerStillIn = await login(OWNER_USER, OWNER_PASS);
  add('رمز اصلی مدیر کل دست‌نخورده مانده', !!ownerStillIn.json.token);

  const okReset = await api(`/api/admin/staff/${fresh.id}`, {
    method: 'PUT', body: JSON.stringify({ password: 'ResetOk12345' })
  }, HR);
  add('بازنشانی رمز کارمند عادی همچنان مجاز است', okReset.status === 200,
      `کد ${okReset.status}`);

  console.log(d('\n  ۲) مدیر کارکنان مدیر کل دوم را حذف/غیرفعال می‌کند'));

  const deact = await api(`/api/admin/staff/${ow2Id}`, {
    method: 'PUT', body: JSON.stringify({ active: false })
  }, HR);
  add('غیرفعال کردن مدیر کل رد می‌شود', deact.status === 403, `کد ${deact.status}`);

  const del = await api(`/api/admin/staff/${ow2Id}`, { method: 'DELETE' }, HR);
  add('حذف مدیر کل رد می‌شود', del.status === 403, `کد ${del.status}`);

  const ow2Login = await login(ow2.nid, ow2.password);
  add('مدیر کل دوم هنوز پابرجاست', !!ow2Login.json.token);

  console.log(d('\n  ۳) مدیر نقش‌ها به نقش خودش مجوز اضافه می‌کند'));

  const selfRole = await api('/api/admin/roles/t_rmrole', {
    method: 'PUT',
    body: JSON.stringify({
      name: 'مدیر نقش‌های آزمایشی',
      permissions: ['orders.view', 'staff.view', 'roles.manage',
                    'orders.export', 'products.price', 'settings.write']
    })
  }, RM);
  add('ویرایش نقشِ خودِ کارمند رد می‌شود', selfRole.status === 403,
      `کد ${selfRole.status}`);

  const exportTry = await api('/api/admin/export/csv', {}, RM);
  add('مجوز تازه به دست نیامده (خروجی مشتریان بسته است)', exportTry.status === 403,
      `کد ${exportTry.status}`);

  const otherRole = await api('/api/admin/roles/t_weak', {
    method: 'PUT',
    body: JSON.stringify({ name: 'نقش کم‌قدرت آزمایشی',
                           permissions: ['orders.view', 'reviews.view'] })
  }, RM);
  add('ویرایش نقش دیگران همچنان مجاز است', otherRole.status === 200,
      `کد ${otherRole.status}`);

  console.log(d('\n  ۴) مدیر کارکنان نقش خودش را ارتقا می‌دهد'));

  const selfPromote = await api(`/api/admin/staff/${hrId}`, {
    method: 'PUT', body: JSON.stringify({ role_key: 't_rmrole' })
  }, HR);
  add('تغییر نقشِ خود رد می‌شود', selfPromote.status === 403,
      `کد ${selfPromote.status}`);

  const toOwner = await api(`/api/admin/staff/${hrId}`, {
    method: 'PUT', body: JSON.stringify({ role_key: 'owner' })
  }, HR);
  add('ارتقای خود به مدیر کل رد می‌شود', toOwner.status === 403,
      `کد ${toOwner.status}`);

  const hrWho = await api('/api/admin/whoami', {}, HR);
  add('نقش مدیر کارکنان عوض نشده', hrWho.json.role_key === 't_hrrole',
      hrWho.json.role_key);

  const selfName = await api(`/api/admin/staff/${hrId}`, {
    method: 'PUT', body: JSON.stringify({ display_name: 'نام تازه آزمایشی' })
  }, HR);
  add('ویرایش نام خود همچنان مجاز است', selfName.status === 200,
      `کد ${selfName.status}`);

  console.log(d('\n  ۵) کارمند با رمز اولیه بدون تغییر آن کار می‌کند'));

  const freshLogin = await login(fresh.nid, 'ResetOk12345');
  const FRESH = freshLogin.json.token;
  add('ورود با رمز اولیه ممکن است', !!FRESH);
  add('پرچم «باید رمز عوض شود» روشن است', freshLogin.json.user?.must_change === true);

  const freshWork = await api('/api/orders', {}, FRESH);
  add('کار کردن پیش از تغییر رمز رد می‌شود', freshWork.status === 403,
      `کد ${freshWork.status}`);

  const freshWho = await api('/api/admin/whoami', {}, FRESH);
  add('اما whoami باز است (پنل باید بارگذاری شود)', freshWho.status === 200,
      `کد ${freshWho.status}`);

  const freshChange = await api('/api/admin/change-password', {
    method: 'POST',
    body: JSON.stringify({ current: 'ResetOk12345', new_password: 'FreshNew12345' })
  }, FRESH);
  add('تغییر رمز باز است', freshChange.status === 200, `کد ${freshChange.status}`);

  const freshWork2 = await api('/api/orders', {}, FRESH);
  add('پس از تغییر رمز کار باز می‌شود', freshWork2.status === 200,
      `کد ${freshWork2.status}`);

  console.log(d('\n  ثبت تلاش‌های ناموفق در سابقه'));
  const audit = await api('/api/admin/audit?denied=1&limit=200', {}, OWNER);

  const testNids = TEST_USERS.map(nidFor);
  const denied = (audit.json.entries || [])
    .filter(e => e.username && testNids.includes(e.username));
  add('تلاش‌های ناموفق در سابقه ثبت شده‌اند', denied.length >= 4,
      `${denied.length} مورد`);

  finish();
})();
