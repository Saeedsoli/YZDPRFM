'use strict';
const assert=require('assert/strict'),Database=require('better-sqlite3');
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const idem=require('../src/order-idempotency'),attempts=require('../src/checkout-attempt'),returns=require('../src/return-store'),recon=require('../src/order-reconciliation');
const now=Date.UTC(2026,10,4),old=now-60000,newTime=now-120000;
if(process.argv[2]==='worker'){
 const db=new Database(process.argv[3]);db.pragma('busy_timeout=5000');db.pragma('foreign_keys=ON');
 const r=recon.correctDelivery(db,{orderId:'D',expectedOldMs:old,newDeliveredAtMs:newTime,evidenceNote:'verified carrier evidence',correctedBy:'owner',nowMs:now});
 console.log(JSON.stringify(r));db.close();process.exit(0);
}
function fixture(file=':memory:'){
 const db=new Database(file);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');db.exec(`
 CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE orders(order_id TEXT PRIMARY KEY,mobile TEXT,status TEXT,payment_ref TEXT,created_at TEXT);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id TEXT,quantity INTEGER,product_name TEXT);
 CREATE TABLE order_status_log(id INTEGER PRIMARY KEY,order_id TEXT,status TEXT,note TEXT);
 CREATE TABLE audit_log(id INTEGER PRIMARY KEY,username TEXT,role_key TEXT,action TEXT,method TEXT,path TEXT,target TEXT,detail TEXT,allowed INTEGER);
 INSERT INTO orders VALUES('P','09120001111','PENDING',NULL,'2026-01-01T00:00:00.000Z'),('D','09120001111','DELIVERED',NULL,'2026-01-01T00:00:00.000Z');
 INSERT INTO order_items VALUES(1,'D',1,'item');`);
 idem.install(db);attempts.install(db);returns.install(db);recon.install(db);
 db.prepare("insert into return_delivery_evidence values('D',?,?,?)").run(old,now,'owner');
 db.prepare('insert into return_item_evidence values(1,30)').run();
 db.prepare("insert into account_return_requests values('R',1,'09120001111',1,'valid description',1,?,'NEW_PENDING')").run(now);
 return db;
}
function run(file){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[__filename,'worker',file]);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',c=>c?reject(Error(err)):resolve(JSON.parse(out)));});}
(async()=>{
 let db=fixture();assert(recon.ready(db));assert.deepEqual(recon.install(db),{created:false});
 const token=attempts.issue(db),d=idem.fingerprint(token,{mobile:'09120001111',items:[{sku:'x',quantity:1}]});
 db.transaction(()=>{attempts.assertActiveInTransaction(db,token);idem.bindNew(db,{...d,orderId:'P'});}).immediate();
 const req={orderId:'P',evidenceNote:'gateway confirms not paid and link closed',reviewedBy:'owner',noPaymentConfirmed:true,linkClosedConfirmed:true,nowMs:now};
 assert.equal(recon.reviewPayment(db,req).reason,'NOT_ELIGIBLE');
 db.prepare("update orders set status='FAILED' where order_id='P'").run();
 // A provider call still in flight cannot be cleared, even if the local order was cancelled.
 assert.equal(recon.reviewPayment(db,req).reason,'NOT_ELIGIBLE');assert(!recon.paymentNeedsReview(db,'P'));
 assert.throws(()=>recon.recoverInterrupted(db,{orderId:'P',evidenceNote:'offline gateway review complete',reviewedBy:'owner',offlineConfirmed:true,nowMs:now}));
 assert.equal(db.transaction(()=>recon.recoverInterrupted(db,{orderId:'P',evidenceNote:'offline gateway review complete',reviewedBy:'owner',offlineConfirmed:false,nowMs:now})).immediate().reason,'INVALID_INPUT');
 assert(db.transaction(()=>recon.recoverInterrupted(db,{orderId:'P',evidenceNote:'offline gateway review complete',reviewedBy:'owner',offlineConfirmed:true,nowMs:now})).immediate().ok);
 assert.equal(db.prepare("select state from order_idempotency where order_id='P'").get().state,'UNCERTAIN');
 assert.equal(db.prepare("select count(*) n from order_status_log where order_id='P'").get().n,1);
 assert(!db.prepare("select note from order_status_log where order_id='P'").get().note.includes('owner'));
 assert.equal(db.prepare("select username from audit_log where target='P'").get().username,'owner');
 for(const x of [{noPaymentConfirmed:false},{linkClosedConfirmed:false},{evidenceNote:'short'},{reviewedBy:''}])assert.equal(recon.reviewPayment(db,{...req,...x}).reason,'INVALID_INPUT');
 db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON order_attempt_reviews BEGIN SELECT RAISE(ABORT,'fixture'); END");
 assert.throws(()=>recon.reviewPayment(db,req));assert.equal(attempts.describe(db,token).kind,'UNRESOLVED');db.exec('DROP TRIGGER fail_review');
 assert(recon.paymentNeedsReview(db,'P'));assert.deepEqual(recon.reviewPayment(db,req),{ok:true});assert(!recon.paymentNeedsReview(db,'P'));
 assert.equal(attempts.describe(db,token).kind,'REVIEWED');assert.equal(recon.reviewPayment(db,req).reason,'ALREADY_REVIEWED');
 db.prepare("update order_idempotency set state='READY' where order_id='P'").run();assert.equal(attempts.describe(db,token).kind,'UNRESOLVED');db.prepare("update order_idempotency set state='UNCERTAIN' where order_id='P'").run();
 const proof=db.prepare('select order_status,payment_ref,evidence_note,reviewed_by from order_attempt_reviews').get();assert.deepEqual(proof,{order_status:'FAILED',payment_ref:null,evidence_note:req.evidenceNote,reviewed_by:'owner'});
 db.prepare("update orders set payment_ref='NEW-REF' where order_id='P'").run();assert.equal(attempts.describe(db,token).kind,'UNRESOLVED');assert.equal(attempts.rotate(db,token).reason,'ORDER_UNRESOLVED');
 db.prepare("update orders set payment_ref=NULL where order_id='P'").run();assert(attempts.rotate(db,token).ok);
 const before=db.prepare('select * from account_return_requests').all();
 const correction={orderId:'D',expectedOldMs:old,newDeliveredAtMs:newTime,evidenceNote:'carrier record verified',correctedBy:'owner',nowMs:now};
 for(const x of [{newDeliveredAtMs:now+1},{newDeliveredAtMs:1},{evidenceNote:'short'},{correctedBy:''}])assert.equal(recon.correctDelivery(db,{...correction,...x}).reason,'INVALID_INPUT');
 assert.equal(recon.correctDelivery(db,{...correction,expectedOldMs:old-1}).reason,'STALE');
 db.exec("CREATE TRIGGER fail_correction BEFORE INSERT ON return_delivery_corrections BEGIN SELECT RAISE(ABORT,'fixture'); END");
 assert.throws(()=>recon.correctDelivery(db,correction));assert.equal(db.prepare("select delivered_at_ms from return_delivery_evidence where order_id='D'").get().delivered_at_ms,old);db.exec('DROP TRIGGER fail_correction');
 assert.deepEqual(recon.correctDelivery(db,correction),{ok:true});assert.equal(recon.correctDelivery(db,correction).reason,'STALE');
 assert.deepEqual(db.prepare('select * from account_return_requests').all(),before);
 assert.deepEqual(db.prepare('select old_delivered_at_ms,new_delivered_at_ms,evidence_note,corrected_by from return_delivery_corrections').get(),{old_delivered_at_ms:old,new_delivered_at_ms:newTime,evidence_note:correction.evidenceNote,corrected_by:'owner'});
 assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recon-race-'));const file=path.join(dir,'db.sqlite');
 try{db=fixture(file);db.close();const rs=await Promise.all([run(file),run(file)]);assert.equal(rs.filter(r=>r.ok).length,1);assert.equal(rs.filter(r=>r.reason==='STALE').length,1);db=new Database(file);assert.equal(db.prepare('select count(*) n from return_delivery_corrections').get().n,1);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();}finally{fs.rmSync(dir,{recursive:true,force:true})}
 console.log('PASS manual evidence, guarded release, correction rollback and two-process race; no real provider verification');
})().catch(e=>{console.error(e);process.exitCode=1});
