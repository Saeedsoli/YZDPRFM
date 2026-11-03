'use strict';

// Account-owned return submission and explicitly confirmed delivery time.
// All routes require the relevant verified session or staff permission, and
// remain unavailable until the backup-first return schema is installed.
const store = require('../return-store');
async function handle(ctx) {
  const {method,pathname,req,sendJSON,can,parseBody,db,otp,getCustomerToken,
    rateLimit,ip,RL,who,logAudit,notify,cleanText} = ctx;
  const customerPath='/api/auth/account-returns';
  const adminPath='/api/admin/account-returns/delivery';
  if (pathname!==customerPath && pathname!==adminPath) return false;
  if (method!=='POST') {sendJSON(405,{error:'روش درخواست مجاز نیست.'});return true;}
  if (pathname===adminPath) {
    if(!can('orders.status'))return true;
    if(!store.ready(db)){sendJSON(503,{error:'سامانه مرجوعی هنوز آماده نیست.'});return true;}
    const b=await parseBody(req);
    if(typeof b.order_id!=='string'||b.order_id.length>100||!Number.isSafeInteger(b.delivered_at_ms)||b.delivered_at_ms<=0||b.delivered_at_ms>Date.now()) {
      sendJSON(400,{error:'شماره سفارش و زمان واقعی تحویل معتبر لازم است.'});return true;
    }
    const order=db.prepare('SELECT created_at FROM orders WHERE order_id=?').get(b.order_id);
    const created=order ? Date.parse(order.created_at) : NaN;
    if(!order || !Number.isFinite(created) || b.delivered_at_ms<created){sendJSON(400,{error:'زمان تحویل برای سفارش معتبر نیست.'});return true;}
    const result=store.recordDelivery(db,{orderId:b.order_id,deliveredAtMs:b.delivered_at_ms,recordedBy:who.username});
    if(!result.ok){sendJSON(409,{error:'ثبت زمان تحویل ممکن نیست؛ وضعیت و سوابق سفارش را بررسی کنید.'});return true;}
    logAudit('orders.status',{target:b.order_id,detail:{event:'return_delivery_evidence',delivered_at_ms:b.delivered_at_ms}});
    sendJSON(201,{message:'زمان تحویل ثبت شد.'});return true;
  }
  const mobile=otp.mobileFromToken(getCustomerToken(req));
  if(!mobile){sendJSON(401,{error:'ابتدا شماره موبایل خود را تأیید کنید.'});return true;}
  if(!store.ready(db)){sendJSON(503,{error:'سامانه مرجوعی هنوز آماده نیست.'});return true;}
  const limited=rateLimit(`return-request:${ip}`,RL.ticket.limit,RL.ticket.window,RL.ticket.block);
  if(!limited.ok){sendJSON(429,{error:'درخواست‌های بیش از حد؛ بعداً تلاش کنید.'});return true;}
  const b=await parseBody(req);
  const description=typeof b.description==='string' ? cleanText(b.description,2001) : '';
  if(b.safe_storage_confirmed!==true){sendJSON(400,{error:'شرایط نگهداری محصول باید تأیید شود.',reason:'INVALID_INPUT'});return true;}
  // store.submit rechecks eligibility under this same transaction. Ticket and
  // request either both persist or both roll back; no guessed item/owner data.
  const result=db.transaction(()=>{
    const r=store.submit(db,{verifiedMobile:mobile,itemId:b.item_id,quantity:b.quantity,
      description,usedUnder2ml:b.used_under_2ml});
    if(!r.ok)return r;
    const item=db.prepare(`SELECT i.order_id,i.product_name,e.volume_ml FROM order_items i
      JOIN return_item_evidence e ON e.item_id=i.id WHERE i.id=?`).get(b.item_id);
    const now=Date.now();
    db.prepare(`INSERT INTO tickets(ticket_id,order_id,product_name,volume_ml,used_under_2ml,reason,description,status,created_at,sla_deadline,mobile)
      VALUES(?,?,?,?,1,?,?,'NEW_PENDING',?,?,?)`).run(r.requestId,item.order_id,item.product_name,item.volume_ml,
        `درخواست حساب کاربری؛ تعداد ${b.quantity}؛ شرایط نگهداری تأیید شد`,`تعداد: ${b.quantity}\n${description}`,new Date(now).toISOString(),new Date(now+86400000).toISOString(),mobile);
    return r;
  }).immediate();
  if(!result.ok){
    const status=result.reason==='OWNER_REQUIRED'||result.reason==='ITEM_UNAVAILABLE'?404:400;
    sendJSON(status,{error:'ثبت درخواست برای این کالا ممکن نیست؛ شرایط و مهلت را بررسی کنید.',reason:result.reason==='OWNER_REQUIRED'||result.reason==='ITEM_UNAVAILABLE'?'ITEM_UNAVAILABLE':result.reason});return true;
  }
  notify.ticketReceived({ticket_id:result.requestId},mobile).catch(()=>{});
  require('../alerts').fireAsync('newTicket',{ticket_id:result.requestId});
  sendJSON(201,{request_id:result.requestId,message:'درخواست ثبت شد و بررسی می‌شود.'});return true;
}
module.exports={handle};
