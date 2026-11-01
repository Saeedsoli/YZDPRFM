'use strict';
// Provisional price references, never verification of the supplied essence.
// Reprice only untouched, unavailable products; preserve all owner changes.
const fs=require('fs');
const {kgToGram,productPriceState,applyProductPrice}=require('./product-essence-pricing');
const {HOST_BY_BRAND}=require('./official-identities');
const VERSION='official_reference_prices_2026_10_v1';
const VERSION_2='official_reference_prices_2026_10_v2';
const VERSION_3='official_reference_prices_2026_10_v3';
const VERSION_4='official_reference_prices_2026_10_v4';
const VERSION_5='official_reference_prices_2026_10_v5';
const VERSION_6='official_reference_prices_2026_10_v6';
const VERSION_7='official_reference_prices_2026_10_v7';
const VERSION_8='official_reference_prices_2026_10_v8';
const VERSION_9='official_reference_prices_2026_10_v9';
const VERSION_10='official_reference_prices_2026_10_v10';
const VERSION_11='official_reference_prices_2026_10_v11';
const VERSION_12='official_reference_prices_2026_10_v12';
const VERSION_13='official_reference_prices_2026_10_v13';
const VERSION_14='official_reference_prices_2026_10_v14';
const VERSION_15='official_reference_prices_2026_10_v15';
const VERSION_16='official_reference_prices_2026_10_v16';
const VERSION_17='official_reference_prices_2026_10_v17';
const VERSION_18='official_reference_prices_2026_10_v18';
const VERSION_19='official_reference_prices_2026_11_v19';
const VERSION_20='official_reference_prices_2026_11_v20';
const VERSION_21='official_reference_prices_2026_11_v21';
const VERSION_22='official_reference_prices_2026_11_v22';
const VERSION_23='official_reference_prices_2026_11_v23';
const VERSION_24='official_reference_prices_2026_11_v24';
const VERSION_25='official_reference_prices_2026_11_v25';
const VERSION_26='official_reference_prices_2026_11_v26';
const VERSION_27='official_reference_prices_2026_11_v27';
const VERSION_28='official_reference_prices_2026_11_v28';
const VERSION_29='official_reference_prices_2026_11_v29';
const VERSION_30='official_reference_prices_2026_11_v30';
const VERSION_31='official_reference_prices_2026_11_v31';
const VERSION_32='official_reference_prices_2026_11_v32';
const VERSION_33='official_reference_prices_2026_11_v33';
const VERSION_34='official_reference_prices_2026_11_v34';
const VERSION_35='official_reference_prices_2026_11_v35';
const VERSION_36='official_reference_prices_2026_11_v36';
const VERSION_37='official_reference_prices_2026_11_v37';
const VERSION_38='official_reference_prices_2026_11_v38';
const VERSION_39='official_reference_prices_2026_11_v39';
const VERSION_40='official_reference_prices_2026_11_v40';
const VERSION_41='official_reference_prices_2026_11_v41';
const VERSION_42='official_reference_prices_2026_11_v42';
const VERSION_43='official_reference_prices_2026_11_v43';
const VERSION_44='official_reference_prices_2026_11_v44';
const VERSION_45='official_reference_prices_2026_11_v45';
const VERSION_47='official_reference_prices_2026_11_v47';
const VERSION_48='official_reference_prices_2026_11_v48';
const VERSION_49='official_reference_prices_2026_11_v49';
const VERSION_50='official_reference_prices_2026_11_v50';
const VERSION_51='official_reference_prices_2026_11_v51';
const V1_HOSTS=new Set(['lattafa.com','www.creedfragrance.com','www.atkinsons1799.com']);
function applyReferencePrices(db,file){
 if(!fs.existsSync(file))return {applied:0,skipped:0,reason:'file_missing'};
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 const second=data.version===VERSION_2;
 const needsIdentity=[VERSION_2,VERSION_3,VERSION_4,VERSION_5,VERSION_6,VERSION_7,VERSION_8,VERSION_9,VERSION_10,VERSION_11,VERSION_12,VERSION_13,VERSION_14,VERSION_15,VERSION_16,VERSION_17,VERSION_18,VERSION_19,VERSION_20,VERSION_21,VERSION_22,VERSION_23,VERSION_24,VERSION_25,VERSION_26,VERSION_27,VERSION_28,VERSION_29,VERSION_30,VERSION_31,VERSION_32,VERSION_33,VERSION_34,VERSION_35,VERSION_36,VERSION_37,VERSION_38,VERSION_39,VERSION_40,VERSION_41,VERSION_42,VERSION_43,VERSION_44,VERSION_45,VERSION_47,VERSION_48,VERSION_49,VERSION_50,VERSION_51].includes(data.version);
 const counts={[VERSION]:4,[VERSION_2]:37,[VERSION_3]:6,[VERSION_4]:6,[VERSION_5]:8,[VERSION_6]:1,[VERSION_7]:5,[VERSION_8]:3,[VERSION_9]:1,[VERSION_10]:2,[VERSION_11]:6,[VERSION_12]:5,[VERSION_13]:5,[VERSION_14]:7,[VERSION_15]:6,[VERSION_16]:6,[VERSION_17]:2,[VERSION_18]:1,[VERSION_19]:2,[VERSION_20]:2,[VERSION_21]:4,[VERSION_22]:2,[VERSION_23]:3,[VERSION_24]:1,[VERSION_25]:3,[VERSION_26]:2,[VERSION_27]:1,[VERSION_28]:2,[VERSION_29]:1,[VERSION_30]:1,[VERSION_31]:2,[VERSION_32]:1,[VERSION_33]:1,[VERSION_34]:1,[VERSION_35]:1,[VERSION_36]:1,[VERSION_37]:1,[VERSION_38]:1,[VERSION_39]:1,[VERSION_40]:1,[VERSION_41]:1,[VERSION_42]:1,[VERSION_43]:1,[VERSION_44]:1,[VERSION_45]:1,[VERSION_47]:1,[VERSION_48]:1,[VERSION_49]:1,[VERSION_50]:1,[VERSION_51]:7};
 if(!Object.hasOwn(counts,data.version)||!/^[a-f0-9]{64}$/.test(data.supplier_file_sha256||'')||!Array.isArray(data.items)||data.items.length!==counts[data.version])throw new Error('Invalid reference price manifest');
 const ids=new Set();
 for(const x of data.items){
  let url;try{url=new URL(x.official_url);}catch{throw new Error('Invalid source URL');}
  const allowedHost=needsIdentity ? HOST_BY_BRAND[x.brand_en]===url.hostname : V1_HOSTS.has(url.hostname);
  if(!x.product_id||!x.slug||ids.has(x.product_id)||url.protocol!=='https:'||!allowedHost||url.username||url.password||
    x.match_status!=='name_matched_supplier_identity_unverified'||!/^[A-Za-z]$/.test(x.quality||'')||!Array.isArray(x.expected_edps)||
    (needsIdentity&&(!x.brand_en||!x.expected_name_en||!x.reference_name)))throw new Error('Invalid reference price entry');
  for(const v of x.expected_edps)if(!v.sku||![10,30,50,100].includes(v.volume_ml)||!Number.isInteger(v.price_toman)||v.price_toman<=0||v.stock!==0||!(v.price_usd===null||typeof v.price_usd==='number'))throw new Error('Invalid baseline variant');
  kgToGram(x.usd_per_kg);ids.add(x.product_id);
 }
 return db.transaction(()=>{
  if(db.prepare('select value from settings where key=?').get(data.version))return {applied:0,skipped:0,reason:'already_applied'};
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_price_evidence (
    product_id TEXT PRIMARY KEY, supplier_file_sha256 TEXT NOT NULL, official_url TEXT NOT NULL,
    usd_per_kg TEXT NOT NULL, quality TEXT NOT NULL, match_status TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const find=db.prepare(needsIdentity
    ? 'select id,slug,brand_en,name_en,supply_mode,essence_usd_per_kg from products where id=?'
    : 'select id,slug,supply_mode,essence_usd_per_kg from products where id=?');
  const edps=db.prepare("select sku,volume_ml,price_toman,stock,price_usd from variants where product_id=? and type='EDP' order by volume_ml,sku");
  const currentNew=db.prepare("select count(*) n from variants where product_id=? and ((type='SAMPLE' and volume_ml=5) or (type='BODY_SPLASH' and volume_ml=120))");
  const total=db.prepare('select count(*) n from variants where product_id=?');
  const priorEvidence=db.prepare('select product_id from supplier_price_evidence where product_id=?');
  const secondaryExists=db.prepare("select 1 from sqlite_master where type='table' and name='secondary_reference_evidence'").get();
  const priorSecondary=secondaryExists?db.prepare('select product_id from secondary_reference_evidence where product_id=?'):null;
  const evidence=db.prepare('insert into supplier_price_evidence(product_id,supplier_file_sha256,official_url,usd_per_kg,quality,match_status) values(?,?,?,?,?,?)');
  const originalImport=second && !!db.prepare("select value from settings where key='supplier_exact_price_import_v1'").get();
  const official=needsIdentity ? db.prepare('select official_url,status from official_identity_evidence where product_id=?') : null;
  let applied=0,backfilled=0;const skipped=[];
  for(const x of data.items){
   const p=find.get(x.product_id), e=needsIdentity ? official.get(x.product_id) : null;
   const identityOk=!needsIdentity || !!(p&&p.brand_en===x.brand_en&&p.name_en===x.expected_name_en&&e&&e.official_url===x.official_url&&e.status==='official_original_found_supplier_essence_unverified');
   const already=priorEvidence.get(x.product_id)||(priorSecondary&&priorSecondary.get(x.product_id));
   // For the previously imported 42, add provenance only when the value is
   // unchanged and the original one-time import marker exists. Never reprice.
   if(second&&p&&p.slug===x.slug&&p.supply_mode==='UNAVAILABLE'&&identityOk&&originalImport&&!already&&p.essence_usd_per_kg===x.usd_per_kg){
    evidence.run(p.id,data.supplier_file_sha256,x.official_url,x.usd_per_kg,x.quality,x.match_status);backfilled++;continue;
   }
   const safe=p&&p.slug===x.slug&&p.supply_mode==='UNAVAILABLE'&&p.essence_usd_per_kg===null&&identityOk&&
     !already&&currentNew.get(x.product_id).n===0&&
     JSON.stringify(edps.all(x.product_id))===JSON.stringify(x.expected_edps)&&
     (x.expected_edps.length>0||total.get(x.product_id).n===0);
   if(!safe){skipped.push(x.product_id);continue;}
   const state=productPriceState(db,p.id);
   applyProductPrice(db,p.id,kgToGram(x.usd_per_kg),state.rate_toman,null);
   evidence.run(p.id,data.supplier_file_sha256,x.official_url,x.usd_per_kg,x.quality,x.match_status);applied++;
  }
  const audit={applied,skipped,at:new Date().toISOString()};if(second)audit.backfilled=backfilled;
  db.prepare('insert into settings(key,value) values(?,?)').run(data.version,JSON.stringify(audit));
  return second ? {applied,backfilled,skipped:skipped.length,skipped_ids:skipped} : {applied,skipped:skipped.length,skipped_ids:skipped};
 })();
}
module.exports={applyReferencePrices,VERSION,VERSION_2,VERSION_3,VERSION_4,VERSION_5,VERSION_6,VERSION_7,VERSION_8,VERSION_9,VERSION_10,VERSION_11,VERSION_12,VERSION_13,VERSION_14,VERSION_15,VERSION_16,VERSION_17,VERSION_18};
