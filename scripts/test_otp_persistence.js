#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4406;
const BASE = `http://127.0.0.1:${PORT}`;
const MOBILE = '09171112233';

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

function cleanup() {
  const db = new Database(DB);
  try { db.prepare('DELETE FROM otp_codes WHERE mobile=?').run(MOBILE); } catch {}
  db.prepare('DELETE FROM rate_limits').run();
  db.prepare("DELETE FROM sessions WHERE subject=?").run(MOBILE);
  db.close();
}

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', c => { log += c; });
  proc.stderr.on('data', c => { log += c; });

  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await sleep(400);
  }
  return { proc, getLog: () => log };
}

const post = (p, body) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async res => ({ status: res.status, json: await res.json() }));

(async () => {
  console.log('\n  آزمون پایداری کد یکبار مصرف\n');
  cleanup();

  let srv = await boot();
  const checks = [];
  const finish = code => {
    try { srv.proc.kill('SIGKILL'); } catch {}
    cleanup();
    process.exit(code);
  };

  const req = await post('/api/auth/request-code', { mobile: MOBILE });
  if (req.status !== 200) {
    console.error(r('  ✗ درخواست کد ناموفق: ' + JSON.stringify(req.json)));
    return finish(1);
  }
  await sleep(400);
  const code = (srv.getLog().match(/\b\d{5}\b/g) || []).pop();
  console.log(d(`  کد صادرشده: ${code}`));

  const db = new Database(DB, { readonly: true });
  const stored = db.prepare('SELECT * FROM otp_codes WHERE mobile=?').get(MOBILE);
  db.close();
  checks.push(['کد در دیتابیس ذخیره شد', !!stored]);

  console.log(d('  ری‌استارت سرور…'));
  srv.proc.kill('SIGKILL');
  await sleep(1200);
  srv = await boot();

  const afterRestart = await post('/api/auth/verify-code', { mobile: MOBILE, code });
  checks.push(['کد پس از ری‌استارت معتبر ماند', !!afterRestart.json.token]);
  console.log(d(`  پس از ری‌استارت: ${afterRestart.json.token ? 'ورود موفق' : afterRestart.json.error}`));

  const reuse = await post('/api/auth/verify-code', { mobile: MOBILE, code });
  checks.push(['کد پس از مصرف باطل شد', !reuse.json.token]);

  cleanup();
  await post('/api/auth/request-code', { mobile: MOBILE });
  await sleep(300);
  const code2 = (srv.getLog().match(/\b\d{5}\b/g) || []).pop();

  const wrong1 = await post('/api/auth/verify-code', { mobile: MOBILE, code: '00000' });
  checks.push(['کد نادرست رد می‌شود', !wrong1.json.token]);
  checks.push(['شمار تلاش باقی‌مانده نمایش داده می‌شود',
    /تلاش/.test(wrong1.json.error || '')]);

  for (let i = 0; i < 4; i++) {
    await post('/api/auth/verify-code', { mobile: MOBILE, code: '00000' });
  }
  const afterMax = await post('/api/auth/verify-code', { mobile: MOBILE, code: code2 });
  checks.push(['پس از ۵ تلاش نادرست کد درست هم رد می‌شود', !afterMax.json.token]);

  cleanup();
  await post('/api/auth/request-code', { mobile: MOBILE });
  await sleep(300);
  const code3 = (srv.getLog().match(/\b\d{5}\b/g) || []).pop();
  const faCode = code3.replace(/\d/g, x => '۰۱۲۳۴۵۶۷۸۹'[x]);
  const faTry = await post('/api/auth/verify-code', { mobile: MOBILE, code: faCode });
  checks.push(['کد با ارقام فارسی پذیرفته می‌شود', !!faTry.json.token]);

  console.log();
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}`);
    if (!pass) failed++;
  }

  console.log();
  console.log(failed === 0
    ? g('  کد یکبار مصرف پایدار و امن است.\n')
    : r(`  ${failed} بررسی ناموفق.\n`));
  finish(failed === 0 ? 0 : 1);
})();
