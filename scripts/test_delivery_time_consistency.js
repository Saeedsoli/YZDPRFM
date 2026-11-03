'use strict';
// No database or real SMS required. Verify user-facing promised time wording.
const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');const get=f=>fs.readFileSync(path.join(root,f),'utf8');
const product=get('public/product.html'),footer=get('public/assets/app.js'),terms=get('public/terms.html'),sandbox=get('public/payment-sandbox.html');
assert(product.includes('به سفارش ساخته می‌شود — تحویل ۳ تا ۷ روز کاری پس از تأیید پرداخت'));
assert(product.includes('تحویل با پست یا تیپاکس ۳ تا ۷ روز کاری پس از تأیید پرداخت'));
assert(!product.includes('آماده‌سازی ۳ تا ۷ روز کاری'));
assert(footer.includes('زمان تحویل: ۳ تا ۷ روز کاری پس از تأیید پرداخت'));
assert(terms.includes('۳ تا ۷ روز کاری</strong> پس از تأیید پرداخت'));
assert(sandbox.includes('زمان تحویل سفارش ۳ تا ۷ روز کاری پس از تأیید پرداخت است'));
const sms=require('../src/sms');const messages=[];sms.send=async(mobile,text)=>{messages.push(text);return {ok:true}};
const notify=require('../src/notify');
(async()=>{
 const order={mobile:'09120000000',order_id:'TEST',total_paid:1000,tracking_code:'T1',carrier:'Post'};
 assert(await notify.orderPaid(order));assert(await notify.statusChanged(order,'SHIPPED'));
 assert(messages[0].includes('زمان تحویل سفارش ۳ تا ۷ روز کاری پس از تأیید پرداخت است'));
 assert(messages[1].includes('زمان تحویل مطابق بازه اعلام‌شده هنگام ثبت سفارش است'));
 assert(!messages[1].includes('۳ تا ۷ روز کاری'));
 console.log('PASS one consistent delivery window from payment; SMS mocked');
})().catch(e=>{console.error(e);process.exitCode=1});
