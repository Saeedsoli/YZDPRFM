'use strict';

const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const Database=require('better-sqlite3'),{handle}=require('../src/routes/admin-system');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-backup-test-'));
const dbPath=path.join(dir,'live.sqlite');
const db=new Database(dbPath);db.pragma('journal_mode = WAL');
db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY,customer TEXT); INSERT INTO orders VALUES(1,'private'); CREATE TABLE payload(v BLOB); INSERT INTO payload VALUES(zeroblob(4000000));");
let failVacuum=false;
const dbProxy={prepare(sql){if(failVacuum && sql==='VACUUM INTO ?')return {run(){throw new Error('sensitive path');}};return db.prepare(sql);}};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const can=()=>{if(req.headers.authorization!=='Bearer fixture'){res.writeHead(401);res.end();return false;}return true;};
 const sendJSON=(code,data)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 handle({method:req.method,pathname:url.pathname,parsed:{query:{}},req,res,can,db:dbProxy,DB_PATH:dbPath,sendJSON,appLog:()=>{}}).catch(()=>res.destroy());
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 try {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/admin/backup')).status,401);
  const headers={Authorization:'Bearer fixture'};

  const results=await Promise.all(Array.from({length:6},()=>fetch(base+'/api/admin/backup',{headers})));
  for(let i=0;i<results.length;i++){
   const r=results[i];assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
   const buf=Buffer.from(await r.arrayBuffer());assert.equal(buf.length,Number(r.headers.get('content-length')));
   const p=path.join(dir,`restore-${i}.sqlite`);fs.writeFileSync(p,buf);
   const restored=new Database(p,{readonly:true});assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');
   assert.equal(restored.prepare('select customer from orders where id=1').get().customer,'private');restored.close();
  }

  await new Promise((resolve,reject)=>{const request=http.get(base+'/api/admin/backup',{headers},res=>{res.once('data',()=>{res.destroy();resolve();});res.once('error',()=>{});});request.on('error',reject);});
  for(let i=0;i<50 && fs.readdirSync(dir).some(x=>x.startsWith('.manual-backup-'));i++)await pause(20);
  assert(!fs.readdirSync(dir).some(x=>x.startsWith('.manual-backup-')),'temporary backup remains');
  failVacuum=true;const failed=await fetch(base+'/api/admin/backup',{headers});assert.equal(failed.status,500);
  assert(!(await failed.text()).includes('sensitive path'));failVacuum=false;
  assert(!fs.readdirSync(dir).some(x=>x.startsWith('.manual-backup-')),'failed snapshot remains');

  const originalRead=fs.createReadStream;
  fs.createReadStream=function(file,...args){
   if(String(file).includes('.manual-backup-')){
    const {Readable}=require('stream');const s=new Readable({read(){this.destroy(new Error('disk read failure'));}});return s;
   }
   return originalRead.call(this,file,...args);
  };
  try { await fetch(base+'/api/admin/backup',{headers}).then(r=>r.arrayBuffer()).catch(()=>{}); }
  finally { fs.createReadStream=originalRead; }
  for(let i=0;i<50 && fs.readdirSync(dir).some(x=>x.startsWith('.manual-backup-'));i++)await pause(20);
  assert(!fs.readdirSync(dir).some(x=>x.startsWith('.manual-backup-')),'read-error snapshot remains');
  assert.equal((await fetch(base+'/api/admin/backup')).status,401);
  fs.mkdirSync(path.join(dir,'backups'));const saved=path.join(dir,'backups','yazd-2026110100.db');
  fs.copyFileSync(path.join(dir,'restore-0.sqlite'),saved);
  const historic=await fetch(base+'/api/admin/backups/yazd-2026110100.db',{headers});assert.equal(historic.status,200);
  assert.equal(historic.headers.get('cache-control'),'no-store');const historicalBytes=Buffer.from(await historic.arrayBuffer());assert(historicalBytes.length>0);
  assert.equal((await fetch(base+'/api/admin/backups/%2e%2e%2fx',{headers})).status,400);

  const backups=path.join(dir,'backups');
  fs.symlinkSync(dbPath,path.join(backups,'yazd-2026110101.db'));
  fs.linkSync(dbPath,path.join(backups,'yazd-2026110102.db'));
  fs.writeFileSync(path.join(backups,'yazd-2026110103.db'),'not sqlite');
  fs.writeFileSync(saved+'-wal','external sidecar');
  for(const name of ['yazd-2026110100.db','yazd-2026110101.db','yazd-2026110102.db','yazd-2026110103.db'])
    assert.equal((await fetch(base+'/api/admin/backups/'+name,{headers})).status,409,name);
  const fifo=path.join(backups,'yazd-2026110104.db');
  const made=require('child_process').spawnSync('mkfifo',[fifo]);assert.equal(made.status,0);
  assert.equal((await fetch(base+'/api/admin/backups/yazd-2026110104.db',{headers})).status,409);
  fs.unlinkSync(saved+'-wal');
  const listing=await (await fetch(base+'/api/admin/backups',{headers})).json();assert.deepEqual(listing.backups.map(x=>x.name),['yazd-2026110100.db']);

  const originalCreate=fs.createReadStream,relocated=saved+'.relocated';
  fs.createReadStream=function(file,...args){
   if(file===saved){fs.renameSync(saved,relocated);fs.symlinkSync(dbPath,saved);}
   return originalCreate.call(this,file,...args);
  };
  try {
   const race=await fetch(base+'/api/admin/backups/yazd-2026110100.db',{headers});assert.equal(race.status,200);
   assert.deepEqual(Buffer.from(await race.arrayBuffer()),historicalBytes);
  } finally {fs.createReadStream=originalCreate;fs.unlinkSync(saved);fs.renameSync(relocated,saved);}
  console.log('PASS backup permissions, SQLite restores, cleanup, safe path/descriptor handling and no-store');
 } finally {await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
