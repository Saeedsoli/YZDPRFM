'use strict';
// Versioned one-time correction: only overwrite untouched seed notes, never prices or orders.
const fs=require('fs');
const MARKER='official_notes_2026_10_v1'; // legacy export for integrations
function applyOfficialNotes(db,file) {
  if (!fs.existsSync(file)) return {updated:0,skipped:0,reason:'file_missing'};
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if (!/^official_notes_\d{4}_\d{2}_v[1-9]\d*$/.test(data.version || '') || !Array.isArray(data.items) || data.items.length===0) throw new Error('Invalid official notes manifest');
  const marker=data.version;
  const ids=new Set();
  for (const item of data.items) {
    if (!item.product_id || !item.product_slug || !/^https:\/\/(www\.creedfragrance\.com|us\.parfums-de-marly\.com|www\.byredo\.com|www\.xerjoff\.com|www\.montblanc\.com|ortoparisi\.com)\//.test(item.source_url) || ids.has(item.product_id)) throw new Error('Invalid official notes entry');
    ids.add(item.product_id);
    for(const key of ['top','middle','base']) {
      if(!Array.isArray(item.expected_old_notes?.[key]) || !Array.isArray(item.verified_notes?.[key])) throw new Error('Invalid note list');
      if(!item.verified_notes[key].every(s=>typeof s==='string' && s.trim() && s.length<=60)) throw new Error('Invalid verified note');
    }
  }
  return db.transaction(()=>{
    if(db.prepare('SELECT value FROM settings WHERE key=?').get(marker))return {updated:0,skipped:0,reason:'already_applied'};
    const get=db.prepare('SELECT id,slug,notes_top,notes_middle,notes_base FROM products WHERE id=?');
    const update=db.prepare('UPDATE products SET notes_top=?,notes_middle=?,notes_base=?,search_blob=NULL WHERE id=?');
    let updated=0,skipped=0;
    for(const item of data.items) {
      const row=get.get(item.product_id);
      if(!row || row.slug!==item.product_slug) { skipped++; continue; }
      let unchanged;
      try {unchanged=['top','middle','base'].every(k=>JSON.stringify(JSON.parse(row['notes_'+k]||'[]'))===JSON.stringify(item.expected_old_notes[k]));}
      catch {unchanged=false;}
      if(!unchanged){skipped++;continue;}
      update.run(JSON.stringify(item.verified_notes.top),JSON.stringify(item.verified_notes.middle),JSON.stringify(item.verified_notes.base),item.product_id);updated++;
    }
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,JSON.stringify({at:new Date().toISOString(),updated,skipped}));
    return {updated,skipped};
  })();
}
module.exports={applyOfficialNotes,MARKER};
