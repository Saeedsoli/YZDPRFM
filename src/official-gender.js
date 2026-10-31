'use strict';
// Official classification of the reference fragrance, applied only to unchanged,
// unavailable products. It does not restrict who can wear any perfume.
const fs=require('fs');
function applyOfficialGender(db,file) {
  if (!fs.existsSync(file)) return {updated:0,skipped:0,reason:'file_missing'};
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if (!/^official_gender_\d{4}_\d{2}_v[1-9]\d*$/.test(data.version||'') || !Array.isArray(data.items) || !data.items.length) throw new Error('Invalid official gender manifest');
  const ids=new Set();
  for(const x of data.items) {
    if(!x.product_id || !x.product_slug || ids.has(x.product_id) || !['MEN','WOMEN','UNISEX'].includes(x.expected_old_gender) || !(x.official_gender === null || ['MEN','WOMEN','UNISEX'].includes(x.official_gender)) || !/^https:\/\/(?:us\.parfums-de-marly\.com\/products|lattafa\.com\/product)\//.test(x.source_url)) throw new Error('Invalid official gender entry');
    ids.add(x.product_id);
  }
  return db.transaction(()=>{
    if(db.prepare('SELECT value FROM settings WHERE key=?').get(data.version)) return {updated:0,skipped:0,reason:'already_applied'};
    const update=db.prepare("UPDATE products SET gender=?,search_blob=NULL WHERE id=? AND slug=? AND gender=? AND supply_mode='UNAVAILABLE'");
    let updated=0;for(const x of data.items)updated+=update.run(x.official_gender,x.product_id,x.product_slug,x.expected_old_gender).changes;
    const result={updated,skipped:data.items.length-updated};
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(data.version,JSON.stringify({...result,at:new Date().toISOString()}));
    return result;
  })();
}
module.exports={applyOfficialGender};
