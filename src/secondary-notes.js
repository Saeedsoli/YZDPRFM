'use strict';
// Independent-source note corrections; never imply manufacturer verification.
const fs=require('fs');
const VERSION='secondary_notes_2026_11_v1';
const VERSION_2='secondary_notes_2026_11_v2';
const VERSION_3='secondary_notes_2026_11_v3';
const VERSION_4='secondary_notes_2026_11_v4';
const STATUS='secondary_original_found_supplier_essence_unverified';
function applySecondaryNotes(db,file){
 if(!fs.existsSync(file))return {updated:0,skipped:0,reason:'file_missing'};
 const m=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Object.hasOwn({[VERSION]:5,[VERSION_2]:2,[VERSION_3]:1,[VERSION_4]:1},m.version)||!Array.isArray(m.items)||m.items.length!==({[VERSION]:5,[VERSION_2]:2,[VERSION_3]:1,[VERSION_4]:1})[m.version])throw new Error('Invalid independent notes manifest');
 const seen=new Set();
 for(const x of m.items){
  let url;try{url=new URL(x.source_url);}catch{throw new Error('Invalid independent note URL');}
  if(!x.product_id||!x.product_slug||seen.has(x.product_id)||url.protocol!=='https:'||url.hostname!=='www.fragrantica.com'||url.username||url.password||!/^\/perfume\/[^/]+\/[^/]+-\d+\.html$/.test(url.pathname)||url.search||url.hash||typeof x.expected_notice!=='string'||typeof x.new_notice!=='string'||!x.new_notice.includes('فراگرانتیکا')||!x.new_notice.includes('بازآفرینی دست‌ساز'))throw new Error('Invalid independent note entry');
  for(const k of ['top','middle','base'])if(!Array.isArray(x.expected_old_notes?.[k])||!Array.isArray(x.notes?.[k])||!x.notes[k].every(s=>typeof s==='string'&&s.trim()&&s.length<=60))throw new Error('Invalid note list');
  if(!Array.isArray(x.expected_old_accords)||!Array.isArray(x.accords)||!x.accords.every(s=>typeof s==='string'&&s.trim()&&s.length<=60))throw new Error('Invalid unclassified notes');seen.add(x.product_id);
 }
 return db.transaction(()=>{
  if(db.prepare('select value from settings where key=?').get(m.version))return {updated:0,skipped:0,reason:'already_applied'};
  const get=db.prepare('select id,slug,supply_mode,notes_top,notes_middle,notes_base,accords,transparency_notice from products where id=?');
  const ev=db.prepare('select source_url,status from secondary_reference_evidence where product_id=?');
  const update=db.prepare('update products set notes_top=?,notes_middle=?,notes_base=?,accords=?,transparency_notice=?,search_blob=NULL where id=?');
  let updated=0;const skipped=[];
  for(const x of m.items){
   const p=get.get(x.product_id),e=ev.get(x.product_id);let unchanged=!!(p&&p.slug===x.product_slug&&p.supply_mode==='UNAVAILABLE'&&p.transparency_notice===x.expected_notice&&e&&e.source_url===x.source_url&&e.status===STATUS);
   try {if(unchanged)unchanged=['top','middle','base'].every(k=>JSON.stringify(JSON.parse(p['notes_'+k]||'[]'))===JSON.stringify(x.expected_old_notes[k]))&&JSON.stringify(JSON.parse(p.accords||'[]'))===JSON.stringify(x.expected_old_accords);}catch{unchanged=false;}
   if(!unchanged){skipped.push(x.product_id);continue;}
   update.run(JSON.stringify(x.notes.top),JSON.stringify(x.notes.middle),JSON.stringify(x.notes.base),JSON.stringify(x.accords),x.new_notice,x.product_id);updated++;
  }
  db.prepare('insert into settings(key,value) values(?,?)').run(m.version,JSON.stringify({updated,skipped,at:new Date().toISOString()}));return {updated,skipped:skipped.length,skipped_ids:skipped};
 })();
}
module.exports={applySecondaryNotes,VERSION,VERSION_2};
