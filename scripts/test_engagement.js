#!/usr/bin/env node
/**
 * آزمون ماژول تعامل مشتری — گام ۸ تفکیک `server.js`.
 *
 * چرا این آزمون:
 *
 *   یازده مسیر این ماژول همه **بدون `can()`** کار می‌کنند. یعنی
 *   لایه دفاعی متمرکزی که شش ماژول مدیریتی داشتند اینجا نیست؛
 *   هر مسیر محافظ خودش را دارد. اگر یکی از آن محافظ‌ها هنگام
 *   جابه‌جایی بیفتد، هیچ ۴۰۳ سراسری جلویش را نمی‌گیرد.
 *
 *   سه مسیر داده شخصی برمی‌گردانند و آزمون روی هر سه سخت‌گیر است:
 *     • `/api/orders/track`      → سفارش دیگری دیده نشود
 *     • `/api/review-invite/:t`  → شماره کامل لو نرود
 *     • `/api/wishlist`          → بدون ورود چیزی برنگردد
 *
 * پوشش:
 *   ۱) هر یازده مسیر پاسخ درست می‌دهند
 *   ۲) مرز داده شخصی سالم مانده
 *   ۳) دو محدودیت نرخ با دو رفتار متفاوت (۲۰۰ خاموش / ۴۲۹ گویا)
 *   ۴) توکن دعوت یک‌بارمصرف است
 *   ۵) اثر واقعی روی دیتابیس (علاقه‌مندی، هشدار موجودی، نظر)
 *   ۶) سرور پس از همه اینها زنده است
 *
 * اجرا: node scripts/test_engagement.js   (سرور باید بالا باشد)
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { db } = require('../src/db');

const PORT = process.env.PORT || 3000;
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const h = s => `\x1b[1m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

/* مسیر همیشه اینجا امن می‌شود، نه در محل فراخوانی.
   نسخه اول این کار را نمی‌کرد و اولین نامک فارسی، آزمون را با
   ERR_UNESCAPED_CHARACTERS می‌انداخت — خطای آزمون، نه سرور.

   فقط نویسه‌های خام غیر-ASCII کدگذاری می‌شوند. `encodeURIComponent`
   روی کل مسیر، بخش‌هایی را که فراخوان از قبل کد کرده دوباره کد
   می‌کرد (`%D9` → `%25D9`) و آزمون بی‌دلیل قرمز می‌شد. */
const enc = p => p.replace(/[^\x00-\x7F]/g, encodeURIComponent);

function api(p, opt = {}, cookie) {
  return new Promise(res => {
    const body = opt.body || null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: enc(p), method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b,
              cookies: x.headers['set-cookie'] || [] });
      });
    });
    req.on('error', () => res({ status: 0, json: {}, raw: '', cookies: [] }));
    if (body) req.write(body);
    req.end();
  });
}
const post = (p, obj, cookie) =>
  api(p, { method: 'POST', body: JSON.stringify(obj) }, cookie);

/** ورود مشتری واقعی با کد یکبارمصرف — تنها راه گرفتن کوکی نشست */
async function loginCustomer(mobile) {
  db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'otp%'").run();
  await post('/api/auth/request-code', { mobile });
  const row = db.prepare(
    'SELECT code FROM otp_codes WHERE mobile=? ORDER BY rowid DESC LIMIT 1'
  ).get(mobile);
  if (!row) return null;
  const v = await post('/api/auth/verify-code', { mobile, code: row.code });
  const c = (v.cookies || []).find(x => x.startsWith('yazd_customer='));
  return c ? c.split(';')[0] : null;
}

