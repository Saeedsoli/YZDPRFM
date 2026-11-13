#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4412;
const BASE = `http://127.0.0.1:${PORT}`;
const MOBILE = '09191234567';

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const PAYLOADS = [
  '<script>window.__xss=1</script>',
  '<img src=x onerror="window.__xss=1">',
  '"><svg onload=alert(1)>',
  "'><iframe src=javascript:alert(1)>",
  '<a href="javascript:alert(1)">کلیک</a>'
];

function cleanup() {
  const db = new Database(DB);
  db.prepare('DELETE FROM reviews WHERE mobile=?').run(MOBILE);
  db.prepare('DELETE FROM tickets WHERE mobile=?').run(MOBILE);
  db.prepare('DELETE FROM sessions WHERE subject=?').run(MOBILE);
  try { db.prepare('DELETE FROM otp_codes WHERE mobile=?').run(MOBILE); } catch {}
  db.prepare('DELETE FROM rate_limits').run();
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
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await sleep(400);
  }
  return { proc, getLog: () => log };
}

function isDangerous(html, payload) {
  if (!html) return false;

  const raw = payload.replace(/"/g, '&quot;');
  return html.includes(payload) || html.includes(raw);
}

(async () => {
  console.log('\n  آزمون تزریق اسکریپت (XSS)\n');
  cleanup();

  const srv = await boot();
  const finish = code => {
    try { srv.proc.kill('SIGKILL'); } catch {}
    cleanup();
    process.exit(code);
  };

  await fetch(`${BASE}/api/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile: MOBILE })
  });
  await sleep(400);
  const code = (srv.getLog().match(/\b\d{5}\b/g) || []).pop();
  const auth = await (await fetch(`${BASE}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile: MOBILE, code })
  })).json();

  if (!auth.token) {
    console.error(r('  ✗ ورود ناموفق: ' + JSON.stringify(auth)));
    return finish(1);
  }

  const cat = await (await fetch(`${BASE}/api/products?limit=1`)).json();
  const slug = cat.products[0].slug;
  const checks = [];

  console.log(d('  ثبت نظر با بارهای مخرب…\n'));

  for (const payload of PAYLOADS) {
    const db0 = new Database(DB);
    db0.prepare('DELETE FROM reviews WHERE mobile=?').run(MOBILE);
    db0.prepare('DELETE FROM rate_limits').run();
    db0.close();

    await fetch(`${BASE}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Token': auth.token },
      body: JSON.stringify({
        product: slug,
        rating: 5,
        title: payload,
        body: 'متن نظر آزمایشی برای سنجش تزریق ' + payload,
        display_name: payload
      })
    });

    const db1 = new Database(DB);
    db1.prepare("UPDATE reviews SET status='APPROVED' WHERE mobile=?").run(MOBILE);
    db1.close();

    const res = await (await fetch(`${BASE}/api/reviews/${slug}`)).json();
    const mine = (res.reviews || [])[0];
    if (!mine) { checks.push([`نظر ثبت نشد: ${payload.slice(0, 24)}`, false]); continue; }

    const combined = `${mine.display_name}|${mine.title}|${mine.body}`;
    const dangerous = isDangerous(combined, payload);

    console.log(`  ${dangerous ? r('✗') : g('✓')} ${payload.slice(0, 42)}`);
    if (dangerous) {
      console.log(d(`      خروجی: ${String(mine.title).slice(0, 60)}`));
    }
    checks.push([`خنثی شد: ${payload.slice(0, 30)}`, !dangerous]);
  }

  console.log();
  let failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed === 0
    ? g('  همه بارهای مخرب خنثی شدند.\n')
    : r(`  ${failed} بار مخرب خام برگشت — XSS ممکن است.\n`));
  finish(failed === 0 ? 0 : 1);
})();
