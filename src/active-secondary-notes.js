'use strict';
// Scoped independent note additions: reference data only, not verification of
// supplier essence or actual ingredients. Never change orders, prices or stock.
const fs=require('fs');
const VERSION='active_secondary_notes_2026_11_v1';
const VERSION_2='active_secondary_notes_2026_11_v2';
const VERSION_3='active_secondary_notes_2026_11_v3';
const VERSION_4='active_secondary_notes_2026_11_v4';
const BATCHES={
 [VERSION]:{
  'YZD-PROD-0591':'https://www.fragrantica.com/perfume/Xerjoff/Torino22-77059.html',
  'SUP-AT-900013':'https://www.fragrantica.com/perfume/Atkinsons/Atkinsons-Her-Majesty-The-Oud-38960.html',
  'SUP-GL-900027':'https://www.fragrantica.com/perfume/Guy-Laroche/Drakkar-Noir-2069.html',
  'SUP-MB-900013':'https://www.fragrantica.com/perfume/Montblanc/Legend-Eau-de-Parfum-62583.html'
 },
 [VERSION_2]:{
  'SUP-CH-900004':'https://www.fragrantica.com/perfume/Carolina-Herrera/212-Sexy-306.html',
  'YZD-PROD-1809':'https://www.fragrantica.com/perfume/Calvin-Klein/Euphoria-253.html',
  'YZD-PROD-0931':'https://www.fragrantica.com/perfume/Orto-Parisi/Megamare-53471.html'
 },
 [VERSION_3]:{
  'YZD-PROD-0921':'https://www.fragrantica.com/perfume/Nasomatto/Baraonda-40200.html',
  'YZD-PROD-0928':'https://www.fragrantica.com/perfume/Nasomatto/Fantomas-62775.html'
 },
 [VERSION_4]:{
  'SUP-SH-900022':'https://www.fragrantica.com/perfume/Shiseido/Zen-1499.html',
  'SUP-XJ-900007':'https://www.fragrantica.com/perfume/Xerjoff/Torino24-99380.html',
  'YZD-PROD-0919':'https://www.fragrantica.com/perfume/Nasomatto/Black-Afgano-6472.html'
 }
};
// Keep normalization identical to the catalog index without importing db.js,
// which would run unrelated initialization on an offline database.
function normalizeFa(s){return String(s||'').replace(/[\u064B-\u0652\u0670]/g,'').replace(/[\u0623\u0625\u0622]/g,'ا').replace(/\u0649|\u064A/g,'ی').replace(/\u0643/g,'ک').replace(/\u0629/g,'ه').replace(/[\u200c\u200f\u200e]/g,' ').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s+/g,' ').trim().toLowerCase()}
function apply(db,file,{indexExisting=false}={}){
 const m=JSON.parse(fs.readFileSync(file,'utf8'));
 const sources=BATCHES[m.version];
 if(!sources||!Array.isArray(m.items)||m.items.length!==Object.keys(sources).length)throw Error('Invalid independent note additions');
 const ids=new Set();
 for(const x of m.items){
  if(!Object.hasOwn(sources,x.product_id)||ids.has(x.product_id)||x.source_url!==sources[x.product_id]||x.provider!=='Fragrantica'||!x.slug||!x.expected_name_en||!x.expected_brand||typeof x.expected_usd_per_kg!=='string'||typeof x.expected_notice!=='string'||!x.official_identity_url||!/^\d{4}-\d{2}-\d{2}$/.test(x.checked_date))throw Error('Invalid note addition');
  for(const k of ['top','middle','base'])if(!Array.isArray(x.notes?.[k])||!x.notes[k].every(n=>typeof n==='string'&&n.trim()&&n.length<=60)||(m.version!==VERSION_3&&!x.notes[k].length)||(m.version===VERSION_3&&x.notes[k].length))throw Error('Invalid note list');
  if(m.version===VERSION_3&&(!Array.isArray(x.accords)||!x.accords.length||!x.accords.every(n=>typeof n==='string'&&n.trim()&&n.length<=60)))throw Error('Invalid unclassified notes');
  if(m.version!==VERSION_3&&x.accords!==undefined&&(!Array.isArray(x.accords)||x.accords.length))throw Error('Unexpected unclassified notes');
  ids.add(x.product_id);
 }
 return db.transaction(()=>{
  if(db.prepare('select 1 from settings where key=?').get(m.version))return {reason:'already_applied',updated_ids:[],skipped_ids:[]};
  const get=db.prepare('select id,slug,name_en,brand_en,concentration,supply_mode,essence_usd_per_kg,transparency_notice,notes_top,notes_middle,notes_base,accords,search_blob from products where id=?');
  const evidence=db.prepare('select official_url,status from official_identity_evidence where product_id=?');
  const price=db.prepare('select official_url,usd_per_kg,match_status from supplier_price_evidence where product_id=?');
  const set=db.prepare('update products set notes_top=?,notes_middle=?,notes_base=?,accords=?,search_blob=? where id=?');
  const idx=indexExisting ? db.prepare('select count(*) n from product_notes where product_id=?') : null;
  const ins=indexExisting ? db.prepare('insert into product_notes(product_id,note,note_key,position) values(?,?,?,?)') : null;
  const updated=[],skipped=[];
  for(const x of m.items){
   const p=get.get(x.product_id),e=evidence.get(x.product_id),v=price.get(x.product_id);
   let ok=!!(p&&p.slug===x.slug&&p.name_en===x.expected_name_en&&p.brand_en===x.expected_brand&&p.concentration===x.expected_concentration&&p.supply_mode==='MADE_TO_ORDER'&&p.essence_usd_per_kg===x.expected_usd_per_kg&&p.transparency_notice===x.expected_notice&&e&&e.official_url===x.official_identity_url&&e.status==='official_original_found_supplier_essence_unverified'&&v&&v.official_url===x.official_identity_url&&v.usd_per_kg===x.expected_usd_per_kg&&v.match_status==='name_matched_supplier_identity_unverified');
   try{if(ok)ok=['notes_top','notes_middle','notes_base','accords'].every(k=>JSON.stringify(JSON.parse(p[k]||'[]'))==='[]') && (!indexExisting || (typeof p.search_blob==='string' && idx.get(x.product_id).n===0))}catch{ok=false}
   if(!ok){skipped.push(x.product_id);continue;}
   const accords=x.accords || [];
   const blob=indexExisting ? normalizeFa(p.search_blob+' '+[...['top','middle','base'].flatMap(k=>x.notes[k]),...accords].join(' ')) : null;
   set.run(JSON.stringify(x.notes.top),JSON.stringify(x.notes.middle),JSON.stringify(x.notes.base),JSON.stringify(accords),blob,x.product_id);
   if(indexExisting){
    for(const pos of ['top','middle','base'])for(const n of x.notes[pos])ins.run(x.product_id,n,normalizeFa(n),pos);
    for(const n of accords)ins.run(x.product_id,n,normalizeFa(n),'accord');
   }
   updated.push(x.product_id);
  }
  db.prepare('insert into settings(key,value) values(?,?)').run(m.version,JSON.stringify({updated,skipped,at:new Date().toISOString()}));
  return {updated_ids:updated,skipped_ids:skipped};
 }).immediate();
}
module.exports={VERSION,VERSION_2,VERSION_3,VERSION_4,apply,normalizeFa};
