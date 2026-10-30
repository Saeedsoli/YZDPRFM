'use strict';
// Internal pricing infrastructure. Not connected to HTTP, storefront, or admin UI.
const { priceFromUsdPerKg } = require('./essence-pricing');
const RATE_KEY = 'essence_usd_rate_toman';
function migratePricing(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(products)').all().map(x => x.name));
  if (!cols.has('essence_usd_per_kg')) db.exec('ALTER TABLE products ADD COLUMN essence_usd_per_kg TEXT');
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').run(RATE_KEY, '300000');
}
function rateString(rate) {
  const value = String(rate).trim();
  if (!/^[1-9]\d{0,9}$/.test(value)) throw new Error('Dollar rate must be a positive integer in toman');
  return value;
}
function allowedVariant(type, volume) {
  return (type === 'SAMPLE' && volume === 5) ||
    (type === 'EDP' && [10,30,50,100].includes(volume)) ||
    (type === 'BODY_SPLASH' && volume === 120);
}
// Atomic rate update + reprice: never rewrites orders or products with no verified input.
// Unsupported legacy variants remain untouched and are counted for migration review.
function updateExchangeRate(db, newRate) {
  const rate=rateString(newRate);
  return db.transaction(() => {
    const products=db.prepare('SELECT id, essence_usd_per_kg AS usd FROM products WHERE essence_usd_per_kg IS NOT NULL').all();
    const variants=db.prepare('SELECT sku,type,volume_ml FROM variants WHERE product_id=?');
    const update=db.prepare('UPDATE variants SET price_toman=? WHERE sku=?');
    let repriced=0, skipped=0;
    for (const product of products) {
      // Validate even if product has no valid variants, so corrupted data roll back all changes.
      priceFromUsdPerKg(product.usd,rate,'EDP',10);
      for (const variant of variants.all(product.id)) {
        if (!allowedVariant(variant.type,variant.volume_ml)) { skipped++; continue; }
        update.run(priceFromUsdPerKg(product.usd,rate,variant.type,variant.volume_ml),variant.sku);
        repriced++;
      }
    }
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(RATE_KEY,rate);
    return { rate_toman: Number(rate), products: products.length, variants_repriced: repriced, legacy_variants_skipped: skipped };
  })();
}
module.exports = { migratePricing, updateExchangeRate, allowedVariant, RATE_KEY };
