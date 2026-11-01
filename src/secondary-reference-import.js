'use strict';
// Independent-source reference originals are never represented as official
// evidence or verification of the supplier's actual essence or stock.
const fs=require('fs');
const {kgToGram,productPriceState,applyProductPrice}=require('./product-essence-pricing');
const VERSION='secondary_reference_prices_2026_11_v1';
const VERSION_2='secondary_reference_prices_2026_11_v2';
const VERSION_3='secondary_reference_prices_2026_11_v3';
const VERSION_4='secondary_reference_prices_2026_11_v4';
const VERSION_5='secondary_reference_prices_2026_11_v5';
const VERSION_6='secondary_reference_prices_2026_11_v6';
const VERSION_7='secondary_reference_prices_2026_11_v7';
const VERSION_8='secondary_reference_prices_2026_11_v8';
const VERSION_9='secondary_reference_prices_2026_11_v9';
const VERSION_10='secondary_reference_prices_2026_11_v10';
const VERSION_11='secondary_reference_prices_2026_11_v11';
const STATUS='secondary_original_found_supplier_essence_unverified';
function applySecondaryReferences(db,file){
 if(!fs.existsSync(file))return {applied:0,backfilled:0,skipped:0,reason:'file_missing'};
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Object.hasOwn({[VERSION]:12,[VERSION_2]:6,[VERSION_3]:3,[VERSION_4]:4,[VERSION_5]:2,[VERSION_6]:2,[VERSION_7]:2,[VERSION_8]:5,[VERSION_9]:1,[VERSION_10]:1,[VERSION_11]:1},data.version)||!/^[a-f0-9]{64}$/.test(data.supplier_file_sha256||'')||!Array.isArray(data.items)||data.items.length!==({[VERSION]:12,[VERSION_2]:6,[VERSION_3]:3,[VERSION_4]:4,[VERSION_5]:2,[VERSION_6]:2,[VERSION_7]:2,[VERSION_8]:5,[VERSION_9]:1,[VERSION_10]:1,[VERSION_11]:1})[data.version])throw new Error('Invalid independent reference manifest');
 const seen=new Set();
 for(const x of data.items){
  let url;try{url=new URL(x.source_url);}catch{throw new Error('Invalid independent reference URL');}
  if(!/^(YZD-PROD-\d+|SUP-TP-\d+)$/.test(x.product_id||'')||seen.has(x.product_id)||!x.slug||!x.brand_en||!x.expected_name_en||!x.reference_name||!x.supplier_brand||!x.supplier_model||
   url.protocol!=='https:'||url.hostname!=='www.fragrantica.com'||url.username||url.password||!/^\/perfume\/[^/]+\/[^/]+-\d+\.html$/.test(url.pathname)||url.search||url.hash||
   x.provider!=='Fragrantica'||x.status!==STATUS||x.match_status!=='name_matched_supplier_identity_unverified'||!/^\d{4}-\d{2}-\d{2}$/.test(x.checked_date||'')||!/^[A-Za-z]$/.test(x.quality||'')||
   typeof x.legacy_backfill!=='boolean'||!Array.isArray(x.expected_edps))throw new Error('Invalid independent reference entry');
  for(const v of x.expected_edps)if(!v.sku||![10,30,50,100].includes(v.volume_ml)||!Number.isInteger(v.price_toman)||v.price_toman<=0||v.stock!==0||!(v.price_usd===null||typeof v.price_usd==='number'))throw new Error('Invalid baseline variant');
  kgToGram(x.usd_per_kg);seen.add(x.product_id);
 }
 return db.transaction(()=>{
  if(db.prepare('select value from settings where key=?').get(data.version))return {applied:0,backfilled:0,skipped:0,reason:'already_applied'};
  db.exec(`CREATE TABLE IF NOT EXISTS secondary_reference_evidence (
    product_id TEXT PRIMARY KEY, reference_name TEXT NOT NULL, source_url TEXT NOT NULL,
    provider TEXT NOT NULL, status TEXT NOT NULL, supplier_file_sha256 TEXT NOT NULL,
    usd_per_kg TEXT NOT NULL, quality TEXT NOT NULL, match_status TEXT NOT NULL,
    checked_date TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);
  const find=db.prepare('select id,slug,brand_en,name_en,supply_mode,essence_usd_per_kg from products where id=?');
  const edps=db.prepare("select sku,volume_ml,price_toman,stock,price_usd from variants where product_id=? and type='EDP' order by volume_ml,sku");
  const currentNew=db.prepare("select count(*) n from variants where product_id=? and ((type='SAMPLE' and volume_ml=5) or (type='BODY_SPLASH' and volume_ml=120))");
  const total=db.prepare('select count(*) n from variants where product_id=?');
  const existingOfficial=db.prepare('select product_id from supplier_price_evidence where product_id=?');
  const existingOfficialIdentity=db.prepare('select product_id from official_identity_evidence where product_id=?');
  const existingSecondary=db.prepare('select product_id from secondary_reference_evidence where product_id=?');
  const insert=db.prepare('insert into secondary_reference_evidence(product_id,reference_name,source_url,provider,status,supplier_file_sha256,usd_per_kg,quality,match_status,checked_date) values(?,?,?,?,?,?,?,?,?,?)');
  const legacyImport=!!db.prepare("select value from settings where key='supplier_exact_price_import_v1'").get();
  let applied=0,backfilled=0;const skipped=[];
  for(const x of data.items){
   const p=find.get(x.product_id),identityOk=p&&p.slug===x.slug&&p.brand_en===x.brand_en&&p.name_en===x.expected_name_en&&p.supply_mode==='UNAVAILABLE';
   if(!identityOk||existingOfficial.get(x.product_id)||existingOfficialIdentity.get(x.product_id)||existingSecondary.get(x.product_id)){skipped.push(x.product_id);continue;}
   if(x.legacy_backfill&&legacyImport&&p.essence_usd_per_kg===x.usd_per_kg){
    insert.run(p.id,x.reference_name,x.source_url,x.provider,x.status,data.supplier_file_sha256,x.usd_per_kg,x.quality,x.match_status,x.checked_date);backfilled++;continue;
   }
   const safe=p.essence_usd_per_kg===null&&currentNew.get(x.product_id).n===0&&JSON.stringify(edps.all(x.product_id))===JSON.stringify(x.expected_edps)&&
     (x.expected_edps.length>0||total.get(x.product_id).n===0);
   if(!safe){skipped.push(x.product_id);continue;}
   const state=productPriceState(db,p.id);applyProductPrice(db,p.id,kgToGram(x.usd_per_kg),state.rate_toman,null);
   insert.run(p.id,x.reference_name,x.source_url,x.provider,x.status,data.supplier_file_sha256,x.usd_per_kg,x.quality,x.match_status,x.checked_date);applied++;
  }
  db.prepare('insert into settings(key,value) values(?,?)').run(data.version,JSON.stringify({applied,backfilled,skipped,at:new Date().toISOString()}));
  return {applied,backfilled,skipped:skipped.length,skipped_ids:skipped};
 })();
}
module.exports={applySecondaryReferences,VERSION,VERSION_2,STATUS};
