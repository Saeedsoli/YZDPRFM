'use strict';

const fs=require('fs'),path=require('path');
const args=process.argv.slice(2);
if (args.length!==3 || args[0]!=='--apply' || args[1]!=='--backup') {
  console.error('Usage: DB_PATH=/path/to/store.db node scripts/apply_supplier_prices.js --apply --backup /path/to/new-backup.db');
  process.exit(2);
}
const source=path.resolve(process.env.DB_PATH || path.join(__dirname,'../data/yazd.db'));
const backup=path.resolve(args[2]);
if (!fs.existsSync(source)) { console.error('Existing database required:',source); process.exit(2); }
if (fs.existsSync(backup) || source===backup) { console.error('Backup path must not already exist or equal the source'); process.exit(2); }
(async()=>{
  fs.mkdirSync(path.dirname(backup),{recursive:true});
  const Database=require('better-sqlite3');
  const old=new Database(source,{readonly:true,fileMustExist:true});
  try {await old.backup(backup);} finally {old.close();}
  process.env.DB_PATH=source;
  const {db}=require('../src/db');
  const {importSupplierPrices}=require('../src/import-supplier-prices');
  const data=require('../seed/supplier_exact_prices_staged.json');
  const result=importSupplierPrices(db,data);
  console.log(JSON.stringify({backup,result,notice:'Availability unchanged; manual review of lexical matches required.'}));
})().catch(err=>{console.error('Supplier import failed:',err.message);process.exitCode=1;});
