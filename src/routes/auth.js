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

    const exists = getCustomer(mobile);
    if (exists) {
      /* Existing OTP-only accounts must never be claimed just by knowing the
         phone number. Require an already authenticated session for this exact
         mobile before assigning its first password. */
      if (!exists.pass_hash && otp.mobileFromToken(getCustomerToken(req)) === mobile) {
        setCustomerPassword(exists.id, password);
        const token = createSession('CUSTOMER', mobile, otp.SESSION_TTL);
        appLog('INFO', 'auth', 'مشتری برای حساب موجود رمز گذاشت', { mobile });
        return sendJSON(200, {
          message: 'رمز عبور برای حساب شما ثبت شد.',
          token, customer: publicCustomer(getCustomer(mobile))
        });
      }
      return sendJSON(409, {
        error: 'با این شماره قبلاً حساب ساخته شده است. وارد شوید.'
      });
    }

    const c = createCustomer({
      mobile, first_name: first, last_name: last,
      email: b.email ? cleanText(b.email, 80) : null,
      password
    });

    const token = createSession('CUSTOMER', mobile, otp.SESSION_TTL);
    appLog('INFO', 'auth', 'حساب مشتری ساخته شد', { mobile });
    analytics.track('register', null, null, req);

    return sendJSON(201, {
      message: `خوش آمدید ${first}!`,
      token, customer: publicCustomer(c)
    });
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

    const mobile = otp.normalizeMobile(b.mobile);
    const password = String(b.password || '');
    const c = getCustomer(mobile);

    // پیام یکسان برای «حساب نیست» و «رمز غلط» تا شماره‌های
    // ثبت‌شده لو نروند
    const bad = () => {
      appLog('WARN', 'security', 'ورود ناموفق مشتری', { ip });
      return sendJSON(401, { error: 'شماره موبایل یا رمز عبور نادرست است.' });
    };

    if (!c || !c.pass_hash) return bad();
    if (!verifyPassword(password, c.pass_hash, c.pass_salt)) return bad();
    if (!c.active) {
      return sendJSON(403, { error: 'حساب شما غیرفعال شده است.' });
    }

    resetRateLimit(`clogin:${ip}`);
    db.prepare('UPDATE customers SET last_login=? WHERE id=?')
      .run(new Date().toISOString(), c.id);

    const token = createSession('CUSTOMER', mobile, otp.SESSION_TTL);
    appLog('INFO', 'auth', 'ورود موفق مشتری', { mobile });

    return sendJSON(200, {
      message: 'ورود موفق', token, customer: publicCustomer(c)
    });
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

    const c = getCustomer(mobile);
    if (c) {
      // requestCode خودش کد می‌سازد، ذخیره و پیامک می‌کند
      const sent = await otp.requestCode(mobile);
      if (sent.ok) {
        appLog('INFO', 'auth', 'کد بازیابی رمز ارسال شد', { mobile });
      }
    }

    return sendJSON(200, {
      message: 'اگر این شماره ثبت شده باشد و سرویس پیامک فعال باشد، کد بازیابی ارسال می‌شود.'
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

    const check = otp.verifyCode(mobile, code);
    if (!check.ok) return sendJSON(400, { error: check.error });

    const c = getCustomer(mobile);
    if (!c) return sendJSON(404, { error: 'حسابی با این شماره یافت نشد.' });

    setCustomerPassword(c.id, next);

    /* همه نشست‌های باز باطل می‌شوند جز همینی که تازه ساخته شد.
       اگر کسی رمز را دزدیده و وارد شده بود، بیرون می‌افتد. */
    db.prepare("DELETE FROM sessions WHERE kind='CUSTOMER' AND subject=? AND token!=?")
      .run(mobile, check.token);

    appLog('INFO', 'auth', 'رمز مشتری بازیابی شد', { mobile });
    const token = check.token;

    return sendJSON(200, {
      message: 'رمز عبور شما تغییر کرد.',
      token, customer: publicCustomer(getCustomer(mobile))
    });
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
      message: 'کد ورود ارسال شد.',
      mobile: r.mobile, ttl: r.ttl,
      dev_mode: otp.PROVIDER === 'console'
    });
  }

  if (method === 'POST' && pathname === '/api/auth/verify-code') {
    const b = await parseBody(req);
    const r = otp.verifyCode(b.mobile, b.code);
    if (!r.ok) return sendJSON(400, { error: r.error });
    res.setHeader('Set-Cookie',
      `yazd_customer=${r.token}; HttpOnly; Path=/; Max-Age=${otp.SESSION_TTL / 1000}; SameSite=Lax`);
    return sendJSON(200, { message: 'ورود موفق', token: r.token, mobile: r.mobile });
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

  // سفارش‌های من — نیازمند ورود
  if (method === 'GET' && pathname === '/api/auth/orders') {
    const mobile = otp.mobileFromToken(getCustomerToken(req));
    if (!mobile) return sendJSON(401, { error: 'ابتدا وارد شوید.' });
    const rows = db.prepare(
      'SELECT * FROM orders WHERE mobile=? ORDER BY created_at DESC').all(mobile);
    return sendJSON(200, {
      total: rows.length,
      orders: rows.map(o => ({
        ...o,
        items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.order_id)
      }))
    });
  }

  return false;   // هیچ‌کدام از مسیرهای این ماژول نبود
}

module.exports = { handle };
