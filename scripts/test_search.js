#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.dirname(__dirname);
const PORT = 4417;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT) },
    stdio: 'ignore'
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

const search = (q, extra = '') =>
  fetch(`${BASE}/api/products?q=${encodeURIComponent(q)}&limit=3${extra}`)
    .then(r => r.json());

(async () => {
  console.log('\n  آزمون کیفیت جستجو\n');
  const srv = await boot();

  const checks = [];
  const add = (label, pass, note) => {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
    checks.push(pass);
  };
  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    const failed = checks.filter(x => !x).length;
    console.log();
    console.log(failed === 0
      ? g('  جستجو سالم است.\n')
      : r(`  ${failed} بررسی ناموفق.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  console.log(d('  واژه‌هایی که مشتری واقعاً تایپ می‌کند'));

  for (const [q, min] of [['عطر', 2000], ['ادکلن', 2000], ['مردانه', 300],
                          ['زنانه', 300], ['اسپرت', 100]]) {
    const res = await search(q);
    add(`«${q}» نتیجه می‌دهد`, res.total >= min,
        `${res.total} نتیجه (حداقل ${min})`);
  }

  console.log(d('\n  برند و نام محصول'));

  const aventus = await search('اونتوس');
  add('نام محصول پیدا می‌شود', aventus.total > 0 &&
      aventus.products[0].name_fa.includes('اونتوس'),
      aventus.products[0]?.name_fa);

  const creed = await search('creed');
  add('برند لاتین پیدا می‌شود', creed.total >= 20, `${creed.total} نتیجه`);

  const creedFa = await search('کرید');
  add('برند فارسی پیدا می‌شود', creedFa.total >= 20, `${creedFa.total} نتیجه`);

  console.log(d('\n  یکسان‌سازی نویسه‌های عربی و فارسی'));

  const arabicK = await search('كريد');
  add('«كريد» عربی = «کرید» فارسی', arabicK.total === creedFa.total,
      `${arabicK.total} در برابر ${creedFa.total}`);

  const withHarakat = await search('کرِید');
  add('حرکت‌گذاری نادیده گرفته می‌شود', withHarakat.total === creedFa.total,
      `${withHarakat.total} در برابر ${creedFa.total}`);

  console.log(d('\n  جستجوی چندکلمه‌ای — نباید بن‌بست بسازد'));

  const combo = await search('عطر مردانه تابستانی');
  add('ترکیب سه کلمه نتیجه می‌دهد', combo.total > 0, `${combo.total} نتیجه`);

  const impossible = await search('کرید شکلات قهوه');
  add('ترکیب نامحتمل هم نتیجه می‌دهد', impossible.total > 0,
      `${impossible.total} نتیجه`);
  add('و به عنوان «تقریبی» علامت می‌خورد', impossible.relaxed === true);

  add('نتیجه دقیق، تقریبی علامت نمی‌خورد', aventus.relaxed !== true);

  console.log(d('\n  واژه بی‌معنی باید واقعاً صفر بدهد'));

  const junk = await search('qqzzxxyy');
  add('واژه بی‌معنی صفر می‌دهد', junk.total === 0, `${junk.total} نتیجه`);

  const junkMulti = await search('qqzzxx yyvvww');
  add('چند واژه بی‌معنی هم صفر می‌دهد', junkMulti.total === 0,
      `${junkMulti.total} نتیجه`);

  console.log(d('\n  جستجو همراه فیلتر'));

  const filtered = await search('عطر', '&gender=WOMEN');
  add('فیلتر جنسیت با جستجو کار می‌کند', filtered.total > 0 &&
      filtered.products.every(p => p.gender === 'WOMEN'),
      `${filtered.total} نتیجه زنانه`);

  console.log(d('\n  تزریق SQL'));

  const before = await fetch(`${BASE}/api/products?limit=1`).then(r => r.json());
  const sqli = await search("'; DROP TABLE products--");
  const after = await fetch(`${BASE}/api/products?limit=1`).then(r => r.json());
  add('تزریق SQL بی‌اثر است',
      after.total === before.total && after.total > 0,
      `${after.total} محصول سالم`);
  add('و خطای سرور نمی‌دهد', typeof sqli.total === 'number');

  finish();
})();
