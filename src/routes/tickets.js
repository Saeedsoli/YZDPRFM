'use strict';

const returnStore = require('../return-store');

async function handle(ctx) {
  const { method, pathname, req, sendJSON, can, parseBody,
          db, cleanText, otp, notify, getCustomerToken,
          rateLimit, ip, RL } = ctx;

  if (method === 'POST' && pathname === '/api/tickets') {
    sendJSON(410, { error: 'ثبت مرجوعی از بخش سفارش‌ها در حساب کاربری انجام می‌شود.' });
    return true;
  }

  if (method === 'GET' && pathname === '/api/tickets') {
    if (!can('tickets.view')) return true;
    sendJSON(200, { tickets: db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all() });
    return true;
  }

  if (method === 'PUT' && pathname.startsWith('/api/tickets/')) {
    if (!can('tickets.reply')) return true;
    const tid = pathname.replace('/api/tickets/', '');
    const b = await parseBody(req);
    const t = db.prepare('SELECT * FROM tickets WHERE ticket_id=?').get(tid);
    if (!t) { sendJSON(404, { error: 'تیکت یافت نشد' }); return true; }

    const returnsReady = returnStore.ready(db);

    if (tid.startsWith('RET-') && !returnsReady) {
      sendJSON(503,{error:'سامانه مرجوعی آماده نیست؛ پاسخ ثبت نشد.'});return true;
    }
    const linked = returnsReady && db.prepare('SELECT status FROM account_return_requests WHERE request_id=?').get(tid);
    if (linked && !['ANSWERED','CLOSED'].includes(b.status || 'ANSWERED')) {
      sendJSON(400,{error:'وضعیت درخواست مرجوعی نامعتبر است.'});return true;
    }
    db.transaction(()=>{
      db.prepare('UPDATE tickets SET reply=?, status=? WHERE ticket_id=?')
        .run(b.reply || t.reply, b.status || 'ANSWERED', tid);
      if (linked) db.prepare('UPDATE account_return_requests SET status=? WHERE request_id=?')
        .run(b.status || 'ANSWERED',tid);
    }).immediate();

    if (b.reply && t.mobile) {
      notify.ticketReplied({ ticket_id: tid, reply: b.reply }, t.mobile).catch(() => {});
    }
    sendJSON(200, { message: 'پاسخ ثبت و به مشتری اطلاع داده شد.' });
    return true;
  }

  return false;
}

module.exports = { handle };
