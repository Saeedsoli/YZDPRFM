#!/usr/bin/env node
/**
 * ممیزی صحت مستندات — آیا اسناد حقیقت را می‌گویند؟
 *
 * تفاوت با `audit_docs.js`:
 *   آن ابزار می‌پرسد «آیا فایلی که سند نام برده وجود دارد؟»
 *   این ابزار می‌پرسد «آیا **عددی** که سند ادعا کرده درست است؟»
 *
 * چرا لازم شد:
 *   سندی که می‌گوید «server.js ۲٬۸۰۶ خط است» وقتی فایل ۲٬۱۶۹ خط
 *   دارد، از نبودِ سند بدتر است — چون خواننده به آن اعتماد می‌کند
 *   و تصمیم اشتباه می‌گیرد. این عددها با هر تغییر کد کهنه می‌شوند
 *   و هیچ‌کس متوجه نمی‌شود.
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) عددهای زنده — خط کد، تعداد جدول، صفحه، محصول، اسکریپت
 *   ۲) ادعاهای وضعیت — «انجام شد»ی که هنوز انجام نشده
 *   ۳) پیوستگی — سندهای مختلف عدد متناقض ندهند
 *   ۴) نام‌گذاری — الگوی نام فایل‌ها یکدست باشد
 *   ۵) خوانایی — سند بدون عنوان یا بیش از حد بلند
 *
 * قرارداد «عدد زنده»:
 *   هر ادعای عددی که به کد وابسته است باید در جدول `LIVE` زیر
 *   ثبت شود تا خودکار سنجیده شود. عددهای تاریخی (مثل «گام ۴:
 *   ۳٬۱۸۴ خط») از این قاعده مستثنا هستند و باید در بافت تاریخی
 *   باشند.
 *
 * اجرا: node scripts/audit_docs_truth.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const DOCS = path.join(ROOT, 'docs');

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const h = s => `\x1b[1m${s}\x1b[0m`;

let problems = 0;
let warnings = 0;
const ok = (m, n) => console.log(`  ${g('✓')} ${m}${n ? d('  — ' + n) : ''}`);
const bad = (m, n) => { problems++; console.log(`  ${r('✗')} ${m}${n ? d('  — ' + n) : ''}`); };
const warn = (m, n) => { warnings++; console.log(`  ${y('!')} ${m}${n ? d('  — ' + n) : ''}`); };

/** رقم فارسی → لاتین، و حذف جداکننده هزارگان */
const toEn = s => String(s)
  .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
  .replace(/[٬,]/g, '');

/** همه صورت‌های نوشتاری یک عدد: ۲۱۱۱ · ۲٬۱۱۱ · 2111 · 2,111 */
function numForms(n) {
  const en = String(n);
  const fa = en.replace(/\d/g, c => '۰۱۲۳۴۵۶۷۸۹'[c]);
  const grp = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const grpFa = fa.replace(/\B(?=(.{3})+(?!.))/g, '٬');
  return [...new Set([en, fa, grp(en), grpFa])];
}

const mdFiles = fs.readdirSync(DOCS).filter(f => f.endsWith('.md'));
const readDoc = f => fs.readFileSync(path.join(DOCS, f), 'utf8');
const allDocs = mdFiles.map(f => ({ name: f, txt: readDoc(f) }));

/* ── سند تاریخی در برابر سند زنده ──
   دو گونه سند داریم و سنجیدنشان با یک معیار، خطا می‌سازد:

     تاریخی — ممیزی، تغییرنامه، سنجش. عمداً وضعیت **یک لحظه از
              گذشته** را ثبت کرده‌اند. «۱۱ جدول» در ممیزی تیر ماه
              درست است، حتی اگر امروز ۲۷ جدول داشته باشیم. تغییر
              دادنشان یعنی تحریف تاریخ.

     زنده   — مرجع، معماری، فهرست، وضعیت. باید **همیشه** امروز را
              بگویند. عدد کهنه در این‌ها خطاست.

   الگوی نام تاریخی: تاریخ در نام، یا پیشوند AUDIT/BENCHMARK/CHANGELOG. */
const HISTORICAL = /^(AUDIT|BENCHMARK|CHANGELOG|DEEP_AUDIT|GAP_ANALYSIS|GOALS_VS_DELIVERED)/;
const isHistorical = n => HISTORICAL.test(n) || /-\d{4}-\d{2}/.test(n);
const liveDocs = allDocs.filter(x => !isHistorical(x.name));

console.log();
console.log(h('  ممیزی صحت مستندات'));
console.log(d('  ═══════════════════════════════════════════════'));

