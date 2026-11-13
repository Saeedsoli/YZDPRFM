'use strict';

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

function updateExchangeRate(db, newRate, expectedRate = null) {
  const rate=rateString(newRate);
  const expected=expectedRate == null ? null : rateString(expectedRate);
  return db.transaction(() => {
    const current=db.prepare('SELECT value FROM settings WHERE key=?').get(RATE_KEY)?.value;
    if (expected !== null && current !== expected) {
      const err = new Error('Exchange rate changed since preview'); err.code = 'RATE_CONFLICT'; throw err;
    }
    const products=db.prepare('SELECT id, essence_usd_per_kg AS usd FROM products WHERE essence_usd_per_kg IS NOT NULL').all();
    const variants=db.prepare('SELECT sku,type,volume_ml FROM variants WHERE product_id=?');
    const update=db.prepare('UPDATE variants SET price_toman=? WHERE sku=?');
    let repriced=0, skipped=0;
    for (const product of products) {

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
function previewExchangeRate(db, newRate) {
  const rate=rateString(newRate);
  const current=db.prepare('SELECT value FROM settings WHERE key=?').get(RATE_KEY)?.value;
  if (!current) throw new Error('Missing exchange rate');
  const products=db.prepare('SELECT id, name_fa, brand_fa, essence_usd_per_kg AS usd FROM products WHERE essence_usd_per_kg IS NOT NULL').all();
  const variants=db.prepare('SELECT sku,type,volume_ml,price_toman FROM variants WHERE product_id=?');
  let repriced=0, skipped=0;
  const examples=[];
  for(const p of products) {
    priceFromUsdPerKg(p.usd,rate,'EDP',10);
    for(const v of variants.all(p.id)) {
      if (!allowedVariant(v.type,v.volume_ml)) { skipped++; continue; }
      const next=priceFromUsdPerKg(p.usd,rate,v.type,v.volume_ml);
      repriced++;
      if (examples.length<20) examples.push({product_id:p.id,name_fa:p.name_fa,brand_fa:p.brand_fa,sku:v.sku,volume_ml:v.volume_ml,type:v.type,old_price_toman:v.price_toman,new_price_toman:next});
    }
  }
  return {current_rate_toman:Number(current),proposed_rate_toman:Number(rate),products:products.length,variants_repriced:repriced,legacy_variants_skipped:skipped,examples};
}
module.exports = { migratePricing, updateExchangeRate, previewExchangeRate, rateString, allowedVariant, RATE_KEY };
