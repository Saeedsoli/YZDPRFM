'use strict';

const a=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/login.html'),'utf8');
const x=html.indexOf('function safeReturnTo(raw) {'),y=html.indexOf('\nconst RETURN_TO',x);a(x>=0&&y>x);
const ctx={URL,location:{origin:'https://shop.example.test'}};vm.runInNewContext(html.slice(x,y)+'\nthis.safe=safeReturnTo;',ctx);
for(const value of ['javascript:alert(1)','https://evil.example/path','//evil.example','/\\evil.example','/\n//evil.example','data:text/html,bad'])a.equal(ctx.safe(value),'/account',value);
a.equal(ctx.safe('/checkout?gift=1'),'/checkout?gift=1');a.equal(ctx.safe('/wishlist'),'/wishlist');
a.equal(new URL(ctx.safe('/%2f%2fevil.example'),'https://shop.example.test').origin,'https://shop.example.test');
console.log('PASS customer login only redirects within the current origin');