(async () => {
  console.log();
  console.log(h('  آزمون تعامل مشتری — گام ۸ تفکیک'));
  console.log(d('  ─────────────────────────────────────────────'));

  const prod = db.prepare('SELECT id, slug FROM products LIMIT 1').get();
  const emptySku = db.prepare('SELECT sku FROM variants WHERE stock=0 LIMIT 1').get().sku;
  const MOBILE = '09121110001';
  const OTHER  = '09121110002';

  // ───────────────────────── ۱) ثبت رویداد
  console.log();
  console.log(h('  ۱) ثبت رویداد از مرورگر'));

  const t1 = await post('/api/track', { kind: 'view', target: prod.id });
  add('‎/api/track پاسخ ۲۰۰', t1.status === 200);
  add('نتیجه ثبت اعلام می‌شود', 'ok' in t1.json, `ok=${t1.json.ok}`);

  const tBad = await post('/api/track', { kind: 'هرچی', target: 'x' });
  add('رویداد ناشناخته ۲۰۰ می‌دهد نه خطا',
      tBad.status === 200, 'تحلیل نباید تجربه کاربر را خراب کند');
  const tEmpty = await post('/api/track', {});
  add('بدنه خالی نمی‌شکند', tEmpty.status === 200);

  // ───────────────────────── ۲) علاقه‌مندی
  console.log();
  console.log(h('  ۲) علاقه‌مندی'));

  add('‎GET بدون ورود ۴۰۱', (await api('/api/wishlist')).status === 401,
      'علاقه‌مندی خودش یک نیمرخ رفتاری است');
  add('‎POST بدون ورود ۴۰۱',
      (await post('/api/wishlist', { product: prod.id })).status === 401);
  const guestCheck = await api('/api/wishlist/check/' + prod.id);
  add('‎check بدون ورود ۲۰۰ با guest=true',
      guestCheck.status === 200 && guestCheck.json.guest === true,
      'نه ۴۰۱ — دکمه قلب روی صفحه محصول نباید خطا بدهد');

  db.prepare('DELETE FROM wishlist WHERE mobile=?').run(MOBILE);
  const cookie = await loginCustomer(MOBILE);
  add('ورود مشتری برای ادامه آزمون', !!cookie,
      cookie ? 'کوکی نشست گرفته شد' : 'ورود ناموفق');

  if (cookie) {
    const w0 = await api('/api/wishlist', {}, cookie);
    add('فهرست خالی ۲۰۰ می‌دهد', w0.status === 200 && w0.json.total === 0);

    const add1 = await post('/api/wishlist', { product: prod.id }, cookie);
    add('افزودن ۲۰۱ با saved=true',
        add1.status === 201 && add1.json.saved === true);
    add('در دیتابیس ثبت شد',
        !!db.prepare('SELECT 1 FROM wishlist WHERE mobile=? AND product_id=?')
          .get(MOBILE, prod.id));

    const w1 = await api('/api/wishlist', {}, cookie);
    add('فهرست یک قلم دارد', w1.json.total === 1);
    add('محصول واریانت دارد', Array.isArray(w1.json.products[0]?.variants),
        'کاربر باید قیمت را ببیند');

    const chk = await api('/api/wishlist/check/' + prod.slug, {}, cookie);
    add('‎check با نامک saved=true می‌دهد', chk.json.saved === true);

    const add2 = await post('/api/wishlist', { product: prod.id }, cookie);
    add('دوباره زدن، برمی‌دارد (کلید دوحالته)',
        add2.status === 200 && add2.json.saved === false,
        'یک دکمه، دو کار — قلب پر و خالی');
    add('از دیتابیس هم رفت',
        !db.prepare('SELECT 1 FROM wishlist WHERE mobile=? AND product_id=?')
          .get(MOBILE, prod.id));

    const noProd = await post('/api/wishlist', { product: 'وجود-ندارد' }, cookie);
    add('محصول ناموجود ۴۰۴ می‌دهد', noProd.status === 404);
    const chkNo = await api(
      '/api/wishlist/check/' + encodeURIComponent('وجود-ندارد'), {}, cookie);
    add('‎check محصول ناموجود ۴۰۴', chkNo.status === 404);
  }

  // ───────────────────────── ۳) نظرات (خواندن)
  console.log();
  console.log(h('  ۳) نظرات — خواندن'));

  const rv = await api('/api/reviews/' + prod.id);
  add('‎/api/reviews/:id پاسخ ۲۰۰', rv.status === 200);
  add('شکل پاسخ کامل است',
      ['summary', 'reviews', 'my_review', 'can_review', 'purchased']
        .every(k => k in rv.json), Object.keys(rv.json).join(','));
  add('مهمان can_review=false می‌گیرد', rv.json.can_review === false);
  add('نامک هم کار می‌کند',
      (await api('/api/reviews/' + prod.slug)).status === 200);
  add('محصول ناموجود ۴۰۴',
      (await api('/api/reviews/' + encodeURIComponent('نیست'))).status === 404);

  if (cookie) {
    const rvIn = await api('/api/reviews/' + prod.id, {}, cookie);
    add('کاربر واردشده can_review=true می‌گیرد', rvIn.json.can_review === true);
    add('وضعیت خرید اعلام می‌شود', typeof rvIn.json.purchased === 'boolean',
        `purchased=${rvIn.json.purchased}`);
  }

  // ───────────────────────── ۴) نظرات (ثبت)
  console.log();
  console.log(h('  ۴) نظرات — ثبت'));

  add('ثبت بدون ورود ۴۰۱',
      (await post('/api/reviews', { product: prod.id, rating: 5, body: 'عالی بود واقعاً' })).status === 401);

  if (cookie) {
    db.prepare('DELETE FROM reviews WHERE mobile=?').run(MOBILE);
    /* سطل «۵ نظر در روز» بین اجراهای آزمون باقی می‌ماند و پنجره‌اش
       ۲۴ ساعت است. بدون این پاک‌سازی، اجرای دوم آزمون همه‌ی این
       بخش را ۴۲۹ می‌گرفت — و باز هم مقصر آزمون بود نه کد. */
    db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'review:%'").run();

    const badRate = await post('/api/reviews',
      { product: prod.id, rating: 9, body: 'متن به‌قدر کافی بلند' }, cookie);
    add('امتیاز خارج از ۱ تا ۵ رد می‌شود', badRate.status === 400);

    const shortBody = await post('/api/reviews',
      { product: prod.id, rating: 5, body: 'خوب' }, cookie);
    add('متن کوتاه‌تر از ۱۰ حرف رد می‌شود', shortBody.status === 400);

    const ok = await post('/api/reviews', {
      product: prod.id, rating: 4,
      title: 'ماندگاری خوب',
      body: 'رایحه‌اش دقیقاً همانی بود که انتظار داشتم. سپاسگزارم.'
    }, cookie);
    add('نظر معتبر ۲۰۱ می‌گیرد', ok.status === 201);
    add('پیام «پس از بررسی» است',
        /بررسی/.test(ok.json.message || ''), 'انتشار فوری نیست');

    const row = db.prepare('SELECT * FROM reviews WHERE mobile=? AND product_id=?')
      .get(MOBILE, prod.id);
    add('در دیتابیس با وضعیت PENDING ثبت شد',
        !!row && row.status === 'PENDING');
    add('نظر تأییدنشده در فهرست عمومی نیست',
        (await api('/api/reviews/' + prod.id)).json.reviews.length === 0,
        'صف تأیید واقعاً کار می‌کند');

    const mineNow = await api('/api/reviews/' + prod.id, {}, cookie);
    add('ولی خود نویسنده نظرش را می‌بیند',
        mineNow.json.my_review?.status === 'PENDING',
        'وگرنه فکر می‌کند ثبت نشده و دوباره می‌نویسد');

    const xss = await post('/api/reviews', {
      product: prod.id, rating: 5,
      body: '<script>alert(1)</script> این متن باید پاک شود'
    }, cookie);
    const xrow = db.prepare('SELECT body FROM reviews WHERE mobile=? AND product_id=?')
      .get(MOBILE, prod.id);
    add('برچسب اسکریپت در نظر پاک می‌شود',
        xss.status === 201 && !/<script/i.test(xrow.body || ''),
        'نظر در پنل مدیریت رندر می‌شود');

    /* محدودیت سوم این ماژول که در بازبینی اولیه از قلم افتاده بود:
       ۵ نظر در ۲۴ ساعت به ازای هر شماره. رفتارش مثل `alert` گویا
       است (۴۲۹ با پیام) چون کاربر منتظر تأیید است. */
    let rev429 = false, revMsg = '';
    for (let i = 0; i < 8; i++) {
      const x = await post('/api/reviews', {
        product: prod.id, rating: 5,
        body: `نظر شماره ${i} برای آزمون محدودیت نرخ روزانه نظرات.`
      }, cookie);
      if (x.status === 429) { rev429 = true; revMsg = x.json.error || ''; break; }
    }
    add('سقف ۵ نظر در روز اعمال می‌شود', rev429, revMsg);
    add('پیام سقف نظر گویا است', /۵ نظر/.test(revMsg), revMsg);

    db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'review:%'").run();
    db.prepare('DELETE FROM reviews WHERE mobile=?').run(MOBILE);
  }

  // ───────────────────────── ۵) دعوت‌نامه نظر
  console.log();
  console.log(h('  ۵) دعوت‌نامه نظر مشتری حضوری'));

  add('توکن نامعتبر ۴۱۰ می‌دهد',
      (await api('/api/review-invite/توکن-جعلی')).status === 410,
      '۴۱۰ یعنی «بود و رفت» — دقیق‌تر از ۴۰۴');
  add('ثبت با توکن نامعتبر ۴۱۰',
      (await post('/api/review-invite', { token: 'x' })).status === 410);

  /* دعوت‌نامه واقعی از خودِ `createReviewInvite` گرفته می‌شود، نه
     دست‌ساز. نسخه اول این آزمون توکن `test-xxxx` می‌ساخت و همه‌ی
     بررسی‌های این بخش قرمز شدند — چون `readReviewInvite` توکن را
     با `/^[a-f0-9]{32}$/` می‌سنجد. کد درست بود، آزمون غلط.

     درس تکراری: قرارداد واقعی را بخوان، حدس نزن. */
  db.prepare('DELETE FROM review_invites WHERE mobile=?').run(OTHER);
  db.prepare('DELETE FROM reviews WHERE mobile=?').run(OTHER);
  const { createReviewInvite } = require('../src/db');
  const tok = createReviewInvite(prod.id, OTHER, 'آزمون گام ۸', 'test').token;
  add('توکن دعوت ۳۲ نویسه hex است', /^[a-f0-9]{32}$/.test(tok),
      'حدس زدنی نباشد — لینک عملاً کلید دسترسی است');

  const inv = await api('/api/review-invite/' + tok);
  add('دعوت‌نامه معتبر ۲۰۰ می‌دهد', inv.status === 200);
  add('محصول همراه دعوت می‌آید', inv.json.product?.id === prod.id);
  add('شماره ماسک‌شده برمی‌گردد',
      /\*{4}/.test(inv.json.mobile_masked || ''), inv.json.mobile_masked);
  add('شماره کامل هرگز برنمی‌گردد',
      !inv.raw.includes(OTHER),
      'اگر لینک به دست دیگری بیفتد شماره لو نمی‌رود');

  const invPost = await post('/api/review-invite', {
    token: tok, rating: 5,
    body: 'در فروشگاه تست زدم و همان روز خریدم. راضی‌ام.'
  });
  add('ثبت نظر با دعوت‌نامه ۲۰۱', invPost.status === 201, invPost.json.error || '');
  add('نظر با منبع دعوت ثبت شد',
      !!db.prepare("SELECT 1 FROM reviews WHERE mobile=? AND product_id=?")
        .get(OTHER, prod.id));

  const reuse = await post('/api/review-invite', {
    token: tok, rating: 1, body: 'تلاش دوم با همان توکن سوخته'
  });
  add('توکن یک‌بارمصرف است — بار دوم ۴۱۰',
      reuse.status === 410 && reuse.json.used === true,
      'وگرنه یک لینک می‌توانست بی‌نهایت نظر بسازد');
  const reread = await api('/api/review-invite/' + tok);
  add('خواندن دعوت سوخته هم ۴۱۰', reread.status === 410);

  db.prepare('DELETE FROM reviews WHERE mobile=?').run(OTHER);
  db.prepare('DELETE FROM review_invites WHERE mobile=?').run(OTHER);

  // ───────────────────────── ۶) اطلاع موجود شدن
  console.log();
  console.log(h('  ۶) اطلاع موجود شدن'));

  db.prepare('DELETE FROM stock_alerts WHERE mobile=?').run(MOBILE);

  const alBad = await post('/api/stock-alert', { sku: emptySku, mobile: '123' });
  add('شماره نامعتبر ۴۰۰ می‌دهد', alBad.status === 400);
  const alNoSku = await post('/api/stock-alert',
    { sku: 'SKU-NIST', mobile: MOBILE });
  add('کالای ناموجود ۴۰۴ می‌دهد', alNoSku.status === 404);

  const inStock = db.prepare('SELECT sku FROM variants WHERE stock>0 LIMIT 1').get();
  if (inStock) {
    const already = await post('/api/stock-alert',
      { sku: inStock.sku, mobile: MOBILE });
    add('کالای موجود ۴۰۰ می‌دهد', already.status === 400,
        'هشدار برای چیزی که هست بی‌معناست');
  } else {
    add('کالای موجود ۴۰۰ می‌دهد', true, 'هیچ واریانت موجودی نیست — رد شد');
  }

  const alOk = await post('/api/stock-alert', { sku: emptySku, mobile: MOBILE });
  add('ثبت هشدار ۲۰۱ می‌گیرد', alOk.status === 201);
  add('در دیتابیس ثبت شد',
      !!db.prepare('SELECT 1 FROM stock_alerts WHERE sku=? AND mobile=?')
        .get(emptySku, MOBILE));
  const alDup = await post('/api/stock-alert', { sku: emptySku, mobile: MOBILE });
  const dupCount = db.prepare(
    'SELECT COUNT(*) c FROM stock_alerts WHERE sku=? AND mobile=?'
  ).get(emptySku, MOBILE).c;
  add('ثبت تکراری ردیف دوم نمی‌سازد',
      alDup.status === 201 && dupCount === 1,
      'INSERT OR IGNORE — کاربر دو بار پیامک نمی‌گیرد');

  db.prepare('DELETE FROM stock_alerts WHERE mobile=?').run(MOBILE);

  // ───────────────────────── ۷) نوار اعلان
  console.log();
  console.log(h('  ۷) نوار اعلان'));

  const nc = await api('/api/notice');
  add('‎/api/notice پاسخ ۲۰۰', nc.status === 200);
  add('کلید notice همیشه هست', 'notice' in nc.json,
      `notice=${nc.json.notice === null ? 'null' : 'دارد'}`);

  db.prepare('DELETE FROM notices WHERE text LIKE ?').run('آزمون گام ۸%');
  db.prepare(`INSERT INTO notices (text, active, starts_at, ends_at, tone)
              VALUES (?,1,?,?,?)`)
    .run('آزمون گام ۸ — پیام فعال', '2020-01-01', '2099-12-31', 'info');
  const ncOn = await api('/api/notice');
  add('اعلان فعال نشان داده می‌شود',
      /آزمون گام ۸/.test(ncOn.json.notice?.text || ''));

  db.prepare("UPDATE notices SET ends_at='2020-01-02' WHERE text LIKE ?")
    .run('آزمون گام ۸%');
  const ncOff = await api('/api/notice');
  add('اعلان منقضی خودبه‌خود محو می‌شود',
      !/آزمون گام ۸/.test(ncOff.json.notice?.text || ''),
      'تاریخ پایان واقعاً اعمال می‌شود');
  db.prepare('DELETE FROM notices WHERE text LIKE ?').run('آزمون گام ۸%');

  // ───────────────────────── ۸) پیگیری سفارش
  console.log();
  console.log(h('  ۸) پیگیری سفارش'));

  add('بدون شماره ۴۰۰ می‌دهد',
      (await api('/api/orders/track')).status === 400);
  add('بدون شماره سفارش هم رد می‌شود', (await api('/api/orders/track?mobile=09120000000')).status === 400);

  const unknown = await api('/api/orders/track?mobile=09999999999&order_id=YZD-MISSING');
  add('شماره ناموجود ۲۰۰ با فهرست خالی می‌دهد',
      unknown.status === 200 && unknown.json.total === 0,
      'نه ۴۰۴ — وگرنه می‌شد فهمید کدام شماره‌ها مشتری‌اند');

  const anyOrder = db.prepare(
    'SELECT order_id, mobile FROM orders ORDER BY rowid DESC LIMIT 1'
  ).get();
  if (anyOrder) {
    const mine = await api('/api/orders/track?mobile=' + anyOrder.mobile + '&order_id=' + encodeURIComponent(anyOrder.order_id));
    add('سفارش خودم پیدا می‌شود', mine.status === 200 && mine.json.total > 0,
        `${mine.json.total} سفارش`);
    add('اقلام سفارش ضمیمه‌اند',
        Array.isArray(mine.json.orders[0]?.items));

    const cross = await api(
      `/api/orders/track?mobile=09999999999&order_id=${anyOrder.order_id}`);
    add('شماره غریبه سفارش دیگری را نمی‌بیند',
        cross.json.total === 0,
        'فیلتر روی mobile **و** order_id هر دو اعمال می‌شود');

    const exact = await api(
      `/api/orders/track?mobile=${anyOrder.mobile}&order_id=${anyOrder.order_id}`);
    add('جستجوی دقیق یک سفارش برمی‌گرداند', exact.json.total === 1);
  } else {
    add('سفارش خودم پیدا می‌شود', true, 'سفارشی در دیتابیس نیست — رد شد');
    add('اقلام سفارش ضمیمه‌اند', true, 'رد شد');
    add('شماره غریبه سفارش دیگری را نمی‌بیند', true, 'رد شد');
    add('جستجوی دقیق یک سفارش برمی‌گرداند', true, 'رد شد');
  }

  // ───────────────────────── ۹) دو محدودیت نرخ، دو رفتار
  console.log();
  console.log(h('  ۹) محدودیت نرخ — دو رفتار عمدی'));

  db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'track%' OR bucket LIKE 'alert%'").run();

  console.log(d('    (‎سیلاب روی /api/track…)'));
  let trThrottled = false, trNon200 = false;
  for (let i = 0; i < 130; i++) {
    const x = await post('/api/track', { kind: 'view', target: prod.id });
    if (x.status !== 200) trNon200 = true;
    if (x.json.throttled) trThrottled = true;
    if (trThrottled) break;
  }
  add('‎track محدودیت نرخ دارد', trThrottled);
  add('‎track رد شدن ۲۰۰ خاموش است', !trNon200,
      'تحلیل نباید تجربه کاربر را خراب کند');

  console.log(d('    (‎سیلاب روی /api/stock-alert…)'));
  let al429 = false, alMsg = '';
  for (let i = 0; i < 40; i++) {
    const x = await post('/api/stock-alert',
      { sku: emptySku, mobile: MOBILE });
    if (x.status === 429) { al429 = true; alMsg = x.json.error || ''; break; }
  }
  add('‎stock-alert محدودیت نرخ دارد', al429);
  add('‎stock-alert رد شدن ۴۲۹ گویا است',
      /دقیقه/.test(alMsg), alMsg.slice(0, 50));
  add('دو رفتار عمداً متفاوت‌اند', !trNon200 && al429,
      'یکی خاموش چون کاربر منتظر نیست، یکی گویا چون هست');

  db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'track%' OR bucket LIKE 'alert%'").run();
  db.prepare('DELETE FROM stock_alerts WHERE mobile=?').run(MOBILE);

  // ───────────────────────── ۱۰) همسایه‌ها
  console.log();
  console.log(h('  ۱۰) مسیرهای همسایه'));

  add('‎/api/products سالم است',
      (await api('/api/products?limit=1')).status === 200);
  add('‎/api/showcase سالم است', (await api('/api/showcase')).status === 200);
  add('‎/api/cart/sync سالم است',
      (await post('/api/cart/sync', { skus: [] })).status === 200);
  add('‎/api/coupons/validate سالم است',
      [200, 400, 404].includes((await post('/api/coupons/validate', {})).status));
  add('‎/api/contact-info سالم است',
      (await api('/api/contact-info')).status === 200);
  add('‎/api/health سالم است', (await api('/api/health')).status === 200);
  add('صفحه اصلی رندر می‌شود', (await api('/')).status === 200);
  add('مسیر ناشناخته ۴۰۴', (await api('/api/hich')).status === 404);

  // ───────────────────────── ۱۱) سلامت ساختاری
  console.log();
  console.log(h('  ۱۱) سلامت ساختاری تفکیک'));

  const ROOT = path.dirname(__dirname);
  const mod = fs.readFileSync(path.join(ROOT, 'src/routes/engagement.js'), 'utf8');
  const srv = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');

  add('ماژول قرارداد handle را دارد',
      /async function handle\(ctx\)/.test(mod) && /module\.exports = \{ handle \}/.test(mod));
  add('در پایان false برمی‌گرداند', /return false;\s*\/\//.test(mod));
  add('پوشش sendJSON با return true هست',
      /const sendJSON = \(code, data\) => \{ ctx\.sendJSON\(code, data\); return true; \};/.test(mod));

  const body = mod.slice(mod.indexOf('const sendJSON'));
  add('هیچ `return;` خالی نیست', !/\breturn;\s*$/m.test(body));
  add('هیچ pipe(res) نیست', !/pipe\(res\)/.test(body));
  add('هیچ res.end() نیست', !/res\.end\(/.test(body));
  add('پیگیری داده شخصی را با no-store برمی‌گرداند', /res\.setHeader\('Cache-Control','no-store'\)/.test(body));

  add('server.js ماژول را صدا می‌زند', /routeEngagement\.handle\(/.test(srv));
  add('بلوک /api/track از server.js رفته',
      !/pathname === '\/api\/track'/.test(srv));
  add('بلوک /api/wishlist از server.js رفته',
      !/pathname === '\/api\/wishlist'/.test(srv));
  add('بلوک /api/notice از server.js رفته',
      !/pathname === '\/api\/notice'/.test(srv));
  add('بلوک /api/orders/track از server.js رفته',
      !/pathname === '\/api\/orders\/track'/.test(srv));
  add('‎POST /api/orders در server.js مانده',
      /pathname === '\/api\/orders'/.test(srv),
      'مسیر پرداخت — گام ۹ مشروط است');
  add('‎/api/payment/verify در server.js مانده',
      /pathname === '\/api\/payment\/verify'/.test(srv));

  const srvLines = srv.split('\n').length;
  const modLines = mod.split('\n').length;
  /* آستانه‌ای که با هر قابلیت تازه جابه‌جا می‌شود، آزمون نیست —
     یادآور است. هدف این بررسی «کوچک ماندن server.js» بود، نه یک
     عدد دقیق. از زمان گام ۸ سه قابلیت اضافه شده (نماد اعتماد،
     رسانه مقالات، هشدار داخلی) و هر کدام چند خط به سرور برده‌اند.

     ۲٬۴۰۰ سقفی است که اگر رد شود، یعنی واقعاً چیزی باید تفکیک
     شود — نه اینکه صرفاً یک قابلیت اضافه شده. */
  add('server.js کوچک مانده', srvLines < 2400, `${srvLines} خط`);
  console.log(d(`      ماژول engagement: ${modLines} خط`));

  // ───────────────────────── ۱۲) سرور زنده است؟
  console.log();
  console.log(h('  ۱۲) سرور پس از همه اینها'));
  add('سرور هنوز پاسخ می‌دهد',
      (await api('/api/products?limit=1')).status === 200,
      'تله ERR_HTTP_HEADERS_SENT فرآیند را می‌کشد');

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  تعامل مشتری سالم است.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
