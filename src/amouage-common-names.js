'use strict';
// Exact seed spellings only; preserve edits. Search keeps older spellings too.
const KEY='amouage_common_names_2026_11_v1';
const ITEMS=[['YZD-PROD-0543','amouage-memoir-man','مموار مردانه','ممویر مردانه'],['YZD-PROD-0553','amouage-honour-woman','هانر زنانه','آنر زنانه']];
function apply(db){return db.transaction(()=>{
 if(db.prepare('select value from settings where key=?').get(KEY))return {reason:'already_applied'};
 const update=db.prepare("update products set name_fa=?,search_blob=NULL where id=? and slug=? and brand_en='Amouage' and name_fa=?");
 let updated=0;for(const [id,slug,oldName,newName] of ITEMS)updated+=update.run(newName,id,slug,oldName).changes;
 const result={updated};db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify(result));return result;
})();}
module.exports={apply,KEY};
