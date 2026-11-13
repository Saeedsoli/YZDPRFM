#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const perms = require(path.join(ROOT, 'src', 'permissions'));

const ROUTES_DIR = path.join(ROOT, 'src', 'routes');
const routeFiles = fs.existsSync(ROUTES_DIR)
  ? fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js'))
      .map(f => fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8'))
  : [];

const src = [
  fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8'),
  ...routeFiles
].join('\n');

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const UI_ONLY = {
  'content.view': 'کاتالوگ مقالات عمومی است؛ فقط تب پنل را کنترل می‌کند'
};

let problems = 0;

console.log('\n  ۱. مجوزهای تعریف‌شده که در سرور بررسی می‌شوند\n');
const unchecked = [];
for (const key of perms.ALL_KEYS) {
  const checked = src.includes(`can('${key}')`);
  if (!checked && !UI_ONLY[key]) unchecked.push(key);
}
if (unchecked.length) {
  problems += unchecked.length;
  for (const k of unchecked) {
    const p = perms.PERMISSIONS.find(x => x.key === k);
    console.log(`  ${r('✗')} ${k}  ${d('(' + p.label + ')')}`);
    console.log(d(`      تعریف شده ولی هیچ مسیری آن را نمی‌سنجد`));
  }
} else {
  console.log(`  ${g('✓')} همه ${perms.ALL_KEYS.length - Object.keys(UI_ONLY).length} مجوز عملیاتی بررسی می‌شوند`);
}
for (const [k, why] of Object.entries(UI_ONLY)) {
  console.log(`  ${d('•')} ${d(k + ' — ' + why)}`);
}

console.log('\n  ۲. مسیرهای مدیریتی بدون بررسی مجوز\n');
const lines = src.split('\n');
const openRoutes = [];

for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];

  const isAdminPath = /pathname\s*(===|\.startsWith\()\s*'\/api\/admin\//.test(ln);
  if (!isAdminPath) continue;
  if (!/^\s*if \(/.test(ln)) continue;

  let depth = 0, end = i;
  for (let j = i; j < Math.min(lines.length, i + 120); j++) {
    depth += (lines[j].match(/\{/g) || []).length;
    depth -= (lines[j].match(/\}/g) || []).length;
    if (j > i && depth <= 0) { end = j; break; }
    end = j;
  }
  const block = lines.slice(i, end + 1).join('\n');
  const guarded = /can\('/.test(block) || /if \(!who\)/.test(block);

  const isPublicByDesign = /admin\/login|admin\/whoami|admin\/me|admin\/logout/.test(ln);

  if (!guarded && !isPublicByDesign) {
    const m = ln.match(/'\/api\/admin\/[^']*'/);
    openRoutes.push({ line: i + 1, path: m ? m[0] : ln.trim().slice(0, 70) });
  }
}

if (openRoutes.length) {
  problems += openRoutes.length;
  openRoutes.forEach(o =>
    console.log(`  ${r('✗')} خط ${o.line}: ${o.path}`));
} else {
  console.log(`  ${g('✓')} همه مسیرهای مدیریتی محافظت شده‌اند`);
}

console.log('\n  ۳. مجوزهایی که در هیچ نقش پیش‌فرضی نیستند\n');
const inRoles = new Set();
perms.DEFAULT_ROLES.forEach(role => role.permissions.forEach(p => inRoles.add(p)));
const orphans = perms.ALL_KEYS.filter(k => !inRoles.has(k));

if (orphans.length) {

  orphans.forEach(k => console.log(`  ${y('•')} ${k} ${d('— فقط مدیر کل')}`));
} else {
  console.log(`  ${g('✓')} همه مجوزها دست‌کم در یک نقش هستند`);
}

console.log('\n  ۴. پوشش نقش‌ها\n');
for (const role of perms.DEFAULT_ROLES) {
  const dangerous = role.permissions.filter(k => {
    const p = perms.PERMISSIONS.find(x => x.key === k);
    return p && p.danger;
  });
  const bar = '█'.repeat(Math.round(role.permissions.length / perms.ALL_KEYS.length * 20));
  console.log(`  ${role.name.padEnd(11)} ${String(role.permissions.length).padStart(2)}/${perms.ALL_KEYS.length}` +
    ` ${d(bar.padEnd(20))} ${dangerous.length ? y(dangerous.length + ' حساس') : d('بدون مجوز حساس')}`);
}

console.log();
if (problems === 0) {
  console.log(g('  پوشش مجوزها کامل است.\n'));
  process.exit(0);
}
console.log(r(`  ${problems} مشکل پیدا شد.\n`));
process.exit(1);
