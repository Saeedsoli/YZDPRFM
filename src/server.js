const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const zlib = require('zlib');
const { isPublicVariant, publicVariantSql } = require('./variant-visibility');
const { variantAvailability } = require('./availability');
const stockReservations = require('./order-stock-reservations');
const essenceInventory = require('./essence-inventory');
const returnStore = require('./return-store');
const orderIdempotency = require('./order-idempotency');
const checkoutAttempt = require('./checkout-attempt');
const browserOriginGuard = require('./browser-origin-guard');
const { resolvePublicFile } = require('./static-path');
const scriptElementCsp = require('./script-element-csp');
const trustedProxyPolicy = require('./client-ip').createPolicy(process.env.TRUSTED_PROXY_CIDRS || '');

const {
  db, parseProduct, attachVariants, DB_PATH,
  validateCoupon, recordCouponUse, releaseCouponUse, logStatus,
  campaignDiscount, campaignPercentFor, activeCampaigns, attachCampaign,
  bustCampaignCache,
  createSession, readSession, destroySession,
  rateLimit, resetRateLimit, appLog, releaseStaleOrders, setStockFreedHandler, PENDING_TTL_MIN,
  hashPassword, verifyPassword, getRole, listRoles,
  getCustomer, createCustomer, setCustomerPassword,
  saveCustomerAddress, publicCustomer, publicStaff,
  getStaff, getStaffByUsername, listStaff, audit, purgeAudit,
  reviewSummary, hasPurchased,
  createReviewInvite, readReviewInvite, consumeReviewInvite, INVITE_TTL_DAYS,
  getSettings, saveSettings, nextInvoiceNo,
  buildSearchIndex, buildNotesIndex, listNotes, normalizeFa,
  storeStats, bustStatsCache
} = require('./db');
const reports = require('./reports').build(db);
const analytics = require('./analytics').build(db, appLog, clientIP);

const taste = require('./taste').build(db, { parseProduct, attachVariants });
const pay = require('./payment');
const otp = require('./otp');
const perms = require('./permissions');
const notify = require('./notify');
const alerts = require('./alerts');
const media  = require('./media');
const seo = require('./seo');

const routeArticles = require('./routes/articles');
const routeTickets  = require('./routes/tickets');
const routeAccountReturns = require('./routes/account-returns');
const routeRbac     = require('./routes/rbac');
const routeAdminCatalog = require('./routes/admin-catalog');
const routeAdminOrders  = require('./routes/admin-orders');
const routeAdminReconciliation = require('./routes/admin-reconciliation');
const routeAdminMarketing = require('./routes/admin-marketing');
const routeAdminSystem  = require('./routes/admin-system');
const routeAdminReviews = require('./routes/admin-reviews');
const routeAuth         = require('./routes/auth');
const routeCatalog      = require('./routes/catalog');
const routeEngagement   = require('./routes/engagement');
const essences = require('./essences');

const ORDER_FLOW = {

  VERIFYING:  ['PAID', 'CANCELLED', 'FAILED'],
  PENDING:    ['PAID', 'CANCELLED', 'FAILED'],
  PAID:       ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED:    ['DELIVERED', 'RETURNED'],
  DELIVERED:  ['RETURNED'],
  CANCELLED:  [],
  FAILED:     [],
  RETURNED:   []
};
const STATUS_FA = {
  PENDING: 'در انتظار پرداخت', PAID: 'پرداخت شده',
  PROCESSING: 'در حال آماده‌سازی', SHIPPED: 'ارسال شده',
  DELIVERED: 'تحویل داده شده', CANCELLED: 'لغو شده',
  FAILED: 'ناموفق', RETURNED: 'مرجوع شده', EXPIRED: 'منقضی شده',
  VERIFYING: 'در حال تأیید پرداخت'
};
ORDER_FLOW.EXPIRED = [];

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const SESSION_TTL = 8 * 3600 * 1000;

function isValidSession(token) {
  return !!readSession(token, 'ADMIN');
}

function currentStaff(token) {
  const sess = readSession(token, 'ADMIN');
  if (!sess) return null;

  const id = parseInt(sess.subject);
  if (!Number.isInteger(id)) return null;

  const st = getStaff(id);
  if (!st || !st.active) return null;
  return st;
}

function clientIP(req) { return trustedProxyPolicy.clientIP(req); }

const RL = {
  login:    { limit: 6,   window: 10 * 60e3, block: 15 * 60e3 },
  otpIp:    { limit: 12,  window: 60 * 60e3, block: 30 * 60e3 },
  otpPhone: { limit: 5,   window: 60 * 60e3, block: 60 * 60e3 },

  order:    { limit: parseInt(process.env.RL_ORDER_LIMIT) || 10,
              window: 10 * 60e3, block: 10 * 60e3 },
  api:      { limit: 300, window: 60e3,      block: 0 },

  track:    { limit: 120, window: 60e3,      block: 5 * 60e3 },
  ticket:   { limit: 5,   window: 60 * 60e3, block: 60 * 60e3 },
  alert:    { limit: 10,  window: 60 * 60e3, block: 30 * 60e3 },

  taste:    { limit: 30,  window: 60e3,      block: 0 },

  trackIp:    { limit: 15, window: 10 * 60e3, block: 30 * 60e3 },
  trackPhone: { limit: 8,  window: 60 * 60e3, block: 60 * 60e3 },
  trackOrder: { limit: 10, window: 60 * 60e3, block: 60 * 60e3 }
};
function getToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/yazd_admin=([a-f0-9]+)/);
  return m ? m[1] : null;
}

function getCustomerToken(req) {
  const h = req.headers['x-customer-token'];
  if (h) return h;
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/yazd_customer=([a-f0-9]+)/);
  return m ? m[1] : null;
}

