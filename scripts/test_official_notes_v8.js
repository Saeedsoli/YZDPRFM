'use strict';
// This legacy fixture explicitly tests the pre-approval unavailable baseline.
process.env.APPROVED_MTO_AUTOSTART ??= '0';
// Manufacturer key notes with no artificial top/heart/base; preserve manual accord edits.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-official-v8-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_note_corrections_v8.json');assert.equal(m.items.length,8);
  const mark=JSON.parse(db.prepare("select value from settings where key='official_notes_2026_10_v8'").get().value);assert.equal(mark.updated,8);assert.equal(mark.skipped,0);
  for(const x of m.items){const p=db.prepare('select * from products where id=?').get(x.product_id);assert.equal(p.supply_mode,'UNAVAILABLE');for(const k of ['top','middle','base'])assert.deepEqual(JSON.parse(p['notes_'+k]),x.verified_notes[k]);if(x.verified_accords){assert.deepEqual(JSON.parse(p.accords),x.verified_accords);for(const note of x.verified_accords)assert(db.prepare("select count(*) n from product_notes where product_id=? and position='accord' and note=?").get(p.id,note).n===1);}}
  const [a,b]=m.items;for(const x of [a,b])db.prepare('update products set notes_top=?,notes_middle=?,notes_base=?,accords=? where id=?').run(JSON.stringify(x.expected_old_notes.top),JSON.stringify(x.expected_old_notes.middle),JSON.stringify(x.expected_old_notes.base),JSON.stringify(x.expected_old_accords),x.product_id);
  db.prepare('update products set accords=? where id=?').run(JSON.stringify(['ویرایش دستی مدیر']),a.product_id);db.prepare('update products set essence_usd_per_kg=? where id=?').run('999.5',b.product_id);
  db.prepare("delete from settings where key='official_notes_2026_10_v8'").run();`);
 run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_note_corrections_v8.json');const [a,b]=m.items;
  const mark=JSON.parse(db.prepare("select value from settings where key='official_notes_2026_10_v8'").get().value);assert.equal(mark.updated,1);assert.equal(mark.skipped,7);
  assert.deepEqual(JSON.parse(db.prepare('select accords from products where id=?').get(a.product_id).accords),['ویرایش دستی مدیر']);
  assert.deepEqual(JSON.parse(db.prepare('select accords from products where id=?').get(b.product_id).accords),b.verified_accords);
  assert.equal(db.prepare('select essence_usd_per_kg from products where id=?').get(b.product_id).essence_usd_per_kg,'999.5');`);
 console.log('PASS 8 official note records, unclassified single molecules, index rebuild and manual accord/price preservation');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
