'use strict';
// Disposable databases only; does not open the user's shop DB.
const assert=require('assert');
const Database=require('better-sqlite3');
const fs=require('fs'), os=require('os'), path=require('path');
const {spawn}=require('child_process');
const store=require('../src/return-store');
const {WINDOW_MS}=require('../src/return-eligibility');
const delivered=Date.UTC(2026,10,3,12), now=delivered+1000;
const args={verifiedMobile:'09120001111',itemId:1,quantity:1,description:'A valid return description',usedUnder2ml:true,nowMs:now};
if(process.argv[2]==='worker'){
 const db=new Database(process.argv[3]);db.pragma('busy_timeout=5000');
 console.log(JSON.stringify(store.submit(db,args)));db.close();process.exit(0);
}
function open(file=':memory:'){
 const db=new Database(file);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
 db.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE orders(order_id TEXT PRIMARY KEY,mobile TEXT,status TEXT);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id TEXT,quantity INTEGER,product_name TEXT);
 INSERT INTO orders VALUES('A','09120001111','DELIVERED'),('B','09120002222','SHIPPED');
 INSERT INTO order_items VALUES(1,'A',2,'name'),(2,'A',1,'sample'),(3,'A',1,'old'),(4,'B',1,'other');`);
 return db;
}
function seed(db){store.install(db);db.transaction(()=>{store.captureNewItem(db,1,30);store.captureNewItem(db,2,5);store.captureNewItem(db,4,30)})();
 assert.deepStrictEqual(store.recordDelivery(db,{orderId:'A',deliveredAtMs:delivered,recordedBy:'admin',nowMs:now}),{ok:true});}
function worker(file){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[__filename,'worker',file]);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',c=>c?reject(Error(err)):resolve(JSON.parse(out)));});}
(async()=>{
 let db=open();assert(!store.ready(db));assert.deepStrictEqual(store.install(db),{created:true});assert(store.ready(db));assert.deepStrictEqual(store.install(db),{created:false});
 assert.throws(()=>store.captureNewItem(db,1,30));assert.throws(()=>db.transaction(()=>{store.captureNewItem(db,1,30);throw Error('rollback')})());
 assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM return_item_evidence').get().n,0);
 db.transaction(()=>{store.captureNewItem(db,1,30);store.captureNewItem(db,2,5);store.captureNewItem(db,4,30)})();
 assert.deepStrictEqual(store.recordDelivery(db,{orderId:'B',deliveredAtMs:delivered,recordedBy:'admin',nowMs:now}),{ok:false,reason:'NOT_DELIVERED'});
 assert.throws(()=>store.recordDelivery(db,{orderId:'A',deliveredAtMs:now+1,recordedBy:'admin',nowMs:now}));
 assert.strictEqual(store.submit(db,args).reason,'DELIVERY_TIME_UNAVAILABLE');
 assert(store.recordDelivery(db,{orderId:'A',deliveredAtMs:delivered,recordedBy:'admin',nowMs:now}).ok);
 assert.strictEqual(store.recordDelivery(db,{orderId:'A',deliveredAtMs:delivered-1,recordedBy:'admin',nowMs:now}).reason,'ALREADY_RECORDED');
 assert.strictEqual(store.submit(db,{...args,verifiedMobile:'09120002222'}).reason,'OWNER_REQUIRED');
 assert.strictEqual(store.submit(db,{...args,itemId:2}).reason,'VOLUME_INELIGIBLE');
 assert.strictEqual(store.submit(db,{...args,itemId:3}).reason,'VOLUME_UNAVAILABLE');
 assert.strictEqual(store.submit(db,{...args,itemId:4}).reason,'OWNER_REQUIRED');
 assert.strictEqual(store.submit(db,{...args,quantity:3}).reason,'INVALID_QUANTITY');
 assert.strictEqual(store.submit(db,{...args,usedUnder2ml:'true'}).reason,'INVALID_INPUT');
 assert.strictEqual(store.submit(db,{...args,nowMs:delivered+WINDOW_MS}).reason,'EXPIRED');
 const r=store.submit(db,args);assert(r.ok&&/^RET-[A-F0-9]{24}$/.test(r.requestId));
 assert.strictEqual(store.submit(db,args).reason,'REQUEST_OPEN');
 assert.strictEqual(db.prepare('SELECT used_under_2ml FROM account_return_requests WHERE request_id=?').get(r.requestId).used_under_2ml,1);
 assert.deepStrictEqual(db.prepare('SELECT order_id,mobile,status FROM orders WHERE order_id=?').get('A'),{order_id:'A',mobile:'09120001111',status:'DELIVERED'});
 assert.strictEqual(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 db.prepare('DELETE FROM order_items WHERE id=?').run(1);
 assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM return_item_evidence WHERE item_id=1').get().n,0);
 assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM account_return_requests WHERE item_id=1').get().n,0);db.close();
 db=open();db.exec('CREATE TABLE return_item_evidence(x)');assert.throws(()=>store.install(db));assert(!store.ready(db));db.close();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'returns-race-'));const file=path.join(dir,'test.sqlite');
 try{db=open(file);seed(db);db.close();const rs=await Promise.all([worker(file),worker(file)]);assert.strictEqual(rs.filter(x=>x.ok).length,1);assert.strictEqual(rs.filter(x=>x.reason==='REQUEST_OPEN').length,1);db=new Database(file);assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM account_return_requests').get().n,1);assert.strictEqual(db.pragma('integrity_check',{simple:true}),'ok');db.close();}finally{fs.rmSync(dir,{recursive:true,force:true})}
 console.log('PASS staged return store: schema conflicts, rollback, explicit evidence, ownership, time/volume/quantity guards and two-process race');
})().catch(e=>{console.error(e);process.exitCode=1});
