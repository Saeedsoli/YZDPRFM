'use strict';

const fs=require('fs'),path=require('path');
const KEY='popular_persian_names_2026_11_v1';
function apply(db){
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'../seed/popular_persian_names_v1.json'),'utf8'));
 if(m.version!==KEY||m.brand_items.length!==21||m.name_items.length!==3)throw Error('Invalid Persian name manifest');
 return db.transaction(()=>{
  if(db.prepare('select 1 from settings where key=?').get(KEY))return {reason:'already_applied'};
  const brand=db.prepare("update products set brand_fa='ژان پل گوتیه',search_blob=NULL where id=? and slug=? and brand_en='Jean Paul Gaultier' and brand_fa='ژان پل گالتیه'");
  const name=db.prepare('update products set name_fa=?,search_blob=NULL where id=? and slug=? and name_fa=?');
  let brands=0,names=0;for(const x of m.brand_items)brands+=brand.run(x.id,x.slug).changes;for(const x of m.name_items)names+=name.run(x.new,x.id,x.slug,x.old).changes;
  const result={brands,names};db.prepare('insert into settings(key,value) values(?,?)').run(KEY,JSON.stringify(result));return result;
 })();
}
module.exports={apply,KEY};
