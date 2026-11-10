'use strict';
const fs = require('fs');
const path = require('path');

const REGISTRY = path.join(__dirname, '..', 'seed', 'brand_logos_v1.json');
const PUBLIC_ROOT = path.join(__dirname, '..', 'public');
const URL_PREFIX = '/images/brands/';

let cache = null;

function load() {
  if (cache) return cache;
  const map = new Map();
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
    for (const [brand, entry] of Object.entries(data.logos || {})) {
      const file = String(entry.file || '');
      if (!/^[a-z0-9-]+\.(?:svg|png|jpg)$/.test(file)) continue;
      if (!['Public domain', 'CC0'].includes(entry.license)) continue;
      if (!fs.existsSync(path.join(PUBLIC_ROOT, 'images', 'brands', file))) continue;
      map.set(brand, { url: URL_PREFIX + file, width: entry.width || null, height: entry.height || null });
    }
  } catch {
    // A missing registry only means brand tiles fall back to their wordmark.
  }
  cache = map;
  return cache;
}

function logoFor(brandEn) {
  return load().get(String(brandEn || '')) || null;
}

function attach(rows) {
  return rows.map(row => {
    const logo = logoFor(row.brand_en);
    return logo ? { ...row, logo: logo.url, logo_width: logo.width, logo_height: logo.height } : row;
  });
}

module.exports = { logoFor, attach, count: () => load().size };
