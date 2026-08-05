#!/usr/bin/env node
/**
 * آزمون پروفایل و کارنامه شخصی کارمند.
 *
 * خطر اصلی: نشت فعالیت بین کارکنان. اگر فیلتر `staff_id` درست
 * نباشد، هر کارمند کار بقیه را می‌بیند — یعنی انباردار می‌فهمد
 * مدیر کل چه کرده و چه سفارش‌هایی لغو شده.
 *
 * خطر دوم: ارتقای خود از راه ویرایش پروفایل. اگر مسیر
 * `me/profile` فیلد `role_key` یا `active` را بپذیرد، کارمند
 * می‌تواند خودش را مدیر کل کند.
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) هر کارمند فقط فعالیت خودش را می‌بیند
 *   ۲) ویرایش پروفایل نقش و وضعیت را عوض نمی‌کند
 *   ۳) بدون ورود ۴۰۱، با رمز اولیه ۴۰۳
 *   ۴) آمار برجسته با نقش هم‌خوان است
 *   ۵) شمارش نشست فعال، منقضی‌ها را نمی‌شمارد
 *   ۶) اعتبارسنجی ورودی (نام خالی، موبایل نامعتبر)
 *
 * اجرا: node scripts/test_profile.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { makeStaff, cleanupStaff, nidFor, mobileFor } = require('./lib/test_staff');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4427;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const USERS = ['pf_wh', 'pf_sup', 'pf_new'];

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
  console.log('\n  آزمون پروفایل و کارنامه شخصی\n');
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
      ? g('  پروفایل سالم است.\n')
      : r(`  ${failed} بررسی ناموفق.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  const ol = await login(process.env.ADMIN_USERNAME || 'owner',
                         process.env.ADMIN_PASSWORD || 'yazd1404');
  if (!ol.json.token) {
    console.error(r('  ورود مدیر کل ناموفق'));
    return finish(true);
  }
  const OWNER = ol.json.token;
  const ownerId = ol.json.user.id;

  // ══ ۱) دسترسی پایه ══
  console.log(d('  دسترسی'));

  const anon = await api('/api/admin/me/activity');
  add('بدون ورود ۴۰۱ می‌گیرد', anon.status === 401, `کد ${anon.status}`);

  const ownerA = await api('/api/admin/me/activity?days=30', {}, OWNER);
  add('مدیر کل کارنامه می‌گیرد', ownerA.status === 200, `کد ${ownerA.status}`);
  add('ساختار پاسخ درست است',
      !!ownerA.json.profile && !!ownerA.json.summary &&
      Array.isArray(ownerA.json.actions) && Array.isArray(ownerA.json.recent));

  // ══ ۲) ساخت کارکنان ══
  const WH  = (await makeStaff(api, OWNER, 'pf_wh', 'warehouse')).token;
  const SUP = (await makeStaff(api, OWNER, 'pf_sup', 'support')).token;
  if (!WH || !SUP) {
    console.error(r('  ساخت کارکنان آزمایشی ناموفق'));
    return finish(true);
  }

  // انباردار چند کار انجام می‌دهد تا کارنامه‌اش پر شود
  await api('/api/orders', {}, WH);
  await api('/api/admin/low-stock', {}, WH);

  // ══ ۳) جداسازی فعالیت ══
  console.log(d('\n  جداسازی فعالیت بین کارکنان'));

  const whA = await api('/api/admin/me/activity?days=30', {}, WH);
  const whId = whA.json.profile?.id;

  add('انباردار پروفایل خودش را می‌گیرد',
      whA.json.profile?.username === nidFor('pf_wh'),
      whA.json.profile?.username);

  add('شناسه پروفایل با کارمند می‌خواند', whId && whId !== ownerId,
      `id=${whId} در برابر مدیر=${ownerId}`);

  /* مهم‌ترین بررسی: هیچ رکوردی از کارمند دیگر در کارنامه نباشد.
     مستقیم با دیتابیس مقایسه می‌شود، نه با فرض. */
  const whRealCount = db.prepare(
    "SELECT COUNT(*) n FROM audit_log WHERE staff_id=? AND at >= datetime('now','-30 days')"
  ).get(whId).n;
  add('شمارش کارنامه با دیتابیس می‌خواند',
      whA.json.summary.total === whRealCount,
      `${whA.json.summary.total} در برابر ${whRealCount}`);

  const ownerTotal = ownerA.json.summary.total;
  add('کارنامه انباردار شامل کار مدیر کل نیست',
      whA.json.summary.total < ownerTotal,
      `انباردار ${whA.json.summary.total} · مدیر ${ownerTotal}`);

  // هیچ نام کاربری دیگری در پاسخ نباشد
  const blob = JSON.stringify(whA.json);
  add('نام کارمند دیگر در پاسخ نیست',
      !blob.includes('owner') && !blob.includes(nidFor('pf_sup')));

  // ══ ۴) آمار برجسته بر پایه نقش ══
  console.log(d('\n  آمار برجسته متناسب با نقش'));

  const labels = j => (j.highlights || []).map(h => h.label);

  add('انباردار «به‌روزرسانی موجودی» دارد',
      labels(whA.json).some(l => l.includes('موجودی')),
      labels(whA.json).join('، ') || 'هیچ');
  add('انباردار «پاسخ به تیکت» ندارد',
      !labels(whA.json).some(l => l.includes('تیکت')));

  const supA = await api('/api/admin/me/activity?days=30', {}, SUP);
  add('پشتیبان «پاسخ به تیکت» دارد',
      labels(supA.json).some(l => l.includes('تیکت')),
      labels(supA.json).join('، ') || 'هیچ');
  add('پشتیبان «به‌روزرسانی موجودی» ندارد',
      !labels(supA.json).some(l => l.includes('موجودی')));

  // ══ ۵) ویرایش پروفایل ══
  console.log(d('\n  ویرایش مشخصات'));

  const okEdit = await api('/api/admin/me/profile', {
    method: 'PUT',
    body: JSON.stringify({ display_name: 'نام تازه انباردار', mobile: '09121112233' })
  }, WH);
  add('ویرایش نام و موبایل مجاز است', okEdit.status === 200, `کد ${okEdit.status}`);
  add('نام واقعاً عوض شد',
      okEdit.json.staff?.display_name === 'نام تازه انباردار',
      okEdit.json.staff?.display_name);

  const emptyName = await api('/api/admin/me/profile', {
    method: 'PUT', body: JSON.stringify({ display_name: '   ' })
  }, WH);
  add('نام خالی رد می‌شود', emptyName.status === 400, `کد ${emptyName.status}`);

  const badMobile = await api('/api/admin/me/profile', {
    method: 'PUT', body: JSON.stringify({ mobile: '12345' })
  }, WH);
  add('موبایل نامعتبر رد می‌شود', badMobile.status === 400, `کد ${badMobile.status}`);

  // ══ ۶) ارتقای خود از راه پروفایل ══
  console.log(d('\n  تلاش برای ارتقا از راه پروفایل'));

  await api('/api/admin/me/profile', {
    method: 'PUT',
    body: JSON.stringify({ display_name: 'انباردار', role_key: 'owner' })
  }, WH);
  const afterRole = db.prepare('SELECT role_key FROM staff WHERE id=?').get(whId);
  add('role_key از راه پروفایل عوض نمی‌شود',
      afterRole.role_key === 'warehouse', afterRole.role_key);

  await api('/api/admin/me/profile', {
    method: 'PUT',
    body: JSON.stringify({ display_name: 'انباردار', permissions: ['staff.manage'] })
  }, WH);
  const whWho = await api('/api/admin/whoami', {}, WH);
  add('مجوزها از راه پروفایل اضافه نمی‌شوند',
      !(whWho.json.permissions || []).includes('staff.manage'),
      `${(whWho.json.permissions || []).length} مجوز`);

  await api('/api/admin/me/profile', {
    method: 'PUT',
    body: JSON.stringify({ display_name: 'انباردار', active: 0, must_change: 1 })
  }, WH);
  const afterFlags = db.prepare('SELECT active, must_change FROM staff WHERE id=?').get(whId);
  add('active و must_change دست‌نخورده می‌مانند',
      afterFlags.active === 1 && afterFlags.must_change === 0,
      `active=${afterFlags.active} must_change=${afterFlags.must_change}`);

  // ══ ۷) نشست فعال ══
  console.log(d('\n  شمارش نشست'));

  const liveNow = db.prepare(
    "SELECT COUNT(*) n FROM sessions WHERE kind='ADMIN' AND subject=? AND expires_at > ?"
  ).get(String(whId), Date.now()).n;
  const whA2 = await api('/api/admin/me/activity', {}, WH);
  add('نشست فعال فقط معتبرها را می‌شمارد',
      whA2.json.profile.active_sessions === liveNow,
      `${whA2.json.profile.active_sessions} در برابر ${liveNow}`);

  // نشست منقضی نباید شمرده شود
  db.prepare(
    "INSERT INTO sessions (token, kind, subject, expires_at) VALUES (?,?,?,?)"
  ).run('deadtoken' + Date.now(), 'ADMIN', String(whId), Date.now() - 60000);
  const whA3 = await api('/api/admin/me/activity', {}, WH);
  add('نشست منقضی شمرده نمی‌شود',
      whA3.json.profile.active_sessions === liveNow,
      `${whA3.json.profile.active_sessions}`);

  // ══ ۸) رمز اولیه ══
  console.log(d('\n  حساب با رمز اولیه'));
  const fNid = nidFor('pf_new');
  const fMob = mobileFor('pf_new');
  await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'تازه', last_name: 'وارد',
      national_id: fNid, mobile: fMob, role_key: 'warehouse'
    })
  }, OWNER);
  const freshTok = (await login(fNid, fMob.replace(/^0+/, ''))).json.token;
  if (freshTok) {
    const fa = await api('/api/admin/me/activity', {}, freshTok);
    add('حساب با رمز اولیه کارنامه نمی‌گیرد', fa.status === 403, `کد ${fa.status}`);
  } else {
    add('ساخت حساب رمز اولیه', false);
  }

  finish();
})();
