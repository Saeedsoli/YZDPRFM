'use strict';
const recon=require('../order-reconciliation');
async function handle(ctx){
 const {method,pathname,req,sendJSON,can,parseBody,db,who,cleanText,logAudit}=ctx;
 const payment='/api/admin/reconciliation/payment-review';
 const delivery='/api/admin/reconciliation/delivery-correction';
 if(pathname!==payment&&pathname!==delivery)return false;
 if(method!=='POST'){sendJSON(405,{error:'روش درخواست مجاز نیست.'});return true;}
 if(!can(pathname===payment?'orders.cancel':'orders.status'))return true;
 if(!recon.ready(db)){sendJSON(503,{error:'سامانه رسیدگی هنوز آماده نیست.'});return true;}
 const b=await parseBody(req);
 const note=typeof b.evidence_note==='string'?cleanText(b.evidence_note,501):'';
 const result=pathname===payment
  ?recon.reviewPayment(db,{orderId:b.order_id,evidenceNote:note,reviewedBy:who.username,
    noPaymentConfirmed:b.no_payment_confirmed,linkClosedConfirmed:b.link_closed_confirmed})
  :recon.correctDelivery(db,{orderId:b.order_id,expectedOldMs:b.expected_old_ms,newDeliveredAtMs:b.new_delivered_at_ms,
    evidenceNote:note,correctedBy:who.username});
 if(!result.ok){
  const status=result.reason==='INVALID_INPUT'?400:409;
  sendJSON(status,{error:pathname===payment?'ثبت بررسی ممکن نیست؛ وضعیت و مدارک درگاه را دوباره بررسی کنید.':'اصلاح زمان ممکن نیست؛ وضعیت و مدارک تحویل را دوباره بررسی کنید.'});return true;
 }
 logAudit(pathname===payment?'orders.cancel':'orders.status',{target:b.order_id,detail:{event:pathname===payment?'payment_review_recorded':'delivery_time_corrected'}});
 sendJSON(201,{message:pathname===payment?'بررسی ثبت شد؛ وضعیت پرداخت تغییر نکرد.':'زمان تحویل اصلاح و سابقه ثبت شد.'});return true;
}
module.exports={handle};
