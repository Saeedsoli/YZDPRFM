'use strict';

process.env.APPROVED_MTO_AUTOSTART ??= '0';
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-official-v3-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
  run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_note_corrections_v3.json');assert.equal(m.items.length,5);
    for(const x of m.items){const p=db.prepare('select * from products where id=?').get(x.product_id);assert.equal(p.supply_mode,'UNAVAILABLE');for(const k of ['top','middle','base'])assert.deepEqual(JSON.parse(p['notes_'+k]),x.verified_notes[k]);assert(db.prepare('select count(*) n from product_notes where product_id=?').get(p.id).n>0);}
    const first=m.items[0];db.prepare('update products set essence_usd_per_kg=? where id=?').run('987.65',first.product_id);db.prepare('update products set notes_top=?,notes_middle=?,notes_base=? where id=?').run(JSON.stringify(first.expected_old_notes.top),JSON.stringify(first.expected_old_notes.middle),JSON.stringify(first.expected_old_notes.base),first.product_id);
    db.prepare('update products set notes_top=? where id=?').run(JSON.stringify(['دست‌نوشته مدیر']),m.items[1].product_id);db.prepare("delete from settings where key='official_notes_2026_10_v3'").run();`);
  run(`const assert=require('assert/strict'),{db}=require('./src/db'),m=require('./seed/official_note_corrections_v3.json');
    assert.equal(db.prepare('select essence_usd_per_kg from products where id=?').get(m.items[0].product_id).essence_usd_per_kg,'987.65');
    const logs=JSON.parse(db.prepare("select value from settings where key='official_notes_2026_10_v3'").get().value);assert.equal(logs.updated,1);assert.equal(logs.skipped,4);
    assert.deepEqual(JSON.parse(db.prepare('select notes_top from products where id=?').get(m.items[1].product_id).notes_top),['دست‌نوشته مدیر']);
    assert(db.prepare("select count(*) n from product_notes where product_id=? and note='دست‌نوشته مدیر'").get(m.items[1].product_id).n===1);
    assert.deepEqual(JSON.parse(db.prepare('select notes_top from products where id=?').get(m.items[0].product_id).notes_top),m.items[0].verified_notes.top);`);
  console.log('PASS five official note actions, note reindex, versioned migration and preservation of manual edits');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
