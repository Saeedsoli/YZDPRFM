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
const csv = require('../csv-export');
const {publicVariantSql} = require('../variant-visibility');
const stockReservations = require('../order-stock-reservations');

// Backup files contain customer and order data. Destroy the read stream when
// the client disconnects; always clean up our private temporary directory.
function streamBackup(res, file, cleanup, appLog, fd) {
  const stream = fd === undefined ? fs.createReadStream(file) : fs.createReadStream(file,{fd,autoClose:true});
  let cleaned = false;
  const finish = () => {
    if (cleaned) return;
    cleaned = true;
    if (cleanup) { try { cleanup(); } catch (e) { appLog('ERROR', 'backup', 'خطا در پاک‌سازی فایل موقت'); } }
  };
  stream.on('error', () => {
    appLog('ERROR', 'backup', 'خطا در خواندن فایل پشتیبان');
    res.destroy();
  });
  stream.on('close', finish);
  res.on('close', () => { if (!stream.destroyed) stream.destroy(); });
  stream.pipe(res);
}

// Open the exact file once and stream the same descriptor: checking a path
// then reopening it would allow it to be replaced between check and use.
function openAutomaticBackup(dir, name, dbPath) {
  const directory=fs.lstatSync(dir);
  if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('Unsafe backup directory');
  if(typeof fs.constants.O_NOFOLLOW!=='number'||typeof fs.constants.O_NONBLOCK!=='number')throw Error('Safe file opening unsupported');
  const file=path.join(dir,name);
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.nlink!==1||st.size<100)throw Error('Unsafe backup file');
    // An offline snapshot must be independent from the live DB and its WAL.
    for(const base of [dbPath,dbPath+'-wal',dbPath+'-shm',dbPath+'-journal']) {
      try { const live=fs.statSync(base);if(live.dev===st.dev&&live.ino===st.ino)throw Error('Live database alias'); }
      catch(e){if(e.code!=='ENOENT')throw e;}
    }
    for(const suffix of ['-wal','-shm','-journal'])if(fs.lstatSync(file+suffix,{throwIfNoEntry:false}))throw Error('Backup has sidecar files');
    const header=Buffer.alloc(16);
    if(fs.readSync(fd,header,0,header.length,0)!==header.length||header.toString('binary')!=='SQLite format 3\u0000')throw Error('Invalid SQLite backup');
    return {fd,size:st.size,created:st.mtime.toISOString(),file};
  } catch(e) {fs.closeSync(fd);throw e;}
}

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
 * @param {Function} ctx.verifyPassword  برای بررسی امن هش رمز حساب مدیر
 * @returns {Promise<boolean>}
 */
