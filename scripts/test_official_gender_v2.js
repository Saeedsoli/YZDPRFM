'use strict';

process.env.APPROVED_MTO_AUTOSTART ??= '0';
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-gender-v2-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
 run(`const assert=require('assert/strict'),{db}=require('./src/db');let p=db.prepare("select gender,supply_mode from products where id='YZD-PROD-1840'").get();assert.equal(p.gender,null);assert.equal(p.supply_mode,'UNAVAILABLE');db.prepare("delete from settings where key='official_gender_2026_10_v2'").run();db.prepare("update products set gender='MEN',supply_mode='MADE_TO_ORDER' where id='YZD-PROD-1840'").run();`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db');let p=db.prepare("select gender,supply_mode from products where id='YZD-PROD-1840'").get();assert.equal(p.gender,'MEN');assert.equal(p.supply_mode,'MADE_TO_ORDER');const r=JSON.parse(db.prepare("select value from settings where key='official_gender_2026_10_v2'").get().value);assert.equal(r.updated,0);assert.equal(r.skipped,1);`);
 console.log('PASS ambiguous manufacturer gender withheld for unchanged unavailable product; active edit preserved');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
