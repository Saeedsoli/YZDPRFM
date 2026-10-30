'use strict';
const assert=require('assert/strict');
const {priceFromUsdPerKg:p}=require('../src/essence-pricing');
assert.equal(p('286','300000','EDP',100),5148000);
assert.equal(p('286','300000','BODY_SPLASH',120),1287000);
assert.equal(p('286','300000','SAMPLE',5),257000);
assert.equal(p('709.5','300000','EDP',100),12771000);
assert.equal(p('314.6','300000','EDP',10),566000);
assert.equal(p('100','300000','EDP',10),180000);
assert.equal(p('100','300000','EDP',30),540000);
assert.equal(p('100','300000','EDP',50),900000);
assert.equal(p('100','300000','EDP',100),1800000);
assert.equal(p('1','250000','EDP',10),2000); // exact 1500 -> half up
assert.throws(()=>p('0','300000','EDP',100));
assert.throws(()=>p('100','0','EDP',100));
assert.throws(()=>p('100','300000','BODY_SPLASH',150));
assert.throws(()=>p('100','300000','HAIR_MIST',150));
assert.throws(()=>p('nan','300000','EDP',100));
console.log('15 pricing arithmetic checks passed; module is not integrated.');
