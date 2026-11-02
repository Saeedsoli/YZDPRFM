'use strict';
// The demonstration UI must not claim success on errors or clear the cart.
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/payment-sandbox.html'),'utf8');
const a=html.indexOf('async function finish(result) {'),b=html.indexOf('\n\nrenderGate();',a);assert(a>=0&&b>a);
const code=html.slice(a,b)+'\nthis.invoke=finish;';
async function scenario(result,response,throws=false){
 let cleared=0,msg='',element={innerHTML:''};
 const ctx={orderId:'fixture-order',esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;'),YazdCart:{clear(){cleared++}},toast(x){msg=x},document:{getElementById(){return element}},fetch:async()=>{if(throws)throw Error('fixture offline');return {ok:response.ok,json:async()=>response.body}}};
 vm.runInNewContext(code,ctx);await ctx.invoke(result);return {cleared,msg,html:element.innerHTML};
}
(async()=>{
 for(const reply of [{ok:false,body:{error:'blocked'}},{ok:true,body:{failed:true}},{ok:true,body:{message:'unexpected'}}]){const x=await scenario('success',reply);assert.equal(x.cleared,0);assert(!x.html.includes('پرداخت با موفقیت'));assert(x.msg);}
 const x=await scenario('success',null,true);assert.equal(x.cleared,0);assert(x.msg);
 const y=await scenario('cancel',{ok:false,body:{error:'blocked'}});assert(!y.html.includes('موجودی بازگردانده'));
 const good=await scenario('success',{ok:true,body:{payment_ref:'SBX-TEST'}});assert.equal(good.cleared,1);assert(good.html.includes('پرداخت با موفقیت'));
 console.log('PASS sandbox UI never shows fake success/cancellation or clears cart on error');
})().catch(e=>{console.error(e);process.exitCode=1});
