'use strict';
const assert=require('assert/strict');
const d=require('../public/assets/persian-date');
for(const [iso,y,m,day] of [
 ['2024-03-20',1403,1,1],['2025-03-20',1403,12,30],['2025-03-21',1404,1,1],
 ['2026-03-20',1404,12,29],['2026-03-21',1405,1,1],['2026-11-04',1405,8,13]]){
 assert.deepEqual(d.toPersian(iso),{year:y,month:m,day});assert.equal(d.toISO(y,m,day),iso);
}
assert.equal(d.toISO(1404,12,30),null);assert.equal(d.toISO(1403,12,30),'2025-03-20');
assert.equal(d.toISO(1405,7,31),null);assert.equal(d.toISO(1405,6,31),'2026-09-22');
assert.equal(d.toPersian('2026-02-30'),null);assert.equal(d.formatDate('nonsense'),'—');
assert.equal(d.formatDate(1e100),'—');assert(!d.setClock(1e100));assert(!d.setClock(-1));
assert.equal(d.formatDate('2026-11-04'),'۱۳ / ۰۸ / ۱۴۰۵');
assert.equal(d.formatDate('2026-11-03T21:00:00Z'),'۱۳ / ۰۸ / ۱۴۰۵');
assert.equal(d.formatDateTime('2026-11-03 21:00:00'),'۱۳ / ۰۸ / ۱۴۰۵، ۰۰:۳۰');
for(let year=1398;year<=1410;year++)for(let month=1;month<=12;month++)for(let day=1;day<=31;day++){
 const iso=d.toISO(year,month,day);if(iso)assert.deepEqual(d.toPersian(iso),{year,month,day});
}
console.log('PASS Persian conversion, leap days, Tehran midnight, invalid input and 13-year roundtrips');
