#!/usr/bin/env node
'use strict';
// These tests use manifest copies only; no real DB is opened or changed.
const assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..');
const manifest=require('../seed/reference_accord_display_v1.json');
const {referenceAccords}=require('../src/reference-accord-display');
assert.equal(manifest.items.length,89);
const seen=new Set();
for(const x of manifest.items){
  assert(!seen.has(x.product_id));seen.add(x.product_id);
  assert.equal(new URL(x.source_url).protocol,'https:');
  assert(/^(?:official_note_corrections_v\d+|active_official_note_corrections_v\d+|official_supplement_v\d+|supplier_verified_supplement|secondary_supplement_v\d+|secondary_note_corrections_v\d+)\.json$/.test(x.source_manifest));
  assert.equal(x.source_kind,x.source_manifest.startsWith('secondary_')?'independent':'official_candidate');
  const src=require(path.join(root,'seed',x.source_manifest));
  const entries=Array.isArray(src)?src:src.items;
  const item=entries.find(i=>(i.product_id||i.id)===x.product_id);
  assert(item);assert.equal(item.source_url,x.source_url);
  assert.deepStrictEqual(item.verified_accords ?? item.accords,x.accords);
  const row={id:x.product_id,slug:x.slug,name_en:x.name_en,brand_en:x.brand_en,concentration:x.concentration,supply_mode:'MADE_TO_ORDER',accords:JSON.stringify(x.accords)};
  assert.deepStrictEqual(referenceAccords(row),x.accords);
  for(const changed of [{slug:'changed'},{name_en:'changed'},{brand_en:'changed'},{concentration:'changed'},{supply_mode:'UNAVAILABLE'},{accords:'["changed"]'},{accords:'bad json'}]) assert.deepStrictEqual(referenceAccords({...row,...changed}),[]);
}
assert.deepStrictEqual(referenceAccords({id:'unknown',supply_mode:'MADE_TO_ORDER'}),[]);
console.log('PASS 89 scoped reference accord records, source manifests and identity/change/availability guards');
