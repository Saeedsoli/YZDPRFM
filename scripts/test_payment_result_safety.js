'use strict';
// Query strings alone can neither assert payment nor clear a current basket.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'../public/payment-result.html'),'utf8');
const start=html.indexOf('const query = new URLSearchParams(location.search);'),end=html.indexOf('\n</script>',start);assert(start>=0&&end>start);
const code=html.slice(start,end).replace('renderPaymentResult();','this.done=renderPaymentResult();');
const escape=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
async function scenario(query,storage,response,fail=false){
 let cleared=0,calls=0;const card={innerHTML:''};
 const ctx={URLSearchParams,location:{search:query},sessionStorage:{getItem:k=>storage[k]||null},document:{getElementById:()=>card},esc:escape,encodeURIComponent,YazdCart:{clear(){cleared++}},fetch:async()=>{calls++;if(fail)throw Error('offline');return {ok:response.ok,json:async()=>response.body}}};
 vm.runInNewContext(code,ctx);await ctx.done;return {cleared,calls,html:card.innerHTML};
}
(async()=>{
 const oid='YZD-TEST-ABC123',same={yazd_last_mobile:'09120001111',yazd_last_order:oid};
 for(const x of [await scenario('?ok=1&order='+oid,{},null),await scenario('?ok=1&order='+oid,same,{ok:true,body:{orders:[]}}),await scenario('?ok=1&order='+oid,same,{ok:false,body:{}}),await scenario('?ok=1&order='+oid,same,null,true)]){
  assert.equal(x.cleared,0);assert(!x.html.includes('پرداخت با موفقیت'));assert(x.html.includes('در حال بررسی'));
 }
 for(const status of ['PENDING','VERIFYING']){const x=await scenario('?ok=1&order='+oid,same,{ok:true,body:{orders:[{order_id:oid,status}]}});assert.equal(x.cleared,0);assert(!x.html.includes('پرداخت با موفقیت'));}
 const good=await scenario('?ok=0&order='+oid,same,{ok:true,body:{orders:[{order_id:oid,status:'PAID'}]}});assert.equal(good.cleared,1);assert(good.html.includes('پرداخت با موفقیت'));
 const old=await scenario('?ok=1&order='+oid,{...same,yazd_last_order:'OTHER'},{ok:true,body:{orders:[{order_id:oid,status:'PAID'}]}});assert.equal(old.cleared,0);assert(old.html.includes('پرداخت با موفقیت'));
 const other=await scenario('?ok=1&order='+oid,same,{ok:true,body:{orders:[{order_id:'OTHER',status:'PAID'}]}});assert.equal(other.cleared,0);assert(!other.html.includes('پرداخت با موفقیت'));
 const cancelled=await scenario('?ok=1&order='+oid,same,{ok:true,body:{orders:[{order_id:oid,status:'CANCELLED'}]}});assert(!cancelled.html.includes('کسر نشده'));assert.equal(cancelled.cleared,0);
 const attack=await scenario('?ok=1&order='+encodeURIComponent('<img src=x onerror=alert(1)>')+'&msg='+encodeURIComponent('<svg onload=alert(1)>')+'&ref='+encodeURIComponent('<img src=x>'),same,{ok:true,body:{orders:[]}});
 assert(!attack.html.includes('<img')&&!attack.html.includes('<svg onload')&&attack.cleared===0&&attack.calls===0);
 console.log('PASS payment result uses server status, preserves unrelated carts and ignores unsafe query text');
})().catch(e=>{console.error(e);process.exitCode=1});
