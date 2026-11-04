'use strict';

// Browser checkout attempts use an HttpOnly capability. The checkout page
// coordinates first-time same-origin tabs with Web Locks; other clients may not.
const crypto=require('crypto');
const orders=require('./order-idempotency');
const KEY='checkout_attempt_cookie_schema_v1';
const COOKIE='yazd_order_attempt';
const DDL=`CREATE TABLE checkout_attempt_tokens (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms > 0),
  revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms > 0)
)`;
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
function ready(db){
 const t=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='checkout_attempt_tokens'").get();
 const m=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 return !!(orders.ready(db)&&t&&norm(t.sql)===norm(DDL)&&m?.value==='1');
}
function install(db){return db.transaction(()=>{
 if(!orders.ready(db))throw Error('Order idempotency schema unavailable');
 const t=db.prepare("SELECT sql FROM sqlite_master WHERE name='checkout_attempt_tokens'").get();
 const m=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 if(t||m){if(ready(db))return {created:false};throw Error('Checkout attempt schema conflict');}
 db.exec(DDL);db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(KEY,'1');return {created:true};
}).immediate();}
function digest(token){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||/^([a-f0-9])\1{63}$/.test(token))throw Error('Invalid attempt token');
 return crypto.createHash('sha256').update(token,'ascii').digest('hex');
}
function readCookie(header){
 if(header===undefined||header==='')return {kind:'ABSENT'};
 if(typeof header!=='string'||header.length>8192)return {kind:'INVALID'};
 const matches=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
 if(!matches.length)return {kind:'ABSENT'};
 if(matches.length!==1)return {kind:'INVALID'};
 const token=matches[0].slice(COOKIE.length+1);
 try{digest(token);return {kind:'VALID',token};}catch{return {kind:'INVALID'};}
}
function setCookie(token,{production=false}={}){
 digest(token);
 return `${COOKIE}=${token}; HttpOnly; Path=/api/orders; Max-Age=2592000; SameSite=Lax${production?'; Secure':''}`;
}
function requireReady(db){if(!ready(db))throw Error('Checkout attempt schema unavailable');}
function requireTransaction(db){if(!db.inTransaction)throw Error('Checkout attempt requires transaction');}
function createLocked(db,nowMs){
 requireTransaction(db);requireReady(db);
 if(!Number.isSafeInteger(nowMs)||nowMs<=0)throw Error('Invalid time');
 for(let i=0;i<3;i++){
  const token=crypto.randomBytes(32).toString('hex'),hash=digest(token);
  const r=db.prepare('INSERT OR IGNORE INTO checkout_attempt_tokens(token_hash,issued_at_ms,revoked_at_ms) VALUES(?,?,NULL)').run(hash,nowMs);
  if(r.changes===1)return token;
 }
 throw Error('Could not allocate checkout attempt');
}
function issue(db,nowMs=Date.now()){return db.transaction(()=>createLocked(db,nowMs)).immediate();}
function active(db,token){
 requireReady(db);const hash=digest(token);
 return !!db.prepare('SELECT 1 FROM checkout_attempt_tokens WHERE token_hash=? AND revoked_at_ms IS NULL').get(hash);
}
// Only non-sensitive state is returned to the browser holding the capability.
// Status is informational: order creation/rotation rechecks under a write lock.
function describe(db,token){
 requireReady(db);const hash=digest(token);
 const tokenRow=db.prepare('SELECT revoked_at_ms FROM checkout_attempt_tokens WHERE token_hash=?').get(hash);
 if(!tokenRow || tokenRow.revoked_at_ms!==null)return {kind:'INACTIVE'};
 const row=db.prepare(`SELECT i.order_id,i.state,o.status,o.payment_ref FROM order_idempotency i
   LEFT JOIN orders o ON o.order_id=i.order_id WHERE i.key_hash=?`).get(hash);
 if(!row)return {kind:'UNUSED'};
 if(['PAID','PROCESSING','SHIPPED','DELIVERED'].includes(row.status))return {kind:'PAID',orderId:row.order_id};
 if(row.state==='READY' && row.status==='PENDING' && row.payment_ref)return {kind:'PENDING',orderId:row.order_id};
 if(require('./order-reconciliation').validReview(db,{orderId:row.order_id,keyHash:hash,status:row.status,paymentRef:row.payment_ref}))return {kind:'REVIEWED',orderId:row.order_id};
 return {kind:'UNRESOLVED',orderId:row.order_id};
}
// Used while holding the SAME write lock as order-idempotency lookup/binding.
// Checking only before the order transaction would leave a rotation race.
function assertActiveInTransaction(db,token){
 requireTransaction(db);if(!active(db,token))throw Error('Checkout attempt inactive');
 return digest(token);
}
function rotate(db,token,nowMs=Date.now()){
 requireReady(db);const hash=digest(token);
 if(!Number.isSafeInteger(nowMs)||nowMs<=0)throw Error('Invalid time');
 return db.transaction(()=>{
  const row=db.prepare('SELECT revoked_at_ms FROM checkout_attempt_tokens WHERE token_hash=?').get(hash);
  if(!row||row.revoked_at_ms!==null)return {ok:false,reason:'INACTIVE'};
  const attempt=db.prepare(`SELECT i.order_id,i.state,o.status,o.payment_ref FROM order_idempotency i
    LEFT JOIN orders o ON o.order_id=i.order_id WHERE i.key_hash=?`).get(hash);
  // Even an apparently cancelled or failed order can have an uncertain
  // external payment. Only a paid/fulfilling order or an unused token can be
  // automatically replaced; all other cases require reconciliation.
  if(attempt&&!['PAID','PROCESSING','SHIPPED','DELIVERED'].includes(attempt.status) &&
     !require('./order-reconciliation').validReview(db,{orderId:attempt.order_id,keyHash:hash,status:attempt.status,paymentRef:attempt.payment_ref}))
    return {ok:false,reason:'ORDER_UNRESOLVED'};
  if(db.prepare('UPDATE checkout_attempt_tokens SET revoked_at_ms=? WHERE token_hash=? AND revoked_at_ms IS NULL').run(nowMs,hash).changes!==1)
    throw Error('Checkout token changed concurrently');
  return {ok:true,token:createLocked(db,nowMs)};
 }).immediate();
}
module.exports={KEY,COOKIE,ready,install,digest,readCookie,setCookie,issue,active,describe,assertActiveInTransaction,rotate};
