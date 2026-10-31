'use strict';
// Backend for product-level essence pricing. No storefront or admin UI dependency.
const crypto=require('crypto');
const {priceFromUsdPerKg}=require('./essence-pricing');
const {RATE_KEY,allowedVariant}=require('./essence-pricing-store');
function decimalParts(value) {
  const s=String(value ?? '').trim();
  if (s.length>32 || !/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(s)) throw new Error('INVALID_PRICE');
  const [whole,frac='']=s.split('.');const n=BigInt(whole+frac);
  if (n<=0n) throw new Error('INVALID_PRICE');
  return {n,scale:frac.length};
}
function decimalText(n, scale) {
  const d=10n**BigInt(scale), whole=n/d, frac=(n%d).toString().padStart(scale,'0').replace(/0+$/,'');
  return whole.toString()+(frac?'.'+frac:'');
}
function gramToKg(value) { const {n,scale}=decimalParts(value); return decimalText(n*1000n,scale); }
function kgToGram(value) { const {n,scale}=decimalParts(value); return decimalText(n,scale+3); }
function tomanPerGram(usdPerGram,rate) { const {n,scale}=decimalParts(usdPerGram); return decimalText(n*BigInt(rate),scale); }
function productPriceState(db,id) {
  const p=db.prepare('SELECT id,name_fa,brand_fa,essence_usd_per_kg FROM products WHERE id=? OR slug=?').get(id,id);
  if (!p) {const e=new Error('PRODUCT_NOT_FOUND');e.code='PRODUCT_NOT_FOUND';throw e;}
  const rate=db.prepare('SELECT value FROM settings WHERE key=?').get(RATE_KEY)?.value;
  if (!/^[1-9]\d{0,9}$/.test(rate||'')) throw new Error('INVALID_RATE');
  const gram=p.essence_usd_per_kg == null ? null : kgToGram(p.essence_usd_per_kg);
  return {product_id:p.id,name_fa:p.name_fa,brand_fa:p.brand_fa,rate_toman:Number(rate),usd_per_gram:gram,usd_per_kg:p.essence_usd_per_kg,toman_per_gram:gram==null?null:tomanPerGram(gram,rate)};
}
function previewProductPrice(db,id,usdPerGram) {
  const state=productPriceState(db,id),kg=gramToKg(usdPerGram);
  // Validate calculation and maximum safe integer even when no EDP variants exist.
  priceFromUsdPerKg(kg,state.rate_toman,'EDP',100);
  const rows=db.prepare('SELECT sku,type,volume_ml,price_toman FROM variants WHERE product_id=? ORDER BY type,volume_ml,sku').all(state.product_id);
  const changes=rows.filter(v=>allowedVariant(v.type,v.volume_ml)).map(v=>({...v,new_price_toman:priceFromUsdPerKg(kg,state.rate_toman,v.type,v.volume_ml)}));
  // New catalog products may not yet have any variants at all.
  for(const [type,volume] of [['SAMPLE',5],['EDP',10],['EDP',30],['EDP',50],['EDP',100],['BODY_SPLASH',120]]) {
    if (!changes.some(v=>v.type===type&&v.volume_ml===volume)) changes.push({sku:null,type,volume_ml:volume,price_toman:null,new_price_toman:priceFromUsdPerKg(kg,state.rate_toman,type,volume)});
  }
  return {...state,proposed_usd_per_gram:kgToGram(kg),proposed_usd_per_kg:kg,proposed_toman_per_gram:tomanPerGram(kgToGram(kg),state.rate_toman),changes};
}
function applyProductPrice(db,id,usdPerGram,expectedRate,expectedOldKg) {
  if (expectedOldKg !== null && typeof expectedOldKg !== 'string') throw new Error('INVALID_EXPECTATION');
  return db.transaction(()=>{
    const p=previewProductPrice(db,id,usdPerGram);
    if (String(p.rate_toman)!==String(expectedRate) || p.usd_per_kg!==expectedOldKg) {const e=new Error('PRICE_CONFLICT');e.code='PRICE_CONFLICT';throw e;}
    const update=db.prepare('UPDATE variants SET price_toman=? WHERE sku=?');
    const insert=db.prepare('INSERT INTO variants(sku,product_id,type,type_label,volume_ml,price_toman,stock,price_usd) VALUES(?,?,?,?,?,?,0,NULL)');
    const digest=crypto.createHash('sha256').update(p.product_id).digest('hex').slice(0,20).toUpperCase();
    let updated=0,created=0;
    for(const v of p.changes) {
      if(v.sku) {update.run(v.new_price_toman,v.sku);updated++;}
      else {
        const code=v.type==='SAMPLE'?'SMP':v.type==='BODY_SPLASH'?'BS':'EDP';
        const label=v.type==='SAMPLE'?'سمپل ۵ میل':v.type==='BODY_SPLASH'?'بادی اسپلش دست‌ساز':'ادو پرفیوم دست‌ساز';
        const sku=`ESS-${digest}-${code}-${String(v.volume_ml).padStart(3,'0')}`;
        insert.run(sku,p.product_id,v.type,label,v.volume_ml,v.new_price_toman);created++;
      }
    }
    db.prepare('UPDATE products SET essence_usd_per_kg=? WHERE id=?').run(p.proposed_usd_per_kg,p.product_id);
    return {product_id:p.product_id,usd_per_gram:p.proposed_usd_per_gram,toman_per_gram:p.proposed_toman_per_gram,rate_toman:p.rate_toman,variants_updated:updated,variants_created:created};
  })();
}
module.exports={gramToKg,kgToGram,tomanPerGram,productPriceState,previewProductPrice,applyProductPrice};
