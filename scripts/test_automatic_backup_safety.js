#!/usr/bin/env node
'use strict';

const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawn,spawnSync}=require('child_process');
const Database=require('better-sqlite3');
const {createAutomaticBackup,positiveInt}=require('../src/automatic-backup');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'auto-backup-safe-'));
const live=path.join(tmp,'live.db'),dir=path.join(tmp,'backups');
const d=new Database(live);d.pragma('journal_mode=WAL');
for(const name of ['products','variants','orders','order_items','coupons','reviews','articles','settings'])d.exec(`CREATE TABLE ${name}(id INTEGER PRIMARY KEY,value TEXT)`);
d.prepare('INSERT INTO orders(value) VALUES (?)').run('historical-order');
const create=(hour,keep=7,db=d)=>createAutomaticBackup({db,dbPath:live,dir,keep,now:new Date(`2026-11-02T${hour}:00:00.000Z`)});
const names=()=>fs.readdirSync(dir).sort();
(async()=>{
 try{
  assert.equal(positiveInt(-1,7),7);assert.equal(positiveInt('no',7),7);assert.equal(positiveInt('4',7),4);assert.equal(positiveInt('597',24,596),24);
  const first=create('10');assert(first.created);assert.equal(fs.statSync(first.file).mode&0o777,0o600);
  const restored=new Database(first.file,{readonly:true,fileMustExist:true});assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');assert.equal(restored.prepare('select value from orders').get().value,'historical-order');restored.close();
  assert.equal(create('10').reason,'already_exists');

  const corrupt=path.join(dir,'yazd-2026110211.db');fs.writeFileSync(corrupt,'not sqlite');const before=names();
  assert.throws(()=>create('11',1));assert.deepEqual(names(),before);assert.equal(fs.readFileSync(corrupt,'utf8'),'not sqlite');

  const badDb={prepare:()=>({run:f=>fs.writeFileSync(f,'truncated')})};
  assert.throws(()=>create('12',1,badDb));assert.deepEqual(names(),before);assert(!fs.existsSync(path.join(dir,'yazd-2026110212.db')));

  fs.writeFileSync(path.join(dir,'yazd-special.db'),'keep');
  fs.symlinkSync(first.file,path.join(dir,'yazd-2026110201.db'));
  fs.linkSync(first.file,path.join(dir,'yazd-2026110202.db'));
  const side=path.join(dir,'yazd-2026110203.db');fs.copyFileSync(first.file,side);fs.writeFileSync(side+'-wal','keep');
  const last=create('13',1);assert(last.created);
  for(const name of ['yazd-special.db','yazd-2026110201.db','yazd-2026110202.db','yazd-2026110203.db','yazd-2026110203.db-wal','yazd-2026110211.db'])assert(fs.lstatSync(path.join(dir,name)));

  fs.unlinkSync(path.join(dir,'yazd-2026110202.db'));
  const next=create('14',1);assert(next.created);assert(!fs.existsSync(first.file));assert(!fs.existsSync(last.file));assert(fs.existsSync(corrupt));

  const source=`const D=require('better-sqlite3'),a=require('./src/automatic-backup'),d=new D(process.env.LIVE,{readonly:true,fileMustExist:true});try{console.log(JSON.stringify(a.createAutomaticBackup({db:d,dbPath:process.env.LIVE,dir:process.env.DIR,keep:7,now:new Date('2026-11-02T15:00:00Z')})))}finally{d.close()}`;
  const children=Array.from({length:6},()=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,['-e',source],{cwd:root,env:{...process.env,LIVE:live,DIR:dir}});let out='',err='';c.stdout.on('data',v=>out+=v);c.stderr.on('data',v=>err+=v);c.on('error',reject);c.on('close',code=>code?reject(Error(err)):resolve(JSON.parse(out)))}));
  const results=await Promise.all(children);assert.equal(results.filter(x=>x.created).length,1);assert.equal(results.filter(x=>!x.created).length,5);
  assert(!names().some(x=>x.startsWith('.auto-backup-')));
  const snap=new Database(path.join(dir,'yazd-2026110215.db'),{readonly:true});assert.equal(snap.pragma('integrity_check',{simple:true}),'ok');assert.equal(snap.prepare('select value from orders').get().value,'historical-order');snap.close();
  assert.equal(d.prepare('select value from orders').get().value,'historical-order');

  const appdb=path.join(tmp,'app','shop.db');fs.mkdirSync(path.dirname(appdb));
  const appCode=`const x=require('./src/db');x.db.prepare("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values('BACKUP-ORDER','2026-01-01','Fixture','09120001234',1000,0,1000,'PAID')").run();console.log('BACKUP '+x.runBackup());x.db.close()`;
  const app=spawnSync(process.execPath,['-e',appCode],{cwd:root,env:{...process.env,DB_PATH:appdb,BACKUP_DISABLED:'1',NODE_ENV:'test'},encoding:'utf8',timeout:120000});
  assert.equal(app.status,0,app.stderr);const line=app.stdout.split('\n').find(v=>v.startsWith('BACKUP '));assert(line&&!line.endsWith('null'),app.stdout);
  const appBackup=line.slice(7);assert.equal(fs.statSync(appBackup).mode&0o777,0o600);
  const verified=new Database(appBackup,{readonly:true,fileMustExist:true});assert.equal(verified.pragma('integrity_check',{simple:true}),'ok');assert.equal(verified.prepare("select count(*) n from orders where order_id='BACKUP-ORDER'").get().n,1);verified.close();
  console.log('PASS verified atomic backups, restore, corruption/partial failure, safe retention and six-process collision');
 }finally{d.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
