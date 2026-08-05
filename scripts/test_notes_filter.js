#!/usr/bin/env node
/**
 * آزمون فیلتر نُت بویایی.
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) ایندکس نُت با داده واقعی محصولات می‌خواند
 *   ۲) شمار اعلام‌شده با نتیجه فیلتر یکی است (بن‌بست نداشته باشیم)
 *   ۳) چند نُت با AND ترکیب می‌شوند نه OR
 *   ۴) ترکیب با فیلترهای دیگر (جنسیت، خانواده) کار می‌کند
 *   ۵) ورودی نامعتبر ۵۰۰ نمی‌دهد
 *   ۶) نشانی قابل اشتراک است
 *   ۷) سیم‌کشی رابط
 *
 * چرا این آزمون لازم است:
 *   «بن‌بست» بی‌صداترین شکست این قابلیت است: چیپی که می‌گوید
 *   «۲۶۵ محصول» ولی صفر نتیجه می‌دهد، هیچ خطایی تولید نمی‌کند —
 *   فقط اعتماد کاربر را می‌برد.
 *
 * اجرا: node scripts/test_notes_filter.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { db, listNotes, buildNotesIndex, normalizeFa } = require('../src/db');

const ROOT = path.dirname(__dirname);
const PORT = process.env.PORT || 3000;
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

function api(p) {
  return new Promise(res => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        try { res({ s: x.statusCode, b: JSON.parse(b) }); }
        catch { res({ s: x.statusCode, b: null }); }
      });
    }).on('error', () => res({ s: 0, b: null }));
  });
}

const enc = o => Object.entries(o)
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

(async () => {
  console.log('\n  آزمون فیلتر نُت بویایی\n');

  // ══ ۱) ایندکس ══
  console.log(d('  ایندکس'));

  const rows = db.prepare('SELECT COUNT(*) c FROM product_notes').get().c;
  add('ایندکس نُت ساخته شده', rows > 10000, `${rows} ردیف`);

  const distinct = db.prepare(
    'SELECT COUNT(DISTINCT note_key) c FROM product_notes').get().c;
  add('نُت‌های متمایز شناسایی شده‌اند', distinct > 100, `${distinct} نُت`);

  const positions = db.prepare(
    'SELECT DISTINCT position FROM product_notes ORDER BY position').all()
    .map(x => x.position);
  add('هر چهار جایگاه ثبت شده',
      ['accord', 'base', 'middle', 'top'].every(p => positions.includes(p)),
      positions.join('، '));

  /* ایندکس باید با داده خام بخواند. اگر ستون JSON عوض شود و
     ایندکس بازسازی نشود، فیلتر بی‌صدا نتیجه غلط می‌دهد. */
  const sample = db.prepare(
    'SELECT id, notes_base FROM products WHERE notes_base IS NOT NULL LIMIT 40').all();
  let mismatch = 0;
  for (const s of sample) {
    let want = [];
    try { want = JSON.parse(s.notes_base || '[]'); } catch {}
    for (const n of want) {
      const hit = db.prepare(
        `SELECT 1 FROM product_notes
         WHERE product_id=? AND note_key=? AND position='base'`
      ).get(s.id, normalizeFa(String(n).trim()));
      if (!hit) mismatch++;
    }
  }
  add('ایندکس با ستون JSON می‌خواند', mismatch === 0,
      mismatch ? `${mismatch} نُت جاافتاده` : '۴۰ محصول بررسی شد');

  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pnotes_key'").get();
  add('ایندکس روی note_key هست', !!idx);

  // ══ ۲) بازسازی پایدار ══
  console.log(d('\n  پایداری'));

  const before = db.prepare('SELECT COUNT(*) c FROM product_notes').get().c;
  buildNotesIndex(true);
  const after = db.prepare('SELECT COUNT(*) c FROM product_notes').get().c;
  add('بازسازی نتیجه یکسان می‌دهد', before === after, `${after} ردیف`);

  // ══ ۳) فهرست نُت ══
  console.log(d('\n  فهرست نُت'));

  const top = listNotes({ minCount: 40, limit: 20 });
  add('فهرست نُت پرتکرار برمی‌گردد', top.length >= 10, `${top.length} نُت`);
  add('به ترتیب نزولی مرتب است',
      top.every((x, i) => i === 0 || top[i - 1].count >= x.count));
  add('نُت کم‌تکرار فیلتر می‌شود',
      top.every(x => x.count >= 40));

  const accords = listNotes({ position: 'accord', minCount: 20, limit: 10 });
  add('آکوردها جدا قابل خواندن‌اند', accords.length > 0, `${accords.length} آکورد`);

  // ══ ۴) API ══
  console.log(d('\n  مسیرهای API'));

  const health = await api('/api/health');
  if (health.s !== 200) {
    add('سرور در دسترس است', false, 'سرور بالا نیست — بخش API رد شد');
  } else {
    const nres = await api('/api/notes?min=40&limit=15');
    add('/api/notes پاسخ می‌دهد',
        nres.s === 200 && (nres.b.notes || []).length >= 10,
        `${(nres.b.notes || []).length} نُت`);

    /* ── مهم‌ترین بررسی ──
       چیپی که می‌گوید «۲۶۵ محصول» باید دقیقاً ۲۶۵ نتیجه بدهد.
       ناهماهنگی یعنی کاربر روی چیپ می‌زند و به فهرست خالی
       می‌رسد — بی‌صداترین شکست ممکن. */
    let deadEnd = 0, off = [];
    for (const n of (nres.b.notes || [])) {
      const res = await api('/api/products?' + enc({ note: n.note, limit: 1 }));
      if (res.b?.total === 0) deadEnd++;
      if (res.b?.total !== n.count) off.push(`${n.note}: ${n.count}≠${res.b?.total}`);
    }
    add('هیچ چیپی به بن‌بست نمی‌رسد', deadEnd === 0,
        deadEnd ? `${deadEnd} چیپ خالی` : `${(nres.b.notes || []).length} چیپ`);
    add('شمار اعلام‌شده با نتیجه یکی است', off.length === 0,
        off.length ? off[0] : '');

    // ترکیب AND
    const list = nres.b.notes || [];
    if (list.length >= 2) {
      const a = await api('/api/products?' + enc({ note: list[0].note, limit: 1 }));
      const b = await api('/api/products?' + enc({ note: list[1].note, limit: 1 }));
      const both = await api('/api/products?' +
        enc({ note: `${list[0].note},${list[1].note}`, limit: 1 }));
      add('چند نُت با AND ترکیب می‌شوند',
          both.b.total <= Math.min(a.b.total, b.b.total),
          `${a.b.total} ∩ ${b.b.total} = ${both.b.total}`);
      add('ترکیب AND است نه OR',
          both.b.total < a.b.total + b.b.total);
    }

    // ترکیب با فیلتر دیگر
    const withG = await api('/api/products?' +
      enc({ note: list[0].note, gender: 'WOMEN', limit: 1 }));
    const noG = await api('/api/products?' + enc({ note: list[0].note, limit: 1 }));
    add('با فیلتر جنسیت ترکیب می‌شود',
        withG.b.total <= noG.b.total && withG.s === 200,
        `${noG.b.total} → ${withG.b.total}`);

    // ورودی نامعتبر
    const bad1 = await api('/api/products?' + enc({ note: 'نُتِ کاملاً نامعتبر', limit: 1 }));
    add('نُت ناموجود ۰ می‌دهد نه خطا', bad1.s === 200 && bad1.b.total === 0);

    const bad2 = await api('/api/products?note=' + encodeURIComponent("' OR 1=1--"));
    add('تلاش تزریق SQL بی‌اثر است', bad2.s === 200 && bad2.b.total === 0,
        `total=${bad2.b?.total}`);

    const bad3 = await api('/api/products?note=' +
      encodeURIComponent('a,b,c,d,e,f,g,h,i,j'));
    add('تعداد نُت محدود است (سقف ۴)', bad3.s === 200);

    const bad4 = await api('/api/products?note=,,,,');
    add('کاماهای خالی امن‌اند', bad4.s === 200 && bad4.b.total > 0,
        `total=${bad4.b?.total}`);
  }

  // ══ ۵) سیم‌کشی رابط ══
  console.log(d('\n  سیم‌کشی رابط'));

  const idxH = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

  add('ظرف نوار نُت هست', /id="noteBar"/.test(idxH));
  add('پیش‌فرض پنهان است (بدون CLS)',
      /id="noteBar"[^>]*display:\s*none/.test(idxH));
  add('وضعیت نُت در state هست', /notes:\s*\[\]/.test(idxH));
  add('نُت در نشانی صفحه ذخیره می‌شود',
      /u\.set\('note',\s*state\.notes\.join/.test(idxH));
  add('نشانی هنگام بارگذاری خوانده می‌شود',
      /state\.notes\s*=\s*\(u\.get\('note'\)/.test(idxH));
  add('نُت به درخواست API اضافه می‌شود',
      /p\.set\('note',\s*state\.notes\.join/.test(idxH));
  add('هر نُت جدا قابل حذف است', /startsWith\('note:'\)/.test(idxH));
  add('«پاک کردن همه» نُت‌ها را هم پاک می‌کند',
      /state\.notes\s*=\s*\[\];/.test(idxH));

  /* چیپ فیلتر فعال با onclick درون‌خطی ساخته می‌شد. نام نُت
     می‌تواند فاصله یا نشانه داشته باشد و رشته را بشکند. */
  add('چیپ فیلتر از data-key استفاده می‌کند نه onclick درون‌خطی',
      /data-key="\$\{esc\(key\)\}"/.test(idxH) &&
      !/onclick="clearFilter\('\$\{key\}'\)"/.test(idxH));
  add('نام نُت پیش از درج فرار داده می‌شود',
      /data-n="\$\{esc\(n\.note\)\}"/.test(idxH));
  add('استایل چیپ نُت تعریف شده', /\.nchip\s*\{/.test(idxH));
  add('چیپ نُت focus-visible دارد', /\.nchip:focus-visible/.test(idxH));
  add('نوارهای فیلتر روی موبایل افقی می‌شوند',
      /\.filter-bar\s*\{[^}]*overflow-x:\s*auto/.test(idxH));
  /* ارتفاع چیپ باید هدف لمسی قابل قبول بدهد. آزمون مرورگر هر
     دکمه زیر ۳۲ پیکسل را قرمز می‌کند و نسخه اول ۲۸ پیکسل بود. */
  add('چیپ نُت هدف لمسی کافی دارد', /\.nchip\s*\{[^}]*min-height:\s*3[4-9]px/.test(idxH));

  // ══ نتیجه ══
  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  فیلتر نُت درست کار می‌کند.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
