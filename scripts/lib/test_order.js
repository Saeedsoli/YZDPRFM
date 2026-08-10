/**
 * ساخت سفارش پرداخت‌شده آزمونی — و پاک کردنش.
 *
 * ═══════════════════════════════════════════════════════════
 * چرا لازم شد
 * ═══════════════════════════════════════════════════════════
 * چند آزمون (فاکتور، مبالغ اضافه، تحلیل) به «یک سفارش پرداخت‌شده»
 * نیاز دارند و آن را از دیتابیس برمی‌داشتند:
 *
 *     SELECT order_id FROM orders WHERE status IN ('PAID', …)
 *
 * این تا وقتی کار می‌کرد که دیتابیس پر از سفارش آزمونی بود. پس از
 * پاک‌سازی برای افتتاح، هر سه آزمون قرمز شدند — نه چون کد خراب
 * است، بلکه چون **آزمون به آشغال قبلی تکیه داشت**.
 *
 * آزمون درست داده خودش را می‌سازد و در پایان برمی‌دارد. آن‌وقت
 * روی دیتابیس تازهٔ افتتاح هم سبز می‌ماند — یعنی همان محیطی که
 * واقعاً روی سرور خواهد بود.
 *
 * ═══════════════════════════════════════════════════════════
 * چرا مستقیم در دیتابیس و نه از راه API
 * ═══════════════════════════════════════════════════════════
 * ثبت سفارش از API نیازمند موجودی، درگاه پرداخت و تأیید است.
 * برای آزمونی که فقط می‌خواهد «فاکتور درست چاپ می‌شود؟» را
 * بسنجد، این زنجیره اضافی است و شکنندگی می‌آورد.
 *
 * پیشوند `YZD-TEST-` تضمین می‌کند پاک‌سازی هرگز سفارش واقعی را
 * لمس نکند.
 */
'use strict';

const PREFIX = 'YZD-TEST-';

/** شناسه یکتا با پیشوند قابل تشخیص */
function newId() {
  return PREFIX + Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * یک سفارش پرداخت‌شده کامل می‌سازد.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @param {number} [opts.giftWrap=0]   مبلغ بسته‌بندی کادویی
 * @param {number} [opts.discount=0]   تخفیف
 * @param {string} [opts.status='PAID']
 * @returns {{order_id, subtotal, shipping_fee, gift_wrap_fee, discount_amount, total_paid}}
 */
function makePaidOrder(db, opts = {}) {
  const {
    giftWrap = 0,
    discount = 0,
    status = 'PAID'
  } = opts;

  // یک واریانت واقعی از کاتالوگ — نام و قیمتش باید معنادار باشد
  const v = db.prepare(`
    SELECT v.sku, v.price_toman, p.name_fa, p.brand_fa
    FROM variants v JOIN products p ON p.id = v.product_id
    ORDER BY v.price_toman DESC LIMIT 1`).get();

  if (!v) throw new Error('کاتالوگ خالی است — سفارش آزمونی ساخته نشد');

  const subtotal = v.price_toman;
  const shipping = subtotal >= 2000000 ? 0 : 100000;
  const total = Math.max(0, subtotal - discount) + shipping + giftWrap;
  const oid = newId();
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO orders (order_id, created_at, updated_at, customer_name,
        first_name, last_name, mobile, province, city, address, postal_code,
        subtotal, shipping_fee, gift_wrap_fee, discount_amount,
        total_paid, payment_gateway, payment_ref, status)
      VALUES (@oid, @now, @now, 'آزمون فاکتور',
        'آزمون', 'فاکتور', '09120000000', 'تهران', 'تهران',
        'خیابان آزمون، پلاک ۱', '1234567890',
        @subtotal, @shipping, @gift, @discount,
        @total, 'sandbox', 'TEST-REF', @status)
    `).run({ oid, now, subtotal, shipping, gift: giftWrap,
             discount, total, status });

    db.prepare(`
      INSERT INTO order_items (order_id, sku, product_name,
        unit_price, quantity, line_total)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(oid, v.sku, `${v.brand_fa} — ${v.name_fa}`, subtotal, subtotal);
  })();

  return {
    order_id: oid, subtotal,
    shipping_fee: shipping, gift_wrap_fee: giftWrap,
    discount_amount: discount, total_paid: total
  };
}

/**
 * پاک کردن سفارش‌های آزمونی.
 *
 * بدون آرگومان همه سفارش‌های با پیشوند آزمون را برمی‌دارد —
 * حتی اگر اجرای قبلی نیمه‌کاره مانده باشد.
 */
function cleanupOrders(db, orderId) {
  const where = orderId ? 'order_id = ?' : `order_id LIKE '${PREFIX}%'`;
  const args = orderId ? [orderId] : [];
  db.transaction(() => {
    db.prepare(`DELETE FROM order_items WHERE ${where}`).run(...args);
    db.prepare(`DELETE FROM order_status_log WHERE ${where}`).run(...args);
    db.prepare(`DELETE FROM orders WHERE ${where}`).run(...args);
    // شماره فاکتور صادرشده برای این سفارش هم برود
    if (orderId) {
      db.prepare("DELETE FROM settings WHERE key = ?").run('invoice_no:' + orderId);
    } else {
      db.prepare("DELETE FROM settings WHERE key LIKE ?")
        .run('invoice_no:' + PREFIX + '%');
    }
  })();
}

module.exports = { makePaidOrder, cleanupOrders, PREFIX };
