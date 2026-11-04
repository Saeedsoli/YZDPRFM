'use strict';
const assert=require('assert/strict'),t=require('../src/shop-time');
assert.equal(t.dateKey(Date.parse('2026-11-03T20:29:59Z')),'2026-11-03');
assert.equal(t.dateKey(Date.parse('2026-11-03T20:30:00Z')),'2026-11-04');
assert(t.validDateKey('2024-02-29'));assert(!t.validDateKey('2025-02-29'));assert(!t.validDateKey('2026-11-31'));
for(const x of ['',null,'2026-1-1','2026-11-04T00:00:00Z'])assert(!t.validDateKey(x));
console.log('PASS shop date boundaries, Tehran midnight and invalid date rejection');
