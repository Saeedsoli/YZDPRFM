'use strict';
const Database=require('better-sqlite3'),path=require('path'),fs=require('fs');
const file=process.argv[2];if(!file||!fs.existsSync(file))throw Error('Existing database path required');
const db=new Database(file,{fileMustExist:true});db.pragma('foreign_keys = ON');
try{console.log(JSON.stringify(require('../src/owner-reference-import-v3').applyOwnerReferences(db,path.join(__dirname,'../seed/owner_reference_selection_v3.json'))));}finally{db.close();}
