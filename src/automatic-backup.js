'use strict';

const fs=require('fs'),path=require('path'),Database=require('better-sqlite3');
const REQUIRED=['products','variants','orders','order_items','coupons','reviews','articles','settings'];
const AUTO_NAME=/^yazd-\d{10}\.db$/;
function positiveInt(value,fallback,max=10000){
 const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=max?n:fallback;
}
function validate(file,dbPath){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink())throw Error('Backup is not a regular file');
 if(fs.existsSync(dbPath)){
  const live=fs.statSync(dbPath);
  if(st.dev===live.dev&&st.ino===live.ino)throw Error('Backup aliases the live database');
 }
 for(const suffix of ['-wal','-shm','-journal'])if(fs.existsSync(file+suffix))throw Error('Backup has SQLite sidecars');
 const check=new Database(file,{readonly:true,fileMustExist:true});
 try{
  check.pragma('query_only=ON');
  if(check.pragma('integrity_check',{simple:true})!=='ok')throw Error('Backup integrity check failed');
  const has=check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  if(REQUIRED.some(t=>!has.get(t)))throw Error('Backup missing required tables');
 }finally{check.close();}
}
function syncPath(file){const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function createAutomaticBackup({db,dbPath,dir,keep,now=new Date()}){
 const limit=positiveInt(keep,7);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const stamp=now.toISOString().slice(0,13).replace(/[:T-]/g,'');
 const target=path.join(dir,`yazd-${stamp}.db`);

 if(fs.existsSync(target)||fs.lstatSync(target,{throwIfNoEntry:false})){
  validate(target,dbPath);return {created:false,reason:'already_exists',file:target};
 }
 const work=fs.mkdtempSync(path.join(dir,'.auto-backup-'));
 const temp=path.join(work,'snapshot.db');let published=false;
 try{
  db.prepare('VACUUM INTO ?').run(temp);
  fs.chmodSync(temp,0o600);
  validate(temp,dbPath);
  syncPath(temp);
  try { fs.linkSync(temp,target);published=true; }
  catch(e){
   if(e.code!=='EEXIST')throw e;
   validate(target,dbPath);return {created:false,reason:'concurrent_exists',file:target};
  }

  syncPath(dir);
 }finally{fs.rmSync(work,{recursive:true,force:true});}
 if(!published)throw Error('Backup was not published');
 const candidates=fs.readdirSync(dir).filter(name=>AUTO_NAME.test(name)).filter(name=>{
  const f=path.join(dir,name);
  try{
   const st=fs.lstatSync(f);
   if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1 || ['-wal','-shm','-journal'].some(s=>fs.existsSync(f+s)))return false;

   validate(f,dbPath);return true;
  }catch{return false;}
 }).sort().reverse();
 for(const name of candidates.slice(limit)){
  const f=path.join(dir,name);

  try{
   const st=fs.lstatSync(f);
   if(f!==target && st.isFile()&&!st.isSymbolicLink()&&st.nlink===1 && !['-wal','-shm','-journal'].some(s=>fs.existsSync(f+s)))fs.unlinkSync(f);
  }catch{}
 }
 return {created:true,file:target};
}
module.exports={createAutomaticBackup,validate,positiveInt};
