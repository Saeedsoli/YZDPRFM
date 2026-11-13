#!/usr/bin/env node

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

  console.log(d('  نگارش تأییدشده'));
  const wrong = [];
  for (const [en, fa] of Object.entries(EXPECTED)) {
    const row = db.prepare('SELECT brand_fa FROM products WHERE brand_en=? LIMIT 1').get(en);
    if (!row) continue;
    if (row.brand_fa !== fa) wrong.push(`${en}: «${row.brand_fa}» به‌جای «${fa}»`);
  }
  add('نام برندهای شاخص درست است', wrong.length === 0,
      wrong.length ? wrong[0] : `${Object.keys(EXPECTED).length} برند`);

  console.log(d('\n  سازگاری با املای قدیمی'));
  for (const old of OLD_SPELLINGS) {
    const res = await fetch(
      `${BASE}/api/products?q=${encodeURIComponent(old)}&limit=1`
    ).then(r => r.json());
    add(`«${old}» هنوز نتیجه می‌دهد`, res.total > 0, `${res.total} نتیجه`);
  }

  console.log(d('\n  یکپارچگی داده'));

  const genericTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='generic_scent_price_evidence'").get();
  const missing = db.prepare("SELECT id,brand_en FROM products WHERE brand_fa IS NULL OR brand_fa=''").all();
  const allowed = new Set(['GEN-SCENT-0001','GEN-SCENT-0002','GEN-SCENT-0003','GEN-SCENT-0004','GEN-SCENT-0005','GEN-SCENT-0006','GEN-SCENT-0007','GEN-SCENT-0008','GEN-SCENT-0009','GEN-SCENT-0010','GEN-SCENT-0011']);
  const evidence = genericTable ? db.prepare("SELECT 1 FROM generic_scent_price_evidence WHERE product_id=? AND status='owner_approved_generic_supplier_composition_unverified'") : null;
  const bad = missing.filter(p => !allowed.has(p.id) || p.brand_en || !evidence || !evidence.get(p.id));
  add('برند فارسی محصولات مشخص است؛ رایحه عمومی شاهد جداگانه دارد', bad.length === 0, `${bad.length} مورد`);

  const CONNECTORS = ['د', 'دو', 'دِ', 'آو', 'او', 'له', 'لا', 'بای',
                      'میس', 'مای', 'مستر', 'مون', 'لو', 'بلو', 'تق',
                      'پاشا', 'ویاژ', 'لنستان'];

  const WORDPLAY = ['دیوراما'];
  const dupRows = db.prepare(`
    SELECT name_fa, brand_fa FROM products
    WHERE brand_fa IS NOT NULL AND name_fa LIKE '%' || brand_fa || '%'
  `).all();

  const trueDup = dupRows.filter(r => {

    if (/\([^)]*\)/.test(r.name_fa)) {
      const outside = r.name_fa.replace(/\([^)]*\)/g, '').trim();
      if (!outside.includes(r.brand_fa)) return false;
    }
    const rest = r.name_fa.split(r.brand_fa).join(' ').replace(/\s+/g, ' ').trim();
    if (rest.length < 3) return false;
    const words = rest.split(/\s+/).filter(Boolean);

    if (words.some(w => CONNECTORS.includes(w))) return false;

    if (WORDPLAY.some(w => r.name_fa.includes(w))) return false;

    return true;
  });

  add('نام محصول برند را بی‌جهت تکرار نمی‌کند', trueDup.length === 0,
      trueDup.length
        ? trueDup.slice(0, 3).map(r => `${r.brand_fa}—${r.name_fa}`).join(' · ')
        : `${dupRows.length} مورد بررسی شد · همه نام رسمی‌اند (بلو د شنل، میس دیور، …)`);

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

  const marked = db.prepare(
    "SELECT id,brand_fa FROM products WHERE brand_fa GLOB '*[\u064B-\u0652]*'"
  ).all();
  const missingMarked = [];
  for (const row of marked) {
    const without = row.brand_fa.replace(/[\u064B-\u0652\u0670]/g,'');
    const response = await fetch(`${BASE}/api/products?q=${encodeURIComponent(without)}&limit=100`).then(r=>r.json());
    if (!(response.products || []).some(p=>p.id===row.id)) missingMarked.push(row.id);
  }
  add('جستجوی برند بدون حرکت‌گذاری محصول را پیدا می‌کند', missingMarked.length === 0,
      missingMarked.length ? missingMarked.join('، ') : `${marked.length} محصول بررسی شد`);

  const spaced = db.prepare(`
    SELECT COUNT(*) n FROM products
    WHERE brand_fa != TRIM(brand_fa) OR brand_fa LIKE '%  %'
  `).get().n;
  add('فاصله اضافی در نام برند نیست', spaced === 0, `${spaced} مورد`);

  const brands = db.prepare('SELECT COUNT(DISTINCT brand_fa) n FROM products').get().n;
  const noFa = db.prepare(
    "SELECT COUNT(DISTINCT brand_en) n FROM products WHERE brand_fa IS NULL OR TRIM(brand_fa) = ''"
  ).get().n;
  add('همه برندها نام فارسی دارند', noFa === 0,
      `${brands} برند · ${noFa} بدون نام فارسی`);

  try { srv.kill('SIGKILL'); } catch {}
  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g('  نگارش نام برندها سالم است.\n')
    : r(`  ${failed} بررسی ناموفق.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
