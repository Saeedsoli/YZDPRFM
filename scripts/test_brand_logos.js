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
  assert(/^[a-z0-9-]+\.(?:svg|png|jpg)$/.test(entry.file), `${brand}: asset filename is normalized`);
  const full = path.join(dir, entry.file);
  assert(fs.existsSync(full), `${brand}: asset exists`);
  const raw = fs.readFileSync(full);
  totalBytes += raw.length;
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), entry.sha256, `${brand}: checksum matches the reviewed download`);
  if (entry.file.endsWith('.svg')) {
    const text = raw.toString('utf8');
    assert(/<svg[\s>]/i.test(text), `${brand}: is an SVG document`);
    assert(!/<script|javascript:|onload\s*=|onerror\s*=/i.test(text), `${brand}: no executable content`);
    assert(!/href\s*=\s*"https?:/i.test(text), `${brand}: no remote references`);
  } else {
    const png = raw.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpg = raw[0] === 0xff && raw[1] === 0xd8;
    assert(png || jpg, `${brand}: raster file has a real image header`);
    assert(raw.length < 512 * 1024, `${brand}: raster stays small`);
  }
  assert(['Public domain', 'CC0'].includes(entry.license), `${brand}: license recorded`);
  assert(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(entry.source || ''), `${brand}: source recorded`);
}
assert(totalBytes < 4 * 1024 * 1024, 'brand assets stay small');
assert.equal(brandLogos.count(), Object.keys(registry.logos).length, 'every registered logo is served');

for (const brand of Object.keys(registry.logos)) {
  const logo = brandLogos.logoFor(brand);
  assert(logo && logo.url === '/images/brands/' + registry.logos[brand].file, `${brand}: resolves to its local file`);
}
assert.equal(brandLogos.logoFor('Parfums de Marly'), null, 'brands without a bundled logo fall back to a wordmark');

const sample = Object.keys(registry.logos)[0];
const rows = brandLogos.attach([{ brand_en: sample, brand_fa: 'نمونه', count: 3 }, { brand_en: 'Unknown House', brand_fa: 'ناشناس', count: 1 }]);
assert.equal(rows[0].logo, '/images/brands/' + registry.logos[sample].file, 'API rows carry the logo path');
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
assert(files.every(f => /\.(?:svg|png|jpg)$/.test(f)), 'only image assets are bundled');

console.log(`PASS: ${Object.keys(registry.logos).length} public-domain brand logos served locally, ${Math.round(totalBytes / 1024)}KB total`);
