'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process'),Database=require('better-sqlite3');
const root=path.join(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'audit-ro-')),file=path.join(dir,'db.sqlite');
try {
 let db=new Database(file);db.exec("CREATE TABLE products(id TEXT, brand_en TEXT); CREATE TABLE settings(key TEXT,value TEXT); INSERT INTO products VALUES('test','brand'); INSERT INTO settings VALUES('sentinel','untouched');");db.close();
 const before=fs.readFileSync(file),r=spawnSync(process.execPath,['scripts/audit_docs_truth.js'],{cwd:root,env:{...process.env,DB_PATH:file},encoding:'utf8',timeout:120000});
 assert.equal(r.status,0,r.stderr);assert(before.equals(fs.readFileSync(file)),'audit changed DB file');db=new Database(file,{readonly:true});assert.equal(db.prepare('select count(*) n from products').get().n,1);assert.equal(db.prepare('select value from settings where key=?').get('sentinel').value,'untouched');assert.equal(db.prepare("select count(*) n from sqlite_master where name='variants'").get().n,0);db.close();console.log('PASS: documentation truth audit reads SQLite without application initialization or mutation');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
