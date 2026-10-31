'use strict';
// Applies a frozen, name-matched price manifest only to untouched, unavailable
// supplement products. This does not establish supplier-essence identity or stock.
const fs=require('fs');
const {kgToGram,productPriceState,applyProductPrice}=require('./product-essence-pricing');
const VERSION='lv_reference_prices_v1';
function applyLvReferencePrices(db,file) {
  if(!fs.existsSync(file)) return {applied:0,skipped:0,reason:'file_missing'};
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(data.version!==VERSION || !/^[a-f0-9]{64}$/.test(data.supplier_file_sha256||'') || !Array.isArray(data.items) || data.items.length!==6) throw new Error('Invalid LV price manifest');
  const seen=new Set();
  for(const x of data.items) {
    let url;try{url=new URL(x.official_url);}catch{throw new Error('Invalid source URL');}
    if(!/^SUP-LV-90000[1-6]$/.test(x.product_id||'') || seen.has(x.product_id) || !/^louis-vuitton-[a-z0-9-]+$/.test(x.slug||'') ||
       url.protocol!=='https:' || (url.hostname!=='louisvuitton.com' && !url.hostname.endsWith('.louisvuitton.com')) || url.username || url.password ||
       x.match_status!=='name_matched_supplier_identity_unverified' || !/^[A-Za-z]$/.test(x.quality||'')) throw new Error('Invalid LV price entry');
    kgToGram(x.usd_per_kg);seen.add(x.product_id);
  }
  return db.transaction(()=>{
    const existing=db.prepare('SELECT value FROM settings WHERE key=?').get(VERSION);
    if(existing) return {applied:0,skipped:0,reason:'already_applied'};
    db.exec(`CREATE TABLE IF NOT EXISTS supplier_price_evidence (
      product_id TEXT PRIMARY KEY, supplier_file_sha256 TEXT NOT NULL, official_url TEXT NOT NULL,
      usd_per_kg TEXT NOT NULL, quality TEXT NOT NULL, match_status TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const find=db.prepare('SELECT id,slug,supply_mode,essence_usd_per_kg FROM products WHERE id=?');
    const count=db.prepare('SELECT COUNT(*) n FROM variants WHERE product_id=?');
    const evidence=db.prepare(`INSERT INTO supplier_price_evidence(product_id,supplier_file_sha256,official_url,usd_per_kg,quality,match_status)
      VALUES(?,?,?,?,?,?)`);
    let applied=0;const skipped=[];
    for(const x of data.items){
      const p=find.get(x.product_id);
      if(!p || p.slug!==x.slug || p.supply_mode!=='UNAVAILABLE' || p.essence_usd_per_kg!==null || count.get(x.product_id).n!==0){skipped.push(x.product_id);continue;}
      const state=productPriceState(db,p.id);
      applyProductPrice(db,p.id,kgToGram(x.usd_per_kg),state.rate_toman,null);
      evidence.run(p.id,data.supplier_file_sha256,x.official_url,x.usd_per_kg,x.quality,x.match_status);
      applied++;
    }
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(VERSION,JSON.stringify({applied,skipped,at:new Date().toISOString()}));
    return {applied,skipped:skipped.length,skipped_ids:skipped};
  })();
}
module.exports={applyLvReferencePrices,VERSION};
