'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-original-gender-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_gender_corrections_v1.json');for(const x of m.items){const p=db.prepare('select gender,supply_mode from products where id=?').get(x.product_id);assert.equal(p.gender,x.official_gender);assert.equal(p.supply_mode,'UNAVAILABLE');}db.prepare("delete from settings where key='official_gender_2026_10_v1'").run();const a=m.items[0],b=m.items[1];db.prepare('update products set gender=? where id=?').run(a.expected_old_gender,a.product_id);db.prepare("update products set gender=?,supply_mode='MADE_TO_ORDER' where id=?").run(b.expected_old_gender,b.product_id);`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_gender_corrections_v1.json');let a=db.prepare('select gender from products where id=?').get(m.items[0].product_id),b=db.prepare('select gender,supply_mode from products where id=?').get(m.items[1].product_id);assert.equal(a.gender,m.items[0].official_gender);assert.equal(b.gender,m.items[1].expected_old_gender);assert.equal(b.supply_mode,'MADE_TO_ORDER');const r=JSON.parse(db.prepare("select value from settings where key='official_gender_2026_10_v1'").get().value);assert.equal(r.updated,1);assert.equal(r.skipped,1);`);
 console.log('PASS official original-gender mapping; unchanged unavailable data only, active product preserved');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
