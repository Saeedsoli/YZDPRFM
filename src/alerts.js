'use strict';

const sms = require('./sms');

const ENABLED = String(process.env.ALERTS_ENABLED ?? '1') !== '0';

const EXTRA = String(process.env.ALERTS_EXTRA_MOBILES || '')
  .split(',').map(s => s.trim()).filter(m => /^09\d{9}$/.test(m));

const QUIET_FROM = Number(process.env.ALERTS_QUIET_FROM ?? 23);
const QUIET_TO   = Number(process.env.ALERTS_QUIET_TO   ?? 7);

function tehranHour() {
  try {
    return Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran', hour: 'numeric', hour12: false
    }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

function inQuietHours() {
  const h = tehranHour();

  return QUIET_FROM > QUIET_TO
    ? (h >= QUIET_FROM || h < QUIET_TO)
    : (h >= QUIET_FROM && h < QUIET_TO);
}

const sentLog = new Map();

const HOURLY_CAP = Number(process.env.ALERTS_HOURLY_CAP ?? 12);

function underCap(kind, cap = HOURLY_CAP) {
  const now = Date.now();
  const hour = 3600e3;
  const list = (sentLog.get(kind) || []).filter(t => now - t < hour);
  if (list.length >= cap) { sentLog.set(kind, list); return false; }
  list.push(now);
  sentLog.set(kind, list);
  return true;
}

const EVENTS = {

  newOrder: {
    perm: 'orders.view',
    urgent: false,
    cap: 20,
    text: o =>
`عطر یزد — سفارش تازه
شماره: ${o.order_id}
مبلغ: ${faNum(money(o.total_paid))} تومان
${o.customer_name || ''} ${o.city ? '· ' + o.city : ''}`.trim()
  },

  paymentFailed: {
    perm: 'orders.view',
    urgent: false,
    cap: 6,
    text: o =>
`عطر یزد — پرداخت ناموفق
سفارش ${o.order_id} پرداخت نشد و موجودی آزاد شد.`
  },

  lowStock: {
    perm: 'products.edit',
    urgent: false,
    cap: 4,
    text: d =>
`عطر یزد — موجودی رو به اتمام
${faNum(d.count)} کالا کمتر از ${faNum(d.threshold)} عدد مانده.
پنل → کالاهای رو به اتمام`
  },

  newTicket: {
    perm: 'tickets.view',
    urgent: false,
    cap: 10,
    text: t =>
`عطر یزد — درخواست مرجوعی
تیکت ${t.ticket_id}
مهلت پاسخ: ۲۴ ساعت`
  },

  newReview: {
    perm: 'reviews.moderate',
    urgent: false,
    cap: 4,
    text: r =>
`عطر یزد — نظر تازه
${faNum(r.count)} نظر در انتظار بررسی است.`
  },

  securityAlert: {
    perm: 'staff.view',
    urgent: true,
    cap: 3,
    text: d =>
`عطر یزد — هشدار امنیتی
${faNum(d.count)} تلاش ناموفق ورود به پنل از ${d.ip || 'نشانی ناشناس'}.`
  }
};

const faNum = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const money = n => Number(n || 0).toLocaleString('en-US');

function recipients(perm) {
  const out = new Set(EXTRA);
  try {
    const { db } = require('./db');
    const { roleHas } = require('./permissions');

    const staff = db.prepare(
      'SELECT display_name, mobile, role_key FROM staff WHERE active = 1'
    ).all();

    for (const s of staff) {
      if (!s.mobile || !/^09\d{9}$/.test(s.mobile)) continue;
      const role = db.prepare('SELECT permissions FROM roles WHERE key = ?')
        .get(s.role_key);
      if (!role) continue;
      let perms = [];
      try { perms = JSON.parse(role.permissions || '[]'); } catch {}
      if (perms.includes('*') || perms.includes(perm)) out.add(s.mobile);
    }
  } catch (e) {

    console.error('  [ALERT] خواندن گیرندگان ناموفق:', e.message);
  }
  return [...out];
}

async function fire(kind, data = {}) {
  const ev = EVENTS[kind];
  if (!ev) return { sent: 0, skipped: 'رویداد ناشناخته' };
  if (!ENABLED) return { sent: 0, skipped: 'خاموش' };

  if (!ev.urgent && inQuietHours()) {
    return { sent: 0, skipped: 'ساعت آرام' };
  }
  if (!underCap(kind, ev.cap)) {
    return { sent: 0, skipped: 'سقف ساعتی' };
  }

  const to = recipients(ev.perm);
  if (!to.length) return { sent: 0, skipped: 'گیرنده‌ای ندارد' };

  let text;
  try { text = ev.text(data); }
  catch (e) { return { sent: 0, skipped: 'ساخت متن ناموفق: ' + e.message }; }

  let sent = 0;
  for (const mobile of to) {
    try {
      const r = await sms.send(mobile, text, 'اطلاع داخلی');
      if (r.ok) sent++;
    } catch {  }
  }
  return { sent, total: to.length };
}

function fireAsync(kind, data) {
  fire(kind, data).catch(() => {});
}

function status() {
  const withMobile = (() => {
    try {
      const { db } = require('./db');
      return db.prepare(
        "SELECT COUNT(*) c FROM staff WHERE active=1 AND mobile IS NOT NULL AND mobile <> ''"
      ).get().c;
    } catch { return 0; }
  })();

  return {
    enabled: ENABLED,
    events: Object.keys(EVENTS).length,
    staff_with_mobile: withMobile,
    extra_mobiles: EXTRA.length,
    quiet_hours: `${faNum(QUIET_FROM)} تا ${faNum(QUIET_TO)}`,
    in_quiet_now: inQuietHours(),
    hourly_cap: HOURLY_CAP,
    reachable: withMobile + EXTRA.length
  };
}

module.exports = {
  fire, fireAsync, status, recipients,
  EVENTS, ENABLED,
  _internals: { inQuietHours, underCap, tehranHour, sentLog }
};
