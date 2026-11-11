'use strict';
// Illustrations 1..8 must all be recognised as symbolic (studio-dark series).
const a=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8');
const match=source.match(/function isGenericProductImage\(url\) \{[\s\S]*?\n\}/);a(match);
const context={};vm.runInNewContext(match[0]+';this.check=isGenericProductImage',context);
const dir=path.join(root,'public/images/products');
for(let i=1;i<=8;i++)for(const ext of ['.jpg','.webp','-sm.jpg','-sm.webp']){
  a(fs.existsSync(path.join(dir,`studio-dark-${i}${ext}`)),`studio-dark-${i}${ext}`);
  a(context.check(`/images/products/studio-dark-${i}${ext}`),`studio-dark-${i}${ext} recognised`);
}
a(!context.check('/images/products/studio-dark-9.jpg'));
a(!context.check('/images/products/ordinary.jpg'));
console.log('PASS eight symbolic illustration variants and disclosure recognition');
