'use strict';
// Guarded corrections to the named reference originals of already-approved items.
// Never edits sale prices, availability, stock, customer data or existing orders.
const fs=require('fs');
const VERSION='active_official_notes_2026_11_v1';
function applyActiveOfficialNotes(db,file){
 const m=JSON.parse(fs.readFileSync(file,'utf8'));
 if(m.version!==VERSION||!Array.isArray(m.items)||m.items.length!==8)throw Error('Invalid active reference manifest');
 const seen=new Set();
 for(const x of m.items){let url;try{url=new URL(x.source_url)}catch{throw Error('Invalid reference source')}
  if(!x.product_id||!x.product_slug||!x.expected_name_en||!x.expected_brand||!x.expected_concentration||typeof x.expected_usd_per_kg!=='string'||url.protocol!=='https:'||url.username||url.password||seen.has(x.product_id)||typeof x.expected_old_notice!=='string'||typeof x.verified_notice!=='string'||!Array.isArray(x.expected_old_accords)||!Array.isArray(x.verified_accords))throw Error('Invalid active reference item');
  for(const k of ['top','middle','base'])if(!Array.isArray(x.expected_old_notes?.[k])||!Array.isArray(x.verified_notes?.[k])||!x.verified_notes[k].every(s=>typeof s==='string'&&s.trim()&&s.length<=60))throw Error('Invalid reference notes');
  if(!x.verified_accords.every(s=>typeof s==='string'&&s.trim()&&s.length<=60))throw Error('Invalid reference accords');seen.add(x.product_id);
 }
 return db.transaction(()=>{
  if(db.prepare('SELECT 1 FROM settings WHERE key=?').get(VERSION))return {updated:0,skipped:0,reason:'already_applied'};
  if(!db.prepare("SELECT 1 FROM settings WHERE key='approved_made_to_order_2026_11_v1'").get())return {updated:0,skipped:0,reason:'approval_missing'};
  const get=db.prepare('SELECT id,slug,name_en,brand_en,concentration,supply_mode,essence_usd_per_kg,notes_top,notes_middle,notes_base,accords,transparency_notice FROM products WHERE id=?');
  const evidence=db.prepare('SELECT official_url,status FROM official_identity_evidence WHERE product_id=?');
  const price=db.prepare('SELECT usd_per_kg,match_status FROM supplier_price_evidence WHERE product_id=?');
  const update=db.prepare('UPDATE products SET notes_top=?,notes_middle=?,notes_base=?,accords=?,transparency_notice=?,search_blob=NULL WHERE id=?');
  let updated=0,skipped=0;
  for(const x of m.items){const p=get.get(x.product_id),e=evidence.get(x.product_id),v=price.get(x.product_id);
   let ok=!!(p&&p.slug===x.product_slug&&p.name_en===x.expected_name_en&&p.brand_en===x.expected_brand&&p.concentration===x.expected_concentration&&p.supply_mode==='MADE_TO_ORDER'&&p.essence_usd_per_kg===x.expected_usd_per_kg&&p.transparency_notice===x.expected_old_notice&&e&&e.official_url===x.source_url&&e.status==='official_original_found_supplier_essence_unverified'&&v&&v.usd_per_kg===x.expected_usd_per_kg&&v.match_status==='name_matched_supplier_identity_unverified');
   try{if(ok)ok=['top','middle','base'].every(k=>JSON.stringify(JSON.parse(p['notes_'+k]||'[]'))===JSON.stringify(x.expected_old_notes[k]))&&JSON.stringify(JSON.parse(p.accords||'[]'))===JSON.stringify(x.expected_old_accords);}catch{ok=false}
   if(!ok){skipped++;continue}
   update.run(...['top','middle','base'].map(k=>JSON.stringify(x.verified_notes[k])),JSON.stringify(x.verified_accords),x.verified_notice,p.id);updated++;
  }
  const result={updated,skipped,at:new Date().toISOString()};db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(VERSION,JSON.stringify(result));return result;
 })();
}
module.exports={applyActiveOfficialNotes,VERSION};
