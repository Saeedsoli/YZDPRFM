'use strict';

const a=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8');
const match=src.match(/function isGenericProductImage\(url\)\s*\{[\s\S]*?\n\}/);a(match,'helper missing');
const isGeneric=vm.runInNewContext('('+match[0]+')');
for(const ext of ['.jpg','.webp','-sm.jpg','-sm.webp']){const p=path.join(root,'public/images/products','studio-dark-6'+ext);a(fs.existsSync(p),p);a(isGeneric('/images/products/studio-dark-6'+ext));}
a(!isGeneric('/images/products/ordinary.jpg'));

for(let i=1;i<=7;i++)a(isGeneric(`/images/products/generic-neutral-${i}.jpg`),String(i));
for(const f of ['product.html','samples.html','wishlist.html','cart.html','quiz.html','review-invite.html'])a(fs.readFileSync(path.join(root,'public',f),'utf8').includes('isGenericProductImage'),f);
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8'),cards=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8'),product=fs.readFileSync(path.join(root,'public/product.html'),'utf8');
a(!index.includes('تصویر نمادین است'),'index suggestions should not show the disclosure badge');
a(!cards.includes('card-illustrative')&&cards.includes('isGenericProductImage'),'shared cards must omit the visible badge but keep image classification');
a(product.includes('id="imageDisclosure"'),'only the product page displays the illustrative-image disclosure');
const generic=require('../src/generic-product-images');a.match(generic.genericFor('SUP-CH-900005',{items:[]}),/\/images\/products\/studio-dark-[1-8]\.jpg$/);console.log('PASS sixth symbolic image assets; only product detail displays the disclosure');
