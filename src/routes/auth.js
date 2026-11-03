/**
 * عطر یزد | احراز هویت مشتری
 * ------------------------------
 * گام ۶ از تفکیک کامل `server.js`.
 *
 * ── محتوا ──
 *   POST /api/auth/register         ثبت‌نام با رمز
 *   POST /api/auth/login            ورود با رمز
 *   POST /api/auth/forgot-password  درخواست بازیابی
 *   POST /api/auth/reset-password   تنظیم رمز تازه
 *   POST /api/auth/request-code     درخواست کد یکبارمصرف
 *   POST /api/auth/verify-code      تأیید کد و ساخت نشست
 *   GET  /api/auth/me               وضعیت ورود
 *   POST /api/auth/logout           خروج
 *   GET  /api/auth/orders           سفارش‌های من
 *
 * ── حساس‌ترین ماژول تا اینجا ──
 * برخلاف گام‌های پیشین، اینجا `can()` وجود ندارد — این مسیرها
 * **عمومی‌اند** و خودشان دروازه ورود به سیستم‌اند. پس محافظ‌ها
 * از جنس دیگری هستند:
 *
 *   ۱) **محدودیت نرخ چندلایه** — ثبت‌نام ۵ در نیم‌ساعت، ورود ۸ در
 *      ربع‌ساعت، کد یکبارمصرف هم بر پایه IP و هم بر پایه شماره
 *   ۲) **کوکی HttpOnly** — توکن نشست از دسترس جاوااسکریپت بیرون
 *   ۳) **پاسخ یکسان برای موبایل موجود و ناموجود** در بازیابی رمز،
 *      تا نتوان فهرست مشتریان را حدس زد
 *   ۴) **`publicCustomer()`** — هش رمز هرگز برنمی‌گردد
 *
 * هر چهار مورد در `test_accounts.js` و `test_otp_persistence.js`
 * آزموده می‌شوند.
 *
 * ── قرارداد `ctx` ──
 * ماژول زمینه می‌گیرد و `Promise<boolean>` برمی‌گرداند.
 */

'use strict';
const phoneVerification = require('../customer-phone-verification');
const crypto = require('crypto');
const returnStore = require('../return-store');
const { eligibility: returnEligibility } = require('../return-eligibility');

/**
 * @param {object}   ctx
 * @param {string}   ctx.method
 * @param {string}   ctx.pathname
 * @param {object}   ctx.req
 * @param {object}   ctx.res                  برای کوکی نشست
 * @param {Function} ctx.parseBody
 * @param {Function} ctx.appLog
 * @param {object}   ctx.db
 * @param {object}   ctx.otp
 * @param {object}   ctx.analytics
 * @param {object}   ctx.RL                   سیاست محدودیت نرخ
 * @param {Function} ctx.rateLimit
 * @param {Function} ctx.resetRateLimit
 * @param {Function} ctx.clientIP
 * @param {Function} ctx.cleanText
 * @param {Function} ctx.getCustomer
 * @param {Function} ctx.createCustomer
 * @param {Function} ctx.setCustomerPassword
 * @param {Function} ctx.verifyPassword
 * @param {Function} ctx.publicCustomer       فهرست سفید — بدون هش رمز
 * @param {Function} ctx.createSession
 * @param {Function} ctx.getCustomerToken
 * @returns {Promise<boolean>}
 */
