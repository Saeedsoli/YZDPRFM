#!/usr/bin/env node
/**
 * ممیزی مستندات — آیا هر فایلی که مستندات وعده داده واقعاً هست؟
 *
 * چرا لازم است: در پروژه‌ای که ۴۰ سند دارد، مستند کهنه از نبودِ
 * مستند بدتر است. کسی که `FILE_INDEX.md` را می‌خواند و فایلی را
 * پیدا نمی‌کند، به کل مستندات بی‌اعتماد می‌شود.
 *
 * سه چیز را می‌سنجد:
 *   ۱) هر مسیر فایلی که در مستندات ذکر شده، واقعاً وجود دارد؟
 *   ۲) هر لینک داخلی بین سندها (‎[..](X.md)) به سند موجود می‌رسد؟
 *   ۳) هر اسکریپت واقعی در scripts/ در FILE_INDEX ذکر شده؟
 *
 * اجرا: node scripts/audit_docs.js
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

const mdFiles = [
  ...fs.readdirSync(DOCS).filter(f => f.endsWith('.md')).map(f => path.join(DOCS, f)),
  path.join(ROOT, 'README.md')
];

let problems = 0;

/* ── ۱) مسیرهای فایل ذکرشده در مستندات ── */
console.log('\n  ── فایل‌های ذکرشده در مستندات ──\n');

// فقط الگوهایی که قطعاً مسیر فایل‌اند: داخل بک‌تیک و با پسوند شناخته‌شده
const FILE_RE = /`([A-Za-z0-9_./\-]+\.(?:js|py|sh|html|css|json|md|db|png|jpg|webp|woff2|csv))`/g;

const missing = new Map();   // مسیر → سندهایی که ذکرش کرده‌اند

for (const md of mdFiles) {
  const txt = fs.readFileSync(md, 'utf8');
  const lines = txt.split('\n');
  let m;
  while ((m = FILE_RE.exec(txt))) {
    const ref = m[1];
    /* جدول‌های «مسیر قدیم ← مسیر جدید» در تغییرنامه: اگر در همان خط
       نامِ پایه دوباره با مسیر دیگری آمده، این یک سابقه تاریخی است
       نه ارجاع زنده. */
    const lineNo = txt.slice(0, m.index).split('\n').length - 1;
    const line = lines[lineNo] || '';
    const baseName = ref.split('/').pop();
    if (line.split(baseName).length > 2) continue;
    // نشانی وب یا نام عمومی را رد کن
    if (ref.startsWith('http')) continue;
    if (!ref.includes('/') && !/\.(js|py|sh)$/.test(ref)) continue;
    /* مسیرهای مطلقِ داخل کانتینر (‎/app/…) روی این ماشین وجود ندارند
       و نباید «گمشده» شمرده شوند. */
    if (ref.startsWith('/app/') || ref.startsWith('/home/')) continue;
    // مسیرهای نسبی داخل بلوک کد (‎../../src/…)
    if (ref.startsWith('../')) continue;

    // چند جای محتمل را امتحان کن
    const candidates = [
      path.join(ROOT, ref),
      path.join(DOCS, ref),
      path.join(ROOT, 'scripts', ref),
      path.join(ROOT, 'src', ref),
      path.join(ROOT, 'public', ref),
      path.join(ROOT, 'public', 'assets', ref),
      path.join(ROOT, 'seed', ref)
    ];
    if (candidates.some(c => fs.existsSync(c))) continue;

    /* ── سند تاریخی با یادداشت مهاجرت ──
       تغییرنامه‌ها مسیرهای زمان خودشان را ثبت کرده‌اند. وقتی
       ساختار پوشه‌ها عوض می‌شود، ویرایش آن متن یعنی تحریف تاریخ.
       راه درست: یادداشت «مسیر قدیم ← مسیر جدید» در سربرگ سند.

       اگر سند چنین یادداشتی دارد و مسیر گمشده در همان یادداشت
       نگاشت شده، ارجاع تاریخی است نه خطا. */
    if (/یادداشت مسیرها/.test(txt)) {
      const noteZone = txt.slice(0, txt.indexOf('یادداشت مسیرها') + 700);
      if (noteZone.includes(ref)) continue;
    }

    if (!missing.has(ref)) missing.set(ref, []);
    missing.get(ref).push(path.basename(md));
  }
}

if (missing.size === 0) {
  console.log(`  ${g('✓')} همه فایل‌های ذکرشده وجود دارند`);
} else {
  for (const [ref, docs] of missing) {
    console.log(`  ${r('✗')} ${ref}  ${d('← ' + [...new Set(docs)].join('، '))}`);
    problems++;
  }
}

/* ── ۲) لینک بین سندها ── */
console.log('\n  ── لینک‌های بین سندها ──\n');

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
let brokenLinks = 0;

