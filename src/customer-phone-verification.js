'use strict';

const KEY='customer_phone_verification_schema_v1';
const DDL=`CREATE TABLE customer_phone_verifications (
  mobile TEXT PRIMARY KEY,
  verified_at INTEGER NOT NULL,
  password_trusted INTEGER NOT NULL DEFAULT 0 CHECK(password_trusted IN (0,1))
)`;
const canonical=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
function ready(db){
 const t=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customer_phone_verifications'").get();
 const m=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 return !!(t&&canonical(t.sql)===canonical(DDL)&&m?.value==='1');
}
function install(db){return db.transaction(()=>{
 const t=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customer_phone_verifications'").get();
 const m=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 if(t||m){if(ready(db))return {reason:'already_installed'};throw Error('Phone verification schema conflict');}
 db.exec(DDL);db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(KEY,'1');return {created:true};
})();}
function markVerified(db,mobile,trustPassword=false){
 if(!db.inTransaction||!ready(db)||!/^09\d{9}$/.test(mobile))throw Error('Phone verification requires a valid transaction and mobile');
 db.prepare(`INSERT INTO customer_phone_verifications(mobile,verified_at,password_trusted) VALUES(?,?,?)
 ON CONFLICT(mobile) DO UPDATE SET verified_at=excluded.verified_at,
 password_trusted=CASE WHEN excluded.password_trusted=1 THEN 1 ELSE customer_phone_verifications.password_trusted END`)
 .run(mobile,Date.now(),trustPassword?1:0);
}
function verified(db,mobile){if(!ready(db)||!/^09\d{9}$/.test(String(mobile||'')))return false;return !!db.prepare('SELECT 1 FROM customer_phone_verifications WHERE mobile=? AND verified_at>0').get(mobile);}
function trustedPassword(db,mobile){if(!ready(db)||!/^09\d{9}$/.test(String(mobile||'')))return false;return !!db.prepare('SELECT 1 FROM customer_phone_verifications WHERE mobile=? AND verified_at>0 AND password_trusted=1').get(mobile);}
module.exports={KEY,ready,install,markVerified,verified,trustedPassword};
