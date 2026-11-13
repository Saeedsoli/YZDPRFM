'use strict';

const fs=require('fs'),path=require('path');const file=process.argv[2];
if(!file||!fs.existsSync(file))throw Error('Existing database path required');
process.env.DB_PATH=path.resolve(file);process.env.BACKUP_DISABLED='1';
const layer=require('../src/db');
try{
 const result=layer.db.transaction(()=>{
  const r=require('../src/unverified-seed-accords-cleanup').applyUnverifiedSeedAccordsCleanup(layer.db,path.join(__dirname,'../seed/unverified_seed_accords_cleanup_v1.json'));
  if(r.updated_ids?.length&&!r.reason){layer.buildSearchIndex(false,r.updated_ids);layer.refreshProductNotes(r.updated_ids);}return r;
 })();console.log(JSON.stringify(result));
}finally{layer.db.close();}
