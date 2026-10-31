/**
 * عطر یزد | گزارش‌های فروش و تحلیل
 * -----------------------------------
 * همه محاسبات مستقیم روی SQLite انجام می‌شود.
 * وضعیت‌های «فروش محقق‌شده»: PAID, PROCESSING, SHIPPED, DELIVERED
 */

const PAID_STATES = "('PAID','PROCESSING','SHIPPED','DELIVERED')";

function build(db) {

  /** خلاصه کلی در بازه دلخواه */
  function summary(days = 30) {
    const since = `datetime('now','-${parseInt(days)} days')`;

    const cur = db.prepare(`
      SELECT COUNT(*) orders,
             COALESCE(SUM(total_paid),0)      revenue,
             COALESCE(SUM(discount_amount),0) discounts,
             COALESCE(SUM(shipping_fee),0)    shipping,
             COALESCE(AVG(total_paid),0)      avg_order
      FROM orders
      WHERE status IN ${PAID_STATES} AND created_at >= ${since}
    `).get();

    // بازه قبلی برای مقایسه رشد
    const prev = db.prepare(`
      SELECT COUNT(*) orders, COALESCE(SUM(total_paid),0) revenue
      FROM orders
      WHERE status IN ${PAID_STATES}
        AND created_at >= datetime('now','-${parseInt(days) * 2} days')
        AND created_at <  ${since}
    `).get();

    const pct = (a, b) => b > 0 ? Math.round((a - b) / b * 100) : (a > 0 ? 100 : 0);

    const items = db.prepare(`
      SELECT COALESCE(SUM(i.quantity),0) units
      FROM order_items i JOIN orders o ON o.order_id = i.order_id
      WHERE o.status IN ${PAID_STATES} AND o.created_at >= ${since}
    `).get();

    const funnel = db.prepare(`
      SELECT
        SUM(CASE WHEN status='PENDING'   THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN status='EXPIRED'   THEN 1 ELSE 0 END) expired,
        SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) cancelled,
        SUM(CASE WHEN status IN ${PAID_STATES} THEN 1 ELSE 0 END) paid
      FROM orders WHERE created_at >= ${since}
    `).get();

    const total = (funnel.pending || 0) + (funnel.expired || 0)
                + (funnel.cancelled || 0) + (funnel.paid || 0);

    return {
      days: parseInt(days),
      orders: cur.orders,
      revenue: cur.revenue,
      discounts: cur.discounts,
      shipping: cur.shipping,
      avg_order: Math.round(cur.avg_order),
      units: items.units,
      growth: { orders: pct(cur.orders, prev.orders), revenue: pct(cur.revenue, prev.revenue) },
      funnel: { ...funnel, total, conversion: total ? Math.round(funnel.paid / total * 100) : 0 }
    };
  }

  /** فروش روزانه — برای نمودار */
  function daily(days = 30) {
    const rows = db.prepare(`
      SELECT date(created_at) d,
             COUNT(*) orders,
             COALESCE(SUM(total_paid),0) revenue
      FROM orders
      WHERE status IN ${PAID_STATES} AND created_at >= datetime('now','-${parseInt(days)} days')
      GROUP BY d ORDER BY d
    `).all();

    // پر کردن روزهای خالی تا نمودار پیوسته باشد
    const map = Object.fromEntries(rows.map(r => [r.d, r]));
    const out = [];
    for (let i = parseInt(days) - 1; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      out.push(map[dt] || { d: dt, orders: 0, revenue: 0 });
    }
    return out;
  }

  /** پرفروش‌ترین محصولات */
  function topProducts(days = 30, limit = 10) {
    return db.prepare(`
      SELECT p.slug, p.name_fa, p.brand_fa, p.image_url,
             SUM(i.quantity)   units,
             SUM(i.line_total) revenue,
             COUNT(DISTINCT o.order_id) orders
      FROM order_items i
      JOIN orders   o ON o.order_id = i.order_id
      JOIN order_variant_history v ON v.sku = i.sku
      JOIN products p ON p.id = v.product_id
      WHERE o.status IN ${PAID_STATES}
        AND o.created_at >= datetime('now','-${parseInt(days)} days')
      GROUP BY p.id ORDER BY revenue DESC LIMIT ?
    `).all(parseInt(limit));
  }

  /** فروش به تفکیک برند */
  function byBrand(days = 30, limit = 10) {
    return db.prepare(`
      SELECT p.brand_fa brand, SUM(i.quantity) units, SUM(i.line_total) revenue
      FROM order_items i
      JOIN orders   o ON o.order_id = i.order_id
      JOIN order_variant_history v ON v.sku = i.sku
      JOIN products p ON p.id = v.product_id
      WHERE o.status IN ${PAID_STATES}
        AND o.created_at >= datetime('now','-${parseInt(days)} days')
        AND p.brand_fa IS NOT NULL
      GROUP BY p.brand_fa ORDER BY revenue DESC LIMIT ?
    `).all(parseInt(limit));
  }

  /** فروش به تفکیک نوع محصول (سمپل/ادوپرفیوم/…) */
  function byType(days = 30) {
    return db.prepare(`
      SELECT v.type, v.type_label, SUM(i.quantity) units, SUM(i.line_total) revenue
      FROM order_items i
      JOIN orders   o ON o.order_id = i.order_id
      JOIN order_variant_history v ON v.sku = i.sku
      WHERE o.status IN ${PAID_STATES}
        AND o.created_at >= datetime('now','-${parseInt(days)} days')
      GROUP BY v.type ORDER BY revenue DESC
    `).all();
  }

  /** پراکندگی جغرافیایی */
  function byProvince(days = 30, limit = 12) {
    return db.prepare(`
      SELECT COALESCE(province,'نامشخص') province,
             COUNT(*) orders, COALESCE(SUM(total_paid),0) revenue
      FROM orders
      WHERE status IN ${PAID_STATES} AND created_at >= datetime('now','-${parseInt(days)} days')
      GROUP BY province ORDER BY revenue DESC LIMIT ?
    `).all(parseInt(limit));
  }

  /** عملکرد کدهای تخفیف */
  function couponStats(days = 90) {
    return db.prepare(`
      SELECT o.discount_code code,
             COUNT(*) uses,
             COALESCE(SUM(o.discount_amount),0) given,
             COALESCE(SUM(o.total_paid),0)      revenue
      FROM orders o
      WHERE o.status IN ${PAID_STATES}
        AND o.discount_code IS NOT NULL
        AND o.created_at >= datetime('now','-${parseInt(days)} days')
      GROUP BY o.discount_code ORDER BY uses DESC
    `).all();
  }

  /** مشتریان وفادار */
  function topCustomers(days = 365, limit = 10) {
    return db.prepare(`
      SELECT mobile,
             MAX(customer_name) name,
             COUNT(*) orders,
             COALESCE(SUM(total_paid),0) spent,
             MAX(created_at) last_order
      FROM orders
      WHERE status IN ${PAID_STATES} AND created_at >= datetime('now','-${parseInt(days)} days')
      GROUP BY mobile ORDER BY spent DESC LIMIT ?
    `).all(parseInt(limit));
  }

  /** ارزش موجودی انبار */
  function inventoryValue() {
    const r = db.prepare(`
      SELECT COALESCE(SUM(stock * price_toman),0) value,
             COALESCE(SUM(stock),0) units,
             SUM(CASE WHEN stock = 0  THEN 1 ELSE 0 END) out_of_stock,
             SUM(CASE WHEN stock <= 10 AND stock > 0 THEN 1 ELSE 0 END) low_stock
      FROM variants
    `).get();
    return r;
  }

  function full(days = 30) {
    return {
      summary: summary(days),
      daily: daily(days),
      top_products: topProducts(days),
      by_brand: byBrand(days),
      by_type: byType(days),
      by_province: byProvince(days),
      coupons: couponStats(days),
      top_customers: topCustomers(365),
      inventory: inventoryValue()
    };
  }

  return { summary, daily, topProducts, byBrand, byType, byProvince,
           couponStats, topCustomers, inventoryValue, full };
}

module.exports = { build };
