'use strict';
// This legacy fixture explicitly tests the pre-approval unavailable baseline.
process.env.APPROVED_MTO_AUTOSTART ??= '0';
// Isolated cold-deploy and restart regression for documented supplier products.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-lv-'));
const env={...process.env,DB_PATH:path.join(tmp,'test.db'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
  const seed=require('../seed/supplier_verified_supplement.json').filter(x=>x.inspired_brand_en==='Louis Vuitton');
  assert.equal(seed.length,6);assert.equal(new Set(seed.map(x=>x.id)).size,6);assert.equal(new Set(seed.map(x=>x.slug)).size,6);
  for(const p of seed){assert(/^https:\/\/[^/]*louisvuitton\.com\//.test(p.source_url));assert(Number(p.supplier_usd_per_kg)>0);assert(p.supplier_quality);assert(p.accords.length>0);assert.deepEqual(p.notes,{top:[],middle:[],base:[]});assert.deepEqual(p.variants,[]);}
  run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/lv_reference_prices_v1.json'),{priceFromUsdPerKg}=require('./src/essence-pricing');const r=db.prepare("select * from products where id like 'SUP-LV-%'").all();assert.equal(r.length,6);for(const p of r){const x=m.items.find(x=>x.product_id===p.id);assert.equal(p.supply_mode,'UNAVAILABLE');assert.equal(p.brand_en,'Louis Vuitton');assert.equal(p.essence_usd_per_kg,x.usd_per_kg);const vs=db.prepare('select * from variants where product_id=?').all(p.id);assert.equal(vs.length,6);assert(vs.every(v=>v.stock===0));const v=vs.find(v=>v.type==='EDP'&&v.volume_ml===100);assert.equal(v.price_toman,priceFromUsdPerKg(x.usd_per_kg,300000,'EDP',100));assert.equal(db.prepare('select match_status from supplier_price_evidence where product_id=?').get(p.id).match_status,'name_matched_supplier_identity_unverified');assert(JSON.parse(p.accords).length>0);assert.deepEqual(JSON.parse(p.notes_top),[]);}db.prepare("update products set name_fa='ویرایش مدیر' where id='SUP-LV-900001'").run();`);
  run(`const assert=require('assert/strict'),{db}=require('./src/db');assert.equal(db.prepare("select count(*) n from products where id like 'SUP-LV-%'").get().n,6);assert.equal(db.prepare("select name_fa from products where id='SUP-LV-900001'").get().name_fa,'ویرایش مدیر');`);
  console.log('PASS six sourced products and reference prices, unverified matches and unavailable status, idempotent restart and preserved edits');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