async function handle(ctx) {
  const {
    method, pathname, req, res,
    parseBody, appLog, db, otp, analytics,
    RL, rateLimit, resetRateLimit, clientIP, cleanText,
    getCustomer, createCustomer, setCustomerPassword, verifyPassword,
    publicCustomer, createSession, getCustomerToken
  } = ctx;

  /* پوشش `sendJSON` — درس گام ۱.
     بررسی شد: این ماژول پاسخ استریمی ندارد. دو مورد
     `res.setHeader` برای کوکی نشست‌اند که **پیش از** بدنه اجرا
     می‌شوند، پس تداخلی ندارند. */
  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };
  if (pathname.startsWith('/api/auth/')) res.setHeader('Cache-Control','no-store');
  function issueCustomerCookie(token) {
    const secure=String(process.env.NODE_ENV||'').trim().toLowerCase()==='production' ? '; Secure' : '';
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Set-Cookie',`yazd_customer=${token}; HttpOnly; Path=/; Max-Age=${otp.SESSION_TTL / 1000}; SameSite=Lax${secure}`);
  }
  // Browser UI requests a cookie-only response; token-based API clients keep
  // the existing response for backward compatibility.
  const apiToken=token=>req.headers['x-customer-cookie-only']==='1'?{}:{token};

  if (method === 'POST' && pathname === '/api/auth/register') {
    const b = await parseBody(req);
    const ip = clientIP(req);

    const rl = rateLimit(`reg:${ip}`, 5, 30 * 60e3, 30 * 60e3);
    if (!rl.ok) {
      return sendJSON(429, {
        error: 'تلاش‌های بیش از حد. کمی بعد دوباره امتحان کنید.',
        retry_after: rl.retry_after
      });
    }

    const first = cleanText(b.first_name, 40);
    if (!first || first.length < 2) {
      return sendJSON(400, { error: 'نام را وارد کنید (حداقل ۲ نویسه).' });
    }
    const last = b.last_name ? cleanText(b.last_name, 40) : null;

    const mobile = otp.normalizeMobile(b.mobile);
    if (!otp.isValidMobile(mobile)) {
      return sendJSON(400, { error: 'شماره موبایل معتبر نیست.' });
    }

    const password = String(b.password || '');
    if (password.length < 8) {
      return sendJSON(400, { error: 'رمز عبور باید حداقل ۸ نویسه باشد.' });
    }

    if (!phoneVerification.ready(db)) return sendJSON(503,{error:'سامانه تأیید شماره هنوز آماده نیست.'});
    // OTP consumption, ownership record, customer mutation and session are
    // one transaction. Legacy accounts/passwords are not implicitly trusted.
    const result=db.transaction(()=>{
      const check=otp.consumeCode(mobile,b.code);
      if(!check.ok)return {status:400,error:check.error};
      const exists=getCustomer(mobile);
      if(exists && !exists.active)return {status:403,error:'حساب شما غیرفعال شده است.'};
      if(exists && exists.pass_hash)return {status:409,error:'با این شماره قبلاً حساب ساخته شده است. از ورود یا بازیابی رمز استفاده کنید.'};
      let customer;
      if(exists){setCustomerPassword(exists.id,password);customer=getCustomer(mobile);}
      else customer=createCustomer({mobile,first_name:first,last_name:last,email:b.email?cleanText(b.email,80):null,password});
      phoneVerification.markVerified(db,mobile,true);
      db.prepare("DELETE FROM sessions WHERE kind IN ('CUSTOMER','CUSTOMER_VERIFIED') AND subject=?").run(mobile);
      const token=createSession('CUSTOMER_VERIFIED',mobile,otp.SESSION_TTL);
      return {status:exists?200:201,token,customer:publicCustomer(customer)};
    }).immediate();
    if(result.error)return sendJSON(result.status,{error:result.error});
    issueCustomerCookie(result.token);
    appLog('INFO','auth','حساب مشتری با تأیید شماره ثبت شد',{mobile});
    analytics.track('register',null,null,req);
    return sendJSON(result.status,{message:`خوش آمدید ${first}!`,...apiToken(result.token),customer:result.customer});
  }

  /** ورود با شماره موبایل و رمز */
  if (method === 'POST' && pathname === '/api/auth/login') {
    const b = await parseBody(req);
    const ip = clientIP(req);

    const rl = rateLimit(`clogin:${ip}`, 8, 15 * 60e3, 15 * 60e3);
    if (!rl.ok) {
      appLog('WARN', 'security', 'تلاش‌های مکرر ورود مشتری', { ip });
      return sendJSON(429, {
        error: `تلاش ناموفق بیش از حد. ${Math.ceil(rl.retry_after / 60)} دقیقه دیگر تلاش کنید.`,
        retry_after: rl.retry_after
      });
    }

    if (!phoneVerification.ready(db)) return sendJSON(503,{error:'سامانه تأیید شماره هنوز آماده نیست.'});
    const mobile = otp.normalizeMobile(b.mobile);
    const password = String(b.password || '');
    // Distributed guesses remain bounded even if the forwarded IP changes.
    const phoneKey = otp.isValidMobile(mobile) ? 'clogin-phone:'+crypto.createHash('sha256').update(mobile).digest('hex') : null;
    if(phoneKey){const ph=rateLimit(phoneKey,8,15*60e3,15*60e3);if(!ph.ok)return sendJSON(429,{error:'تلاش‌های ورود برای این شماره بیش از حد است. کمی بعد تلاش کنید.',retry_after:ph.retry_after});}
    const c = getCustomer(mobile);

    // پیام یکسان برای «حساب نیست» و «رمز غلط» تا شماره‌های
    // ثبت‌شده لو نروند
    const bad = () => {
      appLog('WARN', 'security', 'ورود ناموفق مشتری', { ip });
      return sendJSON(401, { error: 'شماره موبایل یا رمز عبور نادرست است.' });
    };

    if (!c || !c.pass_hash) return bad();
    if (!verifyPassword(password, c.pass_hash, c.pass_salt)) return bad();
    // Verify the same stored credential again under a write lock before issuing
    // a session: a concurrent OTP reset must not resurrect an old password.
    const auth=db.transaction(()=>{
      const latest=getCustomer(mobile);
      if(!latest || latest.pass_hash!==c.pass_hash || latest.pass_salt!==c.pass_salt)return {kind:'bad'};
      if(!latest.active)return {kind:'disabled'};
      if(!phoneVerification.trustedPassword(db,mobile))return {kind:'untrusted'};
      db.prepare('UPDATE customers SET last_login=? WHERE id=?').run(new Date().toISOString(),latest.id);
      return {kind:'ok',token:createSession('CUSTOMER_VERIFIED',mobile,otp.SESSION_TTL),customer:publicCustomer(latest)};
    }).immediate();
    if(auth.kind==='bad')return bad();
    if(auth.kind==='disabled')return sendJSON(403,{error:'حساب شما غیرفعال شده است.'});
    if(auth.kind==='untrusted')return sendJSON(403,{error:'برای امنیت حساب، یک‌بار رمز را با کد پیامکی از بخش بازیابی رمز تغییر دهید.',phone_verification_required:true});
    resetRateLimit(`clogin:${ip}`);
    if(phoneKey)resetRateLimit(phoneKey);
    issueCustomerCookie(auth.token);
    appLog('INFO','auth','ورود موفق مشتری',{mobile});
    return sendJSON(200,{message:'ورود موفق',...apiToken(auth.token),customer:auth.customer});
  }

  /**
   * بازیابی رمز — مرحله یک: درخواست کد پیامکی.
   *
   * پاسخ همیشه یکسان است، حتی اگر شماره ثبت نشده باشد. وگرنه
   * مهاجم می‌تواند بفهمد چه شماره‌هایی در سیستم هستند.
   */
  if (method === 'POST' && pathname === '/api/auth/forgot-password') {
    const b = await parseBody(req);
    const ip = clientIP(req);
    const mobile = otp.normalizeMobile(b.mobile);

    if (!otp.isValidMobile(mobile)) {
      return sendJSON(400, { error: 'شماره موبایل معتبر نیست.' });
    }

    const rl = rateLimit(`forgot:${mobile}`, 3, 30 * 60e3, 30 * 60e3);
    if (!rl.ok) {
      return sendJSON(429, {
        error: 'درخواست بیش از حد. نیم ساعت دیگر تلاش کنید.',
        retry_after: rl.retry_after
      });
    }

    // Share SMS abuse limits with ordinary code requests; otherwise this
    // endpoint can bypass the per-IP and per-phone limits for sending codes.
    const ipRl = rateLimit(`otp-ip:${ip}`, RL.otpIp.limit, RL.otpIp.window, RL.otpIp.block);
    if (!ipRl.ok) return sendJSON(429,{error:'درخواست‌های بیش از حد. لطفاً بعداً تلاش کنید.',retry_after:ipRl.retry_after});
    const pRl = rateLimit(`otp-ph:${mobile}`, RL.otpPhone.limit, RL.otpPhone.window, RL.otpPhone.block);
    if (!pRl.ok) return sendJSON(429,{error:'برای این شماره درخواست‌های زیادی ثبت شده. یک ساعت دیگر تلاش کنید.',retry_after:pRl.retry_after});

    if (!phoneVerification.ready(db) || !(await otp.deliveryAvailable())) return sendJSON(503,{error:'سامانه پیامک یا تأیید شماره هنوز آماده نیست.'});
    // Both existing and unknown numbers take the same provider path. Merely
    // returning the same text while sending only for existing accounts leaks
    // account existence through provider latency. Code ownership is still
    // required; reset-password will not create a missing account.
    await otp.requestCode(mobile);

    return sendJSON(200, {
      message: 'درخواست بازیابی ثبت شد. در صورت امکان، کد به این شماره ارسال می‌شود.'
    });
  }

  /** بازیابی رمز — مرحله دو: تأیید کد و ثبت رمز تازه */
  if (method === 'POST' && pathname === '/api/auth/reset-password') {
    const b = await parseBody(req);
    const mobile = otp.normalizeMobile(b.mobile);
    const code = String(b.code || '').trim();
    const next = String(b.new_password || '');

    if (next.length < 8) {
      return sendJSON(400, { error: 'رمز تازه باید حداقل ۸ نویسه باشد.' });
    }

    if (!phoneVerification.ready(db)) return sendJSON(503,{error:'سامانه تأیید شماره هنوز آماده نیست.'});
    const result=db.transaction(()=>{
      const check=otp.consumeCode(mobile,code);if(!check.ok)return {status:400,error:check.error};
      const c=getCustomer(mobile);
      if(!c)return {status:404,error:'حسابی با این شماره یافت نشد.'};
      if(!c.active)return {status:403,error:'حساب شما غیرفعال شده است.'};
      setCustomerPassword(c.id,next);phoneVerification.markVerified(db,mobile,true);
      db.prepare("DELETE FROM sessions WHERE kind IN ('CUSTOMER','CUSTOMER_VERIFIED') AND subject=?").run(mobile);
      const token=createSession('CUSTOMER_VERIFIED',mobile,otp.SESSION_TTL);
      return {status:200,token,customer:publicCustomer(getCustomer(mobile))};
    }).immediate();
    if(result.error)return sendJSON(result.status,{error:result.error});
    issueCustomerCookie(result.token);
    appLog('INFO','auth','رمز مشتری با تأیید شماره بازیابی شد',{mobile});
    return sendJSON(200,{message:'رمز عبور شما تغییر کرد.',...apiToken(result.token),customer:result.customer});
  }

  if (method === 'POST' && pathname === '/api/auth/request-code') {
    const b = await parseBody(req);
    const ip = clientIP(req);

    const ipRl = rateLimit(`otp-ip:${ip}`, RL.otpIp.limit, RL.otpIp.window, RL.otpIp.block);
    if (!ipRl.ok) {
      appLog('WARN', 'security', 'درخواست انبوه کد از یک IP', { ip });
      return sendJSON(429, {
        error: 'درخواست‌های بیش از حد. لطفاً بعداً تلاش کنید.',
        retry_after: ipRl.retry_after
      });
    }

    const norm = otp.normalizeMobile(b.mobile);
    if (otp.isValidMobile(norm)) {
      const pRl = rateLimit(`otp-ph:${norm}`, RL.otpPhone.limit, RL.otpPhone.window, RL.otpPhone.block);
      if (!pRl.ok) {
        appLog('WARN', 'security', 'درخواست انبوه کد برای یک شماره', { mobile: norm, ip });
        return sendJSON(429, {
          error: 'برای این شماره درخواست‌های زیادی ثبت شده. یک ساعت دیگر تلاش کنید.',
          retry_after: pRl.retry_after
        });
      }
    }

    const r = await otp.requestCode(b.mobile);
    if (!r.ok) return sendJSON(400, { error: r.error, retry_after: r.retry_after });
    return sendJSON(200, {
      message: r.dev_hint ? 'کد فقط در محیط آزمایشی تولید شد.' : 'درخواست ارسال کد پذیرفته شد.',
      mobile: r.mobile, ttl: r.ttl,
      dev_mode: !!r.dev_hint
    });
  }

  if (method === 'POST' && pathname === '/api/auth/verify-code') {
    const b = await parseBody(req);
    const r = otp.verifyCode(b.mobile, b.code);
    if (!r.ok) return sendJSON(400, { error: r.error });
    issueCustomerCookie(r.token);
    return sendJSON(200, { message: 'ورود موفق', ...apiToken(r.token), mobile: r.mobile });
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(200, { authenticated: false });
    const stats = db.prepare(
      `SELECT COUNT(*) orders, COALESCE(SUM(total_paid),0) spent
       FROM orders WHERE mobile=? AND status='PAID'`).get(mobile);
    return sendJSON(200, { authenticated: true, mobile, ...stats });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    otp.destroySession(getCustomerToken(req));
    res.setHeader('Set-Cookie', 'yazd_customer=; HttpOnly; Path=/; Max-Age=0');
    return sendJSON(200, { message: 'خروج انجام شد' });
  }

  // Only the verified owner can read the fields needed to prefill checkout.
  // Unpaid/cancelled guest orders must not become a default address.
  if (method === 'GET' && pathname === '/api/auth/checkout-profile') {
    const mobile=otp.mobileFromToken(getCustomerToken(req));
    if(!mobile)return sendJSON(401,{error:'ابتدا شماره موبایل را تأیید کنید.'});
    const row=db.prepare(`SELECT customer_name,first_name,last_name,email,province,city,address,postal_code
      FROM orders WHERE mobile=? AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')
      ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(mobile);
    return sendJSON(200,{profile:row || null});
  }

  // سفارش‌های من — نیازمند ورود
  if (method === 'GET' && pathname === '/api/auth/orders') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(401, { error: 'ابتدا وارد شوید.' });
    const rows = db.prepare(
      'SELECT * FROM orders WHERE mobile=? ORDER BY created_at DESC').all(mobile);
    res.setHeader('Cache-Control','no-store');
    const returnsReady = returnStore.ready(db);
    const nowMs = Date.now();
    return sendJSON(200, {
      total: rows.length,
      orders: rows.map(o => {
        const delivered = returnsReady
          ? db.prepare('SELECT delivered_at_ms FROM return_delivery_evidence WHERE order_id=?').get(o.order_id)
          : null;
        const items = db.prepare('SELECT id,order_id,sku,product_name,unit_price,quantity,line_total FROM order_items WHERE order_id=?').all(o.order_id);
        return {
          order_id:o.order_id,created_at:o.created_at,status:o.status,
          province:o.province,city:o.city,total_paid:o.total_paid,
          discount_amount:o.discount_amount,discount_code:o.discount_code,
          tracking_code:o.tracking_code,carrier:o.carrier,
          payment_ref:['PAID','PROCESSING','SHIPPED','DELIVERED'].includes(o.status)?o.payment_ref:null,
          items:items.map(i => {
            const evidence=returnsReady ? db.prepare('SELECT volume_ml FROM return_item_evidence WHERE item_id=?').get(i.id) : null;
            const request=returnsReady ? db.prepare("SELECT request_id,status FROM account_return_requests WHERE item_id=? AND mobile=? AND status!='CLOSED'").get(i.id,mobile) : null;
            const result=returnsReady ? returnEligibility({verifiedMobile:mobile,order:o,item:{...i,volume_ml:evidence?.volume_ml},deliveredAtMs:delivered?.delivered_at_ms,nowMs,hasOpenRequest:!!request}) : {eligible:false,reason:'SERVICE_UNAVAILABLE'};
            return {id:i.id,sku:i.sku,product_name:i.product_name,unit_price:i.unit_price,quantity:i.quantity,line_total:i.line_total,
              return_info:{...result,volume_ml:evidence?.volume_ml ?? null,request:request || null}};
          })
        };
      })
    });
  }

  return false;   // هیچ‌کدام از مسیرهای این ماژول نبود
}

module.exports = { handle };