async function handle(ctx) {
  const {
    method, pathname, parsed, req, res,
    can, parseBody, logAudit, appLog, rateLimit, who, db,
    DB_PATH, otp, notify, pay, getSettings, normalizeDigits,
    reports, analytics, verifyPassword, trustedProxyPolicy
  } = ctx;

  /* پوشش `sendJSON` — درس گام ۱.
     ولی توجه: دو مسیر پشتیبان **استریم** می‌فرستند و این پوشش
     کمکشان نمی‌کند؛ آن‌ها صریحاً `return true` دارند. */
  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  if (method === 'GET' && pathname === '/api/admin/backup') {
    if (!can('system.backup')) return true;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let dir;
    try {
      // Unique directory prevents collisions for concurrent requests and is
      // private even when the parent directory is broadly readable.
      dir = fs.mkdtempSync(path.join(path.dirname(DB_PATH), '.manual-backup-'));
      const tmp = path.join(dir, 'snapshot.db');
      db.prepare('VACUUM INTO ?').run(tmp);   // نسخه سازگار حتی حین نوشتن
      const size = fs.statSync(tmp).size;
      appLog('INFO', 'backup', 'پشتیبان دستی گرفته شد', { size });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="yazd-backup-${stamp}.db"`,
        'Content-Length': size,
        'Cache-Control': 'no-store'
      });
      streamBackup(res, tmp, () => fs.rmSync(dir, {recursive: true, force: true}), appLog);
      return true;
    } catch (e) {
      if (dir) { try { fs.rmSync(dir, {recursive: true, force: true}); } catch {} }
      appLog('ERROR', 'backup', e.message);
      if (res.headersSent) { res.destroy(); return true; }
      return sendJSON(500, { error: 'خطا در تهیه پشتیبان' });
    }
  }

  if (method === 'GET' && pathname === '/api/admin/backups') {
    if (!can('system.backup')) return true;
    const dir = path.join(path.dirname(DB_PATH), 'backups');
    if (!fs.existsSync(dir)) return sendJSON(200, { total: 0, backups: [] });
    let list;
    try {
      const st=fs.lstatSync(dir);
      if(!st.isDirectory()||st.isSymbolicLink())return sendJSON(409,{error:'پوشه پشتیبان معتبر نیست.'});
      list=fs.readdirSync(dir).filter(f=>/^yazd-\d{10}\.db$/.test(f)).flatMap(name=>{
        try {const item=openAutomaticBackup(dir,name,DB_PATH);fs.closeSync(item.fd);return [{name,size:item.size,created:item.created}];}
        catch {return [];}
      }).sort((a,b)=>b.created.localeCompare(a.created));
    } catch {return sendJSON(500,{error:'فهرست پشتیبان‌ها در دسترس نیست.'});}
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
    let opened;
    try { opened=openAutomaticBackup(dir,raw,DB_PATH); }
    catch(e) {
      if(e.code==='ENOENT'||e.code==='ENOTDIR')return sendJSON(404,{error:'این نسخه پشتیبان یافت نشد.'});
      appLog('WARN','backup','دانلود نسخه نامعتبر مسدود شد',{file:raw});
      return sendJSON(409,{error:'این نسخه پشتیبان قابل دانلود ایمن نیست.'});
    }
    try {
      appLog('INFO', 'backup', 'دانلود نسخه پشتیبان', { file: raw });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${raw}"`,
        'Content-Length': opened.size,
        'Cache-Control': 'no-store'
      });
      streamBackup(res, opened.file, null, appLog, opened.fd);
      return true;
    } catch(e) {
      try {fs.closeSync(opened.fd);}catch{}
      if(res.headersSent){res.destroy();return true;}
      return sendJSON(500,{error:'خطا در خواندن پشتیبان'});
    }
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

    // The environment initializes a new owner, but is NOT the credential used
    // for an existing account. Inspect active owner records without exposing
    // their hashes, names, or passwords; also honor pending password changes.
    const owners = db.prepare("SELECT pass_hash,pass_salt,must_change FROM staff WHERE role_key='owner' AND active=1").all();
    let ownerRisk = !owners.length;
    for (const owner of owners) {
      try {
        if (owner.must_change || !/^[0-9a-f]{128}$/i.test(owner.pass_hash || '') || !owner.pass_salt ||
            verifyPassword('yazd1404', owner.pass_hash, owner.pass_salt)) ownerRisk = true;
      } catch { ownerRisk = true; } // invalid credentials must not appear safe
    }
    push('admin_password', 'رمز مدیر کل',
      ownerRisk ? 'error' : 'ok',
      !owners.length ? 'حساب مدیر کل فعال پیدا نشد.'
        : ownerRisk ? 'دست‌کم یک مدیر کل فعال رمز پیش‌فرض دارد یا باید رمز خود را تغییر دهد.'
        : 'رمز پیش‌فرض و الزام تغییر رمز در حساب‌های فعال مدیر کل دیده نشد.',
      ownerRisk ? 'از حساب مدیر کل وارد شوید و رمز اولیه را در پنل تغییر دهید.' : undefined);

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
    const supply = db.prepare(`SELECT
      COUNT(DISTINCT CASE WHEN v.stock>0 THEN p.id END) in_stock,
      COUNT(DISTINCT CASE WHEN v.stock=0 AND p.supply_mode='MADE_TO_ORDER' THEN p.id END) made_to_order
      FROM variants v JOIN products p ON p.id=v.product_id
      WHERE p.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND v.price_toman>0
        AND v.stock>=0 AND ${publicVariantSql('v')}`).get();
    const sellable = supply.in_stock + supply.made_to_order;
    const ledgerReady = stockReservations.ready(db);
    push('stock', 'آمادگی تأمین کالا',
      sellable && ledgerReady ? 'ok' : 'error',
      !ledgerReady ? 'ثبت رزرو انبار هنوز آماده نیست؛ سفارش تازه پذیرفته نمی‌شود.' :
        sellable ? `${supply.in_stock} محصول دارای موجودی و ${supply.made_to_order} محصول دارای گزینه ساخت پس از سفارش است.` : 'محصول قابل سفارش با قیمت معتبر پیدا نشد.',
      !ledgerReady ? 'پس از پشتیبان معتبر، مهاجرت محافظت‌شده رزرو انبار لازم است.' :
        sellable ? undefined : 'پنل → محصولات → بررسی قیمت و وضعیت تأمین');

    // Configuration alone cannot prove the proxy overwrites/appends headers
    // safely or that the server is reachable only through that proxy.
    push('proxy','آدرس IP و پروکسی','warn',
      trustedProxyPolicy?.configured
        ? 'پروکسی مورد اعتماد تنظیم شده؛ رفتار واقعی آن هنوز باید در محیط لیارا بررسی شود.'
        : 'پروکسی مورد اعتماد تنظیم نشده؛ محدودیت درخواست ممکن است برای همه مشتریان مشترک شود.',
      'پیش از افتتاح، مسیر شبکه و فهرست دقیق پروکسی‌های مورد اعتماد را بررسی کنید.');

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
      // No network call without a phone number. Provider name alone does not
      // imply credentials, a configured sender or actual delivery.
      smsInfo = await notify.testConnection();
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

  /* ── خروجی گزارش فروش ──
     گزارش تا امروز فقط در پنل دیده می‌شد. حسابدار برای بستن
     دفتر ماهانه باید عددها را دستی رونویسی می‌کرد — کاری که
     پرخطاست و انجام نمی‌شود.

     ── چرا چند جدول در یک فایل ──
     CSV استاندارد یک جدول است. ولی گزارش فروش شش نمای مختلف
     دارد (روزانه، محصول، برند، استان، کوپن، مشتری) و شش فایل
     جدا یعنی شش بار دانلود. اکسل با سطر خالی و عنوان، بلوک‌ها
     را جدا نشان می‌دهد و همه در یک برگه می‌مانند. */
  if (method === 'GET' && pathname === '/api/admin/reports/csv') {
    if (!can('reports.sales')) return true;
    const days = Math.min(365, Math.max(1, parseInt(parsed.query.days) || 30));
    const rep = reports.full(days);

    /* BOM لازم است وگرنه اکسل فارسی را «ØªÙˆÙ…Ø§Ù†» نشان می‌دهد.
       این را یک بار در CSV سفارش‌ها یاد گرفتیم. */
    const out = ['\uFEFF'];
    const block = (title, headers, rows) => {
      out.push(`\n${title}\n`);
      out.push(headers.join(',') + '\n');
      rows.forEach(r => out.push(csv.row(r)));
    };

    const s = rep.summary;
    block(`گزارش فروش ${days} روز اخیر`,
      ['شاخص', 'مقدار'],
      [
        ['تعداد سفارش', s.orders],
        ['درآمد (تومان)', s.revenue],
        ['تخفیف‌ها (تومان)', s.discounts],
        ['هزینه ارسال (تومان)', s.shipping],
        ['میانگین سفارش (تومان)', s.avg_order],
        ['تعداد کالای فروخته', s.units],
        ['رشد سفارش (٪)', s.growth?.orders ?? 0],
        ['رشد درآمد (٪)', s.growth?.revenue ?? 0]
      ]);

    block('فروش روزانه',
      ['تاریخ', 'سفارش', 'درآمد'],
      (rep.daily || []).map(d => [d.d, d.orders, d.revenue]));

    /* نام میدان‌ها از پاسخ واقعی گرفته شده، نه حدس: `d` نه
       `day`، و `name_fa`/`brand_fa` نه `name`. حدس اولیه سه
       ستون خالی می‌داد. */
    block('پرفروش‌ترین محصولات',
      ['برند', 'محصول', 'تعداد', 'سفارش', 'درآمد'],
      (rep.top_products || []).map(p =>
        [p.brand_fa, p.name_fa, p.units, p.orders, p.revenue]));

    block('فروش به تفکیک برند',
      ['برند', 'تعداد', 'درآمد'],
      (rep.by_brand || []).map(b => [b.brand, b.units, b.revenue]));

    block('فروش به تفکیک استان',
      ['استان', 'سفارش', 'درآمد'],
      (rep.by_province || []).map(p => [p.province, p.orders, p.revenue]));

    block('کدهای تخفیف',
      ['کد', 'دفعات استفاده', 'تخفیف داده‌شده', 'درآمد حاصل'],
      (rep.coupons || []).map(c => [c.code, c.uses, c.given, c.revenue]));

    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="yazd-report-${days}d-${stamp}.csv"`
    });
    res.end(out.join(''));
    return true;
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
