'use strict';

const crypto=require('crypto');
const DEFAULT_PASSWORD='yazd1404';
function strongInitialSecret(value){
 if(typeof value!=='string'||value.length<12||value.length>256||!value.trim())return false;
 const normalized=value.trim().toLowerCase();
 if(new Set(normalized).size<5||['password1234','password12345','password123456','123456789012','adminadmin123','yazd1404'].includes(normalized))return false;
 return true;
}
function isDefaultOrInvalid(owner){
 try{
  if(!/^[a-f0-9]{128}$/i.test(owner.pass_hash||'')||!owner.pass_salt)return true;
  const stored=Buffer.from(owner.pass_hash,'hex'),candidate=crypto.scryptSync(DEFAULT_PASSWORD,owner.pass_salt,64);
  return stored.length!==candidate.length||crypto.timingSafeEqual(stored,candidate);
 }catch{return true;}
}
function assertProductionAdmin({Database,dbPath,existing,env=process.env}){
 if(String(env.NODE_ENV||'').trim().toLowerCase()!=='production')return;
 const fail=()=>{throw Error('Production administrator is unsafe or unconfigured. Set a unique initial credential or securely change the existing owner credential before deployment.');};
 if(!existing){if(!strongInitialSecret(env.ADMIN_PASSWORD))fail();return;}
 const db=new Database(dbPath,{readonly:true,fileMustExist:true});
 try{
  db.pragma('query_only=ON');
  const has=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='staff'").get();
  if(!has){if(!strongInitialSecret(env.ADMIN_PASSWORD))fail();return;}
  const owners=db.prepare("SELECT pass_hash,pass_salt,active FROM staff WHERE role_key='owner'").all();
  if(!owners.length){if(!strongInitialSecret(env.ADMIN_PASSWORD))fail();return;}
  const active=owners.filter(o=>o.active===1);
  if(!active.length||active.some(isDefaultOrInvalid))fail();
 }catch(e){if(e.message?.startsWith('Production administrator'))throw e;throw Error('Production administrator safety check failed; existing database was not modified.');}
 finally{db.close();}
}
module.exports={assertProductionAdmin,strongInitialSecret};