/* ══════════════════════════════════════════
   ۱) عددهای زنده
   ══════════════════════════════════════════ */
console.log();
console.log(h('  ۱) عددهای زنده — ادعا در برابر واقعیت'));
console.log();

const countLines = p => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').length;

let dbTables = 0, dbProducts = 0, dbVariants = 0;
try {
  const { db } = require('../src/db');
  dbTables = db.prepare(
    "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).get().c;
  dbProducts = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  dbVariants = db.prepare('SELECT COUNT(*) c FROM variants').get().c;
} catch (e) {
  warn('دیتابیس خوانده نشد — بررسی‌های وابسته رد شد', e.message.slice(0, 40));
}

/**
 * هر قلم: توضیح، مقدار واقعی، و الگویی که ادعا را در متن پیدا می‌کند.
 * گروه ۱ الگو باید خودِ عدد باشد.
 */
const LIVE = [
  {
    label: 'خط‌های src/server.js',
    real: countLines('src/server.js'),
    re: /`?server\.js`?[^.\n]{0,40}?([\d۰-۹٬,]+)\s*خط|([\d۰-۹٬,]+)\s*خط[^.\n]{0,20}`?server\.js/g,
    skipDocs: ['SERVER_MODULARIZATION.md'],
    note: 'تاریخچه تفکیک مستثناست'
  },
  {
    label: 'تعداد محصول',
    real: dbProducts,
    re: /([\d۰-۹٬,]+)\s*(?:عطر|محصول)\b/g,
    min: 1000
  },
  {
    label: 'تعداد جدول دیتابیس',
    real: dbTables,
    re: /([\d۰-۹٬,]+)\s*جدول/g,
    min: 10
  },
  {
    label: 'تعداد صفحه HTML',
    real: fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.html')).length,
    re: /([\d۰-۹٬,]+)\s*صفحه\b/g,
    min: 15
  },
  {
    label: 'تعداد اسکریپت',
    real: fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => /\.(js|py|sh)$/.test(f)).length,
    re: /([\d۰-۹٬,]+)\s*اسکریپت/g,
    min: 20
  },
  {
    label: 'تعداد سند',
    real: mdFiles.length,
    re: /([\d۰-۹٬,]+)\s*سند/g,
    min: 20
  }
];

for (const item of LIVE) {
  if (!item.real) continue;
  const okForms = new Set(numForms(item.real));
  const wrong = [];

  /* فقط سندهای زنده سنجیده می‌شوند — ممیزی تیر ماه حق دارد
     بگوید آن روز ۱۱ جدول داشتیم. */
  for (const { name, txt } of liveDocs) {
    if ((item.skipDocs || []).includes(name)) continue;
    const lines = txt.split('\n');
    let m;
    item.re.lastIndex = 0;
    while ((m = item.re.exec(txt))) {
      const raw = m[1] || m[2];
      if (!raw) continue;
      const val = parseInt(toEn(raw), 10);
      if (isNaN(val)) continue;
      if (item.min && val < item.min) continue;   // عدد بی‌ربط
      if (okForms.has(raw.trim())) continue;      // درست است
      const ln = txt.slice(0, m.index).split('\n').length;
      const ctx = (lines[ln - 1] || '').trim().slice(0, 62);
      wrong.push(`${name}:${ln}  «${ctx}»`);
    }
  }

  if (!wrong.length) {
    ok(`${item.label} = ${item.real}`, item.note);
  } else {
    bad(`${item.label} — واقعیت ${item.real}، ${wrong.length} ادعای ناهمخوان`);
    wrong.slice(0, 4).forEach(w => console.log(d('        ' + w)));
    if (wrong.length > 4) console.log(d(`        … و ${wrong.length - 4} مورد دیگر`));
  }
}

/* ══════════════════════════════════════════
   ۲) ادعاهای وضعیت
   ══════════════════════════════════════════ */
console.log();
console.log(h('  ۲) ادعاهای وضعیت — آیا با واقعیت می‌خواند؟'));
console.log();

let settings = {};
try { settings = require('../src/db').getSettings(); } catch {}

/* هر قلم: شرطی که اگر **درست** باشد، ادعای «هنوز نشده» کهنه است */
const STATE = [
  {
    label: 'کد اینماد',
    done: !!(settings.enamad_id && settings.enamad_code),
    /* سه صورت نوشتاری که همگی یعنی «ثبت نشده». نسخه اول فقط
       صورت اول را می‌گرفت و بندی که نوشته بود «enamad_code خالی»
       از زیرش رد شد — سند کهنه ماند و ممیزی سبز داد.
       الگو باید هر سه را بگیرد، وگرنه خودِ ابزار دروغ می‌گوید. */
    staleRe: /(?:(?:کد )?(?:نماد|اینماد)[^\n]{0,60}(?:وارد نشده|ثبت نشده|خالی|ندارد)|enamad_code\s*خالی|نشان «?آزمایشی»?\s*می‌دهد)/g,
    hint: 'شناسه در دیتابیس ثبت شده — سندی که می‌گوید خالی است کهنه شده'
  },
  {
    label: 'رمز پیش‌فرض مدیر',
    done: (process.env.ADMIN_PASSWORD || 'yazd1404') !== 'yazd1404',
    staleRe: /رمز[^\n]{0,40}(عوض شده|تغییر کرده است)/g,
    hint: 'رمز هنوز پیش‌فرض است'
  }
];

for (const s of STATE) {
  const hits = [];
  for (const { name, txt } of liveDocs) {
    s.staleRe.lastIndex = 0;
    let m;
    while ((m = s.staleRe.exec(txt))) {
      const ln = txt.slice(0, m.index).split('\n').length;
      hits.push(`${name}:${ln}  «${m[0].trim().slice(0, 58)}»`);
    }
  }
  if (s.done && hits.length) {
    bad(`${s.label}: انجام شده ولی ${hits.length} سند خلافش را می‌گوید`, s.hint);
    hits.slice(0, 5).forEach(x => console.log(d('        ' + x)));
    if (hits.length > 5) console.log(d(`        … و ${hits.length - 5} مورد دیگر`));
  } else if (s.done) {
    ok(`${s.label}: انجام شده و هیچ سندی خلافش نمی‌گوید`);
  } else {
    ok(`${s.label}: هنوز انجام نشده`, 'اسناد باید همین را بگویند');
  }
}

/* ══════════════════════════════════════════
   ۳) پیوستگی میان اسناد
   ══════════════════════════════════════════ */
console.log();
console.log(h('  ۳) پیوستگی — سندها یکدیگر را نقض نکنند'));
console.log();

/* قوانین کسب‌وکار که در چند سند تکرار شده‌اند. اگر عددی
   جابه‌جا شود ولی همه‌جا به‌روز نشود، مشتری دو وعده متفاوت
   می‌بیند — و این از خطای فنی بدتر است. */
const RULES = [
  { label: 'ارسال سراسری',  re: /(?:سراسری|پست و تیپاکس)[^\n]{0,30}?([\d۰-۹٬,]{6,})/g },
  { label: 'ارسال یزد',     re: /(?:شهر یزد|یزد)[^\n]{0,26}?([\d۰-۹٬,]{6,})\s*تومان/g },
  { label: 'آستانه رایگان', re: /رایگان[^\n]{0,26}?([\d۰-۹٬,]{7,})/g }
];

for (const rule of RULES) {
  const found = new Map();
  for (const { name, txt } of liveDocs) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(txt))) {
      const v = toEn(m[1]);
      if (!/^\d+$/.test(v)) continue;
      if (!found.has(v)) found.set(v, []);
      found.get(v).push(name);
    }
  }
  const vals = [...found.keys()];
  if (vals.length <= 1) {
    ok(`${rule.label} همه‌جا یکسان`, vals[0] ? Number(vals[0]).toLocaleString('fa-IR') : 'ذکر نشده');
  } else {
    bad(`${rule.label} — ${vals.length} مقدار متفاوت در اسناد`);
    vals.forEach(v => console.log(d(
      `        ${Number(v).toLocaleString('fa-IR')}  ←  ${[...new Set(found.get(v))].slice(0, 3).join('، ')}`)));
  }
}

/* ══════════════════════════════════════════
   ۴) نام‌گذاری و جاگذاری
   ══════════════════════════════════════════ */
console.log();
console.log(h('  ۴) نام‌گذاری و جاگذاری فایل‌ها'));
console.log();

/* الگوی نام: حروف بزرگ و زیرخط، با پسوند تاریخ اختیاری.
   `AUDIT_2026-07-28.md` و `DEEP_AUDIT_2026-07.md` هر دو معتبرند —
   نسخه اول این الگو خط تیره را فقط پس از بخش تاریخ می‌پذیرفت و
   این چهار سند را بی‌دلیل خطا می‌داد. */
const NAME_RE = /^[A-Z][A-Z0-9_]*(?:_\d{4}-\d{2}(?:-\d{2})?)?\.md$/;
const oddNames = mdFiles.filter(f => f !== 'README.md' && !NAME_RE.test(f));
if (!oddNames.length) ok(`هر ${mdFiles.length} سند از الگوی نام یکسان پیروی می‌کند`,
  'حروف بزرگ و زیرخط · تاریخ‌دارها با _YYYY-MM-DD');
else { bad(`${oddNames.length} سند نام غیرالگو دارد`); oddNames.forEach(f => console.log(d('        ' + f))); }

/* نام باید بگوید داخلش چیست. سندی به نام `AUDIT_V3` یا `PRD`
   برای کسی که تازه وارد پروژه شده هیچ معنایی ندارد. */
const CRYPTIC = { 'PRD.md': 'سند نیازمندی محصول', 'AUDIT_V3.md': 'ممیزی نسخه سوم',
                  'IA_TAXONOMY.md': 'معماری اطلاعات', 'DATA_CONTRACT.md': 'قرارداد داده' };
const unexplained = Object.keys(CRYPTIC)
  .filter(f => mdFiles.includes(f))
  .filter(f => {
    const first = readDoc(f).split('\n').slice(0, 8).join(' ');
    return !first.includes(CRYPTIC[f].split(' ')[0]);
  });
if (!unexplained.length) ok('نام‌های مخفف در عنوان سند توضیح داده شده‌اند');
else {
  warn(`${unexplained.length} سند نام مخفف بدون توضیح دارد`);
  unexplained.forEach(f => console.log(d(`        ${f}  →  ${CRYPTIC[f]}`)));
}

// سند بدون عنوان سطح‌یک
const noTitle = allDocs.filter(x => !/^#\s+\S/m.test(x.txt));
if (!noTitle.length) ok('هر سند عنوان سطح‌یک دارد');
else { bad(`${noTitle.length} سند بدون عنوان`); noTitle.forEach(x => console.log(d('        ' + x.name))); }

/* فایل غیر md در docs.
   `samples/` استثناست: نمونه خروجی‌های پنل (فاکتور، برچسب، CSV)
   عمداً کنار مستنداتشان می‌مانند تا کسی که `samples/README.md`
   را می‌خواند، فایل‌ها را همان‌جا ببیند. */
const ALLOWED_DIRS = ['samples'];
const stray = fs.readdirSync(DOCS)
  .filter(f => !f.endsWith('.md'))
  .filter(f => !ALLOWED_DIRS.includes(f));
if (!stray.length) ok('پوشه docs فقط سند دارد', 'تصویر و خروجی جای دیگر');
else { warn(`${stray.length} فایل غیرسند در docs`); stray.forEach(f => console.log(d('        ' + f))); }

// README ریشه باید باشد
if (fs.existsSync(path.join(ROOT, 'README.md'))) ok('README در ریشه پروژه هست');
else bad('README در ریشه نیست');

/* ══════════════════════════════════════════
   ۵) خوانایی
   ══════════════════════════════════════════ */
console.log();
console.log(h('  ۵) خوانایی برای خواننده غیرمتخصص'));
console.log();

/* سند بلند فی‌نفسه بد نیست — تغییرنامه‌ای که ۳۸ کار را ثبت
   می‌کند طبعاً بلند است. آنچه خواننده را گم می‌کند، سند بلندِ
   **بدون فهرست** است. پس معیار «فهرست دارد یا نه». */
const LONG = 1200;
const longNoToc = allDocs
  .map(x => ({ name: x.name, n: x.txt.split('\n').length, txt: x.txt }))
  .filter(x => x.n > LONG)
  .filter(x => !/^##\s*فهرست مطالب/m.test(x.txt))
  .sort((a, b) => b.n - a.n);

if (!longNoToc.length) ok(`هر سند بلندتر از ${LONG} خط فهرست مطالب دارد`);
else {
  warn(`${longNoToc.length} سند بلند بدون فهرست مطالب`);
  longNoToc.slice(0, 5).forEach(x => console.log(d(`        ${x.name}  ${x.n} خط`)));
}

// سند بدون هیچ عنوان دوم — یعنی دیوار متن
const noSections = allDocs.filter(x => (x.txt.match(/^##\s+/gm) || []).length === 0);
if (!noSections.length) ok('هر سند به بخش‌های عنوان‌دار شکسته شده');
else { warn(`${noSections.length} سند بدون بخش‌بندی`); noSections.forEach(x => console.log(d('        ' + x.name))); }

/* واژه‌های انگلیسی که معادل فارسی جاافتاده دارند. متن فارسی که
   وسطش «deploy» و «cache» باشد، برای خواننده غیرمتخصص سکته دارد.
   نام ابزار و کد مستثناست (داخل بک‌تیک). */
const JARGON = {
  'deploy': 'استقرار', 'cache': 'کش', 'endpoint': 'مسیر',
  'commit': 'ثبت', 'rollback': 'بازگردانی', 'query': 'کوئری'
};
/* فقط اسناد زنده. متن ممیزی تیر ماه را دست نمی‌زنیم — ویرایش
   یک گزارش گذشته برای زیباتر شدنش، تحریف است. */
const jargonHits = [];
for (const { name, txt } of liveDocs) {
  const clean = txt
    .replace(/```[\s\S]*?```/g, '')   // بلوک کد
    .replace(/`[^`]*`/g, '')          // کد درون‌خطی
    .replace(/\[[^\]]*\]\([^)]*\)/g, ''); // لینک
  for (const [w, fa] of Object.entries(JARGON)) {
    const re = new RegExp(`\\b${w}\\b`, 'gi');
    const n = (clean.match(re) || []).length;
    if (n) jargonHits.push(`${name}: «${w}» ${n} بار → ${fa}`);
  }
}
if (!jargonHits.length) ok('واژه انگلیسی رهاشده در متن فارسی نیست');
else {
  warn(`${jargonHits.length} مورد واژه انگلیسی بیرون از بک‌تیک`);
  jargonHits.slice(0, 6).forEach(x => console.log(d('        ' + x)));
}

