'use strict';

// Explicit, auditable human confirmation for old order items whose volume was
// not snapshotted at checkout. Never infer historic volume from current SKU or
// product name. Only authorized staff after verifying independent evidence.
const base=require('./return-store');
const KEY='account_returns_historical_evidence_v1';
const DDL=`CREATE TABLE return_historical_evidence (
  item_id INTEGER PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
  volume_ml INTEGER NOT NULL CHECK(volume_ml > 0),
  confirmed_by TEXT NOT NULL CHECK(length(confirmed_by) > 0),
  confirmed_at_ms INTEGER NOT NULL CHECK(confirmed_at_ms > 0),
  evidence_note TEXT NOT NULL CHECK(length(evidence_note) >= 10)
)`;
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
function ready(db){
 const row=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='return_historical_evidence'").get();
 const marker=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 return base.ready(db)&&marker?.value==='1'&&norm(row?.sql)===norm(DDL);
}
function install(db){
 return db.transaction(()=>{
  if(!base.ready(db))throw Error('Base return schema is not ready');
  const row=db.prepare("SELECT sql FROM sqlite_master WHERE name='return_historical_evidence'").get();
  const marker=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
  if(row||marker){if(ready(db))return {created:false};throw Error('Historical evidence schema conflict');}
  db.exec(DDL);db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(KEY,'1');return {created:true};
 }).immediate();
}
function confirm(db,{itemId,volumeMl,confirmedBy,evidenceNote,confirmed,nowMs=Date.now()}){
 if(!ready(db))throw Error('Historical evidence schema is not ready');
 if(!Number.isSafeInteger(itemId)||itemId<=0||!Number.isSafeInteger(volumeMl)||volumeMl<=0||volumeMl>1000||
   typeof confirmedBy!=='string'||!confirmedBy.trim()||confirmedBy.length>100||
   typeof evidenceNote!=='string'||evidenceNote.trim().length<10||evidenceNote.length>500||
   confirmed!==true||!Number.isSafeInteger(nowMs)||nowMs<=0)return {ok:false,reason:'INVALID_INPUT'};
 return db.transaction(()=>{
  const row=db.prepare(`SELECT i.id,i.order_id,o.status FROM order_items i JOIN orders o ON o.order_id=i.order_id WHERE i.id=?`).get(itemId);
  if(!row||row.status!=='DELIVERED')return {ok:false,reason:'ITEM_UNAVAILABLE'};
  if(db.prepare('SELECT 1 FROM return_item_evidence WHERE item_id=?').get(itemId))return {ok:false,reason:'ALREADY_RECORDED'};
  db.prepare('INSERT INTO return_item_evidence(item_id,volume_ml) VALUES(?,?)').run(itemId,volumeMl);
  db.prepare('INSERT INTO return_historical_evidence(item_id,volume_ml,confirmed_by,confirmed_at_ms,evidence_note) VALUES(?,?,?,?,?)')
    .run(itemId,volumeMl,confirmedBy.trim(),nowMs,evidenceNote.trim());
  return {ok:true,orderId:row.order_id};
 }).immediate();
}
module.exports={KEY,ready,install,confirm};
