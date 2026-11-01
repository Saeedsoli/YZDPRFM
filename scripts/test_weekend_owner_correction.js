'use strict';
const a=require('assert/strict'),D=require('better-sqlite3'),crypto=require('crypto'),path=require('path');
const correction=require('../src/weekend-owner-correction'),{priceFromUsdPerKg}=require('../src/essence-pricing');
const file=path.join(__dirname,'../seed/retracted_weekend_man_reference_v1.json'),m=require(file),x=m.items[0];
function setup(){
 const db=new D(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE products(id TEXT PRIMARY KEY,slug TEXT,name_en TEXT,brand_en TEXT,supply_mode TEXT,essence_usd_per_kg TEXT);CREATE TABLE supplier_price_evidence(product_id TEXT PRIMARY KEY,supplier_file_sha256 TEXT,official_url TEXT,usd_per_kg TEXT,quality TEXT,match_status TEXT);CREATE TABLE variants(sku TEXT PRIMARY KEY,product_id TEXT,type TEXT,volume_ml INTEGER,price_toman INTEGER,stock INTEGER,price_usd REAL);CREATE TABLE order_items(sku TEXT);CREATE TABLE stock_alerts(sku TEXT)');
 db.prepare('insert into settings values(?,?)').run(m.version,'{}');db.prepare('insert into settings values(?,?)').run('essence_usd_rate_toman','300000');
 db.prepare('insert into products values(?,?,?,?,?,?)').run(x.product_id,x.slug,x.expected_name_en,x.brand_en,'UNAVAILABLE',x.usd_per_kg);
 db.prepare('insert into supplier_price_evidence values(?,?,?,?,?,?)').run(x.product_id,m.supplier_file_sha256,x.official_url,x.usd_per_kg,x.quality,x.match_status);
 const add=db.prepare('insert into variants values(?,?,?,?,?,?,?)');
 for(const v of x.expected_edps)add.run(v.sku,x.product_id,'EDP',v.volume_ml,priceFromUsdPerKg(x.usd_per_kg,300000,'EDP',v.volume_ml),0,v.price_usd);
 const digest=crypto.createHash('sha256').update(x.product_id).digest('hex').slice(0,20).toUpperCase();
 for(const [type,vol,code] of [['SAMPLE',5,'SMP'],['BODY_SPLASH',120,'BS']])add.run(`ESS-${digest}-${code}-${String(vol).padStart(3,'0')}`,x.product_id,type,vol,priceFromUsdPerKg(x.usd_per_kg,300000,type,vol),0,null);
 return db;
}
for(const scenario of ['price-edit','order-reference','stock-alert','evidence-without-marker']){
 const db=setup(),sku=x.expected_edps[0].sku;
 if(scenario==='price-edit')db.prepare('update variants set price_toman=price_toman+1000 where sku=?').run(sku);
 if(scenario==='order-reference')db.prepare('insert into order_items values(?)').run(sku);
 if(scenario==='stock-alert')db.prepare('insert into stock_alerts values(?)').run(sku);
 if(scenario==='evidence-without-marker')db.prepare('delete from settings where key=?').run(m.version);
 const before=JSON.stringify(db.prepare('select * from variants order by sku').all());
 a.equal(correction.apply(db,file).ok,false,scenario);a.equal(JSON.stringify(db.prepare('select * from variants order by sku').all()),before);a.equal(db.prepare('select count(*) n from supplier_price_evidence').get().n,1);a.equal(db.prepare('select count(*) n from settings where key=?').get(correction.KEY).n,0);db.close();
}
const db=setup();a.equal(correction.apply(db,file).reason,'retracted_owner_correction');a.equal(db.prepare('select essence_usd_per_kg from products').get().essence_usd_per_kg,null);a.equal(db.prepare('select count(*) n from supplier_price_evidence').get().n,0);a.equal(db.prepare('select count(*) n from variants').get().n,4);for(const v of x.expected_edps)a.equal(db.prepare('select price_toman from variants where sku=?').get(v.sku).price_toman,v.price_toman);a.equal(correction.apply(db,file).reason,'already_applied');db.close();console.log('PASS owner correction, price/order/alert guards, marker and rollback');
