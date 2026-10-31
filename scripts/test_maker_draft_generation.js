'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'maker-draft-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);}
try{
 run(['-e',`const {db}=require('./src/db');let p=db.prepare('select id from products order by id limit 1').get();db.prepare('update products set maker_note=?,maker_note_by=?,maker_note_approved=1 where id=?').run('تأیید قبلی','مدیر',p.id);`]);
 run(['scripts/seed_maker_notes.js','--force','--limit','1']);
 run(['-e',`const assert=require('assert/strict'),{db}=require('./src/db');let p=db.prepare('select * from products order by id limit 1').get();assert.equal(p.maker_note_approved,0);assert(p.maker_note);assert.equal(require('./src/db').parseProduct(p).maker_note,null);`]);
 console.log('PASS generated note, including forced replacement, is never auto-approved');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
