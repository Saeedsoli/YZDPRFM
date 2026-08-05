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

/**
 * @param {object} ctx زمینه درخواست (شرح در articles.js)
 * @returns {Promise<boolean>} آیا مسیر رسیدگی شد؟
 */
async function handle(ctx) {
  const { method, pathname, req, sendJSON, can, parseBody,
          db, cleanText, otp, notify, getCustomerToken,
          rateLimit, ip, RL } = ctx;

  // ═══════════ ثبت تیکت مرجوعی (مشتری) ═══════════
  if (method === 'POST' && pathname === '/api/tickets') {
    /* ── محدودیت نرخ (ممیزی مرداد ۱۴۰۵) ──
       این مسیر بدون احراز هویت است و هر بار چند کوئری می‌زند.
       آزمون نشان داد ۲۰ درخواست پیاپی بدون هیچ مانعی پذیرفته
       می‌شد. پنج تیکت در ساعت برای مشتری واقعی بیش از کافی است. */
    const trl = rateLimit(`ticket:${ip}`, RL.ticket.limit, RL.ticket.window, RL.ticket.block);
    if (!trl.ok) {
      sendJSON(429, {
        error: `درخواست‌های بیش از حد. ${Math.ceil(trl.retry_after / 60)} دقیقه دیگر تلاش کنید.`
      });
      return true;
    }

    const body = await parseBody(req);
    const vol = parseInt(body.volume_ml) || 0;
    if (vol <= 10) {
      sendJSON(400, { error: 'طبق قوانین، تنها حجم‌های بالای ۱۰ میلی‌لیتر قابل مرجوع هستند.' });
      return true;
    }
    if (!body.used_under_2ml) {
      sendJSON(400, { error: 'شرط پذیرش مرجوعی، مصرف کمتر از ۲ میلی‌لیتر است.' });
      return true;
    }

    const desc = cleanText(body.description, 2000);
    if (desc.length < 10) {
      sendJSON(400, { error: 'لطفاً دلیل مرجوعی را در حداقل ۱۰ حرف توضیح دهید.' });
      return true;
    }

    /* شماره سفارش باید واقعی باشد.
       پیش‌تر هر رشته‌ای پذیرفته می‌شد و تیکت‌های بی‌مرجع در پنل انباشته
       می‌شدند؛ مدیر هم راهی برای پیگیری‌شان نداشت. */
    const oid = (body.order_id || '').trim().toUpperCase();
    if (!oid) {
      sendJSON(400, { error: 'شماره سفارش را وارد کنید.' });
      return true;
    }
    const srcOrder = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(oid);
    if (!srcOrder) {
      sendJSON(404, { error: 'سفارشی با این شماره پیدا نشد. شماره را از صفحه پیگیری بردارید.' });
      return true;
    }
    // فقط سفارش‌هایی که واقعاً به دست مشتری رسیده‌اند قابل مرجوع‌اند
    if (!['SHIPPED', 'DELIVERED'].includes(srcOrder.status)) {
      sendJSON(400, {
        error: 'این سفارش هنوز ارسال نشده است. مرجوعی تنها پس از تحویل مرسوله ممکن است.'
      });
      return true;
    }

    const id = `TKT-${Date.now().toString(36).toUpperCase()}`;
    const mobile = otp.mobileFromToken(getCustomerToken(req))
      || (body.mobile ? otp.normalizeMobile(body.mobile) : null)
      || srcOrder.mobile;

    // تیکت باز تکراری برای همان سفارش جلوگیری شود
    const dup = db.prepare(
      "SELECT ticket_id FROM tickets WHERE order_id = ? AND status != 'CLOSED'"
    ).get(oid);
    if (dup) {
      sendJSON(409, {
        error: `برای این سفارش تیکت باز «${dup.ticket_id}» وجود دارد. پاسخ ما را همان‌جا دنبال کنید.`
      });
      return true;
    }

    db.prepare(`
      INSERT INTO tickets (ticket_id, order_id, product_name, volume_ml,
        used_under_2ml, reason, description, status, created_at, sla_deadline, mobile)
      VALUES (?,?,?,?,1,?,?, 'NEW_PENDING', ?, ?, ?)
    `).run(id, oid, cleanText(body.product_name, 200) || null, vol,
           cleanText(body.reason, 200) || null, desc,
           new Date().toISOString(),
           new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
           mobile);

    if (mobile) notify.ticketReceived({ ticket_id: id }, mobile).catch(() => {});
    /* خبر به مسئول مرجوعی — مهلت پاسخ ۲۴ ساعت است و کسی باید
       بداند ساعت شمارش شروع شده. */
    require('../alerts').fireAsync('newTicket', { ticket_id: id });

    sendJSON(201, {
      message: 'تیکت ثبت شد. حداکثر تا ۲۴ ساعت پاسخ داده می‌شود.',
      ticket_id: id
    });
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

    db.prepare('UPDATE tickets SET reply=?, status=? WHERE ticket_id=?')
      .run(b.reply || t.reply, b.status || 'ANSWERED', tid);

    if (b.reply && t.mobile) {
      notify.ticketReplied({ ticket_id: tid, reply: b.reply }, t.mobile).catch(() => {});
    }
    sendJSON(200, { message: 'پاسخ ثبت و به مشتری اطلاع داده شد.' });
    return true;
  }

  return false;
}

module.exports = { handle };