for (const md of mdFiles) {
  const txt = fs.readFileSync(md, 'utf8');
  let m;
  while ((m = LINK_RE.exec(txt))) {
    let target = m[1].split('#')[0].trim();
    if (!target) continue;                       // لنگر خالص
    if (/^https?:|^mailto:|^computer:/.test(target)) continue;

    const base = path.dirname(md);
    if (!fs.existsSync(path.join(base, target)) &&
        !fs.existsSync(path.join(ROOT, target))) {
      console.log(`  ${r('✗')} ${path.basename(md)} → ${target}`);
      brokenLinks++; problems++;
    }
  }
}
if (!brokenLinks) console.log(`  ${g('✓')} همه لینک‌های داخلی سالم‌اند`);

/* ── ۳) اسکریپت‌هایی که در FILE_INDEX نیستند ── */
console.log('\n  ── پوشش FILE_INDEX ──\n');

const idxPath = path.join(DOCS, 'FILE_INDEX.md');
if (!fs.existsSync(idxPath)) {
  console.log(`  ${r('✗')} FILE_INDEX.md وجود ندارد`);
  problems++;
} else {
  const idx = fs.readFileSync(idxPath, 'utf8');
  const realScripts = fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter(f => /\.(js|py|sh)$/.test(f));
  const undocumented = realScripts.filter(s => !idx.includes(s));

  if (undocumented.length === 0) {
    console.log(`  ${g('✓')} هر ${realScripts.length} اسکریپت در فهرست هست`);
  } else {
    console.log(`  ${y('!')} ${undocumented.length} از ${realScripts.length} اسکریپت در FILE_INDEX نیست:`);
    undocumented.forEach(s => console.log('      ' + s));
    problems++;
  }

  // صفحات public هم باید پوشش داشته باشند
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.html'));
  const undocPages = pages.filter(p => !idx.includes(p));
  if (undocPages.length) {
    console.log(`  ${y('!')} صفحات بدون ذکر در FILE_INDEX: ${undocPages.join('، ')}`);
    problems++;
  } else {
    console.log(`  ${g('✓')} هر ${pages.length} صفحه در فهرست هست`);
  }

  // ماژول‌های src
  const mods = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
  const undocMods = mods.filter(p => !idx.includes(p));
  if (undocMods.length) {
    console.log(`  ${y('!')} ماژول‌های بدون ذکر: ${undocMods.join('، ')}`);
    problems++;
  } else {
    console.log(`  ${g('✓')} هر ${mods.length} ماژول در فهرست هست`);
  }
}

/* ── ۴) پوشش مسیرهای API ── */
console.log('\n  ── پوشش API_REFERENCE ──\n');

/* همه فایل‌های مسیر خوانده می‌شوند، نه فقط server.js.
   با تفکیک ماژول‌ها، مسیرهای منتقل‌شده از دید این ممیزی ناپدید
   می‌شدند و «در مستند هست ولی در کد نیست» گزارش می‌شدند —
   هشدار کاذبی که به‌مرور باعث بی‌اعتمادی به ممیزی می‌شود. */
const _routesDir = path.join(ROOT, 'src', 'routes');
const serverSrc = [
  fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8'),
  ...(fs.existsSync(_routesDir)
    ? fs.readdirSync(_routesDir).filter(f => f.endsWith('.js'))
        .map(f => fs.readFileSync(path.join(_routesDir, f), 'utf8'))
    : [])
].join('\n');
const codeRoutes = [...new Set(
  [...serverSrc.matchAll(/pathname === '(\/api\/[^']+)'/g)].map(m => m[1])
)].sort();

const apiDoc = fs.existsSync(path.join(DOCS, 'API_REFERENCE.md'))
  ? fs.readFileSync(path.join(DOCS, 'API_REFERENCE.md'), 'utf8') : '';
const docRoutes = new Set(
  [...apiDoc.matchAll(/\/api\/[A-Za-z0-9/_:-]+/g)]
    .map(m => m[0].replace(/:[a-z]+/g, ':id').replace(/\/$/, ''))
);

const undocApi = codeRoutes.filter(rt => !docRoutes.has(rt));
if (undocApi.length === 0) {
  console.log(`  ${g('✓')} هر ${codeRoutes.length} مسیر API مستند شده`);
} else {
  console.log(`  ${r('✗')} ${undocApi.length} از ${codeRoutes.length} مسیر مستند نشده:`);
  undocApi.forEach(rt => console.log('      ' + rt));
  problems++;
}

// عکسش هم مهم است: مستندِ مسیرِ خیالی، خواننده را گمراه می‌کند
const ghost = [...docRoutes].filter(rt =>
  !rt.includes(':id') && !codeRoutes.includes(rt) &&
  !/\/api\/(admin|auth|orders|products|cart)$/.test(rt));
if (ghost.length) {
  console.log(`  ${y('!')} در مستند هست ولی در کد نیست: ${ghost.join('، ')}`);
}

console.log(problems
  ? `\n  ${r(`${problems} مورد نیاز به رسیدگی`)}\n`
  : `\n  ${g('مستندات با واقعیت هم‌خوان است.')}\n`);

process.exit(problems ? 1 : 0);
