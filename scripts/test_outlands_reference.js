'use strict';
// This legacy fixture explicitly tests the pre-approval unavailable baseline.
process.env.APPROVED_MTO_AUTOSTART ??= '0';
// Isolated seed/import, supplier-price provenance, owner edits and idempotency.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),price=require('../seed/official_reference_prices_v6.json'),identity=require('../seed/official_identity_evidence_v5.json');
const raw=fs.readFileSync(path.join(root,'uploads/لیست_قیمت_عمده.md'));
assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),price.supplier_file_sha256);
let brand='',values=[];for(const line of raw.toString('utf8').split(/\r?\n/)){if(line.startsWith('## '))brand=line.slice(3).trim();if(brand!=='AMUAGE'||!line.startsWith('|'))continue;const c=line.slice(1).replace(/\|\s*$/,'').split('|').map(s=>s.trim());if(c.length===5&&c[1]==='OUTLADNS'&&/^\d+(?:\.\d+)?$/.test(c[4])&&Number(c[4])>0)values.push({v:Number(c[4]),quality:c[3]});}
values.sort((a,b)=>b.v-a.v);assert.equal(values[0].v,408.1);assert.equal(values[0].quality,'H');assert.equal(Number(price.items[0].usd_per_kg),values[0].v);assert.equal(identity.items[0].official_url,price.items[0].official_url);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-outlands-'));
const env={...process.env,DB_PATH:path.join(dir,'test.db'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw Error(r.stderr+'\n'+r.stdout);}
try{
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),{priceFromUsdPerKg}=require('./src/essence-pricing'); const id='SUP-AM-900008',p=db.prepare('select * from products where id=?').get(id);assert.equal(p.name_en,'AMOUAGE - Outlands');assert.equal(p.gender,null);assert.equal(p.supply_mode,'UNAVAILABLE');assert.equal(p.essence_usd_per_kg,'408.1');assert(JSON.parse(p.notes_top).includes('هل'));assert(p.transparency_notice.includes('بازآفرینی دست‌ساز'));let v=db.prepare('select * from variants where product_id=?').all(id);assert.equal(v.length,6);for(const x of v){assert.equal(x.stock,0);assert.equal(x.price_toman,priceFromUsdPerKg('408.1',300000,x.type,x.volume_ml));}assert.equal(db.prepare('select status from official_identity_evidence where product_id=?').get(id).status,'official_original_found_supplier_essence_unverified');assert.equal(db.prepare('select match_status from supplier_price_evidence where product_id=?').get(id).match_status,'name_matched_supplier_identity_unverified');db.prepare('update products set name_fa=?,essence_usd_per_kg=? where id=?').run('ویرایش مدیر','999',id);`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db');let p=db.prepare('select * from products where id=?').get('SUP-AM-900008');assert.equal(p.name_fa,'ویرایش مدیر');assert.equal(p.essence_usd_per_kg,'999');assert.equal(db.prepare('select count(*) n from products where slug=?').get('amouage-outlands').n,1);assert.equal(db.prepare('select count(*) n from variants where product_id=?').get(p.id).n,6);`);
 console.log('PASS: Outlands supplier source, seed, price, six zero-stock variants, unavailable, identity caveat and edit preservation');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
