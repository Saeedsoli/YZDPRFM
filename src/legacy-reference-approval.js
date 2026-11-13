'use strict';

const fs=require('fs'),crypto=require('crypto');
const {allowedVariant,RATE_KEY}=require('./essence-pricing-store');
const {priceFromUsdPerKg}=require('./essence-pricing');
const {kgToGram,applyProductPrice}=require('./product-essence-pricing');
const KEY='legacy_reference_approval_2026_11_v1';
const DIGEST='30aa36b476755caba07dd136b945cf8b56d483d593f76f6332026566de52e04f';
function applyLegacyReferenceApproval(db,file){
 const raw=fs.readFileSync(file);if(crypto.createHash('sha256').update(raw).digest('hex')!==DIGEST)throw Error('Legacy selection manifest changed');
 const m=JSON.parse(raw);if(m.version!=='secondary_reference_prices_2026_11_v28'||m.items.length!==2)throw Error('Invalid legacy selection');
 return db.transaction(()=>{
  const prior=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);if(prior)return {reason:'already_applied',...JSON.parse(prior.value)};
  const rate=db.prepare('SELECT value FROM settings WHERE key=?').get(RATE_KEY)?.value;if(!/^[1-9]\d{0,9}$/.test(rate||''))throw Error('Invalid exchange rate');
  const fields=Object.keys(m.items[0].expected_fields);if(!fields.every(k=>/^[a-z_]+$/.test(k)))throw Error('Invalid baseline field');
  const find=db.prepare(`SELECT ${fields.join(',')},supply_mode,essence_usd_per_kg FROM products WHERE id=?`);
  const vs=db.prepare('SELECT sku,type,volume_ml,price_toman,stock,price_usd FROM variants WHERE product_id=? ORDER BY sku');
  const off=db.prepare('SELECT 1 FROM supplier_price_evidence WHERE product_id=?');
  const ident=db.prepare('SELECT 1 FROM official_identity_evidence WHERE product_id=?');
  const sec=db.prepare('SELECT 1 FROM secondary_reference_evidence WHERE product_id=?');
  const oldImport=db.prepare("SELECT 1 FROM settings WHERE key='supplier_exact_price_import_v1'").get();

  for(const x of m.items){
   const p=find.get(x.product_id);
   if(!p||p.supply_mode!=='UNAVAILABLE'||fields.some(k=>p[k]!==x.expected_fields[k])||off.get(x.product_id)||ident.get(x.product_id)||sec.get(x.product_id))throw Error('Legacy product content/evidence changed: '+x.product_id);
   const rows=vs.all(x.product_id);
   if(p.essence_usd_per_kg===null){if(JSON.stringify(rows)!==JSON.stringify(x.expected_fresh_variants))throw Error('Legacy fresh baseline changed: '+x.product_id);}
   else {
    if(!oldImport||p.essence_usd_per_kg!==x.usd_per_kg)throw Error('Legacy price conflict: '+x.product_id);
    const sell=rows.filter(v=>allowedVariant(v.type,v.volume_ml));
    if(sell.length!==6||new Set(sell.map(v=>`${v.type}:${v.volume_ml}`)).size!==6||!sell.every(v=>v.stock===0&&v.price_toman>0&&v.price_toman===priceFromUsdPerKg(x.usd_per_kg,rate,v.type,v.volume_ml)))throw Error('Legacy variant changed: '+x.product_id);
   }
  }
  const evidence=db.prepare(`INSERT INTO secondary_reference_evidence(product_id,reference_name,source_url,provider,status,supplier_file_sha256,usd_per_kg,quality,match_status,checked_date) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const update=db.prepare(`UPDATE products SET gender=?,notes_top=?,notes_middle=?,notes_base=?,accords='[]',temperature=NULL,taste=NULL,season=NULL,occasion=NULL,longevity=NULL,sillage=NULL,perfumer=NULL,transparency_notice=?,search_blob=NULL,supply_mode='MADE_TO_ORDER' WHERE id=? AND supply_mode='UNAVAILABLE'`);
  for(const x of m.items){
   const p=find.get(x.product_id);if(p.essence_usd_per_kg===null)applyProductPrice(db,x.product_id,kgToGram(x.usd_per_kg),rate,null);
   const rows=vs.all(x.product_id).filter(v=>allowedVariant(v.type,v.volume_ml));
   if(rows.length!==6||new Set(rows.map(v=>`${v.type}:${v.volume_ml}`)).size!==6||!rows.every(v=>v.stock===0&&v.price_toman===priceFromUsdPerKg(x.usd_per_kg,rate,v.type,v.volume_ml)))throw Error('Legacy final price verification failed');
   evidence.run(x.product_id,x.reference_name,x.source_url,x.provider,x.status,m.supplier_file_sha256,x.usd_per_kg,x.quality,x.match_status,x.checked_date);
   let notice='این محصول بازآفرینی دست‌ساز است و محصول اورجینال برند اصلی نیست. اطلاعات رایحه مرجع از فراگرانتیکا، یک منبع مستقل، گرفته شده و هویت و ترکیب اسانس تأمین‌کننده مستقلاً تأیید نشده است.';
   if(x.product_id==='YZD-PROD-0145')notice+=' آکورد ویسکی و عنبرسائل فقط توصیف رایحه مرجع‌اند و وجود این مواد در محصول را تأیید نمی‌کنند.';
   else notice+=' مرجع انتخابی نسخه ۲۰۱۳ و مشترک است؛ در فایل قیمت زنانه نوشته شده است.';
   if(update.run(x.reference_gender,JSON.stringify(x.notes.top),JSON.stringify(x.notes.middle),JSON.stringify(x.notes.base),notice,x.product_id).changes!==1)throw Error('Legacy availability conflict');
  }
  const result={approved:2,activated:2,at:new Date().toISOString()};db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(KEY,JSON.stringify(result));return result;
 })();
}
module.exports={applyLegacyReferenceApproval,KEY};
