'use strict';

const KEY='joop_duplicate_name_2026_11_v1';
const ITEMS=[['SUP-TP-910040','joop-nightflight-original','جوپ نایت فلایت','نایت فلایت'],['SUP-TP-910041','joop-homme-original','جوپ هوم','هوم']];
function apply(db){return db.transaction(()=>{
 if(db.prepare('select value from settings where key=?').get(KEY))return {reason:'already_applied'};
 const find=db.prepare('select slug,brand_en,name_fa from products where id=?');
 const update=db.prepare('update products set name_fa=?,search_blob=NULL where id=? and slug=? and brand_en=? and name_fa=?');
 let updated=0,already=0;const skipped=[];
 for(const [id,slug,oldName,newName] of ITEMS){const p=find.get(id);
  if(p&&p.slug===slug&&p.brand_en==='Joop!'&&p.name_fa===newName){already++;continue;}
  if(p&&p.slug===slug&&p.brand_en==='Joop!'&&p.name_fa===oldName){updated+=update.run(newName,id,slug,'Joop!',oldName).changes;continue;}
  skipped.push(id);
 }
 const result={updated,already,skipped};db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify(result));return result;
})();}
module.exports={apply,KEY};
