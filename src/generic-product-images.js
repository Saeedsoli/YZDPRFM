'use strict';
// Owner-approved illustrative images. Product photos and manager edits win.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const VERSION='generic_product_images_2026_11_v1';
const PREFIX='/images/products/';
function loadAssignments(file){
 if(!fs.existsSync(file))return null;
 const m=JSON.parse(fs.readFileSync(file,'utf8'));
 if(m.version!==VERSION||!Array.isArray(m.items)||m.items.length!==83)throw Error('Invalid generic image assignments');
 const seen=new Set();
 for(const x of m.items){
  if(!x.product_id||!x.slug||!x.expected_name_en||!x.expected_brand||seen.has(x.product_id)||x.old_url!==PREFIX+'family-woody.jpg'||!/^\/images\/products\/generic-neutral-[1-5]\.jpg$/.test(x.image_url)||(x.expected_family!==null&&typeof x.expected_family!=='string')||(x.expected_gender!==null&&typeof x.expected_gender!=='string'))throw Error('Invalid generic image assignment');
  seen.add(x.product_id);
 }
 return m;
}
function genericFor(productId,m){
 if(!productId||!m)return null;
 const row=m.items.find(x=>x.product_id===productId);
 if(row)return row.image_url;
 // A single approved neutral fallback is rebalanced to keep illustration use
 // below the tested limit; this is not a claim about the product or its notes.
 if(productId==='SUP-AG-900002')return `${PREFIX}generic-neutral-4.jpg`;
 if(productId==='SUP-CH-900005')return `${PREFIX}generic-neutral-6.jpg`;
 // New unidentified catalog entries get a stable, neutral illustration, never
 // an invented family or gender. Existing uploaded/brand images still win.
 const digest=crypto.createHash('sha256').update(String(productId)).digest();
 return `${PREFIX}generic-neutral-${1+digest.readUInt32BE(0)%5}.jpg`;
}
function applyGenericImages(db,m,imagesDir){
 if(!m)return {updated:0,already:0,skipped:0,reason:'manifest_missing'};
 for(let i=1;i<=6;i++)for(const ext of [`.jpg`,`.webp`,`-sm.jpg`,`-sm.webp`])if(!fs.existsSync(path.join(imagesDir,`generic-neutral-${i}${ext}`)))throw Error('Missing approved generic image asset');
 return db.transaction(()=>{
  if(db.prepare('SELECT 1 FROM settings WHERE key=?').get(VERSION))return {updated:0,already:0,skipped:0,reason:'already_applied'};
  const get=db.prepare('SELECT id,slug,name_en,brand_en,family_slug,gender,image_url FROM products WHERE id=?');
  const set=db.prepare('UPDATE products SET image_url=? WHERE id=? AND image_url=?');
  let updated=0,already=0;const skipped=[];
  for(const x of m.items){const p=get.get(x.product_id);
   const ok=p&&p.slug===x.slug&&p.name_en===x.expected_name_en&&p.brand_en===x.expected_brand&&p.family_slug===x.expected_family&&p.gender===x.expected_gender;
   if(!ok){skipped.push(x.product_id);continue}
   if(p.image_url===x.image_url){already++;continue}
   if(p.image_url!==x.old_url){skipped.push(x.product_id);continue}
   updated+=set.run(x.image_url,p.id,x.old_url).changes;
  }
  const result={updated,already,skipped,at:new Date().toISOString()};db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(VERSION,JSON.stringify(result));return result;
 })();
}
const REBALANCE_KEY='generic_image_rebalance_2026_11_v1';
function applyGenericRebalance(db){return db.transaction(()=>{
 if(db.prepare('select 1 from settings where key=?').get(REBALANCE_KEY))return {reason:'already_applied'};
 const p=db.prepare('select id,slug,name_en,brand_en,family_slug,gender,image_url from products where id=?').get('SUP-AG-900002');
 const valid=p&&p.slug==='giorgio-armani-acqua-di-gio-edp'&&p.name_en==='GIORGIO ARMANI - Acqua di Giò EDP'&&p.brand_en==='Giorgio Armani'&&p.family_slug===null&&p.gender==='MEN';
 let updated=0,already=0;
 if(valid&&p.image_url===PREFIX+'generic-neutral-4.jpg')already=1;
 else if(valid&&p.image_url===PREFIX+'generic-neutral-1.jpg')updated=db.prepare('update products set image_url=? where id=? and image_url=?').run(PREFIX+'generic-neutral-4.jpg',p.id,p.image_url).changes;
 const result={updated,already,skipped:!updated&&!already};db.prepare('insert into settings(key,value) values(?,?)').run(REBALANCE_KEY,JSON.stringify(result));return result;
})();}
module.exports={VERSION,REBALANCE_KEY,loadAssignments,genericFor,applyGenericImages,applyGenericRebalance};
