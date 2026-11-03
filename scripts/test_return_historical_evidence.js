'use strict';
const assert=require('assert'),Database=require('better-sqlite3');
const base=require('../src/return-store'),history=require('../src/return-historical-evidence');
function fixture(){
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(`
 CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE orders(order_id TEXT PRIMARY KEY,mobile TEXT,status TEXT);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id TEXT,quantity INTEGER);
 INSERT INTO orders VALUES('A','09120001111','DELIVERED'),('B','09120001111','SHIPPED');
 INSERT INTO order_items VALUES(1,'A',1),(2,'A',1),(3,'B',1);`);return db;
}
const params={itemId:1,volumeMl:30,confirmedBy:'owner',evidenceNote:'verified physical invoice',confirmed:true,nowMs:1800000000000};
let db=fixture();assert.throws(()=>history.install(db));base.install(db);assert.deepStrictEqual(history.install(db),{created:true});assert(history.ready(db));assert.deepStrictEqual(history.install(db),{created:false});
for(const bad of [{confirmed:false},{volumeMl:'30'},{volumeMl:0},{volumeMl:1001},{evidenceNote:'short'},{confirmedBy:''},{itemId:0}])assert.strictEqual(history.confirm(db,{...params,...bad}).reason,'INVALID_INPUT');
assert.strictEqual(history.confirm(db,{...params,itemId:3}).reason,'ITEM_UNAVAILABLE');
// Failure of durable provenance must roll back the volume snapshot as well.
db.exec("CREATE TRIGGER fail_historical BEFORE INSERT ON return_historical_evidence BEGIN SELECT RAISE(ABORT,'fixture'); END");
assert.throws(()=>history.confirm(db,params));assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM return_item_evidence').get().n,0);
db.exec('DROP TRIGGER fail_historical');assert.deepStrictEqual(history.confirm(db,params),{ok:true,orderId:'A'});
assert.deepStrictEqual(db.prepare('SELECT item_id,volume_ml,confirmed_by,confirmed_at_ms,evidence_note FROM return_historical_evidence').get(),{item_id:1,volume_ml:30,confirmed_by:'owner',confirmed_at_ms:params.nowMs,evidence_note:params.evidenceNote});
assert.strictEqual(history.confirm(db,{...params,volumeMl:50}).reason,'ALREADY_RECORDED');
assert.strictEqual(db.prepare('SELECT volume_ml FROM return_item_evidence WHERE item_id=1').get().volume_ml,30);
assert.strictEqual(db.pragma('integrity_check',{simple:true}),'ok');db.close();
db=fixture();base.install(db);db.exec('CREATE TABLE return_historical_evidence(other)');assert.throws(()=>history.install(db));assert(!history.ready(db));db.close();
console.log('PASS explicit historical evidence: valid role caller input, provenance, immutable replay and atomic rollback');
