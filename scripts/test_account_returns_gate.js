'use strict';
const assert=require('assert');
const route=require('../src/routes/account-returns');
(async()=>{
 for(const [env,flag] of [['production','1'],['test',''],['development','1']]){
  process.env.NODE_ENV=env;process.env.RETURNS_API_TEST_ONLY=flag;
  for(const pathname of ['/api/auth/account-returns','/api/admin/account-returns/delivery']){
   let code;const handled=await route.handle({pathname,method:'POST',sendJSON:c=>{code=c;}});
   assert(handled);assert.strictEqual(code,404);
  }
 }
 console.log('PASS account returns API gate is closed in production and by default');
})().catch(e=>{console.error(e);process.exitCode=1});
