'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'supplier-import-'));
const env={...process.env,DB_PATH:path.join(tmp,'test.db'),BACKUP_DISABLED:'1',REFERENCE_PRICE_V2_AUTOMIGRATE:'0'};
const code=`
const assert=require('assert/strict');
const {db}=require('./src/db');
const {importSupplierPrices,MARKER}=require('./src/import-supplier-prices');
const data=require('./seed/supplier_exact_prices_staged.json');
const id='YZD-PROD-0429';
// Simulate a deployment that still contains a historic 3ml SKU.
db.prepare('insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)').run('OLD-SAMPLE-3',id,'SAMPLE','قدیمی',3,123000,0);
const old=db.prepare('select count(*) n from variants where product_id=?').get(id).n;
const before=db.prepare("select price_toman from variants where product_id=? and type='EDP' and volume_ml=100").get(id).price_toman;
const bad=JSON.parse(JSON.stringify(data));bad.prices[1].product_id='YZD-PROD-999999';
assert.throws(()=>importSupplierPrices(db,bad));
assert.equal(db.prepare('select essence_usd_per_kg from products where id=?').get(data.prices[0].product_id).essence_usd_per_kg,null);
assert.equal(db.prepare('select value from settings where key=?').get(MARKER),undefined);
const result=importSupplierPrices(db,data);assert.deepEqual(result,{products:42,variants_created:84,edp_repriced:168,rate_toman:300000});
assert.equal(db.prepare('select essence_usd_per_kg,supply_mode from products where id=?').get(id).essence_usd_per_kg,'709.5');
assert.equal(db.prepare('select supply_mode from products where id=?').get(id).supply_mode,'UNAVAILABLE');
const v=(t,ml)=>db.prepare('select * from variants where product_id=? and type=? and volume_ml=?').get(id,t,ml);
assert.equal(v('EDP',100).price_toman,12771000);assert.notEqual(before,v('EDP',100).price_toman);
assert.equal(v('SAMPLE',5).price_toman,639000);assert.equal(v('BODY_SPLASH',120).price_toman,3193000);
assert.equal(v('SAMPLE',5).stock,0);assert.equal(v('BODY_SPLASH',120).stock,0);
assert(v('SAMPLE',3));assert(v('BODY_SPLASH',150));
assert.equal(db.prepare('select count(*) n from variants where product_id=?').get(id).n,old+2);
assert.throws(()=>importSupplierPrices(db,data));
console.log('PASS: 42 staged matches, 84 new variants, EDP prices, unavailable preserved, legacy retained, rollback and duplicate protection');`;
try {const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);console.log(r.stdout.trim());}
finally {fs.rmSync(tmp,{recursive:true,force:true});}
