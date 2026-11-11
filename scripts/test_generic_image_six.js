'use strict';
// The sixth approved-style illustration must be treated as symbolic everywhere.
const a=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8');
const match=src.match(/function isGenericProductImage\(url\)\s*\{[\s\S]*?\n\}/);a(match,'helper missing');
const isGeneric=vm.runInNewContext('('+match[0]+')');
for(const ext of ['.jpg','.webp','-sm.jpg','-sm.webp']){const p=path.join(root,'public/images/products','generic-neutral-6'+ext);a(fs.existsSync(p),p);a(isGeneric('/images/products/generic-neutral-6'+ext));}
a(!isGeneric('/images/products/ordinary.jpg'));
// legacy neutral images must stay recognised for older rows and cached pages
for(let i=1;i<=7;i++)a(isGeneric(`/images/products/generic-neutral-${i}.jpg`),String(i));for(const f of ['index.html','product.html','samples.html','wishlist.html','cart.html','quiz.html','review-invite.html'])a(fs.readFileSync(path.join(root,'public',f),'utf8').includes('isGenericProductImage'),f);
const generic=require('../src/generic-product-images');a.match(generic.genericFor('SUP-CH-900005',{items:[]}),/\/images\/products\/studio-dark-[1-8]\.jpg$/);console.log('PASS sixth symbolic image assets and disclosure helper');