function newOrderId() {
  const t = Date.now().toString(36).toUpperCase();

  return `YZD-${t}-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
}

const SHIPPING = {
  FLAT: 100000,
  FREE_THRESHOLD: 2000000
};

const GIFT_WRAP_FEE = 70000;

function calcShipping(subtotal) {
  if (subtotal >= SHIPPING.FREE_THRESHOLD) {
    return { fee: 0, label: 'رایگان (خرید بالای ۲٬۰۰۰٬۰۰۰ تومان)' };
  }
  return { fee: SHIPPING.FLAT, label: 'پست / تیپاکس سراسری (۱۰۰٬۰۰۰ تومان)' };
}

function calcGiftWrap(wanted) {
  return wanted ? GIFT_WRAP_FEE : 0;
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faNum = n => String(n).replace(/\d/g, d => FA_DIGITS[d]);

function variantLabel(row) {
  const label = (row.type_label || '').trim();
  const ml = row.volume_ml;

  const hasVolume = !ml || /میل/.test(label);
  return hasVolume ? label : `${label} ${faNum(ml)} میل`.trim();
}

function variantFullName(row) {
  const base = row.brand_fa ? `${row.brand_fa} — ${row.name_fa}` : row.name_fa;
  const lbl = variantLabel(row);
  return lbl ? `${base} — ${lbl}` : base;
}

function notifyStockWatchers(skus, reason = 'موجودی') {
  const list = [...new Set((skus || []).filter(Boolean))];
  if (!list.length) return 0;

  let total = 0;
  for (const sku of list) {

    const v = db.prepare(`SELECT v.stock, v.type, v.volume_ml, v.price_toman, p.supply_mode
      FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=?`).get(sku);
    if (!v || !isPublicVariant(v.type, v.volume_ml) ||
        variantAvailability(v.supply_mode, v.stock, v.price_toman).state !== 'IN_STOCK') continue;

    const waiting = db.prepare(
      'SELECT mobile FROM stock_alerts WHERE sku=? AND notified=0'
    ).all(sku);
    if (!waiting.length) continue;

    const info = db.prepare(`
      SELECT p.name_fa, p.brand_fa, p.slug, v.volume_ml, v.type_label
      FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ?
    `).get(sku);
    if (!info) continue;

    const full = info.brand_fa ? `${info.brand_fa} — ${info.name_fa}` : info.name_fa;
    const site = (process.env.SITE_URL || 'https://yazdperfume.ir').replace(/\/$/, '');
    const text = `عطر یزد\n\n${full}\n${variantLabel(info)}`
      + `\n\nکالای مورد نظر شما موجود شد.\n${site}/perfume/${info.slug}`;

    waiting.forEach(w => notify.send(w.mobile, text, 'موجودی').catch(() => {}));
    db.prepare('UPDATE stock_alerts SET notified=1 WHERE sku=? AND notified=0').run(sku);

    total += waiting.length;
    appLog('INFO', 'stock', 'اطلاع‌رسانی موجود شدن',
           { sku, count: waiting.length, reason });
  }
  return total;
}

function normalizeDigits(v) {
  return String(v || '')
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[\s\-_.]/g, '')
    .trim();
}

function trackPurchase(order, req) {
  try {
    const items = db.prepare(`
      SELECT v.product_id pid, i.quantity q
      FROM order_items i JOIN order_variant_history v ON v.sku = i.sku
      WHERE i.order_id = ?
    `).all(order.order_id);

    for (const it of items) {
      analytics.track('purchase', it.pid,
        { qty: it.q }, req);
    }
  } catch {  }
}

function cleanText(input, maxLen = 2000) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/\son\w+\s*=/gi, ' ')
    .trim()
    .slice(0, maxLen);
}

function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'سبد خرید خالی است.' };
  }

  const stmt = db.prepare(`
    SELECT v.sku, v.price_toman, v.stock, v.volume_ml, v.type_label, v.type,
           p.name_fa, p.name_en, p.slug, p.brand_fa, p.id AS product_id,
           p.family_slug, p.gender, p.supply_mode
    FROM variants v JOIN products p ON p.id = v.product_id
    WHERE v.sku = ?
  `);

  const validated = [];
  const seenSkus = new Set();
  let subtotal = 0;

  if (items.length > 30) {
    return { ok: false, error: 'تعداد اقلام سبد بیش از حد مجاز است.' };
  }

  for (const item of items) {
    if (!item || typeof item.sku !== 'string' || !item.sku.trim()) return { ok:false, error:'شناسه کالا نامعتبر است.' };
    if (seenSkus.has(item.sku)) return { ok:false, error:'هر کالا باید فقط یک بار در سبد باشد.' };
    seenSkus.add(item.sku);
    const raw = Number(item.quantity);
    if (!Number.isInteger(raw) || raw < 1) {
      return { ok: false, error: 'تعداد کالا باید عددی صحیح و بزرگ‌تر از صفر باشد.' };
    }
    const qty = raw;
    if (qty > 50) {
      return { ok: false, error: 'حداکثر ۵۰ عدد از هر کالا در یک سفارش مجاز است.' };
    }
    const row = stmt.get(item.sku);
    if (!row) return { ok: false, error: `کالای «${item.sku}» یافت نشد.` };
    const availability = variantAvailability(row.supply_mode, row.stock, row.price_toman);
    if (!isPublicVariant(row.type, row.volume_ml) || availability.state === 'UNAVAILABLE') {
      return { ok: false, error: `«${row.name_fa}» فعلاً قابل تهیه نیست.` };
    }

    let maxQty = availability.max_quantity;
    if (essenceInventory.ready(db)) {
      const cap = essenceInventory.sellableCapacity(db, row.product_id, row.type, row.volume_ml);
      if (cap) maxQty = Math.min(50, cap.total);
    }
    if (qty > maxQty) {
      return { ok: false, error: availability.state === 'MADE_TO_ORDER' && maxQty <= 5
        ? `«${row.name_fa}» به سفارش ساخته می‌شود؛ حداکثر ${maxQty} عدد در هر سفارش.`
        : `موجودی «${row.name_fa}» کافی نیست.` };
    }
    const madeToOrder = availability.state === 'MADE_TO_ORDER';
    const lineTotal = row.price_toman * qty;
    subtotal += lineTotal;
    validated.push({
      sku: row.sku,
      product_name: variantFullName(row),
      slug: row.slug,
      unit_price: row.price_toman,
      quantity: qty,
      line_total: lineTotal,

      _product_id: row.product_id,
      _family: row.family_slug,
      _brand: row.brand_fa,
      _type: row.type,
      _volume_ml: row.volume_ml,
      _gender: row.gender
    });
  }
  return { ok: true, items: validated, subtotal };
}

function slugify(text) {
  return String(text || '')
    .trim()
    .replace(/[\u200c\u200f\u200e]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'article';
}

class BadRequest extends Error {
  constructor(msg) { super(msg); this.name = 'BadRequest'; this.statusCode = 400; }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 1e6) {
        req.destroy();
        reject(new BadRequest('حجم درخواست بیش از حد مجاز است.'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        const parsed = JSON.parse(body);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new BadRequest('ساختار داده ارسالی نامعتبر است.'));
        }
        resolve(parsed);
      } catch {
        reject(new BadRequest('داده ارسالی قالب معتبری ندارد.'));
      }
    });
    req.on('error', () => reject(new BadRequest('خطا در دریافت داده.')));
  });
}

const toFaSafe = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.avif': 'image/avif',

  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',

  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {

  let parsed,pathname;
  try {
    parsed=url.parse(req.url,true);
    if(typeof parsed.pathname!=='string')throw Error('Invalid request target');
    pathname=decodeURIComponent(parsed.pathname);
    if(/[\u0000-\u001f\u007f]/.test(pathname))throw Error('Invalid request target');
  } catch {
    res.writeHead(400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    return res.end(JSON.stringify({error:'نشانی درخواست معتبر نیست.'}));
  }

  const isHead = req.method === 'HEAD';
  const method = isHead ? 'GET' : req.method;

  if (!browserOriginGuard.allowed(req,pathname,{
    production:String(process.env.NODE_ENV||'').trim().toLowerCase()==='production',
    siteUrl:process.env.SITE_URL||''
  })) {
    res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    return res.end(JSON.stringify({error:'مبدأ درخواست معتبر نیست.'}));
  }

  if (isHead) {
    const realEnd = res.end.bind(res);
    const realWrite = res.write.bind(res);
    res.write = () => true;
    res.end = (...a) => realEnd();
    void realWrite;
  }

  const isPrivate = pathname.startsWith('/api/admin')
                 || pathname.startsWith('/api/auth')
                 || pathname.startsWith('/api/wishlist')
                 || pathname.startsWith('/api/orders')
                 || pathname.startsWith('/api/reviews')

                 || pathname.startsWith('/api/review-invite')
                 || pathname.startsWith('/api/tickets')
                 || pathname.startsWith('/api/cart')
                 || pathname.startsWith('/api/stock-alert')
                 || pathname.startsWith('/api/payment');
  if (!isPrivate) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {

    res.setHeader('Cache-Control','no-store');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()');

  if ((req.headers['x-forwarded-proto'] || '') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "script-src-elem 'self'",
    "script-src-attr 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://trustseal.enamad.ir",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",

    "frame-src 'self' https://www.aparat.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'"
  ].join('; '));

  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const reqIP = clientIP(req);

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');

  const sendBody = (code, body, contentType, extraHeaders = {}) => {
    const buf = Buffer.from(body, 'utf-8');
    const headers = { 'Content-Type': contentType, ...extraHeaders };

    if (acceptsGzip && buf.length > 1024) {
      zlib.gzip(buf, { level: 6 }, (err, gz) => {
        if (err) { res.writeHead(code, headers); return res.end(buf); }
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = headers['Vary'] ? headers['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
        res.writeHead(code, headers);
        res.end(gz);
      });
      return;
    }
    res.writeHead(code, headers);
    res.end(buf);
  };

  const sendJSON = (code, data) => {

    const json = process.env.NODE_ENV === 'production'
      ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    sendBody(code, json, 'application/json; charset=utf-8');
  };

  const who = currentStaff(getToken(req));

  const logAudit = (action, extra = {}) => {
    audit({
      staff_id: who?.id ?? null,
      username: who?.username ?? null,
      role_key: who?.role_key ?? null,
      action, method, path: pathname,
      ip: clientIP(req),
      ...extra
    });
  };

  const can = (perm) => {
    if (!who) {
      sendJSON(401, { error: 'دسترسی غیرمجاز — لطفاً وارد پنل مدیریت شوید.' });
      return false;
    }

    if (who.must_change) {
      logAudit(perm, { allowed: false, detail: { reason: 'رمز اولیه تغییر نکرده' } });
      sendJSON(403, {
        error: 'برای ادامه باید رمز عبور اولیه را عوض کنید.',
        must_change: true
      });
      return false;
    }
    if (!who.permissions.includes(perm)) {

      logAudit(perm, { allowed: false });
      appLog('WARN', 'security', 'تلاش دسترسی بدون مجوز',
             { user: who.username, perm, path: pathname });
      sendJSON(403, {
        error: 'شما اجازه انجام این کار را ندارید.',
        required: perm
      });
      return false;
    }
    logAudit(perm);
    return true;
  };

  const requireAdmin = () => {
    if (who) return true;
    sendJSON(401, { error: 'دسترسی غیرمجاز — لطفاً وارد پنل مدیریت شوید.' });
    return false;
  };

  try {

    if (method === 'POST' && pathname === '/api/admin/login') {
      const ip = clientIP(req);
      const rl = rateLimit(`login:${ip}`, RL.login.limit, RL.login.window, RL.login.block);
      if (!rl.ok) {
        appLog('WARN', 'security', 'تلاش‌های مکرر ورود ادمین', { ip });
        return sendJSON(429, {
          error: `تلاش‌های ناموفق بیش از حد. ${Math.ceil(rl.retry_after / 60)} دقیقه دیگر تلاش کنید.`,
          retry_after: rl.retry_after
        });
      }

      const body = await parseBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');

      const target = username
        ? getStaffByUsername(username)
        : getStaffByUsername(process.env.ADMIN_USERNAME || 'owner');

      const accountName = String(target?.username || username || process.env.ADMIN_USERNAME || 'owner').trim().toLowerCase();
      const accountKey = 'login-account:' + crypto.createHash('sha256').update(accountName).digest('hex');
      const accountLimit = rateLimit(accountKey, RL.login.limit, RL.login.window, RL.login.block);
      if (!accountLimit.ok) {
        appLog('WARN', 'security', 'محدودیت تعداد تلاش ورود برای حساب', { ip });
        return sendJSON(429, {
          error: `تلاش‌های ناموفق بیش از حد. ${Math.ceil(accountLimit.retry_after / 60)} دقیقه دیگر تلاش کنید.`,
          retry_after: accountLimit.retry_after
        });
      }

      const bad = () => {
        appLog('WARN', 'security', 'ورود ناموفق کارمند', { ip, username: username || '—' });
        audit({ username: username || '—', action: 'auth.login', method, path: pathname,
                ip, allowed: false, detail: { reason: 'اعتبار نادرست' } });

        return sendJSON(401, { error: 'نام کاربری یا رمز عبور نادرست است.' });
      };

      if (!target) return bad();
      if (!verifyPassword(password, target.pass_hash, target.pass_salt)) return bad();

      if (!target.active) {
        audit({ staff_id: target.id, username: target.username, action: 'auth.login',
                method, path: pathname, ip, allowed: false,
                detail: { reason: 'حساب غیرفعال' } });
        return sendJSON(403, { error: 'حساب شما غیرفعال شده است. با مدیر تماس بگیرید.' });
      }

      resetRateLimit(`login:${ip}`);
      resetRateLimit(accountKey);
      db.prepare('UPDATE staff SET last_login=? WHERE id=?')
        .run(new Date().toISOString(), target.id);

      const token = createSession('ADMIN', String(target.id), SESSION_TTL);

      appLog('INFO', 'auth', 'ورود موفق کارمند',
             { ip, user: target.username, role: target.role_key });
      audit({ staff_id: target.id, username: target.username, role_key: target.role_key,
              action: 'auth.login', method, path: pathname, ip });

      const secureCookie = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ? '; Secure' : '';
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Set-Cookie',
        `yazd_admin=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax${secureCookie}`);

      return sendJSON(200, {
        message: 'ورود موفق',

        ...(req.headers['x-admin-cookie-only']==='1' ? {} : {token}),
        user: {
          id: target.id,
          username: target.username,
          display_name: target.display_name,
          role_key: target.role_key,
          role_name: target.role_name,
          permissions: target.permissions,
          must_change: target.must_change
        }
      });
    }

    if (method === 'POST' && pathname === '/api/admin/logout') {
      destroySession(getToken(req));
      res.setHeader('Set-Cookie', 'yazd_admin=; HttpOnly; Path=/; Max-Age=0');
      return sendJSON(200, { message: 'خروج انجام شد' });
    }

    if (method === 'GET' && pathname === '/api/admin/clock') {
      if (!who) return sendJSON(401,{error:'ابتدا وارد پنل شوید.'});
      res.setHeader('Cache-Control','no-store');
      return sendJSON(200,{now_ms:Date.now()});
    }

    if (method === 'GET' && pathname === '/api/admin/me') {
      return sendJSON(200, { authenticated: isValidSession(getToken(req)) });
    }

    if (await routeCatalog.handle({
      method, pathname, parsed, req, reqIP, db,
      parseBody, rateLimit, RL,
      sendJSON, parseProduct, attachVariants, attachCampaign,
      campaignPercentFor, activeCampaigns, listNotes, normalizeFa,
      getCustomer, getCustomerToken, otp, taste, essences, analytics,
      res, storeStats
    })) return;

    if (await routeEngagement.handle({
      method, pathname, parsed, req, res, reqIP, db,
      sendJSON, parseBody, rateLimit, RL, appLog, cleanText,
      parseProduct, attachVariants, reviewSummary, hasPurchased,
      readReviewInvite, consumeReviewInvite,
      getCustomerToken, otp, analytics
    })) return;

    if (method === 'POST' && pathname === '/api/cart/sync') {
      const body = await parseBody(req);
      const skus = Array.isArray(body.skus) ? body.skus.slice(0, 30) : [];
      if (!skus.length) return sendJSON(200, { variants: [] });

      const marks = skus.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT v.sku, v.price_toman, v.stock, v.volume_ml, v.type_label,
               p.name_fa, p.brand_fa, p.slug, p.image_url, p.supply_mode
        FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.sku IN (${marks}) AND ${publicVariantSql('v')}
      `).all(...skus);

      return sendJSON(200, {
        variants: rows.map(r => ({
          sku: r.sku,
          price: r.price_toman,
          stock: r.stock,
          ...variantAvailability(r.supply_mode, r.stock, r.price_toman),
          slug: r.slug,
          image_url: r.image_url,
          name: variantFullName(r)
        }))
      });
    }

    if (method === 'POST' && pathname === '/api/cart/calculate') {
      const body = await parseBody(req);
      const v = validateCart(body.items);
      if (!v.ok) return sendJSON(400, { error: v.error });

      const camp = campaignDiscount(v.items);
      const afterCampaign = Math.max(0, v.subtotal - camp.total);

      const ship = calcShipping(v.subtotal);
      let shippingFee = ship.fee, shippingLabel = ship.label;
      let discount = 0, couponInfo = null, couponError = null;

      if (body.coupon_code) {
        const verifiedMobile = otp.mobileFromToken(getCustomerToken(req));
        const mobile = verifiedMobile || body.mobile || null;
        const cv = validateCoupon(body.coupon_code, afterCampaign, shippingFee, mobile, v.items, verifiedMobile);
        if (cv.ok) {
          if (cv.free_shipping) {
            shippingFee = 0;
            shippingLabel = 'رایگان (کد تخفیف)';
            discount = 0;
          } else {
            discount = cv.discount;
          }
          couponInfo = {
            code: cv.coupon.code, type: cv.coupon.type,
            description: cv.coupon.description,
            discount: cv.free_shipping ? cv.discount : discount,
            free_shipping: !!cv.free_shipping
          };
        } else {
          couponError = cv.error;
        }
      }

      const giftWrap = calcGiftWrap(body.gift_wrap);

      return sendJSON(200, {
        items: v.items,
        subtotal: v.subtotal,
        discount,
        coupon: couponInfo,
        coupon_error: couponError,
        campaign_discount: camp.total,
        campaign_lines: camp.lines,
        shipping_fee: shippingFee,
        shipping_label: shippingLabel,
        is_free_shipping: shippingFee === 0,
        gift_wrap: giftWrap > 0,
        gift_wrap_fee: giftWrap,
        total_payable: Math.max(0, v.subtotal - camp.total - discount + shippingFee) + giftWrap
      });
    }

    if (method === 'POST' && pathname === '/api/coupons/validate') {
      const body = await parseBody(req);
      const v = validateCart(body.items || []);
      if (!v.ok) return sendJSON(400, { error: v.error });

      const camp = campaignDiscount(v.items);
      const afterCampaign = Math.max(0, v.subtotal - camp.total);

      const ship = calcShipping(v.subtotal);
      const verifiedMobile = otp.mobileFromToken(getCustomerToken(req));
      const mobile = verifiedMobile || body.mobile || null;
      const cv = validateCoupon(body.code, afterCampaign, ship.fee, mobile, v.items, verifiedMobile);
      if (!cv.ok) return sendJSON(400, { error: cv.error });
      return sendJSON(200, {
        valid: true, code: cv.coupon.code,
        description: cv.coupon.description,
        discount: cv.discount, free_shipping: !!cv.free_shipping,
        campaign_discount: camp.total,
        campaign_lines: camp.lines,
        subtotal: v.subtotal
      });
    }

    if (method === 'GET' && pathname === '/api/orders/attempt/status') {
      if(!checkoutAttempt.ready(db)) return sendJSON(503,{error:'سامانه جلوگیری از ثبت تکراری هنوز آماده نیست.'});
      const cookie=checkoutAttempt.readCookie(req.headers.cookie);
      if(cookie.kind==='ABSENT') return sendJSON(401,{error:'شناسه ثبت سفارش موجود نیست.'});
      if(cookie.kind==='INVALID') return sendJSON(400,{error:'شناسه ثبت سفارش معتبر نیست.'});
      const attempt=checkoutAttempt.describe(db,cookie.token);
      if(attempt.kind==='INACTIVE') return sendJSON(409,{error:'شناسه ثبت سفارش دیگر فعال نیست.'});
      return sendJSON(200,{ready:true,state:attempt.kind,...(attempt.orderId?{order_id:attempt.orderId}:{})});
    }
    if (method === 'POST' && (pathname === '/api/orders/attempt' || pathname === '/api/orders/attempt/rotate')) {
      const rl=rateLimit(`checkout-attempt:${clientIP(req)}`, RL.order.limit, RL.order.window, RL.order.block);
      if(!rl.ok) return sendJSON(429,{error:'تعداد درخواست‌ها بیش از حد مجاز است.'});
      if(!checkoutAttempt.ready(db)) return sendJSON(503,{error:'سامانه جلوگیری از ثبت تکراری هنوز آماده نیست.'});
      await parseBody(req);
      const cookie=checkoutAttempt.readCookie(req.headers.cookie);
      if(cookie.kind==='INVALID') return sendJSON(400,{error:'شناسه ثبت سفارش معتبر نیست.'});
      const production=String(process.env.NODE_ENV||'').trim().toLowerCase()==='production';
      if(pathname==='/api/orders/attempt') {
        if(cookie.kind==='VALID') {
          if(!checkoutAttempt.active(db,cookie.token))return sendJSON(409,{error:'شناسه ثبت سفارش دیگر فعال نیست؛ صفحه را بررسی کنید.'});
          return sendJSON(200,{ready:true});
        }
        const token=checkoutAttempt.issue(db);
        res.setHeader('Set-Cookie',checkoutAttempt.setCookie(token,{production}));
        return sendJSON(201,{ready:true});
      }
      if(cookie.kind!=='VALID') return sendJSON(400,{error:'شناسه ثبت سفارش موجود نیست.'});
      const changed=checkoutAttempt.rotate(db,cookie.token);
      if(!changed.ok)return sendJSON(409,{error:'سفارش قبلی نیاز به بررسی دارد؛ با پشتیبانی تماس بگیرید.'});
      res.setHeader('Set-Cookie',checkoutAttempt.setCookie(changed.token,{production}));
      return sendJSON(200,{ready:true});
    }

    if (method === 'POST' && pathname === '/api/orders') {

      if (!pay.productionReady()) return sendJSON(503, { error: 'درگاه پرداخت واقعی هنوز آماده نیست.' });
      if (!stockReservations.ready(db)) return sendJSON(503, { error: 'سامانه ثبت رزرو موجودی هنوز آماده نیست.' });
      const ip = clientIP(req);
      const rl = rateLimit(`order:${ip}`, RL.order.limit, RL.order.window, RL.order.block);
      if (!rl.ok) {
        appLog('WARN', 'security', 'ثبت سفارش بیش از حد', { ip });
        return sendJSON(429, { error: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.' });
      }

      const body = await parseBody(req);
      let idem = null, cookieToken = null;
      const cookie=checkoutAttempt.readCookie(req.headers.cookie);
      if(cookie.kind==='INVALID') return sendJSON(400,{error:'شناسه ثبت سفارش معتبر نیست.'});
      if(cookie.kind==='VALID' && req.headers['idempotency-key']!==undefined)
        return sendJSON(400,{error:'فقط یک روش شناسایی سفارش مجاز است.'});
      if(cookie.kind==='VALID') {
        if(!checkoutAttempt.ready(db))return sendJSON(503,{error:'سامانه جلوگیری از ثبت تکراری هنوز آماده نیست.'});
        cookieToken=cookie.token;
      }
      const key = cookieToken || req.headers['idempotency-key'];
      const respondToAttempt = result => {
        if (result.kind === 'READY') return sendJSON(200, {message:'سفارش پیش‌تر ثبت شده است.', ...result.response});
        if (result.kind === 'CONFLICT') return sendJSON(409, {error:'این کلید برای اطلاعات سفارش دیگری استفاده شده است.'});
        if (result.kind === 'REVOKED') return sendJSON(409, {error:'شناسه ثبت سفارش دیگر فعال نیست؛ صفحه را بررسی کنید.'});
        if (result.kind === 'PAID') return sendJSON(409, {error:'این سفارش قبلاً پرداخت شده است.',order_id:result.orderId,status:'PAID'});
        if (result.kind === 'FAILED') return sendJSON(409, {error:'درخواست قبلی ناموفق بوده است؛ پیش از ثبت مجدد وضعیت را بررسی کنید.',order_id:result.orderId});
        return sendJSON(409, {error:'نتیجه درخواست قبلی نامشخص یا در حال بررسی است؛ پیش از تلاش دوباره با پشتیبانی بررسی کنید.', ...(result.orderId ? {order_id:result.orderId} : {})});
      };
      const lookupAttempt = () => {
        const check = () => {
          if(cookieToken) {
            try { checkoutAttempt.assertActiveInTransaction(db,cookieToken); }
            catch { return {kind:'REVOKED'}; }
          }
          return orderIdempotency.lookup(db,idem);
        };

        return cookieToken ? db.transaction(check).immediate() : check();
      };
      const rejectOrReplay = (status,data) => {
        if(idem) {
          const existing=lookupAttempt();
          if(existing.kind!=='NEW') return respondToAttempt(existing);
        }
        return sendJSON(status,data);
      };
      if (key !== undefined) {
        if (!orderIdempotency.ready(db)) return sendJSON(503,{error:'سامانه جلوگیری از ثبت تکراری هنوز آماده نیست.'});
        try { idem=orderIdempotency.fingerprint(key,body); }
        catch { return sendJSON(400,{error:'کلید ثبت سفارش یا اطلاعات درخواست معتبر نیست.'}); }

        const existing=lookupAttempt();
        if(existing.kind!=='NEW') return respondToAttempt(existing);
      }

      if (!body.customer_name || !/^09\d{9}$/.test(String(body.mobile || ''))) {
        return sendJSON(400, { error: 'نام و شماره موبایل معتبر (۰۹xxxxxxxxx) الزامی است.' });
      }

      body.customer_name = cleanText(body.customer_name, 100);
      body.address       = cleanText(body.address, 500);
      body.city          = cleanText(body.city, 60);
      body.province      = cleanText(body.province, 60);

      body.customer_note = cleanText(body.customer_note, 500);
      if (!body.customer_name) {
        return sendJSON(400, { error: 'نام معتبر وارد کنید.' });
      }
      const v = validateCart(body.items);
      if (!v.ok) return rejectOrReplay(400, { error: v.error });

      const camp = campaignDiscount(v.items);
      const afterCampaign = Math.max(0, v.subtotal - camp.total);

      const ship = calcShipping(v.subtotal);

      let orderId = null;
      for (let i = 0; i < 3; i++) {
        const cand = newOrderId();
        if (!db.prepare('SELECT 1 FROM orders WHERE order_id=?').get(cand)) {
          orderId = cand;
          break;
        }
      }
      if (!orderId) {
        appLog('ERROR', 'orders', 'ساخت شماره سفارش یکتا پس از ۳ تلاش ناموفق ماند');
        return rejectOrReplay(503, {
          error: 'سامانه لحظه‌ای شلوغ است. چند ثانیه بعد دوباره تلاش کنید.'
        });
      }

      let shippingFee = ship.fee, discount = 0, appliedCode = null;
      let couponSnapshot = null;
      if (body.coupon_code) {
        const verifiedMobile = otp.mobileFromToken(getCustomerToken(req));
        const cv = validateCoupon(body.coupon_code, afterCampaign, shippingFee, body.mobile, v.items, verifiedMobile);
        if (!cv.ok) return rejectOrReplay(400, { error: cv.error });
        couponSnapshot = {code:cv.coupon.code, free_shipping:!!cv.free_shipping, discount:cv.discount || 0};
        if (cv.free_shipping) shippingFee = 0;
        else discount = cv.discount;
        appliedCode = cv.coupon.code;
      }

      const totalDiscount = camp.total + discount;

      const giftWrapFee = calcGiftWrap(body.gift_wrap);

      const total = Math.max(0, v.subtotal - totalDiscount + shippingFee) + giftWrapFee;

      const tx = db.transaction(() => {
        if (idem) {
          const existing=lookupAttempt();
          if(existing.kind!=='NEW') throw Object.assign(Error('Prior order attempt'),{code:'IDEMPOTENCY_REPLAY',result:existing});
        }

        if (couponSnapshot) {

          const verifiedMobile=otp.mobileFromToken(getCustomerToken(req));
          const current=validateCoupon(body.coupon_code,afterCampaign,ship.fee,body.mobile,v.items,verifiedMobile);
          if (!current.ok || current.coupon.code!==couponSnapshot.code ||
              !!current.free_shipping!==couponSnapshot.free_shipping || (current.discount || 0)!==couponSnapshot.discount)
            throw Object.assign(Error('Coupon changed'),{code:'COUPON_CHANGED'});
          const reserved=recordCouponUse(couponSnapshot.code,body.mobile,orderId);
          if (!reserved.ok) throw Object.assign(Error('Coupon changed'),{code:'COUPON_CHANGED'});
        }
        db.prepare(`
          INSERT INTO orders (order_id, created_at, customer_name, mobile,
            first_name, last_name, email,
            province, city, address, postal_code,
            subtotal, shipping_fee, gift_wrap_fee, total_paid, payment_gateway, status,
            discount_code, discount_amount,
            campaign_discount, campaign_note, customer_note, updated_at)
          VALUES (@order_id, @created_at, @customer_name, @mobile,
            @first_name, @last_name, @email,
            @province, @city, @address, @postal_code,
            @subtotal, @shipping_fee, @gift_wrap_fee, @total_paid, @gateway, 'PENDING',
            @discount_code, @discount_amount,
            @campaign_discount, @campaign_note, @customer_note, @created_at)
        `).run({
          customer_note: body.customer_note || null,
          discount_code: appliedCode,

          discount_amount: totalDiscount,

          campaign_discount: camp.total || null,
          campaign_note: camp.lines.length
            ? [...new Set(camp.lines.map(l => l.title))].join(' · ').slice(0, 160)
            : null,
          order_id: orderId,
          created_at: new Date().toISOString(),
          customer_name: String(body.customer_name).slice(0, 100),

          first_name: body.first_name
            ? String(body.first_name).slice(0, 40)
            : String(body.customer_name || '').split(' ')[0] || null,
          last_name: body.last_name
            ? String(body.last_name).slice(0, 40)
            : String(body.customer_name || '').split(' ').slice(1).join(' ') || null,
          email: body.email ? String(body.email).slice(0, 80) : null,
          mobile: body.mobile,
          province: body.province || null,
          city: body.city || null,
          address: body.address || null,
          postal_code: body.postal_code || null,
          subtotal: v.subtotal,
          shipping_fee: shippingFee,
          gift_wrap_fee: giftWrapFee,
          total_paid: total,
          gateway: pay.gatewayName()
        });

        const insItem = db.prepare(`
          INSERT INTO order_items (order_id, sku, product_name, unit_price, quantity, line_total)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        const canSnapshotReturns = returnStore.ready(db);
        const variantVolume = canSnapshotReturns
          ? db.prepare('SELECT volume_ml FROM variants WHERE sku=?') : null;
        for (const it of v.items) {
          if (canSnapshotReturns && variantVolume.get(it.sku)?.volume_ml !== it._volume_ml)
            throw Object.assign(Error('Variant changed'), {code:'CART_CHANGED'});
          const item = insItem.run(orderId, it.sku, it.product_name, it.unit_price, it.quantity, it.line_total);

          let numericTake = null;
          if (essenceInventory.ready(db)) {
            const row = db.prepare(`SELECT v.product_id, v.type, v.volume_ml, v.stock FROM variants v WHERE v.sku=?`).get(it.sku);
            if (row && essenceInventory.policyFor(db, row.product_id).tracked) {
              const policy = essenceInventory.policyFor(db, row.product_id);
              const onHand = policy.use_count ? Math.max(0, Number(row.stock) || 0) : 0;
              numericTake = Math.min(it.quantity, onHand);
              const rest = it.quantity - numericTake;
              if (rest > 0 && !policy.use_essence)
                throw Object.assign(Error('Not enough stock'), { code: 'CART_CHANGED' });
              essenceInventory.reserveItem(db, orderId, {
                product_id: row.product_id, type: row.type, volume_ml: row.volume_ml, quantity: it.quantity
              });
            }
          }
          stockReservations.reserveItem(db, item.lastInsertRowid,
            numericTake === null ? undefined : { numericQty: numericTake });
          if (canSnapshotReturns) returnStore.captureNewItem(db, item.lastInsertRowid, it._volume_ml);
        }
        if (idem) orderIdempotency.bindNew(db,{...idem,orderId});
        logStatus(orderId, 'PENDING', 'ثبت سفارش');
      });
      try { tx.immediate(); }
      catch (e) {

        if (e.code === 'IDEMPOTENCY_REPLAY') return respondToAttempt(e.result);
        if (e.code === 'CART_CHANGED') return sendJSON(409, { error:'قیمت یا موجودی سبد تغییر کرده است؛ دوباره بررسی کنید.' });
        if (e.code === 'COUPON_CHANGED') return sendJSON(409, { error:'کد تخفیف یا ظرفیت آن تغییر کرده است؛ دوباره بررسی کنید.' });
        throw e;
      }

      const pr = await pay.requestPayment({
        orderId, amountToman: total, mobile: body.mobile,
        description: `سفارش ${orderId} — عطر یزد`
      });

      if (!pr.ok) {

        db.transaction(() => {
          const failed = db.prepare(
            "UPDATE orders SET status='FAILED', updated_at=? " +
            "WHERE order_id=? AND status='PENDING'"
          ).run(new Date().toISOString(), orderId);
          if (failed.changes) {
            const released = stockReservations.release(db, orderId);
            if (released.ok && essenceInventory.ready(db)) essenceInventory.releaseOrder(db, orderId);
            if (!released.ok) throw Error('Reservation requires manual review');
            releaseCouponUse(orderId);
            logStatus(orderId, 'FAILED', 'اتصال به درگاه ممکن نشد — رزرو انبار آزاد شد');
          }

          if (idem) orderIdempotency.markUncertain(db,{keyHash:idem.keyHash,orderId});
        }).immediate();
        return sendJSON(502, { error: 'اتصال به درگاه پرداخت ممکن نشد: ' + pr.error, ...(idem ? {order_id:orderId} : {}) });
      }

      const response = {
        message: 'سفارش ثبت شد. در حال انتقال به درگاه پرداخت…',
        order_id: orderId, subtotal: v.subtotal, discount, discount_code: appliedCode,
        shipping_fee: shippingFee, gift_wrap_fee: giftWrapFee, total_payable: total,
        payment_url: pr.redirect_url
      };
      const bound=db.transaction(()=>{
        const changed=db.prepare("UPDATE orders SET payment_ref=? WHERE order_id=? AND status='PENDING' AND payment_ref IS NULL AND payment_gateway=?")
          .run(pr.authority,orderId,pay.gatewayName());
        if (!changed.changes) {
          if (idem) orderIdempotency.markUncertain(db,{keyHash:idem.keyHash,orderId});
          return false;
        }
        if (idem) orderIdempotency.markReady(db,{keyHash:idem.keyHash,orderId,authority:pr.authority,response});
        return true;
      }).immediate();
      if (!bound) {
        appLog('WARN','payment','وضعیت سفارش هنگام ایجاد پرداخت تغییر کرد؛ پیوند پرداخت ارائه نشد',{order_id:orderId});
        return sendJSON(409,{error:'وضعیت سفارش تغییر کرده است؛ پیوند پرداخت ارائه نشد. وضعیت سفارش را بررسی کنید.',order_id:orderId});
      }

      return sendJSON(201, response);
    }

    if (method === 'POST' && pathname === '/api/payment/verify') {
      if (!pay.productionReady()) return sendJSON(503, { error: 'درگاه پرداخت واقعی هنوز آماده نیست.' });

      if (pay.GATEWAY === 'zarinpal') return sendJSON(405, { error: 'تأیید از مسیر بازگشت درگاه انجام می‌شود.' });
      const body = await parseBody(req);
      const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(body.order_id);
      if (!order) return sendJSON(404, { error: 'سفارش یافت نشد' });

      if (order.status === 'PAID') {
        return sendJSON(200, {
          message: 'این سفارش قبلاً پرداخت شده است',
          order_id: order.order_id, payment_ref: order.payment_ref
        });
      }
      if (order.status !== 'PENDING') {

        return sendJSON(409, {
          error: `این سفارش در وضعیت «${STATUS_FA[order.status] || order.status}» است و قابل پرداخت نیست.`,
          order_id: order.order_id, status: order.status
        });
      }

      const claimed = db.prepare(
        "UPDATE orders SET status='VERIFYING', updated_at=? " +
        "WHERE order_id=? AND status='PENDING'"
      ).run(new Date().toISOString(), order.order_id);

      if (!claimed.changes) {
        return sendJSON(409, {
          error: 'این سفارش هم‌اکنون در حال پردازش است. چند لحظه بعد وضعیت را بررسی کنید.',
          order_id: order.order_id
        });
      }

      const vr = await pay.verifyPayment({
        authority: body.authority || order.payment_ref,
        amountToman: order.total_paid,
        sandboxResult: body.result
      });

      if (vr.ok) {

        const paid = db.prepare(
          "UPDATE orders SET status='PAID', payment_ref=?, updated_at=? " +
          "WHERE order_id=? AND status='VERIFYING'"
        ).run(vr.ref_id, new Date().toISOString(), order.order_id);

        if (!paid.changes) {
          return sendJSON(409, {
            error: 'وضعیت سفارش هنگام بررسی تغییر کرد؛ وضعیت فعلی را بررسی کنید.',
            order_id: order.order_id
          });
        }
        logStatus(order.order_id, 'PAID', 'پرداخت تأیید شد');

        notify.orderPaid({ ...order, status: 'PAID' }).catch(() => {});

        alerts.fireAsync('newOrder', order);
        trackPurchase(order, req);

        return sendJSON(200, {
          message: 'پرداخت تأیید شد',
          order_id: order.order_id, payment_ref: vr.ref_id
        });
      }

      let freed = [];
      if (!stockReservations.inspect(db, order.order_id).ok) {

        logStatus(order.order_id, 'VERIFYING', 'سابقه رزرو انبار نامشخص است؛ بررسی دستی لازم است');
        return sendJSON(409, { error:'سابقه رزرو انبار نامشخص است؛ سفارش نیازمند بررسی دستی است.' });
      }

      db.transaction(() => {
        const cancelled = db.prepare(
          "UPDATE orders SET status='CANCELLED', updated_at=? " +
          "WHERE order_id=? AND status='VERIFYING'"
        ).run(new Date().toISOString(), order.order_id);
        if (!cancelled.changes) return;

        const released = stockReservations.release(db, order.order_id);

        if (released.ok && essenceInventory.ready(db)) essenceInventory.releaseOrder(db, order.order_id);
        if (!released.ok) throw Error('Reservation requires manual review');
        logStatus(order.order_id, 'CANCELLED', 'پرداخت ناموفق — رزرو انبار آزاد شد');
        releaseCouponUse(order.order_id);
        freed = released.skus;
      })();
      notifyStockWatchers(freed, 'پرداخت ناموفق');
      return sendJSON(200, { message: vr.error || 'پرداخت لغو شد', order_id: order.order_id, failed: true });
    }

    if (method === 'GET' && pathname === '/payment/callback') {
      if (!pay.productionReady()) return sendJSON(503, { error: 'درگاه پرداخت واقعی هنوز آماده نیست؛ سفارش تغییری نکرده است.' });
      const orderId = parsed.query.order;
      const authority = parsed.query.Authority || parsed.query.authority;
      const status = parsed.query.Status || parsed.query.status;
      const order = db.prepare('SELECT * FROM orders WHERE order_id=?').get(orderId);

      const goto = (ok, ref, msg) => {

        const u = `/payment/result?order=${encodeURIComponent(orderId || '')}`
          + `&ok=${ok ? '1' : '0'}`;
        res.writeHead(302, { Location: u });
        res.end();
      };

      if (!order) return goto(false, null, 'سفارش یافت نشد');

      if (pay.GATEWAY === 'zarinpal' && order.status === 'PENDING' &&
          (order.payment_gateway !== pay.gatewayName() || !order.payment_ref ||
           typeof authority !== 'string' || authority !== order.payment_ref)) {
        return sendJSON(409, { error: 'شناسه پرداخت با سفارش مطابقت ندارد؛ سفارش تغییری نکرده است.' });
      }

      if (order.status === 'PAID') return goto(true, order.payment_ref);
      if (order.status === 'CANCELLED' || order.status === 'FAILED') {
        return goto(false, null, 'این سفارش پیش‌تر لغو شده است');
      }
      if (order.status === 'VERIFYING') {
        return goto(false, null, 'پرداخت شما در حال بررسی است. چند لحظه بعد وضعیت سفارش را ببینید.');
      }
      if (order.status !== 'PENDING') {
        return goto(false, null, `سفارش در وضعیت «${STATUS_FA[order.status] || order.status}» است`);
      }

      let releasedSkus = [];
      const releaseStock = (note) => db.transaction(() => {
        const done = db.prepare(
          "UPDATE orders SET status='CANCELLED', updated_at=? " +
          "WHERE order_id=? AND status IN ('PENDING','VERIFYING')"
        ).run(new Date().toISOString(), orderId);
        if (!done.changes) return false;

        const released = stockReservations.release(db, orderId);

        if (released.ok && essenceInventory.ready(db)) essenceInventory.releaseOrder(db, orderId);
        if (!released.ok) throw Error('Reservation requires manual review');
        logStatus(orderId, 'CANCELLED', note);
        releasedSkus = released.skus;
        return true;
      })();

      if (status !== 'OK' && pay.GATEWAY === 'zarinpal') {
        const held=db.prepare("UPDATE orders SET status='VERIFYING',updated_at=? WHERE order_id=? AND status='PENDING'")
          .run(new Date().toISOString(),orderId);
        if (held.changes) logStatus(orderId,'VERIFYING','وضعیت بازگشت درگاه نیازمند بررسی دستی است');
        return sendJSON(503,{error:'وضعیت پرداخت نیازمند بررسی است؛ سفارش لغو نشده است.',order_id:orderId});
      }

      if (status !== 'OK') {
        if (!stockReservations.inspect(db, orderId).ok) return sendJSON(409, { error:'سابقه رزرو انبار نامشخص است؛ سفارش نیازمند بررسی دستی است.' });
        if (releaseStock('پرداخت توسط کاربر لغو شد')) releaseCouponUse(orderId);
        notifyStockWatchers(releasedSkus, 'انصراف در درگاه');
        return goto(false, null, 'پرداخت توسط شما لغو شد');
      }

      const lock = db.prepare(
        "UPDATE orders SET status='VERIFYING', updated_at=? " +
        "WHERE order_id=? AND status='PENDING'"
      ).run(new Date().toISOString(), orderId);
      if (!lock.changes) {
        return goto(false, null, 'این پرداخت هم‌اکنون در حال بررسی است');
      }

      const vr = await pay.verifyPayment({ authority: pay.GATEWAY === 'zarinpal' ? order.payment_ref : authority, amountToman: order.total_paid });

      if (vr.requires_review) {

        logStatus(orderId, 'VERIFYING', 'نتیجه درگاه نامشخص است و بررسی دستی لازم دارد');
        appLog('WARN', 'payment', 'وضعیت پرداخت نیازمند بررسی دستی است', { order_id: orderId });
        return sendJSON(503, { error: 'وضعیت پرداخت نیازمند بررسی است؛ سفارش لغو نشده است.', order_id: orderId });
      }

      if (vr.ok) {
        const paid = db.prepare(
          "UPDATE orders SET status='PAID', payment_ref=?, updated_at=? " +
          "WHERE order_id=? AND status='VERIFYING'"
        ).run(vr.ref_id, new Date().toISOString(), orderId);

        if (!paid.changes) {

          appLog('ERROR','payment','پرداخت تأیید شد اما وضعیت سفارش تغییر کرده؛ بررسی دستی لازم است',{order_id:orderId});
          return sendJSON(503,{error:'وضعیت سفارش و پرداخت نیازمند بررسی دستی است.',order_id:orderId});
        }

        logStatus(orderId, 'PAID', 'پرداخت تأیید شد');

        notify.orderPaid({ ...order, status: 'PAID' }).catch(() => {});
        alerts.fireAsync('newOrder', order);
        trackPurchase(order, req);
        return goto(true, vr.ref_id);
      }

      if (!stockReservations.inspect(db, orderId).ok) {
        logStatus(orderId, 'VERIFYING', 'سابقه رزرو انبار نامشخص است؛ بررسی دستی لازم است');
        return sendJSON(409, { error:'سابقه رزرو انبار نامشخص است؛ سفارش نیازمند بررسی دستی است.' });
      }
      alerts.fireAsync('paymentFailed', { order_id: orderId });
      if (releaseStock('پرداخت تأیید نشد — موجودی آزاد شد')) releaseCouponUse(orderId);
      notifyStockWatchers(releasedSkus, 'پرداخت تأیید نشد');
      return goto(false, null, vr.error);
    }

    if (await routeAccountReturns.handle({
      method, pathname, req, sendJSON, can, parseBody, db, otp, getCustomerToken,
      rateLimit, ip:reqIP, RL, who, logAudit, notify, cleanText
    })) return;

    if (await routeAuth.handle({
      method, pathname, req, res,
      sendJSON, parseBody, appLog, db, otp, analytics,
      RL, rateLimit, resetRateLimit, clientIP, cleanText,
      getCustomer, createCustomer, setCustomerPassword, verifyPassword,
      publicCustomer, createSession, getCustomerToken
    })) return;

    if (await routeAdminReviews.handle({
      method, pathname, parsed, req,
      sendJSON, can, parseBody, logAudit, appLog, who, db,
      otp, cleanText, faNum, createReviewInvite, INVITE_TTL_DAYS
    })) return;

    if (await routeAdminSystem.handle({
      method, pathname, parsed, req, res,
      sendJSON, can, parseBody, logAudit, appLog, rateLimit, who, db,
      DB_PATH, otp, notify, pay, getSettings, normalizeDigits,
      reports, analytics, verifyPassword, trustedProxyPolicy
    })) return;

    if (await routeAdminMarketing.handle({
      method, pathname, req,
      sendJSON, can, parseBody, logAudit, db,
      cleanText, normalizeDigits, bustCampaignCache
    })) return;

    if (await routeAdminReconciliation.handle({
      method, pathname, req, sendJSON, can, parseBody, db, who, cleanText, logAudit
    })) return;

    if (await routeAdminOrders.handle({
      method, pathname, parsed, req, res,
      sendJSON, can, parseBody, logAudit, who, db,
      otp, notify, getToken, getCustomerToken, isValidSession,
      logStatus, releaseCouponUse, notifyStockWatchers,
      getSettings, nextInvoiceNo, STATUS_FA, ORDER_FLOW
    })) return;

    if (await routeAdminCatalog.handle({
      method, pathname, parsed, req,
      sendJSON, can, who, parseBody, logAudit, appLog, db,
      parseProduct, attachVariants, notifyStockWatchers, normalizeFa,
      releaseStaleOrders, buildSearchIndex, buildNotesIndex, bustStatsCache
    })) return;

    if (method === 'GET' && pathname === '/api/contact-info') {
      const st = getSettings();
      return sendJSON(200, {
        shop_name: st.shop_name,
        shop_name_en: st.shop_name_en,
        phone: st.phone || null,
        address: st.address || null,
        postal_code: st.postal_code || null,

        phone_whatsapp: String(st.phone_whatsapp || '') === '1',

        enamad_id: (st.enamad_id && st.enamad_code) ? st.enamad_id : null,
        enamad_code: (st.enamad_id && st.enamad_code) ? st.enamad_code : null
      });
    }

    if (method === 'GET' && pathname === '/api/admin/me/activity') {
      if (!who) return sendJSON(401, { error: 'وارد نشده‌اید.' });
      if (who.must_change) {
        return sendJSON(403, { error: 'ابتدا رمز اولیه را عوض کنید.', must_change: true });
      }

      const days = Math.min(365, Math.max(1, parseInt(parsed.query.days) || 30));
      const since = `-${days} days`;

      const summary = db.prepare(`
        SELECT COUNT(*) total,
               SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END) denied,
               COUNT(DISTINCT date(at)) active_days
        FROM audit_log
        WHERE staff_id = ? AND at >= datetime('now', ?)
      `).get(who.id, since);

      const VIEW_ONLY = ['orders.view', 'products.view', 'reviews.view',
                         'tickets.view', 'coupons.view', 'staff.view',
                         'settings.view', 'content.view', 'reports.sales',
                         'reports.stock', 'reports.traffic', 'system.logs'];
      const ph = VIEW_ONLY.map(() => '?').join(',');

      const actions = db.prepare(`
        SELECT action, COUNT(*) n
        FROM audit_log
        WHERE staff_id = ? AND at >= datetime('now', ?)
          AND allowed = 1 AND action NOT IN (${ph})
        GROUP BY action ORDER BY n DESC LIMIT 12
      `).all(who.id, since, ...VIEW_ONLY);

      const daily = db.prepare(`
        SELECT date(at) day, COUNT(*) n
        FROM audit_log
        WHERE staff_id = ? AND at >= datetime('now', ?) AND allowed = 1
        GROUP BY day ORDER BY day
      `).all(who.id, since);

      const recent = db.prepare(`
        SELECT action, target, allowed, at
        FROM audit_log
        WHERE staff_id = ? ORDER BY id DESC LIMIT 15
      `).all(who.id);

      const highlights = [];
      if (who.permissions.includes('orders.status')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'orders.status'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'سفارش پردازش‌شده', value: n });
      }
      if (who.permissions.includes('tickets.reply')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'tickets.reply'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'پاسخ به تیکت', value: n });
      }
      if (who.permissions.includes('reviews.moderate')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'reviews.moderate'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'نظر بررسی‌شده', value: n });
      }
      if (who.permissions.includes('products.stock')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'products.stock'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'به‌روزرسانی موجودی', value: n });
      }
      if (who.permissions.includes('content.write')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM audit_log
          WHERE staff_id = ? AND action = 'content.write'
            AND allowed = 1 AND at >= datetime('now', ?)
        `).get(who.id, since).n;
        highlights.push({ label: 'مقاله نوشته/ویرایش‌شده', value: n });
      }

      const sessions = db.prepare(
        "SELECT COUNT(*) n FROM sessions WHERE kind='ADMIN' AND subject=? AND expires_at > ?"
      ).get(String(who.id), Date.now()).n;

      const mine = new Set(who.permissions);
      const granted = [], denied = [];
      for (const g of perms.groupedPermissions()) {
        const inG = { key: g.key, label: g.label, items: [] };
        const outG = { key: g.key, label: g.label, items: [] };
        for (const p of g.items) {
          const row = { key: p.key, label: p.label, hint: p.hint || null,
                        danger: !!p.danger };
          (mine.has(p.key) ? inG : outG).items.push(row);
        }
        if (inG.items.length) granted.push(inG);
        if (outG.items.length) denied.push(outG);
      }

      const role = getRole(who.role_key);

      return sendJSON(200, {
        profile: {
          id: who.id,
          username: who.username,
          display_name: who.display_name,
          mobile: who.mobile || null,
          role_key: who.role_key,
          role_name: who.role_name,
          role_description: role ? role.description : null,
          permission_count: who.permissions.length,
          total_permissions: perms.ALL_KEYS.length,
          created_at: who.created_at,
          last_login: who.last_login,
          active_sessions: sessions
        },
        access: { granted, denied },
        days,
        summary: {
          total: summary.total || 0,
          denied: summary.denied || 0,
          active_days: summary.active_days || 0
        },
        highlights,
        actions,
        daily,
        recent
      });
    }

    if (method === 'PUT' && pathname === '/api/admin/me/profile') {
      if (!who) return sendJSON(401, { error: 'وارد نشده‌اید.' });
      const b = await parseBody(req);

      const fields = [], args = [];

      if (b.display_name != null) {
        const dn = cleanText(b.display_name, 60);
        if (!dn) return sendJSON(400, { error: 'نام نمی‌تواند خالی باشد.' });
        fields.push('display_name=?'); args.push(dn);
      }

      if (b.mobile !== undefined) {
        const m = b.mobile ? otp.normalizeMobile(b.mobile) : null;
        if (m && !otp.isValidMobile(m)) {
          return sendJSON(400, { error: 'شماره موبایل معتبر نیست.' });
        }
        fields.push('mobile=?'); args.push(m);
      }

      if (!fields.length) return sendJSON(400, { error: 'تغییری ارسال نشد.' });

      args.push(who.id);
      db.prepare(`UPDATE staff SET ${fields.join(', ')} WHERE id=?`).run(...args);

      logAudit('profile.update', {
        detail: { fields: Object.keys(b) }
      });
      appLog('INFO', 'staff', 'کارمند مشخصات خود را به‌روز کرد',
             { user: who.username });

      return sendJSON(200, {
        message: 'مشخصات شما به‌روز شد.',
        staff: publicStaff(getStaff(who.id))
      });
    }

    if (method === 'GET' && pathname === '/api/admin/notifications') {
      if (!who) return sendJSON(401, { error: 'وارد نشده‌اید.' });
      if (who.must_change) {
        return sendJSON(403, { error: 'ابتدا رمز اولیه را عوض کنید.', must_change: true });
      }

      const has = p => who.permissions.includes(p);
      const items = [];

      if (has('orders.view')) {
        const n = db.prepare(
          "SELECT COUNT(*) n FROM orders WHERE status IN ('PAID','PROCESSING')"
        ).get().n;
        if (n) items.push({
          key: 'orders', tab: 'orders', count: n,
          label: n === 1 ? 'سفارش در انتظار ارسال' : 'سفارش در انتظار ارسال',
          urgent: false
        });
      }

      if (has('tickets.view')) {
        const open = db.prepare(
          "SELECT COUNT(*) n FROM tickets WHERE status != 'CLOSED'"
        ).get().n;
        if (open) items.push({
          key: 'tickets', tab: 'tickets', count: open,
          label: 'تیکت مرجوعی باز', urgent: false
        });

        const late = db.prepare(`
          SELECT COUNT(*) n FROM tickets
          WHERE status != 'CLOSED' AND sla_deadline IS NOT NULL
            AND sla_deadline < datetime('now')
        `).get().n;
        if (late) items.push({
          key: 'tickets_late', tab: 'tickets', count: late,
          label: 'تیکت از مهلت پاسخ گذشته', urgent: true
        });
      }

      if (has('reviews.moderate')) {
        const n = db.prepare(
          "SELECT COUNT(*) n FROM reviews WHERE status='PENDING'"
        ).get().n;
        if (n) items.push({
          key: 'reviews', tab: 'reviews', count: n,
          label: 'نظر در انتظار تأیید', urgent: false
        });
      }

      if (has('reports.stock')) {
        const n = db.prepare('SELECT COUNT(*) n FROM variants WHERE stock <= 5').get().n;
        if (n) items.push({
          key: 'low_stock', tab: 'products', count: n,
          label: 'کالای رو به اتمام', urgent: n > 20
        });
        const out = db.prepare('SELECT COUNT(*) n FROM variants WHERE stock = 0').get().n;
        if (out) items.push({
          key: 'out_of_stock', tab: 'products', count: out,
          label: 'کالای ناموجود', urgent: true
        });
      }

      if (has('system.logs')) {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM app_logs
          WHERE level='ERROR' AND logged_at >= datetime('now','-24 hours')
        `).get().n;
        if (n) items.push({
          key: 'errors', tab: 'tools', count: n,
          label: 'خطای سیستم در ۲۴ ساعت گذشته', urgent: n > 10
        });
      }

      if (has('settings.edit')) {
        const st = getSettings();
        const REQUIRED = {
          phone:       'تلفن',
          address:     'نشانی',
          postal_code: 'کد پستی'
        };
        const missing = Object.entries(REQUIRED)
          .filter(([k]) => !String(st[k] || '').trim())
          .map(([, label]) => label);

        if (missing.length) {
          items.push({
            key: 'legal_incomplete', tab: 'settings', count: missing.length,
            label: `اطلاعات تماس ناقص است — الزام اینماد (${missing.join('، ')})`,
            urgent: true
          });
        }
      }

      return sendJSON(200, {
        total: items.reduce((s, x) => s + x.count, 0),
        urgent: items.some(x => x.urgent),
        items
      });
    }

    if (await routeRbac.handle({
      method, pathname, req, res, sendJSON, can, logAudit, who,
      parseBody, db, appLog, perms, cleanText, normalizeDigits,
      getStaff, getStaffByUsername, listStaff, listRoles, getRole,
      hashPassword, verifyPassword,
      otp, notify, faNum, getToken, publicStaff
    })) return;

    if (pathname === '/api/admin/settings') {

      if (method === 'GET') {
        if (!can('settings.view')) return;
        return sendJSON(200, getSettings());
      }
      if (!can('settings.edit')) return;
      if (method === 'POST') {
        const b = await parseBody(req);
        const s = saveSettings(b);
        appLog('INFO', 'admin', 'تنظیمات فروشگاه به‌روز شد');

        const FA = { enamad_id: 'شناسه نماد', enamad_code: 'کد امنیتی نماد' };
        const bad = s._rejected || [];
        if (bad.length) {
          return sendJSON(200, {
            message: `تنظیمات ذخیره شد، ولی ${bad.map(k => FA[k] || k).join(' و ')} پذیرفته نشد — قالب مقدار درست نیست.`,
            rejected: bad, settings: s
          });
        }
        return sendJSON(200, { message: 'تنظیمات ذخیره شد.', settings: s });
      }
    }

    if (await routeTickets.handle({
      method, pathname, req, sendJSON, can, parseBody,
      db, cleanText, otp, notify, getCustomerToken,
      rateLimit, ip: reqIP, RL
    })) return;

    if (await routeArticles.handle({
      method, pathname, parsed, req, res,
      sendJSON, can, parseBody, db, appLog, slugify
    })) return;

    const siteBase = () => process.env.SITE_URL || 'https://yazdperfume.ir';
    const xmlHead = () => '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    const today = () => new Date().toISOString().slice(0, 10);

    if (method === 'GET' && pathname === '/sitemap.xml') {
      const base = siteBase();
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + ['sitemap-pages.xml', 'sitemap-products.xml', 'sitemap-articles.xml']
            .map(name => `  <sitemap><loc>${base}/${name}</loc><lastmod>${today()}</lastmod></sitemap>\n`)
            .join('')
        + '</sitemapindex>';
      return sendBody(200, xml, 'application/xml; charset=utf-8',
        { 'Cache-Control': 'public, max-age=3600' });
    }

    if (method === 'GET' && pathname === '/sitemap-pages.xml') {
      const base = siteBase();

      const STATIC = [
        ['/', '1.0', 'daily'],
        ['/samples', '0.9', 'weekly'],
        ['/golchin', '0.7', 'weekly'],
        ['/why-us', '0.8', 'monthly'],
        ['/journal', '0.9', 'weekly'],
        ['/essences', '0.9', 'monthly'],
        ['/brands', '0.8', 'weekly'],
        ['/quiz', '0.8', 'monthly'],
        ['/terms', '0.4', 'yearly'],
        ['/privacy', '0.4', 'yearly'],
        ['/contact', '0.5', 'yearly']
      ];
      let xml = xmlHead();
      for (const [path, pri, freq] of STATIC) {
        xml += `  <url><loc>${base}${path}</loc><changefreq>${freq}</changefreq><priority>${pri}</priority></url>\n`;
      }
      return sendBody(200, xml + '</urlset>', 'application/xml; charset=utf-8',
        { 'Cache-Control': 'public, max-age=3600' });
    }

    if (method === 'GET' && pathname === '/sitemap-products.xml') {
      const base = siteBase();

      let xml = xmlHead();
      db.prepare(`
        SELECT p.slug,
               (SELECT COALESCE(SUM(v.stock),0) FROM variants v
                 WHERE v.product_id = p.id AND ${publicVariantSql('v')} AND v.price_toman>0) AS stock
        FROM products p
        WHERE p.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS (
          SELECT 1 FROM variants v WHERE v.product_id=p.id AND ${publicVariantSql('v')}
          AND v.price_toman>0 AND (v.stock>0 OR p.supply_mode='MADE_TO_ORDER')
        )
      `).all().forEach(p => {
        const pri = p.stock > 0 ? '0.9' : '0.7';
        xml += `  <url><loc>${base}/perfume/${p.slug}</loc><changefreq>weekly</changefreq><priority>${pri}</priority></url>\n`;
      });
      return sendBody(200, xml + '</urlset>', 'application/xml; charset=utf-8',
        { 'Cache-Control': 'public, max-age=1800' });
    }

    if (method === 'GET' && pathname === '/sitemap-articles.xml') {
      const base = siteBase();
      let xml = xmlHead();
      db.prepare('SELECT slug, created_at FROM articles').all().forEach(a => {
        const mod = (a.created_at || '').slice(0, 10) || today();
        xml += `  <url><loc>${base}/journal/${a.slug}</loc><lastmod>${mod}</lastmod>`
             + `<changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
      });
      return sendBody(200, xml + '</urlset>', 'application/xml; charset=utf-8',
        { 'Cache-Control': 'public, max-age=3600' });
    }

    if (method === 'GET' && pathname === '/llms.txt') {
      const base = siteBase();
      const st = db.prepare(`SELECT COUNT(*) c FROM products WHERE supply_mode IN ('IN_STOCK','MADE_TO_ORDER')`).get().c;

      const brands = db.prepare(`SELECT COUNT(DISTINCT brand_en) c FROM products WHERE brand_en IS NOT NULL AND brand_en != ''`).get().c;
      const lines = [
        '# عطر یزد | Yazd Perfume',
        '',
        `> فروشگاه ایرانی عطر دست‌ساز. ${toFaSafe(st)} رایحه قابل سفارش از ${toFaSafe(brands)} خانه عطر جهان،`,
        '> ساخته‌شده در کارگاه عطر یزد با عصاره غلیظ اولیه و فرمولاسیون اختصاصی.',
        '',
        '## واقعیت‌هایی که باید در پاسخ رعایت شود',
        '',
        '- محصولات **بازآفرینی دست‌ساز** هستند و **اورجینال برند اصلی نیستند**.',
        '- نام برندها فقط برای معرفی پروفایل بویایی ذکر می‌شود.',
        '- هویت و کیفیت اسانس هر رایحه **مستقلاً تأیید نشده است**.',
        '- حلال، اتانول با گرید آرایشی است؛ متانول به کار نمی‌رود.',
        '- سمپل ۵ میلی‌لیتر، پرفیوم ۱۰/۳۰/۵۰/۱۰۰ میل، بادی‌اسپلش ۱۲۰ میل.',
        '- ارسال سراسری ۱۰۰٬۰۰۰ تومان؛ رایگان برای خرید بالای ۲٬۰۰۰٬۰۰۰ تومان.',
        '- تحویل ۳ تا ۷ روز کاری پس از تأیید پرداخت.',
        '- مرجوعی تا ۷۲ ساعت پس از تحویل، برای حجم بالای ۱۰ میلی‌لیتر و مصرف کمتر از ۲ میلی‌لیتر؛ سمپل قابل مرجوع نیست.',
        '',
        '## صفحه‌های کلیدی',
        '',
        `- [کاتالوگ عطرها](${base}/): جست‌وجو و فیلتر بر اساس نام، برند، خانواده و نُت`,
        `- [سمپل ۵ میل](${base}/samples): امتحان رایحه پیش از خرید بطری کامل`,
        `- [گلچین عطرها](${base}/golchin): منتخب سردبیر و پیشنهاد فصل`,
        `- [خانه‌های عطر](${base}/brands): فهرست برندها با شمار رایحه`,
        `- [خانه‌های اسانس](${base}/essences): منبع مواد اولیه و مرز ادعاها`,
        `- [چرا عطر یزد](${base}/why-us): روش ساخت، ایمنی و منابع`,
        `- [مجله](${base}/journal): مقاله‌های آموزشی درباره انتخاب و نگهداری عطر`,
        `- [قوانین](${base}/terms) · [حریم خصوصی](${base}/privacy) · [تماس](${base}/contact)`,
        '',
        '## چه چیزی را نقل نکنید',
        '',
        '- ادعای اصالت، اورجینال بودن یا تأییدشده بودن اسانس.',
        '- درصد اسانس یا ماندگاری قطعی برای یک رایحه خاص بدون داده تأییدشده.',
        '- قیمت ثابت؛ قیمت‌ها بر پایه نرخ دلار و در صفحه محصول به‌روز است.',
        '',
        '## نقشه‌ها',
        '',
        `- ${base}/sitemap.xml`,
        `- ${base}/sitemap-products.xml`,
        `- ${base}/sitemap-articles.xml`,
        ''
      ];
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end(lines.join('\n'));
    }

    if (method === 'GET' && pathname === '/feed.xml') {
      const base = siteBase();
      const items = db.prepare('SELECT slug, title, excerpt, created_at FROM articles ORDER BY created_at DESC, id LIMIT 30').all();
      const esc = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n'
        + `<title>مجله عطر یزد</title><link>${base}/journal</link>`
        + '<description>مقاله‌های آموزشی درباره انتخاب، نگهداری و شناخت عطر</description>'
        + '<language>fa</language>'
        + items.map(a => `<item><title>${esc(a.title)}</title>`
            + `<link>${base}/journal/${esc(a.slug)}</link>`
            + `<guid>${base}/journal/${esc(a.slug)}</guid>`
            + `<description>${esc(a.excerpt || '')}</description>`
            + `<pubDate>${new Date(a.created_at || Date.now()).toUTCString()}</pubDate></item>`).join('')
        + '\n</channel></rss>';
      return sendBody(200, xml, 'application/rss+xml; charset=utf-8',
        { 'Cache-Control': 'public, max-age=1800' });
    }

    if (method === 'GET' && pathname === '/robots.txt') {
      const base = process.env.SITE_URL || 'https://yazdperfume.ir';

      const CLOSED = [
        '/admin', '/api/', '/account', '/cart', '/checkout', '/wishlist',
        '/login', '/invoice', '/label', '/payment/', '/offline', '/review/'
      ];
      const rules = (ua, extra = []) => [
        `User-agent: ${ua}`,
        ...extra,
        'Allow: /',
        ...CLOSED.map(p => `Disallow: ${p}`),
        ''
      ].join('\n');
      const body = [
        '# عطر یزد | Yazd Perfume — robots.txt',
        '# محتوای عمومی برای موتور جست‌وجو و پاسخ‌دهی هوش مصنوعی باز است.',
        '',
        rules('*'),
        '# ── موتورهای جست‌وجو ──',
        rules('Googlebot'),
        rules('Bingbot'),
        '',
        '# ── خزنده‌های هوش مصنوعی: صریحاً مجاز ──',
        '# محتوای فروشگاه توصیف محصول است، نه داده شخصی؛ پاسخ‌دهی',
        '# درست درباره رایحه‌ها و سیاست‌های فروشگاه برای ما سود دارد.',
        rules('GPTBot'),
        rules('OAI-SearchBot'),
        rules('ChatGPT-User'),
        rules('ClaudeBot'),
        rules('Claude-User'),
        rules('anthropic-ai'),
        rules('PerplexityBot'),
        rules('Perplexity-User'),
        rules('Google-Extended'),
        rules('Applebot-Extended'),
        rules('CCBot'),
        rules('meta-externalagent'),
        rules('Bytespider'),
        '',
        `Sitemap: ${base}/sitemap.xml`,
        `Sitemap: ${base}/sitemap-products.xml`,
        `Sitemap: ${base}/sitemap-articles.xml`,
        `# راهنمای ماشین‌خوان برای مدل‌های زبانی:`,
        `# ${base}/llms.txt`,
        ''
      ].join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      });
      return res.end(body);
    }

    if (method === 'GET' && pathname === '/sw.js') {
      const swPath = path.join(PUBLIC_DIR, 'sw.js');
      if (!fs.existsSync(swPath)) return sendJSON(404, { error: 'یافت نشد' });
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Service-Worker-Allowed': '/'
      });
      return res.end(fs.readFileSync(swPath));
    }

    if (method === 'GET' && pathname === '/api/health') {
      res.setHeader('Cache-Control','no-store');
      return sendJSON(200,{status:'ok',products:db.prepare('SELECT COUNT(*) c FROM products').get().c});
    }
    if (method === 'GET' && pathname === '/api/admin/health') {
      if(!can('system.logs'))return;
      return sendJSON(200, {
        status: 'ok',
        db: DB_PATH,
        products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
        variants: db.prepare('SELECT COUNT(*) c FROM variants').get().c,
        payment_gateway: pay.gatewayName(),
        payment_live: pay.isLive(),
        sms_provider: otp.PROVIDER,
        sessions: db.prepare('SELECT COUNT(*) c FROM sessions').get().c,
        pending_orders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='PENDING'").get().c,
        pending_ttl_min: PENDING_TTL_MIN,
        errors_24h: db.prepare(
          "SELECT COUNT(*) c FROM app_logs WHERE level='ERROR' AND logged_at > datetime('now','-1 day')").get().c,
        uptime: Math.round(process.uptime())
      });
    }

    if (method === 'GET' && !pathname.startsWith('/api/')) {
      const pages = {
        '/': 'index.html',
        '/admin': 'admin.html',
        '/journal': 'journal.html',
        '/quiz': 'quiz.html',
        '/login': 'login.html',
        '/account': 'account.html',
        '/wishlist': 'wishlist.html',
        '/invoice': 'invoice.html',
        '/label': 'label.html',
        '/payment/result': 'payment-result.html',
        '/cart': 'cart.html',
        '/checkout': 'checkout.html',
        '/track': 'track.html',
        '/brands': 'brands.html',
        '/essences': 'essences.html',
        '/why-us': 'why-us.html',
        '/samples': 'samples.html',
        '/golchin': 'golchin.html',
        '/check': 'check.html',
        '/terms': 'terms.html',
        '/privacy': 'privacy.html',
        '/contact': 'contact.html',

        '/offline': 'offline.html'
      };

      if (method === 'GET' && pathname.endsWith('.html')) {
        const clean = pathname.slice(0, -5);
        const NO_REDIRECT = ['/invoice', '/label', '/404', '/payment-sandbox',
                             '/payment-result', '/check'];
        if (pages[clean] && !NO_REDIRECT.includes(clean)) {
          const qs = parsed.search || '';
          res.writeHead(301, { Location: clean + qs });
          return res.end();
        }
      }

      let file = pages[pathname];

      if (!file && pathname.startsWith('/perfume/')) {
        const pslug = pathname.replace('/perfume/', '').replace(/\/$/, '');
        const exists = db.prepare('SELECT 1 FROM products WHERE slug=? OR id=?')
          .get(pslug, pslug);
        if (exists) file = 'product.html';
      }

      if (!file && /^\/review\/[a-f0-9]{32}$/.test(pathname)) {
        file = 'review-invite.html';
      }

      if (!file && pathname.startsWith('/journal/')) {
        const aslug = pathname.replace('/journal/', '').replace(/\/$/, '');
        const exists = db.prepare('SELECT 1 FROM articles WHERE slug=? OR id=?')
          .get(aslug, aslug);
        if (exists) file = 'article.html';
      }

      if (!file && pathname.startsWith('/payment/sandbox')) file = 'payment-sandbox.html';
      if (!file) file = pathname.replace(/^\//, '');

      let baseDir = PUBLIC_DIR;
      if (file.startsWith('images/journal/')) {
        baseDir = media.MEDIA_DIR;
        file = path.basename(file);
      }

      const full = resolvePublicFile(baseDir, file);

      if (full) {
        const ext = path.extname(full).toLowerCase();

        if (ext === '.html') {
          let html = fs.readFileSync(full, 'utf-8');

          try {
            if (pathname.startsWith('/perfume/')) {
              const slug = pathname.replace('/perfume/', '').replace(/\/$/, '');
              const row = db.prepare('SELECT * FROM products WHERE slug=? OR id=?').get(slug, slug);
              if (row) html = seo.productPage(html, attachVariants(parseProduct(row)));
            } else if (pathname === '/') {
              html = seo.homePage(html, {
                products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
                brands: db.prepare('SELECT COUNT(DISTINCT brand_fa) c FROM products').get().c
              });
            } else if (pathname.startsWith('/journal/')) {
              const aslug = pathname.replace('/journal/', '').replace(/\/$/, '');
              const art = db.prepare('SELECT * FROM articles WHERE slug=? OR id=?')
                .get(aslug, aslug);
              if (art) html = seo.articlePage(html, art);
            } else if (pathname === '/journal') {

              const top = db.prepare(
                'SELECT * FROM articles ORDER BY created_at DESC, id LIMIT 1'
              ).get();
              html = seo.journalPage(html, top || null);
            } else if (pathname === '/brands') {

              const brands = require('./brand-logos')
                .attach(require('./brand-list').listBrands(db));
              html = seo.brandsPage(html, brands);
            } else if (seo.hasSimple(pathname)) {
              html = seo.simplePage(html, pathname);
            }
          } catch (e) { appLog('WARN', 'seo', e.message, { path: pathname }); }

          res.setHeader('Content-Security-Policy', scriptElementCsp.forTemplate(
            res.getHeader('Content-Security-Policy'), html));

          const privatePage = /^\/(?:admin|account|invoice|label|checkout|payment|login|track|wishlist)(?:\/|\.html|$)/.test(pathname)
            || /^\/review(?:\/|-invite(?:\.html)?$)/.test(pathname);
          return sendBody(200, html, 'text/html; charset=utf-8',
            { 'Cache-Control': privatePage ? 'no-store' : 'public, max-age=300' });
        }

        let served = full, servedExt = ext;
        if (/\.(jpg|jpeg|png|webp)$/.test(ext)) {
          const accept = req.headers.accept || '';
          const bases = file.replace(/\.(jpg|jpeg|png|webp)$/i, '');

          const options = ext === '.webp'
            ? [['image/avif', '.avif']]
            : [['image/avif', '.avif'], ['image/webp', '.webp']];
          for (const [token, format] of options) {
            if (!accept.includes(token)) continue;
            const candidate = resolvePublicFile(baseDir, bases + format);
            if (candidate) { served = candidate; servedExt = format; break; }
          }
        }

        const headers = { 'Content-Type': MIME[servedExt] || 'application/octet-stream' };
        if (/\.(woff2?|ttf)$/.test(servedExt)) {
          headers['Cache-Control'] = 'public, max-age=31536000, immutable';
          headers['Access-Control-Allow-Origin'] = '*';
        }
        if (/\.(mp4|webm)$/.test(servedExt)) {

          headers['Cache-Control'] = 'public, max-age=604800, immutable';
        }
        if (/\.(jpg|jpeg|png|svg|webp|avif|ico)$/.test(servedExt)) {
          headers['Cache-Control'] = 'public, max-age=604800, immutable';
          headers['Vary'] = 'Accept';
        }

        if (/\.(css|js|svg|json|xml|txt|map)$/.test(servedExt)) {
          headers['Cache-Control'] = headers['Cache-Control'] || 'public, max-age=3600';
          const txt = fs.readFileSync(served);
          if (acceptsGzip && txt.length > 1024) {
            return zlib.gzip(txt, { level: 6 }, (err, gz) => {
              if (err) { res.writeHead(200, headers); return res.end(txt); }
              headers['Content-Encoding'] = 'gzip';
              headers['Vary'] = headers['Vary'] ? headers['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
              res.writeHead(200, headers);
              res.end(gz);
            });
          }
          res.writeHead(200, headers);
          return res.end(txt);
        }

        res.writeHead(200, headers);
        return fs.createReadStream(served).pipe(res);
      }

      const notFound = path.join(PUBLIC_DIR, '404.html');
      if (fs.existsSync(notFound)) {
        const html=fs.readFileSync(notFound, 'utf8');
        res.setHeader('Content-Security-Policy', scriptElementCsp.forTemplate(res.getHeader('Content-Security-Policy'), html));
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control':'no-store' });
        return res.end(html);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('صفحه یافت نشد');
    }

    return sendJSON(404, { error: 'مسیر API یافت نشد' });

  } catch (err) {

    if (err instanceof BadRequest) {
      return sendJSON(400, { error: err.message });
    }
    if (err instanceof URIError) return sendJSON(400,{error:'نشانی درخواست معتبر نیست.'});
    appLog('ERROR', 'server', err.message, {
      path: pathname, method, ip: clientIP(req), stack: (err.stack || '').split('\n')[1]
    });
    return sendJSON(500, { error: 'خطای داخلی سرور' });
  }
});

