'use strict';

process.env.APPROVED_MTO_AUTOSTART ??= '0';
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-official-notes-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(code){const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try {
  run(`const assert=require('assert/strict'),{db}=require('./src/db');const m=require('./seed/official_note_corrections_v1.json');
    for(const r of m.items){const p=db.prepare('select * from products where id=?').get(r.product_id);assert.equal(p.supply_mode,'UNAVAILABLE');for(const k of ['top','middle','base'])assert.deepEqual(JSON.parse(p['notes_'+k]),r.verified_notes[k]);assert(db.prepare('select count(*) n from product_notes where product_id=?').get(r.product_id).n>0);}
    assert(db.prepare("select count(*) n from product_notes where product_id='SUP-LV-900001'").get().n>0);
    const green=m.items.find(x=>x.product_id==='YZD-PROD-0430');
    db.prepare("update products set notes_top=? where id='YZD-PROD-0647'").run(JSON.stringify(['یادداشت ویرایش‌شده مدیر']));
    db.prepare('update products set notes_top=?,notes_middle=?,notes_base=? where id=?').run(JSON.stringify(green.expected_old_notes.top),JSON.stringify(green.expected_old_notes.middle),JSON.stringify(green.expected_old_notes.base),green.product_id);
    db.prepare("delete from settings where key='official_notes_2026_10_v1'").run();`);
  run(`const assert=require('assert/strict'),{db}=require('./src/db');const m=require('./seed/official_note_corrections_v1.json');
    assert.deepEqual(JSON.parse(db.prepare("select notes_top from products where id='YZD-PROD-0647'").get().notes_top),['یادداشت ویرایش‌شده مدیر']);
    const green=m.items.find(x=>x.product_id==='YZD-PROD-0430');assert.deepEqual(JSON.parse(db.prepare('select notes_top from products where id=?').get(green.product_id).notes_top),green.verified_notes.top);
    const logs=JSON.parse(db.prepare("select value from settings where key='official_notes_2026_10_v1'").get().value);assert.equal(logs.updated,1);assert.equal(logs.skipped,3);
    assert(db.prepare("select count(*) n from product_notes where product_id='YZD-PROD-0647' and note='یادداشت ویرایش‌شده مدیر'").get().n===1);
    assert(db.prepare("select count(*) n from product_notes where product_id='YZD-PROD-0430' and note='نعناع فلفلی'").get().n===1);`);
  run(`const assert=require('assert/strict'),{db}=require('./src/db');assert.deepEqual(JSON.parse(db.prepare("select notes_top from products where id='YZD-PROD-0647'").get().notes_top),['یادداشت ویرایش‌شده مدیر']);`);
  console.log('PASS 4 sourced note corrections, cold seed, reindex, idempotency, manual edit preservation, no availability changes');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
