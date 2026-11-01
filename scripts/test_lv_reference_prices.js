'use strict';
// This legacy fixture explicitly tests the pre-approval unavailable baseline.
process.env.APPROVED_MTO_AUTOSTART ??= '0';
// Verify supplier-file provenance, arithmetic, idempotency, skip guards and rollback.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),manifest=require('../seed/lv_reference_prices_v1.json');
const raw=fs.readFileSync(path.join(root,'uploads/لیست_قیمت_عمده.md'));
assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),manifest.supplier_file_sha256);
function norm(s){return s.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
const groups=new Map();let brand='';
for(const line of raw.toString('utf8').split(/\r?\n/)){
 if(line.startsWith('## '))brand=line.slice(3).trim();
 if(brand!=='LOUIS VUITTON'||!line.startsWith('|'))continue;
 const cells=line.slice(1).replace(/\|\s*$/,'').split('|').map(x=>x.trim());
 if(cells.length!==5||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cells[4]))continue;
 const price=Number(cells[4]);if(price<=0)continue;const key=norm(cells[1]);
 if(!groups.has(key)||price>groups.get(key).price)groups.set(key,{price,quality:cells[3]});
}
assert.equal(manifest.items.length,6);
for(const x of manifest.items){const source=groups.get(norm(x.reference_name));assert(source,x.reference_name);assert.equal(Number(x.usd_per_kg),source.price);assert.equal(x.quality,source.quality);assert.equal(x.match_status,'name_matched_supplier_identity_unverified');}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-lv-prices-'));const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/lv_reference_prices_v1.json'),{priceFromUsdPerKg}=require('./src/essence-pricing');
  const log=JSON.parse(db.prepare("select value from settings where key='lv_reference_prices_v1'").get().value);assert.equal(log.applied,6);assert.equal(log.skipped.length,0);
  for(const x of m.items){const p=db.prepare('select * from products where id=?').get(x.product_id);assert.equal(p.supply_mode,'UNAVAILABLE');assert.equal(p.essence_usd_per_kg,x.usd_per_kg);const v=db.prepare('select * from variants where product_id=?').all(p.id);assert.equal(v.length,6);assert(v.every(y=>y.stock===0));for(const y of v)assert.equal(y.price_toman,priceFromUsdPerKg(x.usd_per_kg,300000,y.type,y.volume_ml));assert.equal(db.prepare('select match_status from supplier_price_evidence where product_id=?').get(p.id).match_status,'name_matched_supplier_identity_unverified');}
  const a=m.items[0],b=m.items[1];db.prepare('delete from variants where product_id=?').run(a.product_id);db.prepare('delete from supplier_price_evidence where product_id=?').run(a.product_id);db.prepare('update products set essence_usd_per_kg=null where id=?').run(a.product_id);
  db.prepare("update products set supply_mode='MADE_TO_ORDER' where id=?").run(b.product_id);db.prepare("update settings set value='250000' where key='essence_usd_rate_toman'").run();db.prepare("delete from settings where key='lv_reference_prices_v1'").run();`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/lv_reference_prices_v1.json'),{priceFromUsdPerKg}=require('./src/essence-pricing');const log=JSON.parse(db.prepare("select value from settings where key='lv_reference_prices_v1'").get().value);assert.equal(log.applied,1);assert.equal(log.skipped.length,5);const a=m.items[0],b=m.items[1];assert.equal(db.prepare('select supply_mode from products where id=?').get(b.product_id).supply_mode,'MADE_TO_ORDER');const v=db.prepare("select price_toman from variants where product_id=? and type='EDP' and volume_ml=100").get(a.product_id);assert.equal(v.price_toman,priceFromUsdPerKg(a.usd_per_kg,250000,'EDP',100));db.prepare('update products set essence_usd_per_kg=? where id=?').run('999',a.product_id);`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/lv_reference_prices_v1.json');assert.equal(db.prepare('select essence_usd_per_kg from products where id=?').get(m.items[0].product_id).essence_usd_per_kg,'999');`);
 const Database=require('better-sqlite3'),{applyLvReferencePrices}=require('../src/lv-reference-prices');const db=new Database(':memory:');
 db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,slug TEXT,name_fa TEXT,brand_fa TEXT,supply_mode TEXT,essence_usd_per_kg TEXT);CREATE TABLE variants(sku TEXT PRIMARY KEY,product_id TEXT,type TEXT,type_label TEXT,volume_ml INTEGER,price_toman INTEGER,stock INTEGER,price_usd REAL);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);INSERT INTO settings VALUES('essence_usd_rate_toman','300000');`);
 const ins=db.prepare("insert into products values(?,?,?,?,?,NULL)");for(const x of manifest.items.slice(0,2))ins.run(x.product_id,x.slug,'test','brand','UNAVAILABLE');
 const digest=crypto.createHash('sha256').update(manifest.items[1].product_id).digest('hex').slice(0,20).toUpperCase();db.prepare('insert into variants values(?,?,?,?,?,?,?,?)').run('ESS-'+digest+'-SMP-005','other','SAMPLE','x',5,1,0,null);
 assert.throws(()=>applyLvReferencePrices(db,path.join(root,'seed/lv_reference_prices_v1.json')));
 assert.equal(db.prepare('select essence_usd_per_kg from products where id=?').get(manifest.items[0].product_id).essence_usd_per_kg,null);
 assert.equal(db.prepare('select count(*) n from variants where product_id=?').get(manifest.items[0].product_id).n,0);
 assert.equal(db.prepare("select count(*) n from settings where key='lv_reference_prices_v1'").get().n,0);
 console.log('PASS 6 highest-price matches and source hash; 36 formula-priced zero-stock variants; current-rate and edit guards; atomic rollback');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