/* ── سال شمسی ──
   پروژه در ۱۴۰۵ ساخته شده. تاریخ ۱۴۰۴ یعنی اشتباه تایپی، و در
   سندی که «چه زمانی چه شد» را ثبت می‌کند، سال غلط کل ترتیب
   رویدادها را به هم می‌ریزد. */
const badYear = [];
for (const { name, txt } of allDocs) {
  const m = txt.match(/۱۴۰[0-3۰-۳]\s*\/|۱۴۰[0-3۰-۳]\s+(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)/g);
  if (m) badYear.push(`${name}: ${[...new Set(m)].join('، ')}`);
}
if (!badYear.length) ok('هیچ سندی سال شمسی نادرست ندارد', 'پروژه در ۱۴۰۵');
else { bad(`${badYear.length} سند سال مشکوک دارد`); badYear.forEach(x => console.log(d('        ' + x))); }

/* ── سند زنده باید بگوید زنده است ──
   خواننده باید در نگاه اول بداند سندی که می‌خواند «وضعیت امروز»
   است یا «عکس گذشته». بدون این نشانه، ممیزی تیر ماه با مرجع
   امروز یکسان به نظر می‌رسد. */
const KEY_LIVE = ['DATABASE_SCHEMA.md', 'API_REFERENCE.md', 'STATUS_CHECKLIST.md',
                  'FILE_INDEX.md', 'ARCHITECTURE.md'];
