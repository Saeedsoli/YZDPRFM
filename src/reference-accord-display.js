'use strict';

const manifests = [require('../seed/reference_accord_display_v1.json'),require('../seed/reference_accord_display_v2.json'),require('../seed/reference_accord_display_v3.json'),require('../seed/reference_accord_display_v4.json')];
const records = new Map();
for (const [i,manifest] of manifests.entries()) {
 if (manifest.version !== `reference_accord_display_2026_11_v${i+1}` || !Array.isArray(manifest.items)) throw Error('Invalid reference accord display manifest');
 for (const x of manifest.items) {
  if (!x.product_id || records.has(x.product_id) || !Array.isArray(x.accords) || !x.accords.length || !x.accords.every(v=>typeof v==='string' && v.trim())) throw Error('Invalid reference accord display entry');
  records.set(x.product_id,x);
 }
}
function referenceAccords(row) {
  const x=records.get(row.id);
  if (!x || !['MADE_TO_ORDER','IN_STOCK'].includes(row.supply_mode) || row.slug!==x.slug || row.name_en!==x.name_en || row.brand_en!==x.brand_en || row.concentration!==x.concentration) return [];
  let current;try { current=JSON.parse(row.accords || '[]'); } catch { return []; }
  return JSON.stringify(current)===JSON.stringify(x.accords) ? [...x.accords] : [];
}
module.exports={referenceAccords};
