'use strict';

// Manual evidence, not a payment-provider verification. No payment, stock or
// existing return request is changed here. A staff member is responsible for
// checking the real gateway / delivery evidence before using these operations.
const attempts=require('./checkout-attempt');
const crypto=require('crypto');
const returns=require('./return-store');
const KEY='order_reconciliation_schema_v1';
const DDL=[
 `CREATE TABLE order_attempt_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL CHECK(length(key_hash) = 64),
  order_status TEXT NOT NULL CHECK(order_status IN ('FAILED','CANCELLED','EXPIRED')),
  payment_ref TEXT,
  evidence_note TEXT NOT NULL CHECK(length(evidence_note) >= 20),
  reviewed_by TEXT NOT NULL CHECK(length(reviewed_by) > 0),
  reviewed_at_ms INTEGER NOT NULL CHECK(reviewed_at_ms > 0)
 )`,
 `CREATE INDEX order_attempt_reviews_order ON order_attempt_reviews(order_id,id)`,
 `CREATE TABLE return_delivery_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  old_delivered_at_ms INTEGER NOT NULL CHECK(old_delivered_at_ms > 0),
  new_delivered_at_ms INTEGER NOT NULL CHECK(new_delivered_at_ms > 0),
  evidence_note TEXT NOT NULL CHECK(length(evidence_note) >= 10),
  corrected_by TEXT NOT NULL CHECK(length(corrected_by) > 0),
  corrected_at_ms INTEGER NOT NULL CHECK(corrected_at_ms > 0)
 )`,
 `CREATE INDEX return_delivery_corrections_order ON return_delivery_corrections(order_id,id)`
];
const names=['order_attempt_reviews','order_attempt_reviews_order','return_delivery_corrections','return_delivery_corrections_order'];
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
function ready(db){
 const m=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 if(m?.value!=='1'||!attempts.ready(db)||!returns.ready(db))return false;
 return DDL.every((sql,i)=>norm(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(names[i])?.sql)===norm(sql));
}
function install(db){return db.transaction(()=>{
 if(!attempts.ready(db)||!returns.ready(db))throw Error('Required order/return schema unavailable');
 const marker=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 const present=names.some(n=>db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(n));
 if(marker||present){if(ready(db))return {created:false};throw Error('Reconciliation schema conflict');}
 for(const sql of DDL)db.exec(sql);
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(KEY,'1');return {created:true};
}).immediate();}
function goodText(value,min,max){return typeof value==='string'&&value.trim().length>=min&&value.length<=max;}
function requireReady(db){if(!ready(db))throw Error('Reconciliation schema unavailable');}
// Bind approval to the *finished* adapter state as well as the order/ref.
// A still-CREATING provider call can return later and must never be released.
const finishedStates=new Set(['READY','UNCERTAIN','FAILED']);
function reviewBinding(keyHash,state){return crypto.createHash('sha256').update(keyHash+'|'+state,'ascii').digest('hex');}
function validReview(db,{orderId,keyHash,status,paymentRef}){
 if(!ready(db)||!['FAILED','CANCELLED','EXPIRED'].includes(status))return false;
 const current=db.prepare('SELECT state FROM order_idempotency WHERE order_id=? AND key_hash=?').get(orderId,keyHash);
 if(!current||!finishedStates.has(current.state))return false;
 const r=db.prepare(`SELECT key_hash,order_status,payment_ref FROM order_attempt_reviews
  WHERE order_id=? ORDER BY id DESC LIMIT 1`).get(orderId);
 return !!r && r.key_hash===reviewBinding(keyHash,current.state) && r.order_status===status && r.payment_ref===(paymentRef??null);
}
function reviewPayment(db,{orderId,evidenceNote,reviewedBy,noPaymentConfirmed,linkClosedConfirmed,nowMs=Date.now()}){
 requireReady(db);
 if(typeof orderId!=='string'||!orderId||orderId.length>100||!goodText(evidenceNote,20,500)||!goodText(reviewedBy,1,100)||
    noPaymentConfirmed!==true||linkClosedConfirmed!==true||!Number.isSafeInteger(nowMs)||nowMs<=0)return {ok:false,reason:'INVALID_INPUT'};
 return db.transaction(()=>{
  const row=db.prepare(`SELECT o.order_id,o.status,o.payment_ref,i.key_hash,i.state,t.revoked_at_ms FROM orders o
   JOIN order_idempotency i ON i.order_id=o.order_id JOIN checkout_attempt_tokens t ON t.token_hash=i.key_hash
   WHERE o.order_id=?`).get(orderId);
  if(!row||!['FAILED','CANCELLED','EXPIRED'].includes(row.status)||!finishedStates.has(row.state)||row.revoked_at_ms!==null)return {ok:false,reason:'NOT_ELIGIBLE'};
  if(validReview(db,{orderId,keyHash:row.key_hash,status:row.status,paymentRef:row.payment_ref}))return {ok:false,reason:'ALREADY_REVIEWED'};
  db.prepare(`INSERT INTO order_attempt_reviews(order_id,key_hash,order_status,payment_ref,evidence_note,reviewed_by,reviewed_at_ms)
    VALUES(?,?,?,?,?,?,?)`).run(orderId,reviewBinding(row.key_hash,row.state),row.status,row.payment_ref??null,evidenceNote.trim(),reviewedBy.trim(),nowMs);
  return {ok:true};
 }).immediate();
}
function paymentStillCreating(db,orderId){
 if(!ready(db))return false;
 const row=db.prepare(`SELECT o.status,i.state,t.revoked_at_ms FROM orders o
  JOIN order_idempotency i ON i.order_id=o.order_id JOIN checkout_attempt_tokens t ON t.token_hash=i.key_hash WHERE o.order_id=?`).get(orderId);
 return !!row && row.revoked_at_ms===null && row.state==='CREATING' && ['FAILED','CANCELLED','EXPIRED'].includes(row.status);
}
function paymentNeedsReview(db,orderId){
 if(!ready(db))return false;
 const row=db.prepare(`SELECT o.order_id,o.status,o.payment_ref,i.key_hash,i.state,t.revoked_at_ms FROM orders o
   JOIN order_idempotency i ON i.order_id=o.order_id JOIN checkout_attempt_tokens t ON t.token_hash=i.key_hash WHERE o.order_id=?`).get(orderId);
 return !!row && row.revoked_at_ms===null && finishedStates.has(row.state) && ['FAILED','CANCELLED','EXPIRED'].includes(row.status) &&
   !validReview(db,{orderId,keyHash:row.key_hash,status:row.status,paymentRef:row.payment_ref});
}
// Offline-only recovery of a stale CREATING record after ALL writers are
// stopped. This does not change order/payment/stock or authorize a new order.
// Caller must have verified a backup; no automatic age-based recovery.
function recoverInterrupted(db,{orderId,evidenceNote,reviewedBy,offlineConfirmed,nowMs=Date.now()}){
 requireReady(db);
 if(!db.inTransaction)throw Error('Offline recovery requires a transaction');
 if(typeof orderId!=='string'||!orderId||orderId.length>100||!goodText(evidenceNote,20,500)||!goodText(reviewedBy,1,100)||
    offlineConfirmed!==true||!Number.isSafeInteger(nowMs)||nowMs<=0)return {ok:false,reason:'INVALID_INPUT'};
 const r=db.prepare(`SELECT o.status,i.state FROM orders o JOIN order_idempotency i ON i.order_id=o.order_id WHERE o.order_id=?`).get(orderId);
 if(!r||r.state!=='CREATING'||!['PENDING','VERIFYING','FAILED','CANCELLED','EXPIRED'].includes(r.status))return {ok:false,reason:'NOT_ELIGIBLE'};
 const changed=db.prepare("UPDATE order_idempotency SET state='UNCERTAIN',response_json=NULL,updated_at_ms=? WHERE order_id=? AND state='CREATING'").run(nowMs,orderId);
 if(changed.changes!==1)throw Error('Attempt changed during recovery');
 // Order history can be visible to the customer: keep the note generic.
 // The operator and evidence are stored in the private audit log atomically;
 // its configured retention policy still applies.
 db.prepare('INSERT INTO order_status_log(order_id,status,note) VALUES(?,?,?)')
  .run(orderId,r.status,'پردازش متوقف‌شده در حالت آفلاین برای بررسی ثبت شد.');
 db.prepare(`INSERT INTO audit_log(username,role_key,action,method,path,target,detail,allowed)
  VALUES(?,?,'orders.offline_attempt_recovery','CLI',NULL,?,?,1)`)
  .run(reviewedBy.trim(),'offline_operator',orderId,JSON.stringify({evidence:evidenceNote.trim()}));
 return {ok:true};
}
function correctDelivery(db,{orderId,expectedOldMs,newDeliveredAtMs,evidenceNote,correctedBy,nowMs=Date.now()}){
 requireReady(db);
 if(typeof orderId!=='string'||!orderId||orderId.length>100||!Number.isSafeInteger(expectedOldMs)||expectedOldMs<=0||
  !Number.isSafeInteger(newDeliveredAtMs)||newDeliveredAtMs<=0||!Number.isSafeInteger(nowMs)||nowMs<=0||newDeliveredAtMs>nowMs||
  !goodText(evidenceNote,10,500)||!goodText(correctedBy,1,100))return {ok:false,reason:'INVALID_INPUT'};
 return db.transaction(()=>{
  const row=db.prepare(`SELECT o.status,o.created_at,e.delivered_at_ms FROM orders o
   JOIN return_delivery_evidence e ON e.order_id=o.order_id WHERE o.order_id=?`).get(orderId);
  if(!row||row.status!=='DELIVERED')return {ok:false,reason:'NOT_ELIGIBLE'};
  const created=Date.parse(row.created_at);
  if(!Number.isFinite(created)||newDeliveredAtMs<created)return {ok:false,reason:'INVALID_INPUT'};
  if(row.delivered_at_ms!==expectedOldMs)return {ok:false,reason:'STALE'};
  if(newDeliveredAtMs===expectedOldMs)return {ok:false,reason:'UNCHANGED'};
  const changed=db.prepare('UPDATE return_delivery_evidence SET delivered_at_ms=? WHERE order_id=? AND delivered_at_ms=?')
   .run(newDeliveredAtMs,orderId,expectedOldMs);
  if(changed.changes!==1)throw Error('Delivery evidence changed concurrently');
  db.prepare(`INSERT INTO return_delivery_corrections(order_id,old_delivered_at_ms,new_delivered_at_ms,evidence_note,corrected_by,corrected_at_ms)
   VALUES(?,?,?,?,?,?)`).run(orderId,expectedOldMs,newDeliveredAtMs,evidenceNote.trim(),correctedBy.trim(),nowMs);
  return {ok:true};
 }).immediate();
}
module.exports={KEY,ready,install,validReview,reviewPayment,paymentNeedsReview,paymentStillCreating,recoverInterrupted,correctDelivery};
