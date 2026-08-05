/**
 * عطر یزد | مسیرهای سیستم و آمادگی
 * ------------------------------------
 * گام ۴ از تفکیک کامل `server.js`.
 *
 * ── محتوا ──
 *   GET  /api/admin/backup            دانلود پشتیبان زنده
 *   GET  /api/admin/backups           فهرست نسخه‌های خودکار
 *   GET  /api/admin/backups/:file     دانلود یک نسخه
 *   GET  /api/admin/audit             سابقه کارهای کارکنان
 *   GET  /api/admin/readiness         بررسی آمادگی افتتاح
 *   POST /api/admin/readiness/test-sms  آزمون پیامک
 *   GET  /api/admin/reports           گزارش فروش
 *   GET  /api/admin/analytics         تحلیل بازدید
 *   POST /api/admin/analytics/refresh بازسازی ویترین
 *
 * ── سه نکته که این ماژول را متفاوت می‌کند ──
 *
 * ۱) **پاسخ استریمی.** دو مسیر پشتیبان، فایل را مستقیم روی `res`
 *    می‌ریزند و `sendJSON` صدا نمی‌زنند. پس پوشش `sendJSON`
 *    کمکشان نمی‌کند و باید صریحاً `return true` بگذارند.
 *
 * ۲) **بررسی آمادگی گران است.** با `?deep=1` به درگاه پرداخت و
 *    سامانه پیامک وصل می‌شود. محدودیت نرخ دارد.
 *
 * ۳) **نشت کلید ممنوع.** `readiness` هرگز نباید مقدار کلید API
 *    را برگرداند — فقط «هست یا نیست». آزمون این را می‌سنجد.
 *
 * ── قرارداد `ctx` ──
 * ماژول زمینه می‌گیرد و `Promise<boolean>` برمی‌گرداند.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @param {object}   ctx
 * @param {string}   ctx.method
 * @param {string}   ctx.pathname
 * @param {object}   ctx.parsed
 * @param {object}   ctx.req
 * @param {object}   ctx.res            برای استریم پشتیبان
 * @param {Function} ctx.can
 * @param {Function} ctx.parseBody
 * @param {Function} ctx.logAudit
 * @param {Function} ctx.appLog
 * @param {Function} ctx.rateLimit
 * @param {object}   ctx.who
 * @param {object}   ctx.db
 * @param {string}   ctx.DB_PATH
 * @param {object}   ctx.otp
 * @param {object}   ctx.notify
 * @param {object}   ctx.pay
 * @param {Function} ctx.getSettings
 * @param {Function} ctx.normalizeDigits
 * @param {object}   ctx.reports
 * @param {object}   ctx.analytics
 * @param {string}   ctx.ADMIN_PASSWORD  برای هشدار رمز پیش‌فرض
 * @returns {Promise<boolean>}
 */
