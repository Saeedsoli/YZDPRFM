'use strict';
const assert=require('assert');
const route=require('../src/routes/account-returns');
(async()=>{
 for(const [env,flag] of [['production','1'],['test',''],['development','1']]){
  process.env.NODE_ENV=env;process.env.RETURNS_API_TEST_ONLY=flag;
  for(const pathname of ['/api/auth/account-returns','/api/admin/account-returns/delivery','/api/admin/account-returns/historical-volume']){
   let code;const handled=await route.handle({pathname,method:'POST',sendJSON:c=>{code=c;}});
   assert(handled);assert.strictEqual(code,404);
  }
 }
 process.env.NODE_ENV='test';process.env.RETURNS_API_TEST_ONLY='1';
 for(const denied of ['orders.status','tickets.reply']){
  const checked=[];let code;
  const handled=await route.handle({pathname:'/api/admin/account-returns/historical-volume',method:'POST',
   can:permission=>{checked.push(permission);if(permission===denied){code=403;return false;}return true;}});
  assert(handled);assert.strictEqual(code,403);assert(checked.includes(denied));
 }
 console.log('PASS account returns API gate closed in production/default; historical confirmation requires both permissions');
})().catch(e=>{console.error(e);process.exitCode=1});