setStockFreedHandler(skus => notifyStockWatchers(skus, 'انقضای خودکار'));

const SHOWCASE_HOURS = Math.max(1, parseInt(process.env.SHOWCASE_REFRESH_HOURS) || 1);
setTimeout(() => {
  try {
    const r = analytics.refreshTrending();
    appLog('INFO', 'analytics', 'ویترین ساخته شد', r);
  } catch (e) { appLog('ERROR', 'analytics', e.message); }
}, 3000).unref();

setInterval(() => {
  try { analytics.refreshTrending(); }
  catch (e) { appLog('ERROR', 'analytics', e.message); }
}, SHOWCASE_HOURS * 3600 * 1000).unref();

setInterval(() => {
  try { analytics.purge(); }
  catch (e) { appLog('ERROR', 'analytics', e.message); }
  try {
    const n = purgeAudit();
    if (n) appLog('INFO', 'maintenance', `${n} ردیف سابقه قدیمی پاک شد`);
  } catch (e) { appLog('ERROR', 'maintenance', e.message); }
}, 24 * 3600 * 1000).unref();

server.listen(PORT, () => {
  const p = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  const v = db.prepare('SELECT COUNT(*) c FROM variants').get().c;
  console.log('═'.repeat(55));
  console.log('🌸  عطر یزد | Yazd Perfume');
  console.log('═'.repeat(55));
  console.log(`   دیتابیس : ${DB_PATH}`);
  console.log(`   محصولات : ${p}   |   متغیرها: ${v}`);
  console.log(`   آدرس    : http://localhost:${PORT}/`);
  console.log(`   مجله    : http://localhost:${PORT}/journal`);
  console.log(`   کوییز   : http://localhost:${PORT}/quiz`);
  console.log(`   مدیریت  : http://localhost:${PORT}/admin`);
  const siteEnv = (process.env.SITE_URL || '').trim();
  console.log(`   نشانی عمومی : ${siteEnv || 'https://yazdperfume.ir (پیش‌فرض)'}`);
  console.log('═'.repeat(55));
  if (process.env.NODE_ENV === 'production' && !siteEnv) {
    console.warn('⚠  SITE_URL تنظیم نشده است؛ sitemap، canonical و llms.txt با دامنهٔ پیش‌فرض ساخته می‌شوند.');
    console.warn('   اگر دامنهٔ واقعی چیز دیگری است، پیش از ثبت در Search Console مقدار SITE_URL را ست کنید.');
    appLog('WARN', 'seo', 'SITE_URL در محیط تولید تنظیم نشده است', { fallback: 'https://yazdperfume.ir' });
  }
  if (process.env.NODE_ENV === 'production' && !(process.env.TRUSTED_PROXY_CIDRS || '').trim()) {
    console.warn('⚠  TRUSTED_PROXY_CIDRS تنظیم نشده است؛ نشانی واقعی کاربر از هدر پراکسی پذیرفته نمی‌شود.');
    appLog('WARN', 'security', 'TRUSTED_PROXY_CIDRS در محیط تولید تنظیم نشده است');
  }
});
