'use strict';
// Isolated cold-deploy and restart regression for documented supplier products.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-lv-'));
const env={...process.env,DB_PATH:path.join(tmp,'test.db'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
  const seed=require('../seed/supplier_verified_supplement.json').filter(x=>x.inspired_brand_en==='Louis Vuitton');
  assert.equal(seed.length,6);assert.equal(new Set(seed.map(x=>x.id)).size,6);assert.equal(new Set(seed.map(x=>x.slug)).size,6);
  for(const p of seed){assert(/^https:\/\/[^/]*louisvuitton\.com\//.test(p.source_url));assert(Number(p.supplier_usd_per_kg)>0);assert(p.supplier_quality);assert(p.accords.length>0);assert.deepEqual(p.notes,{top:[],middle:[],base:[]});assert.deepEqual(p.variants,[]);}
  run(`const assert=require('assert/strict'),{db}=require('./src/db');const r=db.prepare("select * from products where id like 'SUP-LV-%'").all();assert.equal(r.length,6);for(const p of r){assert.equal(p.supply_mode,'UNAVAILABLE');assert.equal(p.brand_en,'Louis Vuitton');assert.equal(db.prepare('select count(*) n from variants where product_id=?').get(p.id).n,0);assert(JSON.parse(p.accords).length>0);assert.deepEqual(JSON.parse(p.notes_top),[]);}db.prepare("update products set name_fa='ویرایش مدیر' where id='SUP-LV-900001'").run();`);
  run(`const assert=require('assert/strict'),{db}=require('./src/db');assert.equal(db.prepare("select count(*) n from products where id like 'SUP-LV-%'").get().n,6);assert.equal(db.prepare("select name_fa from products where id='SUP-LV-900001'").get().name_fa,'ویرایش مدیر');`);
  console.log('PASS six sourced product seeds, no invented note pyramid, unavailable, idempotent restart and preserved edits');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
