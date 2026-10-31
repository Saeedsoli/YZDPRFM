'use strict';
// Original-product identity is separate from supplier-essence and stock verification.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),manifest=require('../seed/official_identity_evidence_v1.json'),prices=require('../seed/supplier_exact_prices_staged.json').prices;
assert.equal(manifest.items.length,37);assert.equal(manifest.unresolved.length,5);
const ids=[...manifest.items,...manifest.unresolved].map(x=>x.product_id);assert.equal(new Set(ids).size,42);assert.deepEqual(new Set(ids),new Set(prices.map(x=>x.product_id)));
assert(manifest.items.every(x=>x.status==='official_original_found_supplier_essence_unverified'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-identity-'));const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_identity_evidence_v1.json');
  assert.equal(db.prepare('select count(*) n from official_identity_evidence').get().n,37);
  assert.equal(db.prepare("select count(*) n from official_identity_evidence where status!='official_original_found_supplier_essence_unverified'").get().n,0);
  assert.equal(db.prepare("select count(*) n from products where supply_mode!='UNAVAILABLE'").get().n,0);
  const first=m.items[0],second=m.items[1];db.prepare('delete from official_identity_evidence where product_id=?').run(first.product_id);
  db.prepare('update products set name_en=? where id=?').run('Manual modified name',first.product_id);
  db.prepare('update official_identity_evidence set official_url=? where product_id=?').run('https://example.com/owner-choice',second.product_id);`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_identity_evidence_v1.json');const first=m.items[0],second=m.items[1];
  assert.equal(db.prepare('select count(*) n from official_identity_evidence').get().n,36);
  assert.equal(db.prepare('select name_en from products where id=?').get(first.product_id).name_en,'Manual modified name');
  assert.equal(db.prepare('select official_url from official_identity_evidence where product_id=?').get(second.product_id).official_url,'https://example.com/owner-choice');
  db.prepare('update products set name_en=? where id=?').run(first.expected_name_en,first.product_id);`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db');assert.equal(db.prepare('select count(*) n from official_identity_evidence').get().n,37);`);
 const bad=JSON.parse(JSON.stringify(manifest));bad.items[0].official_url='https://www.creedfragrance.com.attacker.invalid/x';const file=path.join(tmp,'bad.json');fs.writeFileSync(file,JSON.stringify(bad));
 const Database=require('better-sqlite3'),{seedOfficialIdentities}=require('../src/official-identities');const mem=new Database(':memory:');mem.exec('CREATE TABLE products(id TEXT PRIMARY KEY,slug TEXT,brand_en TEXT,name_en TEXT)');
 assert.throws(()=>seedOfficialIdentities(mem,file),/Invalid identity evidence record/);
 assert.equal(mem.prepare("select count(*) n from sqlite_master where name='official_identity_evidence'").get().n,0);
 console.log('PASS 37 official-reference sources, 5 unresolved, supplier-unverified status, exact-match guards and no overwrite');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
