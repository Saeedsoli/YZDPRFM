#!/usr/bin/env node

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

console.log('\n  ── فایل‌های ذکرشده در مستندات ──\n');

const FILE_RE = /`([A-Za-z0-9_./\-]+\.(?:js|py|sh|html|css|json|md|db|png|jpg|webp|woff2|csv))`/g;

const missing = new Map();

for (const md of mdFiles) {
  const txt = fs.readFileSync(md, 'utf8');
  const lines = txt.split('\n');
  let m;
  while ((m = FILE_RE.exec(txt))) {
    const ref = m[1];

    const lineNo = txt.slice(0, m.index).split('\n').length - 1;
    const line = lines[lineNo] || '';
    const baseName = ref.split('/').pop();
    if (line.split(baseName).length > 2) continue;

    if (ref.startsWith('http')) continue;
    if (!ref.includes('/') && !/\.(js|py|sh)$/.test(ref)) continue;

    if (ref.startsWith('/app/') || ref.startsWith('/home/')) continue;

    if (ref.startsWith('../')) continue;

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

console.log('\n  ── لینک‌های بین سندها ──\n');

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
let brokenLinks = 0;

for (const md of mdFiles) {
  const txt = fs.readFileSync(md, 'utf8');
  let m;
  while ((m = LINK_RE.exec(txt))) {
    let target = m[1].split('#')[0].trim();
    if (!target) continue;
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

  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.html'));
  const undocPages = pages.filter(p => !idx.includes(p));
  if (undocPages.length) {
    console.log(`  ${y('!')} صفحات بدون ذکر در FILE_INDEX: ${undocPages.join('، ')}`);
    problems++;
  } else {
    console.log(`  ${g('✓')} هر ${pages.length} صفحه در فهرست هست`);
  }

  const mods = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
  const undocMods = mods.filter(p => !idx.includes(p));
  if (undocMods.length) {
    console.log(`  ${y('!')} ماژول‌های بدون ذکر: ${undocMods.join('، ')}`);
    problems++;
  } else {
    console.log(`  ${g('✓')} هر ${mods.length} ماژول در فهرست هست`);
  }
}

console.log('\n  ── پوشش API_REFERENCE ──\n');

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
