'use strict';
const a=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8');
const match=source.match(/function isGenericProductImage\(url\) \{[\s\S]*?\n\}/);a(match);
const context={};vm.runInNewContext(match[0]+';this.check=isGenericProductImage',context);
for(const ext of ['.jpg','.webp','-sm.jpg','-sm.webp']){const p=path.join(root,'public/images/products','generic-neutral-7'+ext);a(fs.existsSync(p),p);a(context.check('/images/products/generic-neutral-7'+ext));}
a(!context.check('/images/products/generic-neutral-8.jpg'));console.log('PASS seventh symbolic image variants and disclosure recognition');
