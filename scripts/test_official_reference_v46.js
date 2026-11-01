'use strict';
// This legacy fixture explicitly tests the pre-approval unavailable baseline.
process.env.APPROVED_MTO_AUTOSTART ??= '0';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),m=require('../seed/retracted_weekend_man_reference_v1.json');
const raw=fs.readFileSync(path.join(root,'uploads/لیست_قیمت_عمده.md'));assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),m.supplier_file_sha256);assert.equal(m.items.length,1);assert.match(m.items[0].owner_version_confirmation,/Owner selected Burberry Weekend for Men/);assert.equal(m.items[0].product_id,'YZD-PROD-0343');
let brand='',rows=[];for(const l of raw.toString('utf8').split(/\r?\n/)){if(l.startsWith('## '))brand=l.slice(3).trim();if(!l.startsWith('|'))continue;const c=l.slice(1).replace(/\|\s*$/,'').split('|').map(x=>x.trim());if(c.length===5&&/^\d+(?:\.\d+)?$/.test(c[4]))rows.push({brand,model:c[1],quality:c[3],price:Number(c[4])})}const x=m.items[0],c=rows.filter(z=>z.brand===x.supplier_brand&&z.model===x.supplier_model).sort((a,b)=>b.price-a.price);assert(c.length);assert.equal(c[0].price,Number(x.usd_per_kg));assert.equal(c[0].quality,x.quality);
console.log('PASS archived owner-retracted Weekend Man selection and source row');
