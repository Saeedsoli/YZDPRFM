#!/usr/bin/env node
/**
 * اصلاح نگارش فارسی نام برندها.
 *
 * چرا مهم است:
 *   مشتری ایرانی برند را با املای جاافتاده در بازار می‌شناسد و
 *   همان را جستجو می‌کند. «آمواژ» به‌جای «آمواج» هم غلط دیده
 *   می‌شود و هم در جستجوی داخلی و گوگل پیدا نمی‌شود.
 *
 * روش:
 *   نگارش رایج از فروشگاه‌های معتبر ایرانی (عطرافشان، لیلیوم،
 *   مارسلا، رها) گرفته شده — نه ترجمه آوایی حدسی.
 *
 * ایمنی:
 *   • املای قدیمی به `search_blob` اضافه می‌شود تا اگر کسی با
 *     نگارش قبلی جستجو کرد، باز هم نتیجه بگیرد
 *   • `--dry` فقط گزارش می‌دهد
 *
 * اجرا:
 *   node scripts/fix_brand_names.js --dry
 *   node scripts/fix_brand_names.js
 */
'use strict';

const { db, normalizeFa, buildSearchIndex } = require('../src/db');

const DRY = process.argv.includes('--dry');
const g = s => `\x1b[32m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

/**
 * نگاشت اصلاح: نام لاتین → نگارش درست فارسی
 *
 * تنها مواردی اینجا هستند که با نگارش رایج بازار ایران فرق داشتند.
 * برندهایی که درست بودند (شنل، دیور، گرلن، …) دست نخورده‌اند.
 */
const FIXES = {
  /* نکته: «هیستویرز د پارفومز»، «لابراتواریو الفاتیو»،
     «لیکوییدز ایمجینایرز»، «نیکولای»، «ناینتین سیکستی ناین» و
     «فلورایکو» با جستجوی وب بررسی شدند و نگارش فعلی پایگاه با
     بازار ایران می‌خواند — دست نخوردند. */

  // ژ/ج — رایج‌ترین خطا
  'Amouage':            'آمواج',          // بود: آمواژ
  'Xerjoff':            'زرجوف',          // بود: زرجوف ✓ (تأیید شد)

  // نگارش جاافتاده متفاوت
  'Atelier Cologne':    'آتلیه کلون',      // بود: آتلیه کلن
  'Etat Libre d\'Orange': 'اتات لیبره د اورنج',  // بود: اتات لیبر دورنج
  'Initio Parfums Prives': 'اینیشیو پارفومز پرایوز',  // بود: اینیشیو
  'Juliette Has A Gun': 'ژولیت هز ای گان',  // بود: جولیت هز ا گان
  'Robert Piguet':      'روبرت پیگه',      // بود: ربرت پیگه
  'Thameen London':     'تامین لندن',      // بود: ثمین لندن
  'Ermenegildo Zegna':  'ارمنجیلدو زگنا',  // بود: ارمنجیلدو زنیا
  'Nishane':            'نیشان',           // بود: نیشانه
  'Lattafa Perfumes':   'لطافه',           // ✓ درست بود
  'Bottega Veneta':     'بوتگا ونتا',      // ✓
  'Maison Francis Kurkdjian': 'میسون فرانسیس کورکجان',  // ✓
  'Marc-Antoine Barrois': 'مارک آنتوان باروآ',  // بود: باروا
  'Matiere Premiere':   'ماتیر پرمیر',     // بود: ماتیره پرمیر
  'Fueguia 1833':       'فوگیا ۱۸۳۳',      // بود: فوگوییا
  'Stéphane Humbert Lucas 777': 'استفان هامبرت لوکاس ۷۷۷',
  'Bond No. 9':         'باند نامبر ۹',     // بود: باند نامبر ناین
  'Zoologist Perfumes': 'زولوژیست',        // ✓
  'V Canto':            'وی کانتو',        // ✓
  'BDK Parfums':        'بی دی کی پارفومز', // ✓
  'The Merchant of Venice': 'مرچنت آو ونیز',  // بود: د مرچنت آو ونیز
  'Vilhelm Parfumerie': 'ویلهلم پارفومری',  // ✓
  'Perris Monte Carlo': 'پریس مونت کارلو',  // ✓
  'Goldfield & Banks':  'گلدفیلد و بنکس',   // بود: گلدفیلد اند بنکس
  'Viktor & Rolf':      'ویکتور و رولف',    // بود: ویکتور اند رولف
  'Van Cleef & Arpels': 'ون کلیف و آرپلز',  // بود: ون کلیف اند آرپلز
  'Escentric Molecules': 'اسنتریک مولکولز', // بود: اسکنتریک
  'Swiss Arabian':      'سوئیس عربین',      // ✓
  'Ormonde Jayne':      'اورموند جین',      // ✓
  'Carner Barcelona':   'کارنر بارسلونا',   // ✓
  'Electimuss London':  'الکتیموس لندن',    // ✓
};

// فقط مواردی که واقعاً تغییر می‌کنند
const rows = db.prepare(
  'SELECT DISTINCT brand_en, brand_fa FROM products WHERE brand_en IS NOT NULL'
).all();

const changes = [];
for (const r of rows) {
  const want = FIXES[r.brand_en];
  if (want && want !== r.brand_fa) {
    const n = db.prepare('SELECT COUNT(*) n FROM products WHERE brand_en=?')
      .get(r.brand_en).n;
    changes.push({ en: r.brand_en, from: r.brand_fa, to: want, n });
  }
}

console.log(`\n  ${DRY ? y('حالت آزمایشی') : g('اصلاح نام برندها')}\n`);

if (!changes.length) {
  console.log('  همه نام‌ها درست‌اند.\n');
  process.exit(0);
}

changes.sort((a, b) => b.n - a.n);
for (const c of changes) {
  console.log(`  ${String(c.n).padStart(3)} محصول  ${c.en.padEnd(30)}`);
  console.log(`      ${c.from}  ${d('→')}  ${g(c.to)}`);
}

if (DRY) {
  console.log(`\n  ${changes.length} برند تغییر می‌کند. برای اعمال بدون --dry اجرا کنید.\n`);
  process.exit(0);
}

/* ── اعمال ──
   نام قدیمی در ستون جستجو نگه داشته می‌شود تا مشتری‌ای که با
   املای قبلی می‌گردد هم نتیجه بگیرد. */
const updBrand = db.prepare('UPDATE products SET brand_fa=? WHERE brand_en=?');
const updName = db.prepare('UPDATE products SET name_fa=? WHERE id=?');
const updTitle = db.prepare('UPDATE products SET title_fa_display=? WHERE id=?');

let brandCount = 0, nameCount = 0;

db.transaction(() => {
  for (const c of changes) {
    updBrand.run(c.to, c.en);
    brandCount++;

    /* نام محصول و عنوان نمایشی هم نام برند را در خود دارند
       («آمواژ — اینترلود») و باید همگام شوند، وگرنه کارت محصول
       نام برند قدیمی را نشان می‌دهد. */
    const prods = db.prepare(
      'SELECT id, name_fa, title_fa_display FROM products WHERE brand_en=?'
    ).all(c.en);

    for (const p of prods) {
      if (p.name_fa && p.name_fa.includes(c.from)) {
        updName.run(p.name_fa.split(c.from).join(c.to), p.id);
        nameCount++;
      }
      if (p.title_fa_display && p.title_fa_display.includes(c.from)) {
        updTitle.run(p.title_fa_display.split(c.from).join(c.to), p.id);
      }
    }
  }
})();

console.log(`\n  ${brandCount} برند و ${nameCount} نام محصول به‌روز شد.`);

// ── بازسازی ایندکس جستجو با نام‌های قدیمی به‌عنوان مترادف ──
const aliasMap = {};
for (const c of changes) aliasMap[c.en] = c.from;

const all = db.prepare('SELECT id, brand_en FROM products').all();
buildSearchIndex(true);

const addAlias = db.prepare(
  'UPDATE products SET search_blob = search_blob || ? WHERE id=?'
);
db.transaction(() => {
  for (const p of all) {
    const old = aliasMap[p.brand_en];
    if (old) addAlias.run(' ' + normalizeFa(old), p.id);
  }
})();

console.log(`  ایندکس جستجو بازسازی شد — املای قدیمی هم پیدا می‌شود.\n`);
