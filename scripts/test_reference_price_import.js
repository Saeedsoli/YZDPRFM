'use strict';
// Provenance, highest-price choice, edit guards and transactional rollback.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),manifest=require('../seed/official_reference_prices_v1.json'),raw=fs.readFileSync(path.join(root,'uploads/لیست_قیمت_عمده.md'));
assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),manifest.supplier_file_sha256);
function norm(s){return s.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
const groups=new Map();let brand='';
for(const line of raw.toString('utf8').split(/\r?\n/)){
 if(line.startsWith('## '))brand=line.slice(3).trim();
 if(!line.startsWith('|'))continue;
 const c=line.slice(1).replace(/\|\s*$/,'').split('|').map(x=>x.trim());
 if(c.length!==5||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(c[4]))continue;
 const price=Number(c[4]);if(price<=0)continue;const key=norm(brand)+'|'+norm(c[1]);
 if(!groups.has(key)||price>groups.get(key).price)groups.set(key,{price,quality:c[3]});
}
assert.equal(manifest.items.length,4);
for(const x of manifest.items){const row=groups.get(norm(x.supplier_brand)+'|'+norm(x.supplier_model));assert(row,x.product_id);assert.equal(row.price,Number(x.usd_per_kg));assert.equal(row.quality,x.quality);assert.equal(x.match_status,'name_matched_supplier_identity_unverified');}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-ref-prices-'));const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_reference_prices_v1.json'),{priceFromUsdPerKg}=require('./src/essence-pricing');
 const log=JSON.parse(db.prepare("select value from settings where key='official_reference_prices_2026_10_v1'").get().value);assert.equal(log.applied,4);assert.equal(log.skipped.length,0);
 for(const x of m.items){const p=db.prepare('select * from products where id=?').get(x.product_id);assert.equal(p.supply_mode,'UNAVAILABLE');assert.equal(p.essence_usd_per_kg,x.usd_per_kg);const v=db.prepare('select * from variants where product_id=?').all(p.id).filter(y=>y.type==='EDP'||(y.type==='SAMPLE'&&y.volume_ml===5)||(y.type==='BODY_SPLASH'&&y.volume_ml===120));assert.equal(v.length,6);for(const y of v){assert.equal(y.stock,0);assert.equal(y.price_toman,priceFromUsdPerKg(x.usd_per_kg,300000,y.type,y.volume_ml));}assert.equal(db.prepare('select match_status from supplier_price_evidence where product_id=?').get(p.id).match_status,'name_matched_supplier_identity_unverified');}
 const a=m.items[0],b=m.items[1],c=m.items[2];db.prepare("delete from variants where product_id=? and ((type='SAMPLE' and volume_ml=5) or (type='BODY_SPLASH' and volume_ml=120))").run(a.product_id);
 for(const v of a.expected_edps)db.prepare('update variants set price_toman=?,stock=?,price_usd=? where sku=?').run(v.price_toman,v.stock,v.price_usd,v.sku);
 db.prepare('delete from supplier_price_evidence where product_id=?').run(a.product_id);db.prepare('update products set essence_usd_per_kg=null where id=?').run(a.product_id);
 db.prepare("update products set supply_mode='MADE_TO_ORDER' where id=?").run(b.product_id);db.prepare('update variants set price_toman=777777 where sku=?').run(c.expected_edps[0].sku);
 db.prepare("update settings set value='250000' where key='essence_usd_rate_toman'").run();db.prepare("delete from settings where key='official_reference_prices_2026_10_v1'").run();`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_reference_prices_v1.json'),{priceFromUsdPerKg}=require('./src/essence-pricing');const log=JSON.parse(db.prepare("select value from settings where key='official_reference_prices_2026_10_v1'").get().value);assert.equal(log.applied,1);assert.equal(log.skipped.length,3);const a=m.items[0],b=m.items[1],c=m.items[2];assert.equal(db.prepare('select supply_mode from products where id=?').get(b.product_id).supply_mode,'MADE_TO_ORDER');assert.equal(db.prepare('select price_toman from variants where sku=?').get(c.expected_edps[0].sku).price_toman,777777);assert.equal(db.prepare("select price_toman from variants where product_id=? and type='EDP' and volume_ml=100").get(a.product_id).price_toman,priceFromUsdPerKg(a.usd_per_kg,250000,'EDP',100));db.prepare('update products set essence_usd_per_kg=? where id=?').run('999',a.product_id);`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_reference_prices_v1.json');assert.equal(db.prepare('select essence_usd_per_kg from products where id=?').get(m.items[0].product_id).essence_usd_per_kg,'999');`);
 const Database=require('better-sqlite3'),{applyReferencePrices}=require('../src/reference-price-import'),db=new Database(':memory:');
 db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,slug TEXT,name_fa TEXT,brand_fa TEXT,supply_mode TEXT,essence_usd_per_kg TEXT);CREATE TABLE variants(sku TEXT PRIMARY KEY,product_id TEXT,type TEXT,type_label TEXT,volume_ml INTEGER,price_toman INTEGER,stock INTEGER,price_usd REAL);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);INSERT INTO settings VALUES('essence_usd_rate_toman','300000');`);
 const x=manifest.items[0];db.prepare('insert into products values(?,?,?,?,?,NULL)').run(x.product_id,x.slug,'test','brand','UNAVAILABLE');const ins=db.prepare('insert into variants values(?,?,?,?,?,?,?,?)');for(const v of x.expected_edps)ins.run(v.sku,x.product_id,'EDP','x',v.volume_ml,v.price_toman,v.stock,v.price_usd);
 const digest=crypto.createHash('sha256').update(x.product_id).digest('hex').slice(0,20).toUpperCase();ins.run('ESS-'+digest+'-SMP-005','other','SAMPLE','x',5,1,0,null);
 assert.throws(()=>applyReferencePrices(db,path.join(root,'seed/official_reference_prices_v1.json')));
 assert.equal(db.prepare('select essence_usd_per_kg from products where id=?').get(x.product_id).essence_usd_per_kg,null);
 assert.equal(db.prepare('select price_toman from variants where sku=?').get(x.expected_edps[0].sku).price_toman,x.expected_edps[0].price_toman);
 assert.equal(db.prepare("select count(*) n from settings where key='official_reference_prices_2026_10_v1'").get().n,0);
 console.log('PASS 4 source-hashed price matches, formula, unchanged status, skip guards, idempotency and atomic rollback');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
