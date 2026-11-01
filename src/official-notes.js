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
    if (!item.product_id || !item.product_slug || !/^https:\/\/(www\.azzaro\.com|www\.narcisorodriguezparfums\.com|www\.dior\.com|www\.tomfordbeauty\.com|us\.bdkparfums\.com|us\.marcantoinebarrois\.com|www\.chanel\.com|us\.viktor-rolf\.com|www\.dunhill\.com|us\.burberry\.com|www\.creedfragrance\.com|us\.parfums-de-marly\.com|www\.byredo\.com|www\.xerjoff\.com|www\.montblanc\.com|ortoparisi\.com|www\.yslbeautyus\.com|www\.versace\.com|lattafa\.com|www\.bulgari\.com|www\.escentric\.com|www\.lancome-usa\.com|www\.bykilian\.com|www\.carolinaherrera\.com|nasomatto\.com|amouage\.com|www\.giorgioarmanibeauty-usa\.com|www\.givenchybeauty\.com|us\.initioparfums\.com|tizianaterenzi\.com|inter\.mugler\.com|www\.penhaligons\.com|www\.franciskurkdjian\.com|us\.memoparis\.com|www\.parfumscaron\.com|us\.clivechristian\.com|bentley-fragrances\.com|us\.lalique\.com)\//.test(item.source_url) || ids.has(item.product_id)) throw new Error('Invalid official notes entry');
    ids.add(item.product_id);
    for(const key of ['top','middle','base']) {
      if(!Array.isArray(item.expected_old_notes?.[key]) || !Array.isArray(item.verified_notes?.[key])) throw new Error('Invalid note list');
      if(!item.verified_notes[key].every(s=>typeof s==='string' && s.trim() && s.length<=60)) throw new Error('Invalid verified note');
    }
    if (item.requires_unavailable !== undefined && typeof item.requires_unavailable !== 'boolean') throw new Error('Invalid availability guard');
    if (item.expected_name_en !== undefined && (typeof item.expected_name_en !== 'string' || !item.expected_name_en.trim())) throw new Error('Invalid name guard');
    if (item.expected_old_notice !== undefined || item.verified_notice !== undefined) {
      if (typeof item.expected_old_notice !== 'string' || typeof item.verified_notice !== 'string' || !item.verified_notice.trim()) throw new Error('Invalid transparency notice');
    }
    if (item.expected_old_accords !== undefined || item.verified_accords !== undefined) {
      if (!Array.isArray(item.expected_old_accords) || !Array.isArray(item.verified_accords) ||
          !item.verified_accords.every(s=>typeof s==='string' && s.trim() && s.length<=60))
        throw new Error('Invalid unclassified official notes');
    }
  }
  return db.transaction(()=>{
    if(db.prepare('SELECT value FROM settings WHERE key=?').get(marker))return {updated:0,skipped:0,reason:'already_applied'};
    const get=db.prepare('SELECT id,slug,name_en,notes_top,notes_middle,notes_base,accords,supply_mode,transparency_notice FROM products WHERE id=?');
    const updateNotice=db.prepare('UPDATE products SET transparency_notice=? WHERE id=?');
    const update=db.prepare('UPDATE products SET notes_top=?,notes_middle=?,notes_base=?,search_blob=NULL WHERE id=?');
    const updateWithAccords=db.prepare('UPDATE products SET notes_top=?,notes_middle=?,notes_base=?,accords=?,search_blob=NULL WHERE id=?');
    let updated=0,skipped=0;
    for(const item of data.items) {
      const row=get.get(item.product_id);
      if(!row || row.slug!==item.product_slug || (item.expected_name_en !== undefined && row.name_en!==item.expected_name_en) || (item.requires_unavailable && row.supply_mode!=='UNAVAILABLE') || (item.expected_old_notice !== undefined && row.transparency_notice!==item.expected_old_notice)) { skipped++; continue; }
      let unchanged;
      try {
        unchanged=['top','middle','base'].every(k=>JSON.stringify(JSON.parse(row['notes_'+k]||'[]'))===JSON.stringify(item.expected_old_notes[k]));
        if (item.verified_accords !== undefined)
          unchanged=unchanged && JSON.stringify(JSON.parse(row.accords||'[]'))===JSON.stringify(item.expected_old_accords);
      } catch {unchanged=false;}
      if(!unchanged){skipped++;continue;}
      const values=[JSON.stringify(item.verified_notes.top),JSON.stringify(item.verified_notes.middle),JSON.stringify(item.verified_notes.base)];
      if(item.verified_accords !== undefined) updateWithAccords.run(...values,JSON.stringify(item.verified_accords),item.product_id);
      else update.run(...values,item.product_id);
      if(item.verified_notice !== undefined) updateNotice.run(item.verified_notice,item.product_id);
      updated++;
    }
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,JSON.stringify({at:new Date().toISOString(),updated,skipped}));
    return {updated,skipped};
  })();
}
module.exports={applyOfficialNotes,MARKER};
