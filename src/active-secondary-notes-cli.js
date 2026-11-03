'use strict';
// Explicit, offline, backup-first scoped update of reference-note data.
const fs=require('fs'),path=require('path'),Database=require('better-sqlite3');
const args=process.argv.slice(2);
if(![5,7].includes(args.length)||args[0]!=='--db'||args[2]!=='--backup'||args[4]!=='--offline-confirmed'||(args.length===7&&(args[5]!=='--batch'||!['2','3','4','5'].includes(args[6])))){
 console.error('Usage: node src/active-secondary-notes-cli.js --db <existing> --backup <new-file> --offline-confirmed [--batch 2|3|4|5]');process.exit(2);
}
const batch=args.length===7?'v'+args[6]:'v1';
const source=path.resolve(args[1]),backup=path.resolve(args[3]);
function quote(x){return '"'+String(x).replace(/"/g,'""')+'"';}
function compare(a,b){
 const schema="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
 if(JSON.stringify(a.prepare(schema).all())!==JSON.stringify(b.prepare(schema).all()))throw Error('Backup schema differs');
 for(const t of a.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all()){
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
 const real=fs.realpathSync(source),alias=path.join(fs.realpathSync(path.dirname(source)),path.basename(source));
 const target=path.join(fs.realpathSync(path.dirname(backup)),path.basename(backup));
 for(const base of new Set([real,alias]))if([base,base+'-wal',base+'-shm',base+'-journal'].includes(target))throw Error('Invalid backup path');
 const fd=fs.openSync(target,'wx',0o600);fs.closeSync(fd);
 let live,snapshot;
 try{
  live=new Database(real,{fileMustExist:true});await live.backup(target);
  snapshot=new Database(target,{readonly:true,fileMustExist:true});
  if(snapshot.pragma('integrity_check',{simple:true})!=='ok')throw Error('Backup integrity failed');
  const result=live.transaction(()=>{compare(live,snapshot);return require('./active-secondary-notes').apply(live,path.join(__dirname,`../seed/active_secondary_note_additions_${batch}.json`),{indexExisting:true});}).immediate();
  console.log(JSON.stringify({backup_verified:true,result}));
 }finally{if(snapshot)snapshot.close();if(live)live.close();}
})().catch(e=>{console.error('Note migration failed; orders were not changed: '+e.message);process.exitCode=1;});