const unmarked = KEY_LIVE
  .filter(f => mdFiles.includes(f))
  .filter(f => !/زنده|به‌روز می‌شود|وضعیت امروز/.test(readDoc(f).slice(0, 900)));
if (!unmarked.length) ok('سندهای مرجع کلیدی «زنده» بودنشان را اعلام می‌کنند');
else {
  warn(`${unmarked.length} سند مرجع بدون نشانه «زنده»`);
  unmarked.forEach(f => console.log(d('        ' + f)));
}

/* ── سند تاریخی باید تاریخ داشته باشد ── */
/* الگو باید هر دو دستگاه رقم را بشناسد. نسخه اول `۱۴۰\d` نوشته
   بود — «۱۴۰» فارسی به‌علاوه رقم لاتین، که هرگز نمی‌خواند و هفت
   سند تاریخ‌دار را بی‌دلیل بی‌تاریخ گزارش کرد. */
const noDate = allDocs
  .filter(x => isHistorical(x.name))
  .filter(x => !/۱۴۰[۰-۹]|\d{4}-\d{2}-\d{2}|تاریخ/.test(x.txt.slice(0, 700)));
if (!noDate.length) ok('هر سند تاریخی، تاریخش را اعلام می‌کند');
else {
  warn(`${noDate.length} سند تاریخی بدون تاریخ`);
  noDate.forEach(x => console.log(d('        ' + x.name)));
}

/* ══════════════════════════════════════════
   جمع‌بندی
   ══════════════════════════════════════════ */
console.log();
console.log(d('  ═══════════════════════════════════════════════'));
if (problems === 0 && warnings === 0) {
  console.log(g('\n  مستندات با واقعیت می‌خوانند.\n'));
} else {
  const parts = [];
  if (problems) parts.push(r(`${problems} خطا`));
  if (warnings) parts.push(y(`${warnings} هشدار`));
  console.log(`\n  ${parts.join(' · ')}\n`);
}
process.exit(problems ? 1 : 0);
