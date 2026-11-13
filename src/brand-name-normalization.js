'use strict';

const LABELS = new Map([
  ['xerjoff', 'زرجوف'],
  ['sapil', 'ساپیل']
]);

function apply(db) {
  const update = db.prepare(`
    UPDATE products
    SET brand_fa = @label
    WHERE lower(trim(COALESCE(brand_en,''))) = @brand
      AND brand_fa IS NOT @label
  `);
  let changed = 0;
  for (const [brand, label] of LABELS) changed += update.run({ brand, label }).changes;
  return changed;
}

function canonicalLabel(brandEn, fallback) {
  return LABELS.get(String(brandEn || '').trim().toLowerCase()) || fallback || null;
}

module.exports = { apply, canonicalLabel, LABELS };