async function handle(ctx) {
  const {
    method, pathname, parsed, req, res,
    can, parseBody, logAudit, appLog, rateLimit, who, db,
    DB_PATH, otp, notify, pay, getSettings, normalizeDigits,
    reports, analytics, ADMIN_PASSWORD
  } = ctx;

  /* پوشش `sendJSON` — درس گام ۱.
     ولی توجه: دو مسیر پشتیبان **استریم** می‌فرستند و این پوشش
     کمکشان نمی‌کند؛ آن‌ها صریحاً `return true` دارند. */
  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  if (method === 'GET' && pathname === '/api/admin/backup') {
    if (!can('system.backup')) return true;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const tmp = path.join(path.dirname(DB_PATH), `backup-${stamp}.db`);
    try {
      db.prepare('VACUUM INTO ?').run(tmp);   // نسخه سازگار حتی حین نوشتن
      const size = fs.statSync(tmp).size;
      appLog('INFO', 'backup', 'پشتیبان دستی گرفته شد', { size });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="yazd-backup-${stamp}.db"`,
        'Content-Length': size
      });
      const stream = fs.createReadStream(tmp);
      stream.pipe(res);
      stream.on('close', () => { try { fs.unlinkSync(tmp); } catch {} });
      return true;    // استریم پشتیبان — sendJSON صدا زده نشد
    } catch (e) {
      appLog('ERROR', 'backup', e.message);
      return sendJSON(500, { error: 'خطا در تهیه پشتیبان: ' + e.message });
    }
  }

  if (method === 'GET' && pathname === '/api/admin/backups') {
    if (!can('system.backup')) return true;
    const dir = path.join(path.dirname(DB_PATH), 'backups');
    if (!fs.existsSync(dir)) return sendJSON(200, { total: 0, backups: [] });
    const list = fs.readdirSync(dir).filter(f => f.endsWith('.db')).map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, created: st.mtime.toISOString() };
    }).sort((a, b) => b.created.localeCompare(a.created));
    return sendJSON(200, { total: list.length, backups: list });
  }

  if (method === 'GET' && pathname.startsWith('/api/admin/backups/')) {
    if (!can('system.backup')) return true;

    const raw = decodeURIComponent(pathname.replace('/api/admin/backups/', ''));
    // فقط نام فایل‌های تولیدشده خودمان — جلوگیری از پیمایش مسیر
    if (!/^yazd-\d{10}\.db$/.test(raw)) {
      return sendJSON(400, { error: 'نام فایل پشتیبان معتبر نیست.' });
    }

    const dir = path.join(path.dirname(DB_PATH), 'backups');
    const full = path.join(dir, raw);
    if (!full.startsWith(dir) || !fs.existsSync(full)) {
      return sendJSON(404, { error: 'این نسخه پشتیبان یافت نشد.' });
    }

    appLog('INFO', 'backup', 'دانلود نسخه پشتیبان', { file: raw });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${raw}"`,
      'Content-Length': fs.statSync(full).size
    });
    fs.createReadStream(full).pipe(res);
    return true;      // استریم فایل — sendJSON صدا زده نشد
  }

  if (method === 'GET' && pathname === '/api/admin/audit') {
    if (!can('system.logs')) return true;
    const limit = Math.min(500, Math.max(1, parseInt(parsed.query.limit) || 100));
    const user = parsed.query.user || '';
    const onlyDenied = parsed.query.denied === '1';

    const where = [], args = {};
    if (user) { where.push('username = @user'); args.user = user; }
    if (onlyDenied) where.push('allowed = 0');
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = db.prepare(
      `SELECT * FROM audit_log ${clause} ORDER BY id DESC LIMIT @limit`
    ).all({ ...args, limit });

    return sendJSON(200, {
      total: db.prepare(`SELECT COUNT(*) n FROM audit_log ${clause}`).get(args).n,
      entries: rows
    });
  }

  if (method === 'GET' && pathname === '/api/admin/readiness') {
    if (!can('settings.view')) return true;

    const st = getSettings();
    const deep = parsed.query.deep === '1';   // تماس واقعی با سرویس‌ها

    /* اطلاعات حقوقی روی فاکتور چاپ می‌شود و جعلی بودنش مسئولیت
       قانونی دارد — پس ناقص بودنش «خطا» است نه «هشدار».

       ولی «خالی نبودن» کافی نیست: مقادیر جای‌نگهدار که هنگام
       ساخت پروژه گذاشته شده بودند، پر **به نظر می‌رسند** و
       بررسی را سبز می‌کردند در حالی که روی فاکتور واقعی چاپ
       می‌شوند. این خطرناک‌تر از خالی بودن است، چون خالی بودن
       دست‌کم دیده می‌شود.

       پس هم خالی بودن سنجیده می‌شود، هم برابری با مقدار
       جای‌نگهدار، هم قالب (کد اقتصادی ۱۲ رقم، شناسه ملی ۱۱
       رقم، کد پستی ۱۰ رقم). */
    const PLACEHOLDER = new Set([
      '411358697643', '14009876543', '12345',
      '8916945781', '03536248000', 'عطر یزد'
    ]);
    const SHAPE = {
      economic_code: [12, 'کد اقتصادی باید ۱۲ رقم باشد'],
      national_id:   [11, 'شناسه ملی باید ۱۱ رقم باشد'],
      postal_code:   [10, 'کد پستی باید ۱۰ رقم باشد']
    };

    /* ── دو دسته، دو سطح سخت‌گیری ──

       **الزامی:** تلفن، نشانی و کد پستی. اینها را خودِ اینماد
       الزام می‌کند («درج دقیق آدرس پستی، کدپستی و شماره تماس
       در سایت الزامی است»)، پس نبودشان صدور مجوز را به خطر
       می‌اندازد. ضمناً نشانی روی برچسب پستی به‌عنوان فرستنده
       چاپ می‌شود و پست بدون آن مرسوله را نمی‌پذیرد.

       **اختیاری:** نام حقوقی، کد اقتصادی، شناسه ملی، شماره
       ثبت. اینها فقط روی «فاکتور رسمی» (`?formal=1`) چاپ
       می‌شوند — برای خریدار عمده‌ای که سند رسمی می‌خواهد.
       مشتری خرده‌فروشی هرگز نمی‌بیندشان.

       خواسته صریح مالک (مرداد ۱۴۰۵): «در فاکتور نیازی به درج
       اطلاعات حقوقی نداریم، خود ای‌نماد کفایت می‌کند.»
       پس نبودشان **خطا نیست**. ولی اگر پر شده باشند و مقدار
       نمونه باشند، هشدار داده می‌شود — چون آن‌وقت روی سندی
       چاپ می‌شوند که به دست خریدار می‌رسد. */
    const LEGAL_REQUIRED = [
      ['phone', 'تلفن'], ['address', 'نشانی'], ['postal_code', 'کد پستی']
    ];
    const LEGAL_OPTIONAL = [
      ['legal_name', 'نام حقوقی'], ['economic_code', 'کد اقتصادی'],
      ['national_id', 'شناسه ملی'], ['register_no', 'شماره ثبت']
    ];

    const missingLegal = [];
    const fakeLegal = [];
    const badShape = [];
    const fakeOptional = [];

    for (const [k, label] of LEGAL_REQUIRED) {
      const v = String(st[k] || '').trim();
      if (!v) { missingLegal.push(label); continue; }
      if (PLACEHOLDER.has(v)) { fakeLegal.push(label); continue; }
      const rule = SHAPE[k];
      if (rule && normalizeDigits(v).replace(/\D/g, '').length !== rule[0]) {
        badShape.push(rule[1]);
      }
    }

    /* فیلدهای اختیاری فقط وقتی سنجیده می‌شوند که پر باشند —
       خالی بودنشان کاملاً پذیرفته است. */
    for (const [k, label] of LEGAL_OPTIONAL) {
      const v = String(st[k] || '').trim();
      if (!v) continue;
      if (PLACEHOLDER.has(v)) { fakeOptional.push(label); continue; }
      const rule = SHAPE[k];
      if (rule && normalizeDigits(v).replace(/\D/g, '').length !== rule[0]) {
        fakeOptional.push(label);
      }
    }

    const items = [];
    const push = (key, title, level, message, hint) =>
      items.push({ key, title, level, message, hint });

    // ── اطلاعات حقوقی ──
    {
      const problems = [];
      if (missingLegal.length) problems.push(`خالی: ${missingLegal.join('، ')}`);
      /* جای‌نگهدار جدا و با لحن صریح‌تر گزارش می‌شود — چون
         برخلاف فیلد خالی، به چشم نمی‌آید. */
      if (fakeLegal.length) problems.push(`هنوز مقدار نمونه دارد: ${fakeLegal.join('، ')}`);
      if (badShape.length) problems.push(badShape.join('، '));

      push('legal', 'اطلاعات تماس (الزام اینماد)',
        problems.length ? 'error' : 'ok',
        problems.length
          ? problems.join(' · ')
            + ' — اینماد درج تلفن، نشانی و کد پستی را الزامی کرده است.'
          : 'تلفن، نشانی و کد پستی ثبت شده‌اند.',
        problems.length ? 'پنل → تنظیمات فروشگاه' : undefined);
    }

    /* ── اطلاعات حقوقی: فقط هشدار، نه خطا ──
       نبودشان کاملاً پذیرفته است (فاکتور عادی به آنها نیازی
       ندارد). ولی اگر مقدار نمونه در آنها مانده باشد، روی
       «فاکتور رسمی» چاپ می‌شود و آن سند به دست خریدار عمده
       می‌رسد — پس باید دیده شود. */
    {
      const anySet = LEGAL_OPTIONAL.some(([k]) => String(st[k] || '').trim());
      push('legal_formal', 'اطلاعات حقوقی (فاکتور رسمی)',
        fakeOptional.length ? 'warn' : 'ok',
        fakeOptional.length
          ? `مقدار نمونه یا نامعتبر: ${fakeOptional.join('، ')} — روی فاکتور رسمی چاپ می‌شود.`
          : anySet
            ? 'ثبت شده — فاکتور رسمی قابل صدور است.'
            : 'ثبت نشده — فاکتور عادی بدون آن صادر می‌شود (اشکالی ندارد).',
        fakeOptional.length
          ? 'پنل → تنظیمات فروشگاه — یا خالی بگذارید تا چاپ نشود'
          : undefined);
    }

    // ── رمز مدیر ──
    const weak = ADMIN_PASSWORD === 'yazd1404';
    push('admin_password', 'رمز مدیر کل',
      weak ? 'error' : 'ok',
      weak ? 'رمز هنوز مقدار پیش‌فرض است و در مستندات عمومی نوشته شده.'
           : 'رمز پیش‌فرض تغییر کرده است.',
      weak ? 'liara env set ADMIN_PASSWORD="..." --app yazdperfume' : undefined);

    /* ── نماد اعتماد ──
       نشان **دو بخش** دارد و با یکی کار نمی‌کند: نشانی تصویر هم
       `id` می‌خواهد هم `Code`. پس حالت «نیمه‌پر» جدا گزارش می‌شود،
       وگرنه مدیر شناسه را وارد می‌کند، کارت سبز می‌شود، و نشان
       روی سایت نمی‌آید بی‌آنکه بداند چرا. */
    const enId = String(st.enamad_id || '').trim();
    const enCode = String(st.enamad_code || '').trim();
    const enBoth = enId && enCode;
    const enHalf = (enId || enCode) && !enBoth;
    push('enamad', 'نماد اعتماد الکترونیکی',
      enBoth ? 'ok' : enHalf ? 'error' : 'warn',
      enBoth ? 'شناسه و کد امنیتی هر دو ثبت شده‌اند.'
        : enHalf ? `فقط ${enId ? 'شناسه' : 'کد امنیتی'} ثبت شده — نشان تا پر شدن هر دو نمایش داده نمی‌شود.`
        : 'کد نماد وارد نشده — فوتر نشان آزمایشی می‌دهد.',
      enBoth ? undefined : 'پنل → تنظیمات فروشگاه → شناسه و کد امنیتی نماد');

    /* ── اطلاع‌رسانی داخلی ──
       اگر هیچ کارمندی موبایل نداشته باشد، سفارش‌ها ثبت می‌شوند و
       هیچ‌کس خبردار نمی‌شود تا وقتی کسی پنل را باز کند. برای
       فروشگاهی که تحویل ۳ تا ۷ روز وعده داده، این یعنی از دست
       دادن روزها. */
    try {
      const al = require('../alerts').status();
      push('alerts', 'اطلاع‌رسانی به کارکنان',
        !al.enabled ? 'warn' : al.reachable ? 'ok' : 'error',
        !al.enabled
          ? 'اطلاع‌رسانی داخلی خاموش است.'
          : al.reachable
            ? `${al.reachable} نفر خبر سفارش تازه را می‌گیرند.`
            : 'هیچ‌کس شماره موبایل ندارد — سفارش تازه بی‌خبر می‌ماند.',
        al.reachable || !al.enabled
          ? undefined
          : 'پنل → کارکنان → شماره موبایل هر نفر را ثبت کنید');
    } catch { /* نبود ماژول نباید بررسی آمادگی را بشکند */ }

    // ── موجودی ──
    const inStock = db.prepare('SELECT COUNT(*) c FROM variants WHERE stock > 0').get().c;
    push('stock', 'موجودی کالا',
      inStock ? 'ok' : 'error',
      inStock ? `${inStock} کالا موجود است.` : 'موجودی همه کالاها صفر است — هیچ‌چیز قابل خرید نیست.',
      inStock ? undefined : 'پنل → محصولات → تنظیم موجودی');

    // ── دیسک پایدار ──
    const onLiara = /^\/app\//.test(DB_PATH);
    push('disk', 'دیسک پایدار دیتابیس',
      onLiara ? 'ok' : 'warn',
      onLiara ? `دیتابیس روی ${DB_PATH}` : `مسیر محلی: ${DB_PATH}`,
      onLiara ? undefined : 'روی لیارا باید DB_PATH=/app/data/yazd.db و دیسک متصل باشد.');

    // ── سرویس‌های بیرونی ──
    let payInfo, smsInfo;
    if (deep) {
      /* تماس واقعی — فقط وقتی مدیر صریحاً بخواهد، چون چند ثانیه
         طول می‌کشد و به شبکه وابسته است. */
      [payInfo, smsInfo] = await Promise.all([
        pay.testConnection().catch(e => ({ ok: false, message: e.message })),
        notify.testConnection().catch(e => ({ ok: false, message: e.message }))
      ]);
    } else {
      payInfo = { ok: pay.isLive(), live: pay.isLive(), gateway: pay.gatewayName(),
        message: pay.isLive() ? 'درگاه واقعی پیکربندی شده.' : 'درگاه آزمایشی فعال است.' };
      /* «واقعی» یعنی ارائه‌دهنده غیر از console انتخاب شده باشد،
         نه اینکه اسم خاصی داشته باشد. با افزودن پیامیتو معلوم
         شد بررسی بر اساس نام ارائه‌دهنده شکننده است. */
      const smsLive = notify.PROVIDER !== 'console';
      smsInfo = { ok: smsLive, live: smsLive,
        provider: notify.PROVIDER,
        message: smsLive
          ? `ارائه‌دهنده «${notify.PROVIDER}» انتخاب شده.`
          : 'حالت لاگ — پیامکی ارسال نمی‌شود.' };
    }

    push('payment', 'درگاه پرداخت',
      payInfo.live && payInfo.ok ? 'ok' : payInfo.ok === false ? 'error' : 'warn',
      payInfo.message, payInfo.hint);
    push('sms', 'سرویس پیامک',
      smsInfo.live && smsInfo.ok ? 'ok' : smsInfo.ok === false ? 'error' : 'warn',
      smsInfo.message, smsInfo.hint);

    const errors = items.filter(i => i.level === 'error').length;
    const warns  = items.filter(i => i.level === 'warn').length;

    return sendJSON(200, {
      ready: errors === 0,
      errors, warnings: warns,
      checked_deep: deep,
      items,
      payment: payInfo,
      sms: smsInfo
    });
  }

  if (method === 'POST' && pathname === '/api/admin/readiness/test-sms') {
    if (!can('settings.edit')) return true;
    const b = await parseBody(req);
    const mobile = b.mobile ? otp.normalizeMobile(b.mobile) : null;
    if (mobile && !otp.isValidMobile(mobile)) {
      return sendJSON(400, { error: 'شماره موبایل معتبر وارد کنید.' });
    }
    /* محدودیت نرخ: پیامک آزمایشی هزینه دارد و نباید دکمه‌ای
       باشد که بشود صد بار پشت هم زد. */
    const rl = rateLimit(`smstest:${who?.id || 'anon'}`, 5, 3600e3);
    if (!rl.ok) return sendJSON(429, { error: 'حداکثر ۵ آزمون در ساعت.' });

    const r = await notify.testConnection(mobile);
    logAudit('settings.test_sms', { target: mobile ? 'با پیامک آزمایشی' : 'فقط اتصال' });
    return sendJSON(200, r);
  }

  if (method === 'GET' && pathname === '/api/admin/reports') {
    if (!can('reports.sales')) return true;
    const days = Math.min(365, Math.max(1, parseInt(parsed.query.days) || 30));
    return sendJSON(200, reports.full(days));
  }

  if (method === 'GET' && pathname === '/api/admin/analytics') {
    if (!can('reports.traffic')) return true;
    const days = Math.min(365, Math.max(1, parseInt(parsed.query.days) || 30));
    return sendJSON(200, analytics.dashboard(days));
  }

  if (method === 'POST' && pathname === '/api/admin/analytics/refresh') {
    if (!can('reports.traffic')) return true;
    const r = analytics.refreshTrending();
    return sendJSON(200, { message: 'ویترین صفحه اصلی به‌روز شد.', ...r });
  }

  return false;   // هیچ‌کدام از مسیرهای این ماژول نبود
}

module.exports = { handle };
