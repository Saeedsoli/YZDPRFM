/**
 * عطر یزد | مسیرهای تیکت مرجوعی
 * -------------------------------
 * دومین ماژول جداشده از `server.js`.
 *
 * سیاست مرجوعی فروشگاه (خواسته مالک):
 *   • فقط حجم بالای ۱۰ میلی‌لیتر
 *   • مصرف کمتر از ۲ میلی‌لیتر
 *   • پاسخ حداکثر ۲۴ ساعت
 *
 * الگوی `ctx` مثل بقیه ماژول‌های `routes/` — توضیح کامل در
 * `src/routes/articles.js`.
 */

'use strict';

const returnStore = require('../return-store');

/**
 * @param {object} ctx زمینه درخواست (شرح در articles.js)
 * @returns {Promise<boolean>} آیا مسیر رسیدگی شد؟
 */
async function handle(ctx) {
  const { method, pathname, req, sendJSON, can, parseBody,
          db, cleanText, otp, notify, getCustomerToken,
          rateLimit, ip, RL } = ctx;

  // New returns require a verified customer session and the real order item.
  // Never permit the older anonymous endpoint to bypass ownership or the
  // delivery window. Existing historical tickets remain available to staff.
  if (method === 'POST' && pathname === '/api/tickets') {
    sendJSON(410, { error: 'ثبت مرجوعی از بخش سفارش‌ها در حساب کاربری انجام می‌شود.' });
    return true;
  }

  // ═══════════ فهرست تیکت‌ها (پنل) ═══════════
  if (method === 'GET' && pathname === '/api/tickets') {
    if (!can('tickets.view')) return true;
    sendJSON(200, { tickets: db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all() });
    return true;
  }

  // ═══════════ پاسخ ادمین به تیکت ═══════════
  if (method === 'PUT' && pathname.startsWith('/api/tickets/')) {
    if (!can('tickets.reply')) return true;
    const tid = pathname.replace('/api/tickets/', '');
    const b = await parseBody(req);
    const t = db.prepare('SELECT * FROM tickets WHERE ticket_id=?').get(tid);
    if (!t) { sendJSON(404, { error: 'تیکت یافت نشد' }); return true; }

    const returnsReady = returnStore.ready(db);
    // Never silently desynchronise a linked request if the returns schema is
    // missing or damaged; legacy ticket identifiers use the TKT- prefix.
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
