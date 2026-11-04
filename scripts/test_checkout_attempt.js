'use strict';
const assert=require('assert/strict'),Database=require('better-sqlite3');
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const attempts=require('../src/checkout-attempt'),idem=require('../src/order-idempotency');
const body={mobile:'09120001111',items:[{sku:'SKU',quantity:1}]};
if(process.argv[2]==='worker'){
 const mode=process.argv[3],file=process.argv[4],token=process.argv[5];
 const db=new Database(file);db.pragma('busy_timeout=5000');db.pragma('foreign_keys=ON');let result;
 if(mode==='rotate') {const x=attempts.rotate(db,token);result={ok:x.ok,reason:x.reason};}
 else result=db.transaction(()=>{
  try{attempts.assertActiveInTransaction(db,token)}catch{return {kind:'REVOKED'}}
  const dig=idem.fingerprint(token,body);if(idem.lookup(db,dig).kind!=='NEW')return {kind:'EXISTS'};
  db.prepare("INSERT INTO orders(order_id,status,payment_ref) VALUES('RACE-ORDER','PENDING',NULL)").run();
  idem.bindNew(db,{...dig,orderId:'RACE-ORDER'});return {kind:'CREATED'};
 }).immediate();
 console.log(JSON.stringify(result));db.close();process.exit(0);
}
function fixture(file=':memory:'){
 const db=new Database(file);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
 db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE orders(order_id TEXT PRIMARY KEY,status TEXT,payment_ref TEXT)');return db;
}
function run(file,mode,token){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[__filename,'worker',mode,file,token]);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',c=>c?reject(Error(err)):resolve(JSON.parse(out)));});}
(async()=>{
 let db=fixture();assert.throws(()=>attempts.install(db));idem.install(db);assert.deepEqual(attempts.install(db),{created:true});assert(attempts.ready(db));assert.deepEqual(attempts.install(db),{created:false});
 const token=attempts.issue(db);assert.match(token,/^[0-9a-f]{64}$/);assert(attempts.active(db,token));
 const raw=db.prepare('select * from checkout_attempt_tokens').get();assert(!JSON.stringify(raw).includes(token));assert.equal(raw.token_hash,attempts.digest(token));
 const prod=attempts.setCookie(token,{production:true}),dev=attempts.setCookie(token);
 assert(prod.includes('HttpOnly')&&prod.includes('SameSite=Lax')&&prod.includes('Secure')&&prod.includes('Path=/api/orders')&&prod.includes('Max-Age=2592000'));
 assert(!dev.includes('Secure'));assert.deepEqual(attempts.readCookie('other=1; '+attempts.COOKIE+'='+token),{kind:'VALID',token});
 for(const x of [attempts.COOKIE+'=nope',attempts.COOKIE+'='+token+'; '+attempts.COOKIE+'='+token,attempts.COOKIE+'='+token+'bad'])assert.equal(attempts.readCookie(x).kind,'INVALID');
 assert.equal(attempts.readCookie('other=1').kind,'ABSENT');assert.throws(()=>attempts.assertActiveInTransaction(db,token));
 const fp=idem.fingerprint(token,body);assert.equal(db.transaction(()=>attempts.assertActiveInTransaction(db,token))(),fp.keyHash);
 db.transaction(()=>{db.prepare("INSERT INTO orders VALUES('PENDING','PENDING',NULL)").run();attempts.assertActiveInTransaction(db,token);idem.bindNew(db,{...fp,orderId:'PENDING'});}).immediate();
 for(const status of ['PENDING','VERIFYING','FAILED','CANCELLED','EXPIRED','RETURNED']){
  db.prepare("update orders set status=? where order_id='PENDING'").run(status);
  assert.deepEqual(attempts.rotate(db,token),{ok:false,reason:'ORDER_UNRESOLVED'});assert(attempts.active(db,token));
 }
 db.prepare("update orders set status='PAID' where order_id='PENDING'").run();const rotated=attempts.rotate(db,token);assert(rotated.ok&&!attempts.active(db,token)&&attempts.active(db,rotated.token));
 assert.deepEqual(attempts.rotate(db,token),{ok:false,reason:'INACTIVE'});
 // If allocating a replacement fails, revocation must roll back too.
 const unused=attempts.issue(db);db.exec("CREATE TRIGGER fail_token BEFORE INSERT ON checkout_attempt_tokens BEGIN SELECT RAISE(ABORT,'fixture'); END");
 assert.throws(()=>attempts.rotate(db,unused));assert(attempts.active(db,unused));db.exec('DROP TRIGGER fail_token');
 assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
 db=fixture();idem.install(db);db.exec('CREATE TABLE checkout_attempt_tokens(x)');assert.throws(()=>attempts.install(db));assert(!attempts.ready(db));db.close();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attempt-race-'));
 try{
  for(let i=0;i<4;i++){
   const file=path.join(dir,'test'+i+'.sqlite');db=fixture(file);idem.install(db);attempts.install(db);const original=attempts.issue(db);db.close();
   const [claim,rotation]=await Promise.all([run(file,'claim',original),run(file,'rotate',original)]);
   assert((claim.kind==='CREATED' && !rotation.ok && rotation.reason==='ORDER_UNRESOLVED') ||
          (claim.kind==='REVOKED' && rotation.ok),JSON.stringify({claim,rotation}));
   db=new Database(file);assert.equal(db.prepare('select count(*) n from orders').get().n,claim.kind==='CREATED'?1:0);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
 console.log('PASS staged HttpOnly attempt capability, fail-closed rotation and cross-process claim/rotation races');
})().catch(e=>{console.error(e);process.exitCode=1});
