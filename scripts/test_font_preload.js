'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'public');
const font = '/fonts/Vazirmatn-Regular.woff2';
let checked = 0;
for (const name of fs.readdirSync(dir).filter(x => x.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(dir, name), 'utf8');
  if (!/\/assets\/(?:theme|fonts)\.css/.test(html)) continue;
  const tags = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
  const preload = tags.filter(tag => tag.includes(font) && /rel=["']preload["']/i.test(tag));
  assert.equal(preload.length, 1, `${name}: exactly one font preload`);
  for (const attr of [/as=["']font["']/i, /type=["']font\/woff2["']/i, /\bcrossorigin\b/i]) {
    assert.match(preload[0], attr, `${name}: required preload attribute`);
  }
  assert(html.indexOf(preload[0]) < html.search(/<link\b[^>]*href=["']\/assets\/(?:theme|fonts)\.css/i), `${name}: preload before CSS`);
  checked++;
}
assert(checked > 0);
assert(fs.statSync(path.join(dir, font)).size > 0);
for (const file of ['theme.css', 'fonts.css']) {
  const css = fs.readFileSync(path.join(dir, 'assets', file), 'utf8');
  assert.match(css, /Vazirmatn-Regular\.woff2/);
  assert.match(css, /font-display:\s*swap/);
  assert.doesNotMatch(css, /font-display:\s*optional/);
}
console.log(`Font preload: ${checked} pages verified; local regular WOFF2 and swap verified.`);
