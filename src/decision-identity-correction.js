'use strict';

const fs=require('fs');
const KEY='decision_metadata_2026_11_v1';
const COLUMNS=['name_fa','name_en','subtitle_en_display','gender','family_fa','family_en','family_slug','temperature','taste','season','occasion','longevity','sillage','market_segment','perfumer','release_year'];
function applyDecisionIdentityCorrection(db,file){
 if(!fs.existsSync(file))return {updated:0,reason:'file_missing'};
 const x=JSON.parse(fs.readFileSync(file,'utf8'));
 if(x.version!==KEY||x.product_id!=='YZD-PROD-1996'||x.slug!=='amouage-decision-2024'||x.official_url!=='https://amouage.com/products/new-decision'||x.year_source_url!=='https://www.parfumo.com/Perfumes/Amouage/decision'||!x.expected||!x.updated||JSON.stringify(Object.keys(x.expected).sort())!==JSON.stringify([...COLUMNS].sort())||JSON.stringify(Object.keys(x.updated).sort())!==JSON.stringify([...COLUMNS].sort()))throw new Error('Invalid guarded Decision correction');
 return db.transaction(()=>{
  if(db.prepare('select value from settings where key=?').get(KEY))return {updated:0,reason:'already_applied'};
  const p=db.prepare('select * from products where id=?').get(x.product_id);
  const evidence=['official_identity_evidence','secondary_reference_evidence','supplier_price_evidence'].some(t=>{const exists=db.prepare("select 1 from sqlite_master where type='table' and name=?").get(t);return exists&&db.prepare(`select 1 from ${t} where product_id=?`).get(x.product_id);});
  const safe=p&&p.slug===x.slug&&p.brand_en==='Amouage'&&p.supply_mode==='UNAVAILABLE'&&p.essence_usd_per_kg===null&&!evidence&&COLUMNS.every(k=>p[k]===x.expected[k]);
  let updated=0;
  if(safe){db.prepare('update products set '+COLUMNS.map(k=>`${k}=@${k}`).join(',')+',search_blob=NULL where id=@id').run({...x.updated,id:x.product_id});updated=1;}
  db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify({updated,skipped:updated?0:1,at:new Date().toISOString()}));
  return {updated,skipped:updated?0:1};
 })();
}
module.exports={applyDecisionIdentityCorrection,KEY};
