'use strict';
// One explicitly selected reference; independent sources are never official.
// Create only new, fixed-scope records; never overwrite a product or order.
const fs=require('fs'),crypto=require('crypto');
const {kgToGram,applyProductPrice}=require('./product-essence-pricing');
const {allowedVariant,RATE_KEY}=require('./essence-pricing-store');
const {priceFromUsdPerKg}=require('./essence-pricing');
const KEY='owner_reference_selection_2026_11_v3';
const DIGEST='f9532b8790a47949dcf3c2ea22bb0ac0fbdbe2118d24d5d8dc3448939e3abde6';
function applyOwnerReferences(db,file){
 const raw=fs.readFileSync(file);if(crypto.createHash('sha256').update(raw).digest('hex')!==DIGEST)throw Error('Owner selection manifest changed');
 const m=JSON.parse(raw);if(m.version!==KEY||m.items.length!==1)throw Error('Invalid owner reference selection');
 return db.transaction(()=>{
  const previous=db.prepare('select value from settings where key=?').get(KEY);if(previous)return {reason:'already_applied',...JSON.parse(previous.value)};
  const rate=db.prepare('select value from settings where key=?').get(RATE_KEY)?.value;if(!/^[1-9]\d{0,9}$/.test(rate||''))throw Error('Invalid exchange rate');
  const previousBoss=db.prepare('select name_fa,name_en,slug,brand_en,supply_mode,essence_usd_per_kg from products where id=?').get('YZD-PROD-1798');
  const bossEvidence=db.prepare('select supplier_file_sha256,usd_per_kg,quality,official_url from supplier_price_evidence where product_id=?').get('YZD-PROD-1798');
  if(!previousBoss||previousBoss.name_fa!=='باس باتلد ادوتویلت'||previousBoss.name_en!=='HUGO BOSS - Boss Bottled EDT'||previousBoss.slug!=='hugo-boss-boss-bottled-edt'||previousBoss.brand_en!=='Hugo Boss'||previousBoss.supply_mode!=='MADE_TO_ORDER'||previousBoss.essence_usd_per_kg!=='88'||!bossEvidence||bossEvidence.supplier_file_sha256!==m.supplier_file_sha256||bossEvidence.usd_per_kg!=='88'||bossEvidence.quality!=='I'||bossEvidence.official_url!=='https://www.hugoboss.com/boss-bottled-eau-de-toilette-50ml/hbeu58000035_999.html')throw Error('Boss 98 baseline changed; manual review required');
  if(db.prepare("update products set name_fa=?,search_blob=coalesce(search_blob,'')||? where id=? and name_fa=?").run('بوس ۹۸',' بوس ۹۸ باس ۹۸','YZD-PROD-1798','باس باتلد ادوتویلت').changes!==1)throw Error('Boss 98 name conflict');
  const collision=db.prepare('select id from products where id=? or slug=?');
  for(const x of m.items)if(collision.get(x.product_id,x.slug))throw Error('Selected reference collision: '+x.product_id);
  db.exec(`CREATE TABLE IF NOT EXISTS owner_reference_price_evidence (product_id TEXT PRIMARY KEY REFERENCES products(id),supplier_file_sha256 TEXT NOT NULL,supplier_brand TEXT NOT NULL,supplier_model TEXT NOT NULL,supplier_gender TEXT NOT NULL,usd_per_kg TEXT NOT NULL,quality TEXT NOT NULL,reference_name TEXT NOT NULL,source_url TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL)`);
  const ins=db.prepare(`INSERT INTO products(id,slug,name_fa,name_en,brand_fa,brand_en,gender,subtitle_en_display,notes_top,notes_middle,notes_base,accords,transparency_notice,image_url,search_blob) VALUES(?,?,?,?,?,?,?,?,?,?,?,'[]',?,?,?)`);
  const ev=db.prepare('INSERT INTO owner_reference_price_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const mode=db.prepare("UPDATE products SET supply_mode='MADE_TO_ORDER' WHERE id=? AND supply_mode='UNAVAILABLE'");
  const variants=db.prepare('select type,volume_ml,stock,price_toman from variants where product_id=?');
  for(const x of m.items){
   const note=`این محصول بازآفرینی دست‌ساز است و محصول اورجینال برند اصلی نیست. اطلاعات رایحه مرجع از ${'منابع رسمی و مستقل'} گرفته شده؛ انتخاب مرجع توسط مالک هویت یا ترکیب اسانس تأمین‌کننده را تأیید نمی‌کند.`+' این محصول با بوس ۹۸ ادوتویلت که جداگانه عرضه می‌شود یکسان فرض نشده است.';
   ins.run(x.product_id,x.slug,x.name_fa,x.name_en,x.brand_fa,x.brand_en,x.gender,x.name_en,JSON.stringify(x.notes.top),JSON.stringify(x.notes.middle),JSON.stringify(x.notes.base),note,'/images/products/studio-dark-8.jpg',`${x.brand_fa} ${x.name_fa} ${x.name_en}`);
   applyProductPrice(db,x.product_id,kgToGram(x.usd_per_kg),rate,null);
   ev.run(x.product_id,m.supplier_file_sha256,x.supplier_brand,x.supplier_model,x.supplier_gender,x.usd_per_kg,x.quality,x.reference_name,x.source_url,x.provider,'owner_selected_independent_supplier_essence_unverified');
   const vs=variants.all(x.product_id).filter(v=>allowedVariant(v.type,v.volume_ml));
   if(vs.length!==6||new Set(vs.map(v=>`${v.type}:${v.volume_ml}`)).size!==6||!vs.every(v=>v.stock===0&&v.price_toman>0&&v.price_toman===priceFromUsdPerKg(x.usd_per_kg,rate,v.type,v.volume_ml)))throw Error('Selected reference price verification failed');
   if(mode.run(x.product_id).changes!==1)throw Error('Selected reference activation failed');
  }
  const result={created:1,activated:1,at:new Date().toISOString()};db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify(result));return result;
 })();
}
module.exports={applyOwnerReferences,KEY};
