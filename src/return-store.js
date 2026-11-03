'use strict';

// Staging-only store for an eventual account-returns flow. It is not wired to
// startup or HTTP; callers must verify roles, customer sessions and rate limits.
const crypto = require('crypto');
const { eligibility } = require('./return-eligibility');
const KEY = 'account_returns_schema_v1';
const DDL = [
 `CREATE TABLE return_delivery_evidence (
   order_id TEXT PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
   delivered_at_ms INTEGER NOT NULL CHECK(delivered_at_ms > 0),
   recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms > 0),
   recorded_by TEXT NOT NULL CHECK(length(recorded_by) > 0)
 )`,
 `CREATE TABLE return_item_evidence (
   item_id INTEGER PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
   volume_ml INTEGER NOT NULL CHECK(volume_ml > 0)
 )`,
 `CREATE TABLE account_return_requests (
   request_id TEXT PRIMARY KEY,
   item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
   mobile TEXT NOT NULL,
   quantity INTEGER NOT NULL CHECK(quantity > 0),
   description TEXT NOT NULL,
   used_under_2ml INTEGER NOT NULL CHECK(used_under_2ml = 1),
   created_at_ms INTEGER NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('NEW_PENDING','ANSWERED','CLOSED'))
 )`,
 `CREATE UNIQUE INDEX account_return_one_open_per_item ON account_return_requests(item_id) WHERE status != 'CLOSED'`
];
const norm = s => String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
function ready(db) {
  const marker=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
  if (marker?.value !== '1') return false;
  return DDL.every(sql=>{
    const match=/CREATE (?:UNIQUE )?(?:TABLE|INDEX) (\w+)/.exec(sql);
    const obj=db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(match[1]);
    return norm(obj?.sql) === norm(sql);
  });
}
function install(db) {
  return db.transaction(()=>{
    const marker=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
    const names=['return_delivery_evidence','return_item_evidence','account_return_requests','account_return_one_open_per_item'];
    const conflicts=names.some(name=>db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name));
    if (marker || conflicts) {
      if (ready(db)) return {created:false};
      throw Error('Return schema conflict');
    }
    for (const sql of DDL) db.exec(sql);
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(KEY,'1');
    return {created:true};
  }).immediate();
}
function requireReady(db) { if(!ready(db))throw Error('Return schema is not ready'); }
// Must be called under the same transaction as new order-item creation.
// No silent inference or mass backfill for pre-existing order items.
function captureNewItem(db,itemId,volumeMl) {
  requireReady(db);
  if(!db.inTransaction || !Number.isSafeInteger(itemId) || itemId<=0 || !Number.isSafeInteger(volumeMl) || volumeMl<=0)throw Error('Invalid item snapshot');
  db.prepare('INSERT INTO return_item_evidence(item_id,volume_ml) VALUES(?,?)').run(itemId,volumeMl);
}
// A privileged caller must verify the actual delivery time externally. Existing
// evidence is immutable here; corrections require a separate audited workflow.
function recordDelivery(db,{orderId,deliveredAtMs,recordedBy,nowMs=Date.now()}) {
  requireReady(db);
  if(!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(deliveredAtMs)||deliveredAtMs<=0||deliveredAtMs>nowMs||typeof recordedBy!=='string'||!recordedBy.trim())throw Error('Invalid delivery evidence');
  return db.transaction(()=>{
    const order=db.prepare('SELECT status FROM orders WHERE order_id=?').get(orderId);
    if(!order || order.status!=='DELIVERED')return {ok:false,reason:'NOT_DELIVERED'};
    const prior=db.prepare('SELECT delivered_at_ms FROM return_delivery_evidence WHERE order_id=?').get(orderId);
    if(prior)return {ok:false,reason:'ALREADY_RECORDED'};
    db.prepare('INSERT INTO return_delivery_evidence(order_id,delivered_at_ms,recorded_at_ms,recorded_by) VALUES(?,?,?,?)')
      .run(orderId,deliveredAtMs,nowMs,recordedBy.trim());
    return {ok:true};
  }).immediate();
}
// Caller supplies the identity ONLY after verified customer-session lookup.
// All eligibility and duplicate checks occur under the same SQLite write lock.
function submit(db,{verifiedMobile,itemId,quantity,description,usedUnder2ml,nowMs=Date.now()}) {
  requireReady(db);
  if(!Number.isSafeInteger(itemId)||itemId<=0 || !Number.isSafeInteger(quantity)||quantity<=0 ||
     typeof description!=='string'||description.trim().length<10||description.length>2000||usedUnder2ml!==true)
    return {ok:false,reason:'INVALID_INPUT'};
  return db.transaction(()=>{
    const item=db.prepare(`SELECT i.id,i.order_id,i.quantity,e.volume_ml
      FROM order_items i LEFT JOIN return_item_evidence e ON e.item_id=i.id WHERE i.id=?`).get(itemId);
    const order=item&&db.prepare('SELECT order_id,mobile,status FROM orders WHERE order_id=?').get(item.order_id);
    const delivered=order&&db.prepare('SELECT delivered_at_ms FROM return_delivery_evidence WHERE order_id=?').get(order.order_id);
    const open=!!db.prepare("SELECT 1 FROM account_return_requests WHERE item_id=? AND status!='CLOSED'").get(itemId);
    const e=eligibility({verifiedMobile,order,item,deliveredAtMs:delivered?.delivered_at_ms,nowMs,hasOpenRequest:open});
    if(!e.eligible)return {ok:false,reason:e.reason};
    if(quantity>item.quantity)return {ok:false,reason:'INVALID_QUANTITY'};
    const id='RET-'+crypto.randomBytes(12).toString('hex').toUpperCase();
    db.prepare(`INSERT INTO account_return_requests(request_id,item_id,mobile,quantity,description,used_under_2ml,created_at_ms,status)
      VALUES(?,?,?,?,?,1,?,'NEW_PENDING')`).run(id,itemId,verifiedMobile,quantity,description.trim(),nowMs);
    return {ok:true,requestId:id,deadlineMs:e.deadlineMs};
  }).immediate();
}
module.exports={KEY,ready,install,captureNewItem,recordDelivery,submit};
