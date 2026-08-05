#!/usr/bin/env node
/**
 * آزمون نگارش فارسی نام برندها.
 *
 * چرا مهم است:
 *   مشتری ایرانی برند را با املای جاافتاده بازار می‌شناسد. «آمواژ»
 *   به‌جای «آمواج» هم غلط دیده می‌شود و هم در جستجو پیدا نمی‌شود —
 *   یعنی مستقیم روی فروش اثر دارد.
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) نام‌های تأییدشده درست‌اند
 *   ۲) املای قدیمی هم در جستجو نتیجه می‌دهد (مشتری گم نشود)
 *   ۳) هیچ برندی نام فارسی خالی ندارد
 *   ۴) نام برند در name_fa تکرار نشده (نام دوتایی)
 *   ۵) خطاهای رایج نگارشی وجود ندارند
 *
 * اجرا: node scripts/test_brand_names.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { db } = require('../src/db');

const ROOT = path.dirname(__dirname);
const PORT = 4423;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

/** نگارش تأییدشده — از فروشگاه‌های معتبر ایرانی گرفته شده */
const EXPECTED = {
  'Amouage':            'آمواج',
  'Nishane':            'نیشان',
  'Atelier Cologne':    'آتلیه کلون',
  'Xerjoff':            'زرجوف',
  'Thameen London':     'تامین لندن',
  'Chanel':             'شنل',
  'Christian Dior':     'دیور',
  'Guerlain':           'گرلن',
  'Tom Ford':           'تام فورد',
  'Hermès':             'هرمس',
  'Creed':              'کرید'
};

/** املای قدیمی که باید همچنان در جستجو کار کند */
const OLD_SPELLINGS = ['آمواژ', 'نیشانه', 'آتلیه کلن', 'ثمین لندن'];

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT, env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT) }, stdio: 'ignore'
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

(async () => {
  console.log('\n  آزمون نگارش فارسی نام برندها\n');
  const srv = await boot();

  const checks = [];
  const add = (label, ok, note) => {
    console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
    checks.push(ok);
  };

  // ══ ۱) نگارش درست ══
  console.log(d('  نگارش تأییدشده'));
  const wrong = [];
  for (const [en, fa] of Object.entries(EXPECTED)) {
    const row = db.prepare('SELECT brand_fa FROM products WHERE brand_en=? LIMIT 1').get(en);
    if (!row) continue;
    if (row.brand_fa !== fa) wrong.push(`${en}: «${row.brand_fa}» به‌جای «${fa}»`);
  }
  add('نام برندهای شاخص درست است', wrong.length === 0,
      wrong.length ? wrong[0] : `${Object.keys(EXPECTED).length} برند`);

  // ══ ۲) املای قدیمی در جستجو ══
  console.log(d('\n  سازگاری با املای قدیمی'));
  for (const old of OLD_SPELLINGS) {
    const res = await fetch(
      `${BASE}/api/products?q=${encodeURIComponent(old)}&limit=1`
    ).then(r => r.json());
    add(`«${old}» هنوز نتیجه می‌دهد`, res.total > 0, `${res.total} نتیجه`);
  }

  // ══ ۳) یکپارچگی ══
  console.log(d('\n  یکپارچگی داده'));

  const empty = db.prepare(
    "SELECT COUNT(*) n FROM products WHERE brand_fa IS NULL OR brand_fa=''"
  ).get().n;
  add('هیچ محصولی برند فارسی خالی ندارد', empty === 0, `${empty} مورد`);

  /* نام محصول نباید نام برند را در خود تکرار کند — کارت محصول
     برند را جدا نشان می‌دهد و تکرارش «آمواج — آمواج اینترلود»
     می‌سازد. */
  const dup = db.prepare(`
    SELECT COUNT(*) n FROM products
    WHERE brand_fa IS NOT NULL AND name_fa LIKE '%' || brand_fa || '%'
  `).get().n;
  add('نام محصول برند را تکرار نمی‌کند', dup === 0, `${dup} مورد`);

  // ══ ۴) خطاهای رایج نگارشی ══
  console.log(d('\n  خطاهای رایج'));

  const arabicChars = db.prepare(`
    SELECT COUNT(*) n FROM products
    WHERE brand_fa LIKE '%ي%' OR brand_fa LIKE '%ك%' OR brand_fa LIKE '%ة%'
  `).get().n;
  add('حرف عربی (ي ك ة) در نام برند نیست', arabicChars === 0, `${arabicChars} مورد`);

  const latinLeak = db.prepare(`
    SELECT COUNT(*) n FROM products WHERE brand_fa GLOB '*[a-zA-Z]*'
  `).get().n;
  add('حرف لاتین در نام فارسی برند نیست', latinLeak === 0, `${latinLeak} مورد`);

  /* حرکت‌گذاری (کسره، فتحه، …) در نام برند نباید باشد: در بازار
     ایران «کرید» نوشته می‌شود نه «کرِید»، و حرکت باعث می‌شود
     کپی‌پیست مشتری با متن سایت نخواند. */
  const harakat = db.prepare(
    "SELECT COUNT(*) n FROM products WHERE brand_fa GLOB '*[\u064B-\u0652]*'"
  ).get().n;
  add('حرکت‌گذاری در نام برند نیست', harakat === 0, `${harakat} مورد`);

  const spaced = db.prepare(`
    SELECT COUNT(*) n FROM products
    WHERE brand_fa != TRIM(brand_fa) OR brand_fa LIKE '%  %'
  `).get().n;
  add('فاصله اضافی در نام برند نیست', spaced === 0, `${spaced} مورد`);

  // ══ ۵) پوشش ══
  const brands = db.prepare('SELECT COUNT(DISTINCT brand_fa) n FROM products').get().n;
  add('همه برندها نام فارسی دارند', brands >= 125, `${brands} برند`);

  try { srv.kill('SIGKILL'); } catch {}
  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g('  نگارش نام برندها سالم است.\n')
    : r(`  ${failed} بررسی ناموفق.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
