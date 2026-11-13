'use strict';

const PREFIX = 'YZD-TEST-';

function newId() {
  return PREFIX + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makePaidOrder(db, opts = {}) {
  const {
    giftWrap = 0,
    discount = 0,
    status = 'PAID'
  } = opts;

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

function cleanupOrders(db, orderId) {
  const where = orderId ? 'order_id = ?' : `order_id LIKE '${PREFIX}%'`;
  const args = orderId ? [orderId] : [];
  db.transaction(() => {
    db.prepare(`DELETE FROM order_items WHERE ${where}`).run(...args);
    db.prepare(`DELETE FROM order_status_log WHERE ${where}`).run(...args);
    db.prepare(`DELETE FROM orders WHERE ${where}`).run(...args);

    if (orderId) {
      db.prepare("DELETE FROM settings WHERE key = ?").run('invoice_no:' + orderId);
    } else {
      db.prepare("DELETE FROM settings WHERE key LIKE ?")
        .run('invoice_no:' + PREFIX + '%');
    }
  })();
}

module.exports = { makePaidOrder, cleanupOrders, PREFIX };
