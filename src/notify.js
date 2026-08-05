/**
 * عطر یزد | پیامک اطلاع‌رسانی سفارش
 * ------------------------------------
 * جدا از otp.js — این ماژول پیام‌های متنی آزاد می‌فرستد
 * (تأیید سفارش، ارسال مرسوله، پاسخ تیکت)
 *
 * ── ارسال واقعی در `sms.js` است، نه اینجا ──
 * پیش‌تر کد کاوه‌نگار مستقیم در این فایل و در `otp.js` تکرار شده
 * بود. با تغییر سامانه به پیامیتو معلوم شد آن ساختار اشتباه است:
 * عوض کردن ارائه‌دهنده یعنی دست زدن به دو فایل و دو بار احتمال
 * خطا. حالا هر دو از یک لایه مشترک استفاده می‌کنند.
 *
 * پیامک‌ها هرگز جریان اصلی را متوقف نمی‌کنند؛
 * خطا فقط لاگ می‌شود تا ثبت سفارش با شکست مواجه نشود.
 */

const sms = require('./sms');

const SHOP = 'عطر یزد';

function faNum(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}
function money(n) {
  return faNum(Number(n || 0).toLocaleString('en-US'));
}

/**
 * ارسال امن — هرگز throw نمی‌کند.
 * @returns {Promise<boolean>} برای سازگاری با فراخوانی‌های موجود
 */
async function send(mobile, text, tag = 'SMS') {
  const r = await sms.send(mobile, text, tag);
  if (!r.ok && r.message) {
    console.error(`  [${tag}] ارسال ناموفق به ${mobile}: ${r.message}`);
  }
  return !!r.ok;
}

/* ═══════════ قالب‌های پیام ═══════════ */

const TEMPLATES = {
  orderPaid: o =>
`${SHOP}
سفارش شما با موفقیت ثبت شد.

شماره سفارش: ${o.order_id}
مبلغ: ${money(o.total_paid)} تومان

سفارش ظرف ۳ تا ۷ روز کاری ارسال می‌شود.
پیگیری: yazdperfume.ir/track`,

  processing: o =>
`${SHOP}
سفارش ${o.order_id} در حال آماده‌سازی است.
به‌زودی تحویل پست داده می‌شود.`,

  shipped: o =>
`${SHOP}
سفارش ${o.order_id} ارسال شد.

${o.tracking_code ? `کد رهگیری پستی: ${o.tracking_code}\n` : ''}${o.carrier ? `شیوه ارسال: ${o.carrier}\n` : ''}
تحویل طی ۳ تا ۷ روز کاری انجام می‌شود.`,

  delivered: o =>
`${SHOP}
سفارش ${o.order_id} تحویل داده شد.

امیدواریم از رایحه لذت ببرید.
در صورت هرگونه سؤال با ما در تماس باشید.`,

  cancelled: o =>
`${SHOP}
سفارش ${o.order_id} لغو شد.
در صورت کسر وجه، مبلغ طی ۷۲ ساعت بازگردانده می‌شود.`,

  ticketReceived: t =>
`${SHOP}
درخواست مرجوعی شما ثبت شد.

شماره تیکت: ${t.ticket_id}
حداکثر ظرف ۲۴ ساعت پاسخ داده می‌شود.`,

  ticketReplied: t =>
`${SHOP}
پاسخ کارشناسان برای تیکت ${t.ticket_id} ثبت شد.

${t.reply ? t.reply.slice(0, 200) : ''}`
};

/* ═══════════ توابع کاربردی ═══════════ */

async function orderPaid(order)      { return send(order.mobile, TEMPLATES.orderPaid(order), 'سفارش'); }
async function ticketReceived(t, m)  { return send(m, TEMPLATES.ticketReceived(t), 'تیکت'); }

/** اطلاع‌رسانی تغییر وضعیت سفارش */
async function statusChanged(order, newStatus) {
  const map = {
    PROCESSING: TEMPLATES.processing,
    SHIPPED:    TEMPLATES.shipped,
    DELIVERED:  TEMPLATES.delivered,
    CANCELLED:  TEMPLATES.cancelled
  };
  const tpl = map[newStatus];
  if (!tpl) return false;
  return send(order.mobile, tpl(order), 'وضعیت');
}

async function ticketReplied(ticket, mobile) {
  return send(mobile, TEMPLATES.ticketReplied(ticket), 'تیکت');
}

module.exports = {
  send, orderPaid, statusChanged, ticketReceived, ticketReplied,
  // بررسی سلامت به لایه مشترک واگذار شد
  testConnection: sms.testConnection,
  get PROVIDER() { return sms.PROVIDER; },
  faNum, money
};
