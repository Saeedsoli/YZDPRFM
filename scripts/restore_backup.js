#!/usr/bin/env node
'use strict';
// Read-only inspection and restoration into a NEW isolated file only.
// Never overwrite the live DB or its WAL/SHM; no --yes bypass exists.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const Database=require('better-sqlite3');
const ROOT=path.dirname(__dirname), DB_PATH=process.env.DB_PATH||path.join(ROOT,'data','yazd.db');
const BACKUP_DIR=path.join(path.dirname(DB_PATH),'backups');
const REQUIRED=['products','variants','orders','order_items','coupons','reviews','articles','settings'];
function inspect(file){
 const db=new Database(file,{readonly:true,fileMustExist:true});
 try{
  if(db.pragma('integrity_check',{simple:true})!=='ok')throw Error('SQLite integrity check failed');
  const missing=REQUIRED.filter(t=>!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
  if(missing.length)throw Error('Required tables missing: '+missing.join(','));
  return {products:db.prepare('SELECT COUNT(*) n FROM products').get().n,orders:db.prepare('SELECT COUNT(*) n FROM orders').get().n};
 }finally{db.close();}
}
function hash(file){const fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),buf=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function canonicalTarget(file){const p=path.resolve(file);return path.join(fs.realpathSync(path.dirname(p)),path.basename(p));}
function list(){
 if(!fs.existsSync(BACKUP_DIR)){console.log('پوشه پشتیبان وجود ندارد.');return;}
 const files=fs.readdirSync(BACKUP_DIR).filter(x=>/\.(db|sqlite3?|xz|zip)$/i.test(x)).sort();
 console.log(files.length?'پشتیبان‌ها (محرمانه):':'پشتیبانی یافت نشد.');for(const f of files)console.log(f);
 console.log('دلتاهای فشرده با scripts/sqlite_delta_backup.py فقط در مسیر جدید بازیابی می‌شوند.');
}
function restoreToNew(source,destination){
 const src=path.resolve(source),out=canonicalTarget(destination),live=canonicalTarget(DB_PATH);
 // A configured DB path can itself be a symlink; protect both spellings.
 const activePaths=new Set([live]);if(fs.existsSync(DB_PATH))activePaths.add(fs.realpathSync(DB_PATH));
 for(const base of activePaths)if([base,base+'-wal',base+'-shm',base+'-journal'].includes(out))throw Error('Destination is the active database or a sidecar');
 const stat=fs.lstatSync(src);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Backup must be a regular non-symlink file');
 if(fs.existsSync(DB_PATH)){const current=fs.statSync(DB_PATH);if(stat.dev===current.dev&&stat.ino===current.ino)throw Error('Source is the active database');}
 if(fs.existsSync(src+'-wal')||fs.existsSync(src+'-shm')||fs.existsSync(src+'-journal'))throw Error('Source has SQLite sidecars; use a consistent offline backup');
 const info=inspect(src),before=hash(src);let outFd,created=false;
 try{
  outFd=fs.openSync(out,'wx',0o600);created=true;const inFd=fs.openSync(src,'r');
  try{const buffer=Buffer.alloc(1024*1024);let n;while((n=fs.readSync(inFd,buffer,0,buffer.length,null))>0){let off=0;while(off<n)off+=fs.writeSync(outFd,buffer,off,n-off);}}finally{fs.closeSync(inFd);}
  fs.fsyncSync(outFd);fs.closeSync(outFd);outFd=undefined;
  if(hash(out)!==before||hash(src)!==before)throw Error('Backup changed or copy verification failed');
  const after=inspect(out);if(after.products!==info.products||after.orders!==info.orders)throw Error('Restore verification failed');
  console.log(JSON.stringify({restored_to_new_file:true,sha256:before,products:after.products,orders:after.orders}));
 }catch(e){if(outFd!==undefined)fs.closeSync(outFd);if(created)try{fs.unlinkSync(out)}catch{}throw e;}
}
const args=process.argv.slice(2);
try{
 if(args.length===0||(args.length===1&&args[0]==='--list'))list();
 else if(args.length===1&&['--help','-h'].includes(args[0]))console.log('فقط گزارش --list یا بازیابی غیربازنویسی: --to-new <backup.db> <new-file.db>');
 else if(args.length===3&&args[0]==='--to-new')restoreToNew(args[1],args[2]);
 else {console.error('بازیابی روی دیتابیس موجود ممنوع است؛ فقط --to-new و مسیر جدید مجاز است.');process.exitCode=2;}
}catch(e){console.error('بازیابی انجام نشد: '+e.message);process.exitCode=1;}
