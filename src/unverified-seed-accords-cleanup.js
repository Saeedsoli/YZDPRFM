'use strict';

const fs=require('fs'),crypto=require('crypto');
const KEY='unverified_seed_accords_cleanup_2026_11_v1';
const DIGEST='e938407cc8671675a32b42c4cfe934dc507fecdf5183579e81ee2f666236eb6f';
function applyUnverifiedSeedAccordsCleanup(db,file){
 const raw=fs.readFileSync(file);if(crypto.createHash('sha256').update(raw).digest('hex')!==DIGEST)throw Error('Unverified accord cleanup scope changed');
 const m=JSON.parse(raw);if(m.version!==KEY||m.items.length!==31)throw Error('Invalid unverified accord cleanup');
 return db.transaction(()=>{
  const prior=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);if(prior)return {reason:'already_applied',...JSON.parse(prior.value)};
  const get=db.prepare('SELECT id,slug,name_en,brand_en,supply_mode,essence_usd_per_kg,notes_top,notes_middle,notes_base,accords FROM products WHERE id=?');
  const set=db.prepare("UPDATE products SET accords='[]',search_blob=NULL WHERE id=? AND accords=? AND supply_mode='MADE_TO_ORDER'");
  const updated_ids=[],skipped_ids=[];
  for(const x of m.items){const p=get.get(x.product_id);
   let valid=!!(p&&p.slug===x.slug&&p.name_en===x.expected_name_en&&p.brand_en===x.brand_en&&p.supply_mode==='MADE_TO_ORDER'&&p.essence_usd_per_kg===x.usd_per_kg);
   try{if(valid)valid=['top','middle','base'].every(k=>JSON.stringify(JSON.parse(p['notes_'+k]||'[]'))===JSON.stringify(x.expected_notes[k]))&&JSON.stringify(JSON.parse(p.accords||'[]'))===JSON.stringify(x.expected_accords);}catch{valid=false;}
   if(!valid){skipped_ids.push(x.product_id);continue;}
   if(set.run(p.id,p.accords).changes!==1)throw Error('Unverified accord guard conflict');updated_ids.push(p.id);
  }
  const result={updated:updated_ids.length,skipped:skipped_ids.length,updated_ids,skipped_ids,at:new Date().toISOString()};
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(KEY,JSON.stringify(result));return result;
 })();
}
module.exports={applyUnverifiedSeedAccordsCleanup,KEY};
