'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-gender-migration-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
  run(`const {db}=require('./src/db');db.prepare("delete from settings where key='supplement_gender_official_v1'").run();db.prepare("update products set gender='MEN' where id='SUP-LV-900002'").run();db.prepare("update products set gender='UNISEX' where id='SUP-LV-900001'").run();db.prepare("update products set gender='WOMEN' where id='SUP-LV-900005'").run();db.prepare("update products set gender='MEN',supply_mode='MADE_TO_ORDER' where id='SUP-LV-900006'").run();`);
  run(`const assert=require('assert/strict'),{db}=require('./src/db');const p=id=>db.prepare('select gender,supply_mode from products where id=?').get(id);assert.equal(p('SUP-LV-900002').gender,'UNISEX');assert.equal(p('SUP-LV-900001').gender,null);assert.equal(p('SUP-LV-900005').gender,'WOMEN');assert.equal(p('SUP-LV-900006').gender,'MEN');assert.equal(p('SUP-LV-900006').supply_mode,'MADE_TO_ORDER');assert(db.prepare("select value from settings where key='supplement_gender_official_v1'").get());`);
  console.log('PASS one-time official gender migration, differing values and active products preserved');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
