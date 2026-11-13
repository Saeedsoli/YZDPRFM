'use strict';

const assert=require('assert/strict'),Database=require('better-sqlite3');
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const store=require('../src/order-idempotency');
const key='a1'.repeat(32), payload={mobile:'09120001111',items:[{sku:'SKU',quantity:1}],gift_wrap:false};
const dig=store.fingerprint(key,payload);
if(process.argv[2]==='worker'){
 const db=new Database(process.argv[3]);db.pragma('busy_timeout=5000');db.pragma('foreign_keys=ON');
 const result=db.transaction(()=>{
  const found=store.lookup(db,dig);if(found.kind!=='NEW')return found;
  const id='ORDER-'+process.pid;db.prepare("INSERT INTO orders(order_id,status,payment_ref) VALUES(?,'PENDING',NULL)").run(id);
  store.bindNew(db,{...dig,orderId:id});return {kind:'CREATED',orderId:id};
 }).immediate();console.log(JSON.stringify(result));db.close();process.exit(0);
}
function dbFile(file=':memory:'){
 const db=new Database(file);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
 db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE orders(order_id TEXT PRIMARY KEY,status TEXT NOT NULL,payment_ref TEXT)');return db;
}
function worker(file){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[__filename,'worker',file]);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',c=>c?reject(Error(err)):resolve(JSON.parse(out)));});}
(async()=>{
 assert.deepEqual(store.fingerprint(key,{gift_wrap:false,items:[{quantity:1,sku:'SKU'}],mobile:'09120001111'}),dig);
 assert.notEqual(store.fingerprint(key,{...payload,gift_wrap:true}).payloadHash,dig.payloadHash);
 for(const k of ['', 'a'.repeat(64), 'xyz', 'A1'.repeat(32), 'a1'.repeat(31)])assert.throws(()=>store.fingerprint(k,payload));
 assert.throws(()=>store.fingerprint(key,{n:NaN}));assert.throws(()=>store.fingerprint(key,[]));
 let db=dbFile();assert(!store.ready(db));assert.deepEqual(store.install(db),{created:true});assert.deepEqual(store.install(db),{created:false});assert(store.ready(db));
 assert.equal(store.lookup(db,dig).kind,'NEW');
 assert.throws(()=>store.bindNew(db,{...dig,orderId:'A'}));

 assert.throws(()=>db.transaction(()=>{db.prepare("INSERT INTO orders VALUES('A','PENDING',NULL)").run();store.bindNew(db,{...dig,orderId:'A'});throw Error('crash')})());
 assert.equal(store.lookup(db,dig).kind,'NEW');assert.equal(db.prepare('select count(*) n from orders').get().n,0);
 db.transaction(()=>{db.prepare("INSERT INTO orders VALUES('A','PENDING',NULL)").run();store.bindNew(db,{...dig,orderId:'A'});}).immediate();
 assert.deepEqual(store.lookup(db,dig),{kind:'UNCERTAIN',orderId:'A'});
 assert.equal(store.lookup(db,store.fingerprint(key,{...payload,gift_wrap:true})).kind,'CONFLICT');
 assert(!JSON.stringify(db.prepare('select * from order_idempotency').get()).includes(key));
 const response={order_id:'A',payment_url:'/payment/sandbox?order=A',subtotal:100000,discount:0,discount_code:null,shipping_fee:100000,gift_wrap_fee:0,total_payable:200000};
 assert.throws(()=>db.transaction(()=>store.markReady(db,{keyHash:dig.keyHash,orderId:'A',authority:'AUTH',response}))());

 assert.throws(()=>db.transaction(()=>{db.prepare("UPDATE orders SET payment_ref='AUTH' WHERE order_id='A'").run();store.markReady(db,{keyHash:dig.keyHash,orderId:'A',authority:'AUTH',response});throw Error('crash')})());
 assert.deepEqual(db.prepare("select status,payment_ref from orders where order_id='A'").get(),{status:'PENDING',payment_ref:null});
 assert.equal(store.lookup(db,dig).kind,'UNCERTAIN');
 db.transaction(()=>{db.prepare("UPDATE orders SET payment_ref='AUTH' WHERE order_id='A'").run();store.markReady(db,{keyHash:dig.keyHash,orderId:'A',authority:'AUTH',response});}).immediate();
 const again=store.lookup(db,dig);assert.equal(again.kind,'READY');assert.deepEqual(again.response,response);assert(!('authority' in again.response));
 db.prepare("update orders set status='PAID' where order_id='A'").run();assert.deepEqual(store.lookup(db,dig),{kind:'PAID',orderId:'A'});
 db.prepare("update orders set status='CANCELLED' where order_id='A'").run();assert.equal(store.lookup(db,dig).kind,'UNCERTAIN');
 const dig2=store.fingerprint('b2'.repeat(32),payload);db.transaction(()=>{db.prepare("INSERT INTO orders VALUES('B','PENDING',NULL)").run();store.bindNew(db,{...dig2,orderId:'B'});db.prepare("update orders set status='FAILED' where order_id='B'").run();assert.equal(store.markFailed(db,{keyHash:dig2.keyHash,orderId:'B'}),'FAILED')})();
 assert.deepEqual(store.lookup(db,dig2),{kind:'FAILED',orderId:'B'});assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
 db=dbFile();db.exec('CREATE TABLE order_idempotency(x)');assert.throws(()=>store.install(db));db.close();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'order-idempotency-'));const file=path.join(dir,'test.sqlite');
 try{db=dbFile(file);store.install(db);db.close();const results=await Promise.all(Array.from({length:8},()=>worker(file)));
  assert.equal(results.filter(r=>r.kind==='CREATED').length,1);assert.equal(results.filter(r=>r.kind==='UNCERTAIN').length,7);
  db=new Database(file);assert.equal(db.prepare('select count(*) n from orders').get().n,1);assert.equal(db.prepare('select count(*) n from order_idempotency').get().n,1);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
 console.log('PASS staged idempotency: canonical fingerprints, rollback, payment-state checks and eight-process race; mocked gateway only');
})().catch(e=>{console.error(e);process.exitCode=1});
