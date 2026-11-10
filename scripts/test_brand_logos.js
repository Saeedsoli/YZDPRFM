'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'brand_logos_v1.json'), 'utf8'));
const brandLogos = require('../src/brand-logos');

const dir = path.join(root, 'public', 'images', 'brands');
const files = fs.readdirSync(dir);
let totalBytes = 0;

for (const [brand, entry] of Object.entries(registry.logos)) {
  assert(/^[a-z0-9-]+\.svg$/.test(entry.file), `${brand}: asset filename is normalized`);
  const full = path.join(dir, entry.file);
  assert(fs.existsSync(full), `${brand}: asset exists`);
  const raw = fs.readFileSync(full);
  totalBytes += raw.length;
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), entry.sha256, `${brand}: checksum matches the reviewed download`);
  const text = raw.toString('utf8');
  assert(/<svg[\s>]/i.test(text), `${brand}: is an SVG document`);
  assert(!/<script|javascript:|onload\s*=|onerror\s*=/i.test(text), `${brand}: no executable content`);
  assert(!/href\s*=\s*"https?:/i.test(text), `${brand}: no remote references`);
  assert.equal(entry.license, 'Public domain', `${brand}: license recorded`);
  assert(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(entry.source || ''), `${brand}: source recorded`);
}
assert(totalBytes < 1024 * 1024, 'brand assets stay small');
assert.equal(brandLogos.count(), Object.keys(registry.logos).length, 'every registered logo is served');

for (const brand of Object.keys(registry.logos)) {
  const logo = brandLogos.logoFor(brand);
  assert(logo && logo.url === '/images/brands/' + registry.logos[brand].file, `${brand}: resolves to its local file`);
}
assert.equal(brandLogos.logoFor('Parfums de Marly'), null, 'brands without a bundled logo fall back to a wordmark');

const rows = brandLogos.attach([{ brand_en: 'Creed', brand_fa: 'کرید', count: 3 }, { brand_en: 'Unknown House', brand_fa: 'ناشناس', count: 1 }]);
assert.equal(rows[0].logo, '/images/brand/creed.svg'.replace('/brand/', '/brands/'), 'API rows carry the logo path');
assert(!('logo' in rows[1]), 'rows without artwork stay unchanged');

const catalog = fs.readFileSync(path.join(root, 'src', 'routes', 'catalog.js'), 'utf8');
assert(catalog.includes('brandLogos.attach(rows)'), '/api/brands attaches logos');
const seo = fs.readFileSync(path.join(root, 'src', 'seo.js'), 'utf8');
assert(seo.includes('class="blogo"'), 'server-rendered brands page uses the logo');
const home = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
assert(home.includes('brand-logo'), 'homepage brand tiles use the logo');
assert(home.includes("api/brands"), 'homepage brand tiles read the real brand list');
const brands = fs.readFileSync(path.join(root, 'public', 'brands.html'), 'utf8');
assert(brands.includes('class="blogo"'), 'brands page uses the logo');
assert(files.every(f => /\.svg$/.test(f)), 'only SVG assets are bundled');

console.log(`PASS: ${Object.keys(registry.logos).length} public-domain brand logos served locally, ${Math.round(totalBytes / 1024)}KB total`);
