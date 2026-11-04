'use strict';
// Explicit, backup-first additive migration of an OFFLINE existing database.
// Offline-only recovery: all application writers must be stopped. Never retries a provider or changes payment/stock.
const fs=require('fs'),path=require('path'),Database=require('better-sqlite3');
const args=process.argv.slice(2);
if(args.length!==11||args[0]!=='--db'||args[2]!=='--backup'||args[4]!=='--order-id'||args[6]!=='--actor'||args[8]!=='--note'||args[10]!=='--offline-confirmed'){
 console.error('Usage: node src/order-attempt-recovery-cli.js --db <existing> --backup <new-file> --order-id <order> --actor <operator> --note <evidence> --offline-confirmed');process.exit(2);
}
const source=path.resolve(args[1]),backup=path.resolve(args[3]);
const orderId=args[5],actor=args[7],note=args[9];
function quote(x){return '"'+String(x).replace(/"/g,'""')+'"';}
function compare(a,b){
 const schema="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
 if(JSON.stringify(a.prepare(schema).all())!==JSON.stringify(b.prepare(schema).all()))throw Error('Backup schema differs');
 const tables=a.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
 for(const t of tables){
  let order='rowid';
  if(/\bWITHOUT\s+ROWID\b/i.test(t.sql||'')){
   const pk=a.pragma(`table_info(${quote(t.name)})`).filter(x=>x.pk).sort((x,y)=>x.pk-y.pk).map(x=>quote(x.name));
   if(!pk.length)throw Error('Cannot compare table');order=pk.join(',');
  }
  const q=`SELECT * FROM ${quote(t.name)} ORDER BY ${order}`;
  const x=a.prepare(q).iterate(),y=b.prepare(q).iterate();
  while(true){const i=x.next(),j=y.next();if(i.done!==j.done||(!i.done&&JSON.stringify(i.value)!==JSON.stringify(j.value)))throw Error('Backup content differs');if(i.done)break;}
 }
}
(async()=>{
 if(!fs.existsSync(source)||fs.existsSync(backup))throw Error('Existing database and new backup path required');
 const realSource=fs.realpathSync(source),sourceAlias=path.join(fs.realpathSync(path.dirname(source)),path.basename(source));
 const target=path.join(fs.realpathSync(path.dirname(backup)),path.basename(backup));
 for(const base of new Set([realSource,sourceAlias]))if([base,base+'-wal',base+'-shm',base+'-journal'].includes(target))throw Error('Invalid backup path');
 const fd=fs.openSync(target,'wx',0o600);fs.closeSync(fd);
 let sourceDb,backupDb;
 try{
  sourceDb=new Database(realSource,{fileMustExist:true});await sourceDb.backup(target);
  backupDb=new Database(target,{readonly:true,fileMustExist:true});
  if(backupDb.pragma('integrity_check',{simple:true})!=='ok')throw Error('Backup integrity failed');
  const result=sourceDb.transaction(()=>{compare(sourceDb,backupDb);const r=require('./order-reconciliation').recoverInterrupted(sourceDb,{orderId,evidenceNote:note,reviewedBy:actor,offlineConfirmed:true});if(!r.ok)throw Error('Attempt not eligible for offline recovery');return r;}).immediate();
  console.log(JSON.stringify({backup_verified:true,result,order_payment_and_stock_unchanged:true}));
 }finally{if(backupDb)backupDb.close();if(sourceDb)sourceDb.close();}
})().catch(e=>{console.error('Recovery failed; payment and stock were not changed: '+e.message);process.exitCode=1;});
