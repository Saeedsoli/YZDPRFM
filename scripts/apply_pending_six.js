'use strict';
// Explicit, all-or-nothing migration; operator must back up the offline DB first.
const Database=require('better-sqlite3'),path=require('path'),fs=require('fs');
const file=process.argv[2];if(!file||!fs.existsSync(file))throw Error('Existing database path required');
const db=new Database(file,{fileMustExist:true});db.pragma('foreign_keys = ON');
try{
 const result=db.transaction(()=>({
  generic:require('../src/generic-scent-import-v2').applyGenericScents(db,path.join(__dirname,'../seed/generic_scent_owner_approved_v2.json')),
  boss:require('../src/owner-reference-import-v3').applyOwnerReferences(db,path.join(__dirname,'../seed/owner_reference_selection_v3.json'))
 }))();console.log(JSON.stringify(result));
}finally{db.close();}
