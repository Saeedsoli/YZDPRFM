'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMAGES = path.join(ROOT, 'public', 'images');
const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const MAX_BYTES = 200 * 1024;
const MAX_EDGE = 1200;
const EXEMPT_EDGE = new Set(['brand-logo-og.png', 'icon-512.png', 'icon-maskable-512.png',
  'brand_logo.png', 'apple-touch-icon.png']);
const BUDGET_BYTES = 16 * 1024 * 1024;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function dimensions(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (ext === '.jpg' || ext === '.jpeg') {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      const length = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + length;
    }
    return null;
  }
  if (ext === '.webp') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') {
      return {
        width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
      };
    }
    if (kind === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    return null;
  }
  if (ext === '.avif') {

    const idx = buf.indexOf(Buffer.from('ispe'));
    if (idx < 0) return null;
    return { width: buf.readUInt32BE(idx + 8), height: buf.readUInt32BE(idx + 12) };
  }
  return null;
}

const files = walk(IMAGES);
const rasters = files.filter(f => RASTER.has(path.extname(f).toLowerCase()));
assert(rasters.length > 0, 'رستری پیدا نشد');

let missingWebp = [];
let avifNotSmaller = [];
let oversized = [];
let tooWide = [];
let total = 0;

for (const file of rasters) {
  const ext = path.extname(file).toLowerCase();
  const size = fs.statSync(file).size;
  total += size;
  const rel = path.relative(ROOT, file);

  if ((ext === '.jpg' || ext === '.jpeg' || ext === '.png') &&
      !fs.existsSync(file.slice(0, -ext.length) + '.webp')) {
    missingWebp.push(rel);
  }
  if (ext === '.webp') {
    const avif = file.slice(0, -5) + '.avif';
    if (fs.existsSync(avif) && fs.statSync(avif).size >= size) {
      avifNotSmaller.push(`${rel} (webp ${size} ≤ avif ${fs.statSync(avif).size})`);
    }
  }
  if (size > MAX_BYTES) oversized.push(`${rel} ${Math.round(size / 1024)}KB`);
  const dims = dimensions(file);
  if (dims && Math.max(dims.width, dims.height) > MAX_EDGE &&
      !EXEMPT_EDGE.has(path.basename(file))) {
    tooWide.push(`${rel} ${dims.width}x${dims.height}`);
  }
}

assert.deepEqual(missingWebp, [], `تصویر بدون نسخه WebP: ${missingWebp.slice(0, 5).join(', ')}`);
assert.deepEqual(avifNotSmaller, [], `AVIF سبک‌تر نیست: ${avifNotSmaller.slice(0, 5).join(', ')}`);
assert.deepEqual(oversized, [], `فایل سنگین‌تر از ۲۰۰KB: ${oversized.slice(0, 5).join(', ')}`);
assert.deepEqual(tooWide, [], `ابعاد بیش از ${MAX_EDGE} پیکسل: ${tooWide.slice(0, 5).join(', ')}`);
assert(total < BUDGET_BYTES, `بودجه تصاویر: ${(total / 1048576).toFixed(1)}MB`);

const server = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
assert(/image\/avif/.test(server), 'سرور AVIF را نمی‌شناسد');
assert(/image\/webp/.test(server), 'سرور WebP را نمی‌شناسد');
assert(/'\.avif': 'image\/avif'/.test(server), 'نوع MIME برای AVIF ثبت نشده');
assert(/headers\['Vary'\] = 'Accept'/.test(server), 'هدر Vary برای تصاویر ست نمی‌شود');

const blockStart = server.indexOf("if (/\\.(jpg|jpeg|png|webp)$/.test(ext))");
assert(blockStart > 0, 'بلوک مذاکره تصویر در سرور پیدا نشد');
const negotiation = server.slice(blockStart);
const avifAt = negotiation.indexOf("'image/avif'");
const webpAt = negotiation.indexOf("'image/webp'");
assert(avifAt >= 0, 'حلقه انتخاب قالب تصویر پیدا نشد');
assert(webpAt === -1 || avifAt < webpAt, 'AVIF باید پیش از WebP بررسی شود');

assert(/\.\(jpg\|jpeg\|png\|webp\)/.test(negotiation), 'ارتقای WebP به AVIF پوشش داده نشده');

const avifCount = rasters.filter(f => f.toLowerCase().endsWith('.avif')).length;
console.log(`PASS: ${rasters.length} رستر (${avifCount} AVIF) · ${(total / 1048576).toFixed(2)}MB · بدون تصویر بدون WebP · بدون فایل سنگین`);
