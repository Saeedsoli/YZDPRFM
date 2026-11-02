'use strict';
// Correct an untouched seed name only; keep owner edits and old search aliases.
const KEY='hugo_versus_name_2026_11_v1';
function apply(db){return db.transaction(()=>{
 if(db.prepare('select value from settings where key=?').get(KEY))return {reason:'already_applied'};
 const updated=db.prepare("update products set name_fa=?,search_blob=NULL where id=? and slug=? and brand_en=? and name_en=? and name_fa=?").run('هوگو من (ورسوز)','YZD-PROD-1801','hugo-boss-hugo-man','Hugo Boss','HUGO BOSS - Hugo Man','سبز').changes;
 const result={updated};db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify(result));return result;
})();}
module.exports={apply,KEY};
