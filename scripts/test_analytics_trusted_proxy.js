'use strict';
const assert=require('assert/strict');
const {createPolicy}=require('../src/client-ip');
const analytics=require('../src/analytics');
function tracker(resolver){
 const rows=[];
 const db={prepare(sql){assert.match(sql,/INSERT INTO events/);return{run:(...args)=>rows.push(args)};}};
 return {api:analytics.build(db,()=>{},resolver),rows};
}
const req=(peer,xff)=>({socket:{remoteAddress:peer},headers:{'x-forwarded-for':xff,'user-agent':'TestBrowser'}});
let t=tracker(createPolicy().clientIP);
assert(t.api.track('view','x',null,req('127.0.0.1','203.0.113.1')));
assert(t.api.track('view','x',null,req('127.0.0.1','203.0.113.2')));
assert.equal(t.rows[0][3],t.rows[1][3],'untrusted XFF changes visitor');
t=tracker(createPolicy('127.0.0.1/32').clientIP);
t.api.track('view','x',null,req('127.0.0.1','198.51.100.1, 203.0.113.7'));
t.api.track('view','x',null,req('127.0.0.1','198.51.100.2, 203.0.113.7'));
t.api.track('view','x',null,req('127.0.0.1','203.0.113.8'));
assert.equal(t.rows[0][3],t.rows[1][3],'leftmost spoof affected visitor');
assert.notEqual(t.rows[1][3],t.rows[2][3],'different clients collapsed');
for(const r of t.rows)assert(!JSON.stringify(r).includes('203.0.113.'),'raw IP stored');
t=tracker();t.api.track('view','x',null,req('127.0.0.1','203.0.113.1'));t.api.track('view','x',null,req('127.0.0.1','203.0.113.2'));assert.equal(t.rows[0][3],t.rows[1][3]);
console.log('PASS analytics uses trusted-proxy policy, rejects spoofed IPs and stores only visitor hashes');
