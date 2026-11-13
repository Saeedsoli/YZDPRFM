'use strict';

const csv = require('../csv-export');
const persianDate = require('../../public/assets/persian-date');
const stockReservations = require('../order-stock-reservations');
const essenceInventory = require('../essence-inventory');
const returnStore = require('../return-store');
const reconciliation = require('../order-reconciliation');

async function handle(ctx) {
  const {
    method, pathname, parsed, req, res,
    can, parseBody, logAudit, who, db,
    otp, notify, getToken, getCustomerToken, isValidSession,
    logStatus, releaseCouponUse, notifyStockWatchers,
    getSettings, nextInvoiceNo, STATUS_FA, ORDER_FLOW
  } = ctx;

  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  if (method === 'GET' && pathname === '/api/orders') {
    if (!can('orders.view')) return true;
    const q = (parsed.query.q || '').trim();
    const status = parsed.query.status || '';
    const limit = Math.min(200, parseInt(parsed.query.limit) || 50);
    const page = Math.max(1, parseInt(parsed.query.page) || 1);

    const where = [], args = {};
    if (q) {
      where.push(`(order_id LIKE @q OR customer_name LIKE @q OR mobile LIKE @q
                   OR tracking_code LIKE @q OR city LIKE @q)`);
      args.q = `%${q}%`;
    }
    if (status) { where.push('status = @status'); args.status = status; }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare(`SELECT COUNT(*) c FROM orders ${clause}`).get(args).c;
    const rows = db.prepare(
      `SELECT * FROM orders ${clause} ORDER BY created_at DESC LIMIT @limit OFFSET @off`
    ).all({ ...args, limit, off: (page - 1) * limit });

    const counts = {};
    db.prepare('SELECT status, COUNT(*) c FROM orders GROUP BY status').all()
      .forEach(r => counts[r.status] = r.c);

    const returnsUiEnabled = returnStore.ready(db);
    const evidence = returnsUiEnabled ? db.prepare('SELECT delivered_at_ms FROM return_delivery_evidence WHERE order_id=?') : null;
    const reconciliationReady=reconciliation.ready(db);
    return sendJSON(200, {
      total, page, totalPages: Math.ceil(total / limit),
      status_counts: counts, returns_ui_enabled: returnsUiEnabled, reconciliation_ready:reconciliationReady,
      orders: rows.map(o => ({
        ...o,
        ...(returnsUiEnabled ? {return_delivered_at_ms:evidence.get(o.order_id)?.delivered_at_ms ?? null} : {}),
        ...(reconciliationReady ? {payment_review_needed:['FAILED','CANCELLED','EXPIRED'].includes(o.status) && reconciliation.paymentNeedsReview(db,o.order_id), payment_recovery_pending:['FAILED','CANCELLED','EXPIRED'].includes(o.status) && reconciliation.paymentStillCreating(db,o.order_id)} : {}),
        items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.order_id)
      }))
    });
  }

  if (method === 'PUT' && /^\/api\/orders\/[^/]+\/status$/.test(pathname)) {
    const oid = pathname.split('/')[3];
    const b = await parseBody(req);
    const next = String(b.status || '').toUpperCase();

    const isDestructive = ['CANCELLED','RETURNED','FAILED'].includes(next);
    if (isDestructive) {
      if (!can('orders.cancel')) return true;
    } else {
      if (!can('orders.status')) return true;
    }

    const order = db.prepare('SELECT * FROM orders WHERE order_id=?').get(oid);
    if (!order) return sendJSON(404, { error: 'سفارش یافت نشد' });

    const allowed = ORDER_FLOW[order.status] || [];
    if (!allowed.includes(next)) {
      return sendJSON(400, {
        error: `تغییر وضعیت از «${STATUS_FA[order.status] || order.status}» به «${STATUS_FA[next] || next}» مجاز نیست.`,
        allowed_next: allowed.map(s => ({ code: s, label: STATUS_FA[s] }))
      });
    }

    const change = db.transaction(() => {
      const current=db.prepare('SELECT status FROM orders WHERE order_id=?').get(oid);
      if(!current || current.status!==order.status) return {conflict:true};
      let restored=[];
      if(isDestructive){
        const plan=stockReservations.inspect(db,oid);
        if(!plan.ok)return {needsReview:true};
        const release=stockReservations.release(db,oid);
        if(!release.ok)throw Error('Reservation changed during transition');

        if(essenceInventory.ready(db))essenceInventory.releaseOrder(db,oid);
        restored=release.skus;
      }
      const changed=db.prepare(`UPDATE orders SET status=?,tracking_code=COALESCE(?,tracking_code),
        carrier=COALESCE(?,carrier),admin_note=COALESCE(?,admin_note),updated_at=?
        WHERE order_id=? AND status=?`).run(next,b.tracking_code||null,b.carrier||null,b.note||null,new Date().toISOString(),oid,order.status);
      if(!changed.changes)throw Error('Concurrent order status conflict');
      if(next==='CANCELLED'||next==='FAILED')releaseCouponUse(oid);
      logStatus(oid,next,b.note||null);
      return {restored};
    }).immediate();
    if(change.needsReview)return sendJSON(409,{error:'سابقه رزرو انبار این سفارش نامشخص است؛ بررسی دستی لازم است.'});
    if(change.conflict)return sendJSON(409,{error:'وضعیت سفارش تغییر کرده است؛ دوباره بررسی کنید.'});
    const restored=change.restored;

    logAudit(isDestructive ? 'orders.cancel' : 'orders.status', {
      target: oid, detail: { from: order.status, to: next }
    });

    const updated = db.prepare('SELECT * FROM orders WHERE order_id=?').get(oid);
    notify.statusChanged(updated, next).catch(() => {});

    const alerted = notifyStockWatchers(restored,
      next === 'RETURNED' ? 'مرجوعی' : next === 'FAILED' ? 'پرداخت ناموفق' : 'لغو سفارش');

    return sendJSON(200, {
      message: `وضعیت سفارش به «${STATUS_FA[next]}» تغییر کرد.`
        + (alerted ? ` به ${alerted} نفر منتظر اطلاع داده شد.` : ''),
      order: updated,
      allowed_next: (ORDER_FLOW[next] || []).map(s => ({ code: s, label: STATUS_FA[s] }))
    });
  }

  if (method === 'GET' && /^\/api\/orders\/[^/]+\/history$/.test(pathname)) {
    const oid = pathname.split('/')[3];
    const isAdmin = isValidSession(getToken(req));
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    const order = db.prepare('SELECT * FROM orders WHERE order_id=?').get(oid);
    if (!order) return sendJSON(404, { error: 'سفارش یافت نشد' });
    if (!isAdmin && order.mobile !== mobile) return sendJSON(403, { error: 'دسترسی مجاز نیست' });

    const log = db.prepare(
      'SELECT status, note, changed_at FROM order_status_log WHERE order_id=? ORDER BY id'
    ).all(oid).map(r => ({ ...r, label: STATUS_FA[r.status] || r.status }));

    return sendJSON(200, {
      order_id: oid,
      current: { code: order.status, label: STATUS_FA[order.status] || order.status },
      tracking_code: order.tracking_code, carrier: order.carrier,
      history: log
    });
  }

  if (method === 'GET' && /^\/api\/orders\/[^/]+\/invoice$/.test(pathname)) {
    const oid = pathname.split('/')[3];
    const mobile = otp.mobileFromToken(getCustomerToken(req));

    const order = db.prepare('SELECT * FROM orders WHERE order_id=?').get(oid);
    if (!order) return sendJSON(404, { error: 'سفارش یافت نشد' });

    const isOwnerCustomer = mobile && order.mobile === mobile;
    if (!isOwnerCustomer) {
      if (!who) return sendJSON(403, { error: 'دسترسی مجاز نیست' });
      if (!can('orders.invoice')) return true;
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(oid);
    const settings = getSettings();

    let invNo = db.prepare("SELECT value FROM settings WHERE key=?")
      .get(`invoice_no:${oid}`)?.value;
    if (!invNo && ['PAID','PROCESSING','SHIPPED','DELIVERED'].includes(order.status)) {
      invNo = String(nextInvoiceNo()).padStart(5, '0');
      db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)')
        .run(`invoice_no:${oid}`, invNo);
    }

    return sendJSON(200, {
      invoice_no: invNo || null,
      order, items, settings,
      totals: {
        subtotal: order.subtotal,
        discount: order.discount_amount || 0,

        campaign: order.campaign_discount || 0,
        campaign_note: order.campaign_note || null,
        coupon: Math.max(0, (order.discount_amount || 0) - (order.campaign_discount || 0)),
        shipping: order.shipping_fee,

        gift_wrap: order.gift_wrap_fee || 0,
        grand_total: order.total_paid
      }
    });
  }

  if (method === 'GET' && pathname === '/api/admin/export/csv') {
    if (!can('orders.export')) return true;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="yazd_orders.csv"'
    });
    res.write('\uFEFF');
    res.write('Order_ID,Date,Customer,Mobile,Province,City,SKU,Product,Unit_Price,Qty,'
      + 'Line_Total,Discount_Code,Discount,Shipping,Gift_Wrap,Order_Total,Status,Tracking\n');
    const rows = db.prepare(`
      SELECT o.*, i.sku, i.product_name, i.unit_price, i.quantity, i.line_total
      FROM orders o LEFT JOIN order_items i ON i.order_id = o.order_id
      ORDER BY o.created_at DESC
    `).all();
    rows.forEach(r => {
      res.write(csv.row([
        r.order_id, persianDate.formatDate(r.created_at), r.customer_name,
        r.mobile, r.province, r.city, r.sku, r.product_name,
        r.unit_price ?? 0, r.quantity ?? 0, r.line_total ?? 0,
        r.discount_code, r.discount_amount ?? 0, r.shipping_fee ?? 0,
        r.gift_wrap_fee ?? 0, r.total_paid, STATUS_FA[r.status] || r.status,
        r.tracking_code
      ]));
    });
    res.end();
    return true;
  }

  return false;
}

module.exports = { handle };
