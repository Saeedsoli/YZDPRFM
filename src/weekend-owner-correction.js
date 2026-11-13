'use strict';

const fs=require('fs'),crypto=require('crypto');
const {priceFromUsdPerKg}=require('./essence-pricing');
const KEY='weekend_owner_correction_2026_11_v1';
function apply(db,file){
 const m=JSON.parse(fs.readFileSync(file,'utf8')),x=m.items?.[0];
 if(m.version!=='official_reference_prices_2026_11_v46'||m.items.length!==1||x?.product_id!=='YZD-PROD-0343'||x.usd_per_kg!=='97.9'||x.quality!=='P'||x.supplier_gender!=='Women')throw Error('Invalid retraction manifest');
 return db.transaction(()=>{
  const prior=db.prepare('select value from settings where key=?').get(KEY);
  if(prior)return {ok:true,reason:'already_applied'};
  const imported=db.prepare('select value from settings where key=?').get(m.version);
  if(!imported){

   if(db.prepare('select 1 from supplier_price_evidence where product_id=?').get(x.product_id))return {ok:false,reason:'unmarked_evidence'};
   db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify({reason:'not_previously_imported'}));return {ok:true,reason:'not_previously_imported'};
  }
  const p=db.prepare('select id,slug,name_en,brand_en,supply_mode,essence_usd_per_kg from products where id=?').get(x.product_id);
  const e=db.prepare('select supplier_file_sha256,official_url,usd_per_kg,quality,match_status from supplier_price_evidence where product_id=?').get(x.product_id);
  const rate=db.prepare("select value from settings where key='essence_usd_rate_toman'").get()?.value;
  let ok=!!(p&&p.slug===x.slug&&p.name_en===x.expected_name_en&&p.brand_en===x.brand_en&&p.supply_mode==='UNAVAILABLE'&&p.essence_usd_per_kg===x.usd_per_kg&&e&&e.supplier_file_sha256===m.supplier_file_sha256&&e.official_url===x.official_url&&e.usd_per_kg===x.usd_per_kg&&e.quality===x.quality&&e.match_status===x.match_status&&/^[1-9]\d{0,9}$/.test(rate||''));
  const digest=crypto.createHash('sha256').update(x.product_id).digest('hex').slice(0,20).toUpperCase();
  const sample=`ESS-${digest}-SMP-005`,body=`ESS-${digest}-BS-120`;
  const current=db.prepare("select sku,type,volume_ml,price_toman,stock,price_usd from variants where product_id=? and ((type='EDP' and volume_ml in (10,30,50,100)) or (type='SAMPLE' and volume_ml=5) or (type='BODY_SPLASH' and volume_ml=120))").all(x.product_id);
  if(ok){
   const allowed=new Set([...x.expected_edps.map(v=>v.sku),sample,body]);
   ok=current.length===6&&current.every(v=>allowed.has(v.sku)&&v.stock===0&&v.price_toman===priceFromUsdPerKg(x.usd_per_kg,rate,v.type,v.volume_ml));
   for(const old of x.expected_edps){const v=current.find(z=>z.sku===old.sku);if(!v||v.type!=='EDP'||v.volume_ml!==old.volume_ml||v.price_usd!==old.price_usd)ok=false;}
   const sv=current.find(v=>v.sku===sample),bv=current.find(v=>v.sku===body);
   if(!sv||sv.type!=='SAMPLE'||sv.volume_ml!==5||sv.price_usd!==null||!bv||bv.type!=='BODY_SPLASH'||bv.volume_ml!==120||bv.price_usd!==null)ok=false;
   if(ok)for(const v of current)if(db.prepare('select 1 from order_items where sku=? limit 1').get(v.sku)||db.prepare('select 1 from stock_alerts where sku=? limit 1').get(v.sku)){ok=false;break;}
  }
  if(!ok)return {ok:false,reason:'owner_edit_or_reference'};
  for(const v of x.expected_edps)db.prepare('update variants set price_toman=? where sku=?').run(v.price_toman,v.sku);
  db.prepare('delete from variants where sku in (?,?)').run(sample,body);
  db.prepare('update products set essence_usd_per_kg=NULL where id=?').run(x.product_id);
  db.prepare('delete from supplier_price_evidence where product_id=?').run(x.product_id);
  db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify({reason:'retracted_owner_correction',at:new Date().toISOString()}));
  return {ok:true,reason:'retracted_owner_correction'};
 })();
}
module.exports={apply,KEY};
