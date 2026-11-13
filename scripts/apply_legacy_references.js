'use strict';

const fs=require('fs'),path=require('path');const file=process.argv[2];
if(!file||!fs.existsSync(file))throw Error('Existing database path required');
process.env.DB_PATH=path.resolve(file);process.env.BACKUP_DISABLED='1';
const layer=require('../src/db');
try{
 const result=layer.db.transaction(()=>{
  const r=require('../src/legacy-reference-approval').applyLegacyReferenceApproval(layer.db,path.join(__dirname,'../seed/secondary_reference_prices_v28.json'));
  if(r.activated===2&&!r.reason){
   const get=layer.db.prepare('SELECT id,name_fa,name_en,brand_fa,brand_en,gender,concentration,notes_top,notes_middle,notes_base FROM products WHERE id=?');
   const set=layer.db.prepare('UPDATE products SET search_blob=? WHERE id=?');
   const del=layer.db.prepare('DELETE FROM product_notes WHERE product_id=?');
   const ins=layer.db.prepare('INSERT OR IGNORE INTO product_notes(product_id,note,note_key,position) VALUES(?,?,?,?)');
   for(const id of ['YZD-PROD-0145','YZD-PROD-0362']){
    const p=get.get(id),groups=['top','middle','base'].map(k=>[k,JSON.parse(p['notes_'+k])]);
    const sex=p.gender==='MEN'?'مردانه مردونه men':p.gender==='UNISEX'?'مشترک یونیسکس unisex':'زنانه women';
    const blob=[p.name_fa,p.name_en,p.brand_fa,p.brand_en,p.concentration,sex,...groups.flatMap(g=>g[1]),'عطر ادکلن اسانس رایحه بو خوشبو parfum perfume fragrance'].filter(Boolean).join(' ');
    set.run(layer.normalizeFa(blob),id);del.run(id);
    for(const [pos,notes] of groups)for(const n of notes)ins.run(id,n,layer.normalizeFa(n),pos);
   }
  }return r;
 })();console.log(JSON.stringify(result));
}finally{layer.db.close();}
