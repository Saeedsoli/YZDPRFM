'use strict';
// One-time, non-selling import of four name-matched reference prices. Original
// essence identity remains unverified; never overwrite any existing owner edits.
const fs=require('fs');
const {kgToGram,productPriceState,applyProductPrice}=require('./product-essence-pricing');
const VERSION='official_reference_prices_2026_10_v1';
const HOSTS=new Set(['lattafa.com','www.creedfragrance.com','www.atkinsons1799.com']);
function applyReferencePrices(db,file){
 if(!fs.existsSync(file))return {applied:0,skipped:0,reason:'file_missing'};
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(data.version!==VERSION||!/^[a-f0-9]{64}$/.test(data.supplier_file_sha256||'')||!Array.isArray(data.items)||data.items.length!==4)throw new Error('Invalid reference price manifest');
 const ids=new Set();
 for(const x of data.items){
  let url;try{url=new URL(x.official_url);}catch{throw new Error('Invalid source URL');}
  if(!x.product_id||!x.slug||ids.has(x.product_id)||url.protocol!=='https:'||!HOSTS.has(url.hostname)||url.username||url.password||
    x.match_status!=='name_matched_supplier_identity_unverified'||!/^[A-Za-z]$/.test(x.quality||'')||!Array.isArray(x.expected_edps))throw new Error('Invalid reference price entry');
  for(const v of x.expected_edps)if(!v.sku||![10,30,50,100].includes(v.volume_ml)||!Number.isInteger(v.price_toman)||v.price_toman<=0||v.stock!==0||!(v.price_usd===null||typeof v.price_usd==='number'))throw new Error('Invalid baseline variant');
  kgToGram(x.usd_per_kg);ids.add(x.product_id);
 }
 return db.transaction(()=>{
  if(db.prepare('select value from settings where key=?').get(VERSION))return {applied:0,skipped:0,reason:'already_applied'};
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_price_evidence (
    product_id TEXT PRIMARY KEY, supplier_file_sha256 TEXT NOT NULL, official_url TEXT NOT NULL,
    usd_per_kg TEXT NOT NULL, quality TEXT NOT NULL, match_status TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const find=db.prepare('select id,slug,supply_mode,essence_usd_per_kg from products where id=?');
  const edps=db.prepare("select sku,volume_ml,price_toman,stock,price_usd from variants where product_id=? and type='EDP' order by volume_ml,sku");
  const currentNew=db.prepare("select count(*) n from variants where product_id=? and ((type='SAMPLE' and volume_ml=5) or (type='BODY_SPLASH' and volume_ml=120))");
  const total=db.prepare('select count(*) n from variants where product_id=?');
  const priorEvidence=db.prepare('select product_id from supplier_price_evidence where product_id=?');
  const evidence=db.prepare('insert into supplier_price_evidence(product_id,supplier_file_sha256,official_url,usd_per_kg,quality,match_status) values(?,?,?,?,?,?)');
  let applied=0;const skipped=[];
  for(const x of data.items){
   const p=find.get(x.product_id);
   const safe=p&&p.slug===x.slug&&p.supply_mode==='UNAVAILABLE'&&p.essence_usd_per_kg===null&&
     !priorEvidence.get(x.product_id)&&currentNew.get(x.product_id).n===0&&
     JSON.stringify(edps.all(x.product_id))===JSON.stringify(x.expected_edps)&&
     (x.expected_edps.length>0||total.get(x.product_id).n===0);
   if(!safe){skipped.push(x.product_id);continue;}
   const state=productPriceState(db,p.id);
   applyProductPrice(db,p.id,kgToGram(x.usd_per_kg),state.rate_toman,null);
   evidence.run(p.id,data.supplier_file_sha256,x.official_url,x.usd_per_kg,x.quality,x.match_status);applied++;
  }
  db.prepare('insert into settings(key,value) values(?,?)').run(VERSION,JSON.stringify({applied,skipped,at:new Date().toISOString()}));
  return {applied,skipped:skipped.length,skipped_ids:skipped};
 })();
}
module.exports={applyReferencePrices,VERSION};
