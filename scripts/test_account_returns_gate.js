'use strict';
const assert=require('assert'),Database=require('better-sqlite3');
const route=require('../src/routes/account-returns');
(async()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
 for(const env of ['production','test','development']){
  process.env.NODE_ENV=env;
  let code;
  const customer={pathname:'/api/auth/account-returns',method:'POST',req:{},db,otp:{mobileFromToken:()=>null},getCustomerToken:()=>null,sendJSON:c=>{code=c;}};
  assert(await route.handle(customer));assert.strictEqual(code,401);
  const admin={pathname:'/api/admin/account-returns/delivery',method:'POST',can:()=>{code=403;return false;},sendJSON:c=>{code=c;}};
  assert(await route.handle(admin));assert.strictEqual(code,403);
  code=0;customer.otp.mobileFromToken=()=> '09120001111';assert(await route.handle(customer));assert.strictEqual(code,503);
  code=0;admin.can=()=>true;admin.db=db;assert(await route.handle(admin));assert.strictEqual(code,503);
 }
 db.close();console.log('PASS return endpoints enforce customer/staff authorization and fail closed without schema in all environments');
})().catch(e=>{console.error(e);process.exitCode=1});
