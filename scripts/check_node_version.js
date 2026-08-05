#!/usr/bin/env node
/**
 * نگهبان هم‌راستایی نسخه Node.
 *
 * ── مسئله‌ای که این ابزار حل می‌کند ──
 * نسخه Node در **چهار جا** تعریف می‌شود و هیچ‌کدام دیگری را
 * نمی‌بیند:
 *
 *   package.json  → engines.node   (npm هشدار می‌دهد)
 *   liara.json    → node.version   (لیارا اجرا می‌کند)
 *   Dockerfile    → FROM node:XX   (فقط اگر platform=docker باشد)
 *   محیط اجرا     → process.version
 *
 * پیش از این بررسی، پروژه در وضعیت زیر بود:
 *   engines: ">=20"  ·  Dockerfile: node:20  ·  liara.json: هیچ
 *
 * یعنی کد روی ۲۰ آزموده می‌شد ولی لیارا با پیش‌فرض خودش (۲۲)
 * اجرایش می‌کرد — یک ناسازگاری خاموش که هیچ آزمونی نمی‌گرفت.
 *
 * ── چرا Node 22 ──
 *   • Node 20 (Iron) از مارس ۲۰۲۶ **EOL** است — وصله امنیتی
 *     نمی‌گیرد. سایت رسمی: «Production applications should only
 *     use Active LTS or Maintenance LTS releases.»
 *   • Node 24 (Krypton) LTS است ولی **لیارا ارائه نمی‌دهد**
 *     (سقف لیارا ۲۲ است)
 *   • Node 26 نسخه Current است، نه LTS — برای فروشگاه در حال
 *     افتتاح مناسب نیست
 *   ⇒ Node 22 (Jod, Active LTS) تنها انتخاب درست است.
 *
 * اجرا: npm run check-node
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

/** نسخه‌ای که پروژه رویش قفل است */
const TARGET_MAJOR = 22;

/**
 * سقف نسخه‌ای که لیارا ارائه می‌دهد.
 * منبع: docs.liara.ir/paas/nodejs/how-tos/choose-version
 * (بررسی‌شده: مرداد ۱۴۰۵ — ۸ تا ۲۲، پیش‌فرض ۲۲)
 */
const LIARA_MAX = 22;

const problems = [];
const notes = [];

function read(file) {
  try { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }
  catch { return null; }
}

console.log('\n  بررسی هم‌راستایی نسخه Node\n');

// ── ۱) package.json ──
{
  const raw = read('package.json');
  const pkg = raw ? JSON.parse(raw) : null;
  const eng = pkg?.engines?.node;

  if (!eng) {
    problems.push('package.json فیلد engines.node ندارد');
    console.log(`  ${r('✗')} package.json    ${d('engines.node تعریف نشده')}`);
  } else {
    /* بازه باید سقف داشته باشد. `>=22` تنها یعنی Node 26 هم
       پذیرفته می‌شود — و آن نسخه Current است نه LTS. */
    const hasUpper = /<\s*\d+/.test(eng);
    const mentionsTarget = eng.includes(String(TARGET_MAJOR));
    const ok = hasUpper && mentionsTarget;
    console.log(`  ${ok ? g('✓') : r('✗')} package.json    ${d(eng)}`);
    if (!mentionsTarget) problems.push(`engines.node به ${TARGET_MAJOR} اشاره نمی‌کند: ${eng}`);
    else if (!hasUpper) problems.push(`engines.node سقف ندارد (${eng}) — نسخه Current هم می‌گذرد`);
  }
}

// ── ۲) liara.json ──
{
  const raw = read('liara.json');
  const lia = raw ? JSON.parse(raw) : null;
  const v = lia?.node?.version;

  if (!v) {
    /* بدون نسخه صریح، لیارا پیش‌فرض خودش را می‌گیرد. امروز ۲۲
       است، ولی روزی که عوضش کنند سایت بی‌هشدار جابه‌جا می‌شود. */
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

// ── ۳) Dockerfile ──
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
      /* یادآوری: با platform=node لیارا Dockerfile را نمی‌خواند.
         ولی نباید عدد غلط داشته باشد — سندی که دروغ بگوید بدتر
         از نبودنش است. */
      notes.push('Dockerfile با platform=node خوانده نمی‌شود، ولی باید درست بماند');
    }
  }
}

// ── ۴) محیط اجرای فعلی ──
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

// ── ۵) سازگاری وابستگی native ──
{
  const raw = read('package.json');
  const pkg = raw ? JSON.parse(raw) : {};
  const bs = pkg.dependencies?.['better-sqlite3'];

  if (bs) {
    /* `better-sqlite3` ماژول native است و برای هر نسخه Node
       باینری جدا می‌خواهد. اگر نسخه‌ای انتخاب شود که باینری
       آماده ندارد، بیلد روی سرور از منبع کامپایل می‌کند —
       کند و شکننده.

       اندازه‌گیری‌شده (مرداد ۱۴۰۵):
         12.11.1 → engines: 20.x || 22.x || 23.x || 24.x || 25.x || 26.x
         13.x    → engines: >=22

       نسخه ۱۲ عمداً نگه داشته شد: هم Node 22 را پوشش می‌دهد،
       هم اگر لازم شد به ۲۰ برگردیم کار می‌کند. ارتقا به ۱۳
       این راه برگشت را می‌بندد. */
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

// ── نتیجه ──
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
