'use strict';

const Database=require('better-sqlite3'),path=require('path'),fs=require('fs');
const file=process.argv[2];
if(!file||!fs.existsSync(file))throw Error('Existing database path required');
const db=new Database(file,{fileMustExist:true});db.pragma('foreign_keys = ON');
try{console.log(JSON.stringify(require('../src/generic-scent-import').applyGenericScents(db,path.join(__dirname,'../seed/generic_scent_owner_approved_v1.json'))));}finally{db.close();}
