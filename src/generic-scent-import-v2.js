'use strict';

const fs=require('fs'),crypto=require('crypto');
const {kgToGram,productPriceState,applyProductPrice}=require('./product-essence-pricing');
const {allowedVariant,RATE_KEY}=require('./essence-pricing-store');
const {priceFromUsdPerKg}=require('./essence-pricing');
const KEY='generic_scent_owner_approved_2026_11_v2';
const DIGEST='5143706af5f8d493aeefa2623de2b2678268970ae8820387cc38c80430bded32';

function applyGenericScents(db,file){
 const raw=fs.readFileSync(file);
 if(crypto.createHash('sha256').update(raw).digest('hex')!==DIGEST)throw Error('Generic scent approval manifest changed');
 const m=JSON.parse(raw);if(m.version!==KEY||m.items.length!==5)throw Error('Invalid generic scent approval');
 return db.transaction(()=>{
  const old=db.prepare('select value from settings where key=?').get(KEY);
  if(old)return {reason:'already_applied',...JSON.parse(old.value)};
  const rate=db.prepare('select value from settings where key=?').get(RATE_KEY)?.value;
  if(!/^[1-9]\d{0,9}$/.test(rate||''))throw Error('Invalid exchange rate');
  const collision=db.prepare('select id from products where id=? or slug=?');
  for(const x of m.items)if(collision.get(x.product_id,x.slug))throw Error('Generic scent ID or slug collision: '+x.product_id);
  db.exec(`CREATE TABLE IF NOT EXISTS generic_scent_price_evidence (
    product_id TEXT PRIMARY KEY REFERENCES products(id), supplier_file_sha256 TEXT NOT NULL,
    supplier_brand TEXT NOT NULL, supplier_model TEXT NOT NULL, supplier_gender TEXT NOT NULL,
    usd_per_kg TEXT NOT NULL, quality TEXT NOT NULL, status TEXT NOT NULL)`);
  const ins=db.prepare(`INSERT INTO products(id,slug,name_fa,name_en,title_fa_display,subtitle_en_display,
    gender,notes_top,notes_middle,notes_base,accords,transparency_notice,image_url,search_blob)
    VALUES(?,?,?,?,?,?,?,'[]','[]','[]','[]',?,?,?)`);
  const evidence=db.prepare('INSERT INTO generic_scent_price_evidence VALUES(?,?,?,?,?,?,?,?)');
  const mode=db.prepare("UPDATE products SET supply_mode='MADE_TO_ORDER' WHERE id=? AND supply_mode='UNAVAILABLE'");
  const variants=db.prepare('select type,volume_ml,stock,price_toman from variants where product_id=?');
  for(const [i,x] of m.items.entries()){
   const en=x.name_en,notice='این رایحه عمومی و دست‌ساز است و مرجع برند مشخصی ندارد. ترکیب و منشأ اسانس تأمین‌کننده تأیید نشده است.';
   ins.run(x.product_id,x.slug,x.name_fa,en,`${x.name_fa} «دست‌ساز»`,en,x.supplier_gender==='Men'?'MEN':'UNISEX',notice,'/images/products/studio-dark-7.jpg',`${x.name_fa} ${en}`);
   applyProductPrice(db,x.product_id,kgToGram(x.usd_per_kg),rate,null);
   evidence.run(x.product_id,m.supplier_file_sha256,x.supplier_brand,x.supplier_model,x.supplier_gender,x.usd_per_kg,x.quality,'owner_approved_generic_supplier_composition_unverified');
   const vs=variants.all(x.product_id).filter(v=>allowedVariant(v.type,v.volume_ml));
   if(vs.length!==6||new Set(vs.map(v=>`${v.type}:${v.volume_ml}`)).size!==6||!vs.every(v=>v.stock===0&&v.price_toman>0&&v.price_toman===priceFromUsdPerKg(x.usd_per_kg,rate,v.type,v.volume_ml)))throw Error('Generic price verification failed');
   if(mode.run(x.product_id).changes!==1)throw Error('Generic availability verification failed');
  }
  const result={created:5,activated:5,at:new Date().toISOString()};
  db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify(result));return result;
 })();
}
module.exports={applyGenericScents,KEY};
