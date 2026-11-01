'use strict';
// Owner-approved fixed scope. Never changes prices, stock, customer/order data.
// A one-time marker prevents reopening products the owner later disables.
const fs=require('fs');
const {allowedVariant,RATE_KEY}=require('./essence-pricing-store');
const {priceFromUsdPerKg}=require('./essence-pricing');
const VERSION='approved_made_to_order_2026_11_v15';
const EXPECTED_SOURCE='bbe8f40610bc765bda0a7d2da9dbe78f4e397458a6991239c3c18d0853f33f5c';
function applyApprovedMadeToOrder(db,file){
 const m=JSON.parse(fs.readFileSync(file,'utf8'));
 if(m.version!==VERSION||m.source_sha256!==EXPECTED_SOURCE||!Array.isArray(m.items)||m.items.length!==2)throw new Error('Invalid owner-approved availability manifest');
 const fixed=new Set(["SUP-TB-900003", "YZD-PROD-1773"]);
 if(m.items.some(x=>!fixed.has(x.product_id)))throw Error('Approval scope mismatch');
 const seen=new Set();
 for(const x of m.items){let u;try{u=new URL(x.reference_url)}catch{throw Error('Invalid reference URL')}
  if(!x.product_id||!x.slug||!x.expected_name_en||!x.brand_en||seen.has(x.product_id)||!['provisional','secondary'].includes(x.source_type)||u.protocol!=='https:'||u.username||u.password||!/^[A-Za-z]$/.test(x.quality)||typeof x.usd_per_kg!=='string')throw Error('Invalid approval item');
  priceFromUsdPerKg(x.usd_per_kg,300000,'EDP',10);seen.add(x.product_id);
 }
 return db.transaction(()=>{
  const prior=db.prepare('SELECT value FROM settings WHERE key=?').get(VERSION);
  if(prior)return {reason:'already_applied',...JSON.parse(prior.value)};
  const rate=db.prepare('SELECT value FROM settings WHERE key=?').get(RATE_KEY)?.value;
  if(!/^[1-9]\d{0,9}$/.test(rate||''))throw Error('Invalid exchange rate');
  const find=db.prepare('SELECT id,slug,name_en,brand_en,supply_mode,essence_usd_per_kg FROM products WHERE id=?');
  const variants=db.prepare('SELECT sku,type,volume_ml,price_toman,stock FROM variants WHERE product_id=?');
  const official=db.prepare('SELECT supplier_file_sha256,usd_per_kg,quality,match_status,official_url FROM supplier_price_evidence WHERE product_id=?');
  const secondary=db.prepare('SELECT supplier_file_sha256,usd_per_kg,quality,match_status,source_url,provider,status FROM secondary_reference_evidence WHERE product_id=?');
  const update=db.prepare("UPDATE products SET supply_mode='MADE_TO_ORDER' WHERE id=? AND supply_mode='UNAVAILABLE'");
  let activated=0;const skipped=[];
  for(const x of m.items){
   const p=find.get(x.product_id),e=x.source_type==='provisional'?official.get(x.product_id):secondary.get(x.product_id);
   let ok=!!(p&&p.slug===x.slug&&p.name_en===x.expected_name_en&&p.brand_en===x.brand_en&&p.supply_mode==='UNAVAILABLE'&&p.essence_usd_per_kg===x.usd_per_kg&&e&&e.supplier_file_sha256===EXPECTED_SOURCE&&e.usd_per_kg===x.usd_per_kg&&e.quality===x.quality&&e.match_status==='name_matched_supplier_identity_unverified'&&(x.source_type==='provisional'?e.official_url===x.reference_url:(e.source_url===x.reference_url&&e.provider==='Fragrantica'&&e.status==='secondary_original_found_supplier_essence_unverified')));
   if(ok){const vs=variants.all(p.id).filter(v=>allowedVariant(v.type,v.volume_ml));const keys=new Set(vs.map(v=>`${v.type}:${v.volume_ml}`));ok=vs.length===6&&keys.size===6&&vs.every(v=>v.stock===0&&v.price_toman>0&&v.price_toman===priceFromUsdPerKg(x.usd_per_kg,rate,v.type,v.volume_ml));}
   if(!ok){skipped.push(x.product_id);continue;}
   activated+=update.run(p.id).changes;
  }
  const result={approved:m.items.length,activated,skipped,at:new Date().toISOString()};
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(VERSION,JSON.stringify(result));
  return result;
 })();
}
module.exports={applyApprovedMadeToOrder,VERSION};
