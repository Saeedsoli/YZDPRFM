'use strict';
// Explicit maintenance tool. Requires an existing SQLite database and a new backup path.
const fs=require('fs'),path=require('path');
const args=process.argv.slice(2);
if (args.length!==3 || args[0]!=='--apply' || args[1]!=='--backup') {
  console.error('Usage: DB_PATH=/path/store.db node src/retire-sample3-cli.js --apply --backup /path/new-backup.db');
  process.exit(2);
}
const source=path.resolve(process.env.DB_PATH || path.join(__dirname,'../data/yazd.db'));
const backup=path.resolve(args[2]);
if(!fs.existsSync(source) || fs.existsSync(backup) || source===backup) {
  console.error('Existing database and new, different backup path are required.');process.exit(2);
}
(async()=>{
  fs.mkdirSync(path.dirname(backup),{recursive:true});
  const Database=require('better-sqlite3');const old=new Database(source,{readonly:true,fileMustExist:true});
  try{await old.backup(backup);}finally{old.close();}
  process.env.DB_PATH=source;
  const {db}=require('./db');
  const {retireSampleThree}=require('./variant-history');
  const result=retireSampleThree(db);
  console.log(JSON.stringify({backup,result,notice:'Historic ordered/stocked SKUs archived; old subscriptions remain inactive; 5ml created only through verified pricing.'}));
})().catch(error=>{console.error('Maintenance failed:',error.message);process.exitCode=1;});
