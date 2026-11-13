#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const TARGET_MAJOR = 22;

const LIARA_MAX = 22;

const problems = [];
const notes = [];

function read(file) {
  try { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }
  catch { return null; }
}

console.log('\n  بررسی هم‌راستایی نسخه Node\n');

{
  const raw = read('package.json');
  const pkg = raw ? JSON.parse(raw) : null;
  const eng = pkg?.engines?.node;

  if (!eng) {
    problems.push('package.json فیلد engines.node ندارد');
    console.log(`  ${r('✗')} package.json    ${d('engines.node تعریف نشده')}`);
  } else {

    const hasUpper = /<\s*\d+/.test(eng);
    const mentionsTarget = eng.includes(String(TARGET_MAJOR));
    const ok = hasUpper && mentionsTarget;
    console.log(`  ${ok ? g('✓') : r('✗')} package.json    ${d(eng)}`);
    if (!mentionsTarget) problems.push(`engines.node به ${TARGET_MAJOR} اشاره نمی‌کند: ${eng}`);
    else if (!hasUpper) problems.push(`engines.node سقف ندارد (${eng}) — نسخه Current هم می‌گذرد`);
  }
}

{
  const raw = read('liara.json');
  const lia = raw ? JSON.parse(raw) : null;
  const v = lia?.node?.version;

  if (!v) {

    problems.push('liara.json نسخه Node مشخص نکرده — به پیش‌فرض لیارا وابسته می‌ماند');
    console.log(`  ${r('✗')} liara.json      ${d('node.version تعریف نشده')}`);
  } else {
    const n = parseInt(v);
    const ok = n === TARGET_MAJOR;
    console.log(`  ${ok ? g('✓') : r('✗')} liara.json      ${d(v)}`);
    if (!ok) problems.push(`liara.json روی ${v} است، انتظار ${TARGET_MAJOR}`);
    if (n > LIARA_MAX) {
      problems.push(`لیارا نسخه ${n} را ارائه نمی‌دهد (سقف: ${LIARA_MAX})`);
    }
  }
}

{
  const df = read('Dockerfile');
  if (!df) {
    notes.push('Dockerfile وجود ندارد');
  } else {
    const m = df.match(/^FROM\s+node:(\d+)/mi);
    if (!m) {
      problems.push('Dockerfile تصویر پایه node ندارد');
      console.log(`  ${r('✗')} Dockerfile      ${d('FROM node:… یافت نشد')}`);
    } else {
      const n = parseInt(m[1]);
      const ok = n === TARGET_MAJOR;
      console.log(`  ${ok ? g('✓') : r('✗')} Dockerfile      ${d('node:' + m[1])}`);
      if (!ok) problems.push(`Dockerfile روی node:${m[1]} است، انتظار node:${TARGET_MAJOR}`);

      notes.push('Dockerfile با platform=node خوانده نمی‌شود، ولی باید درست بماند');
    }
  }
}

{
  const cur = parseInt(process.versions.node.split('.')[0]);
  const ok = cur === TARGET_MAJOR;
  console.log(`  ${ok ? g('✓') : y('!')} محیط فعلی      ${d(process.version)}`);
  if (!ok) {
    notes.push(
      `محیط اجرای فعلی Node ${cur} است نه ${TARGET_MAJOR} — `
      + 'آزمون‌ها روی نسخه‌ای غیر از نسخه استقرار اجرا می‌شوند');
  }
}

{
  const raw = read('package.json');
  const pkg = raw ? JSON.parse(raw) : {};
  const bs = pkg.dependencies?.['better-sqlite3'];

  if (bs) {

    console.log(`  ${g('✓')} better-sqlite3  ${d(bs + '  (سازگار با ۲۰ تا ۲۶)')}`);

    try {
      const inst = require(path.join(ROOT, 'node_modules/better-sqlite3/package.json'));
      const eng = inst.engines?.node || '';
      const okEng = !eng || eng.includes(String(TARGET_MAJOR)) || /^>=\s*\d+/.test(eng);
      if (!okEng) {
        problems.push(`better-sqlite3@${inst.version} با Node ${TARGET_MAJOR} سازگار نیست: ${eng}`);
      }
    } catch {
      notes.push('better-sqlite3 نصب نشده — با npm install بررسی دقیق‌تر می‌شود');
    }
  }
}

console.log();
if (notes.length) {
  notes.forEach(n => console.log(`  ${y('!')} ${n}`));
  console.log();
}

if (problems.length) {
  console.log(`  ${r(`${problems.length} ناسازگاری:`)}`);
  problems.forEach(p => console.log(`     • ${p}`));
  console.log();
  process.exit(1);
}

console.log(`  ${g(`همه‌جا Node ${TARGET_MAJOR} (Jod, Active LTS) — هم‌راستا.`)}\n`);
