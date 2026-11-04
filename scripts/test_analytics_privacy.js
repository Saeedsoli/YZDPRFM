'use strict';
const assert=require('assert/strict'),a=require('../src/analytics');
for(const value of ['09120001111','۰۹۱۲ ۰۰۰ ۱۱۱۱','+98 (912) 000-1111','name@example.test','198.51.100.9','2001:db8::1'])assert(a.containsContact(value),value);
for(const value of ['رایحه گل سرخ','CREED-AVENTUS','YZD-0001-EDP-030'])assert(!a.containsContact(value),value);
assert.deepEqual(JSON.parse(a.safeMeta('search',{results:4,relaxed:true,mobile:'09120001111',address:'private'})),{results:4,relaxed:true});
assert.deepEqual(JSON.parse(a.safeMeta('purchase',{qty:2,order:'PRIVATE-ORDER'})),{qty:2});
assert.equal(a.safeMeta('view',{phone:'09120001111'}),null);
const rows=[];const db={prepare:()=>({run:(...x)=>rows.push(x)})};const api=a.build(db,()=>{},()=> '198.51.100.9');const req={headers:{'user-agent':'TestBrowser'}};
assert(!api.track('search','۰۹۱۲ ۰۰۰ ۱۱۱۱',{results:0},req));assert(!api.track('search','name@example.test',{results:0},req));
assert(api.track('search','گل سرخ',{results:0,relaxed:false,email:'name@example.test'},req));
assert(api.track('purchase','PRODUCT-1',{order:'PRIVATE-ORDER',qty:2},req));
assert.equal(rows.length,2);const fields=JSON.stringify(rows.map(r=>r.slice(0,3)));
for(const secret of ['09120001111','name@example.test','198.51.100.9','PRIVATE-ORDER'])assert(!fields.includes(secret),secret);
assert(rows.every(r=>/^[a-f0-9]{16}$/.test(r[3])));
// A valid 16-hex digest can coincidentally include 11 phone-like digits.
// The privacy test must not mistake this digest for a stored raw phone field.
const fakeDigest='09123456789abcde';assert(/^[a-f0-9]{16}$/.test(fakeDigest)&&/09\d{9}/.test(fakeDigest));
console.log('PASS analytics contact-pattern rejection, metadata whitelist and raw-identifier minimization');
