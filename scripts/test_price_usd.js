#!/usr/bin/env node
/**
 * آزمون فیلد قیمت دلاری پایه.
 *
 * ── چرا این فیلد وجود دارد ──
 * فروشگاه فرمولی برای قیمت‌گذاری دارد که به نرخ دلار وابسته است
 * (وزن اسانس × قیمت دلاری + هزینه‌ها). هدف نهایی: با تغییر نرخ
 * ارز، قیمت تومانی همه محصولات خودکار به‌روز شود.
 *
 * این گام **اول** است — فقط نگهداری عدد. فرمول بعداً می‌آید.
 *
 * ── چرا آزمون از حالا ──
 * این عدد قرار است پایه محاسبه هزاران قیمت شود. اگر امروز
 * NULL و صفر با هم قاطی شوند، یا اعشار گرد شود، خطا در فرمول
 * نهایی تکثیر می‌شود — جایی که کشفش خیلی سخت‌تر است.
 *
 * پوشش:
 *   ۱) ستون با مهاجرت امن اضافه شده
 *   ۲) NULL و صفر از هم تفکیک می‌شوند
 *   ۳) اعشار حفظ می‌شود (گرد نمی‌شود)
 *   ۴) مجوز: انباردار نمی‌تواند عوضش کند
 *   ۵) 🔴 به مشتری نشت نمی‌کند
 *   ۶) در سابقه کارها ثبت می‌شود
 *
 * اجرا: node scripts/test_price_usd.js   (سرور بالا)
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { db } = require('../src/db');
const { makeStaff, cleanupStaff } = require('./lib/test_staff');

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

const enc = p => p.replace(/[^\x00-\x7F]/g, encodeURIComponent);
function api(p, opt = {}, token) {
  return new Promise(res => {
    const body = opt.body || null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: enc(p), method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b });
      });
    });
    req.on('error', () => res({ status: 0, json: {}, raw: '' }));
    if (body) req.write(body);
    req.end();
  });
}
const put = (p, obj, token) =>
  api(p, { method: 'PUT', body: JSON.stringify(obj) }, token);

(async () => {
  console.log();
  console.log(h('  آزمون قیمت دلاری پایه'));
  console.log(d('  ─────────────────────────────────────────────'));

  // ─────────────── ۱) ساختار
  console.log();
  console.log(h('  ۱) ستون دیتابیس'));

  const cols = db.prepare('PRAGMA table_info(variants)').all();
  const usdCol = cols.find(c => c.name === 'price_usd');
  add('ستون price_usd هست', !!usdCol);
  add('نوع REAL است', usdCol && usdCol.type === 'REAL',
      usdCol ? usdCol.type : '—');
  add('NULL مجاز است', usdCol && usdCol.notnull === 0,
      'تا «نامشخص» از «رایگان» جدا بماند');
  add('ستون‌های پیشین دست‌نخورده‌اند',
      ['sku', 'price_toman', 'stock'].every(n => cols.some(c => c.name === n)));

  // ─────────────── ۲) ورود مدیر
  console.log();
  console.log(h('  ۲) دسترسی'));

  const login = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  const owner = login.json.token;
  add('ورود مدیر', !!owner);
  if (!owner) { console.log(r('\n  بدون توکن ادامه ممکن نیست.\n')); process.exit(1); }

  const sample = db.prepare(`
    SELECT v.sku, v.price_toman, v.stock, p.slug
    FROM variants v JOIN products p ON p.id = v.product_id LIMIT 1
  `).get();
  const before = db.prepare('SELECT * FROM variants WHERE sku=?').get(sample.sku);

  // ─────────────── ۳) ذخیره و بازخوانی
  console.log();
  console.log(h('  ۳) ذخیره مقدار'));

  const set = await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
    { price_usd: 12.5 }, owner);
  add('ذخیره ۲۰۰ می‌دهد', set.status === 200, set.json.message);
  add('مقدار در پاسخ برمی‌گردد', set.json.price_usd === 12.5,
      String(set.json.price_usd));

  const row = db.prepare('SELECT price_usd FROM variants WHERE sku=?').get(sample.sku);
  add('در دیتابیس ذخیره شد', row.price_usd === 12.5, String(row.price_usd));
  add('🔴 اعشار حفظ شد — گرد نشد', row.price_usd !== 12 && row.price_usd !== 13,
      'قیمت اسانس اعشاری است؛ گرد کردن خطا را در فرمول تکثیر می‌کند');

  const precise = await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
    { price_usd: 0.075 }, owner);
  const r2 = db.prepare('SELECT price_usd FROM variants WHERE sku=?').get(sample.sku);
  add('اعشار ریز هم حفظ می‌شود', r2.price_usd === 0.075, String(r2.price_usd));

  // ─────────────── ۴) NULL در برابر صفر
  console.log();
  console.log(h('  ۴) «نامشخص» در برابر «صفر»'));

  await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
    { price_usd: 0 }, owner);
  const zero = db.prepare('SELECT price_usd FROM variants WHERE sku=?').get(sample.sku);
  add('صفر به‌عنوان صفر ذخیره می‌شود', zero.price_usd === 0);

  await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
    { price_usd: '' }, owner);
  const nul = db.prepare('SELECT price_usd FROM variants WHERE sku=?').get(sample.sku);
  add('🔴 رشته خالی به NULL می‌رود نه صفر', nul.price_usd === null,
      String(nul.price_usd));
  add('صفر و NULL یکی نیستند', zero.price_usd !== nul.price_usd,
      '۰ یعنی رایگان · NULL یعنی وارد نشده');

  // ─────────────── ۵) اعتبارسنجی
  console.log();
  console.log(h('  ۵) اعتبارسنجی'));

  const neg = await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
    { price_usd: -5 }, owner);
  add('عدد منفی رد می‌شود', neg.status === 400, neg.json.error);

  const huge = await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
    { price_usd: 999999 }, owner);
  add('عدد بیش از حد بزرگ رد می‌شود', huge.status === 400,
      'اشتباه تایپی در پایه محاسبه، هزاران قیمت را خراب می‌کند');

  const txt = await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
    { price_usd: 'abc' }, owner);
  add('متن رد می‌شود', txt.status === 400, txt.json.error);

  const afterBad = db.prepare('SELECT price_usd FROM variants WHERE sku=?').get(sample.sku);
  add('پس از ورودی نامعتبر، مقدار پیشین سالم است',
      afterBad.price_usd === null, 'ذخیره نیمه‌کاره رخ نمی‌دهد');

  // ─────────────── ۶) مجوز
  console.log();
  console.log(h('  ۶) مرز دسترسی'));

  /* `makeStaff` یک **شیء** برمی‌گرداند (`{token, nid, mobile}`)
     نه رشته توکن. نسخه اول این آزمون آن را مستقیم به‌عنوان توکن
     فرستاد؛ سرور هدر بی‌معنا گرفت و ۴۰۳ داد — که تصادفاً شبیه
     «مرز دسترسی کار می‌کند» بود. سبزِ توخالی خطرناک‌تر از قرمز
     است. */
  /* پاک‌سازی پیش از ساخت، نه فقط بعدش: اگر اجرای قبلی نیمه‌کاره
     تمام شده باشد، کارمند می‌ماند و ساخت دوباره ۴۰۰ می‌دهد.
     آزمون باید از هر وضعیتی بتواند شروع کند. */
  cleanupStaff(db, ['usdtest_wh']);
  const whStaff = await makeStaff(api, owner, 'usdtest_wh', 'warehouse');
  const wh = whStaff.token;
  add('کارمند انباردار ساخته شد', !!wh,
      wh ? `کد ملی ${whStaff.nid}` : (whStaff.error || 'توکن نگرفت'));

  if (wh) {
    const attempt = await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
      { price_usd: 99 }, wh);
    add('🔴 انباردار نمی‌تواند قیمت دلاری بگذارد', attempt.status === 403,
        'پایه محاسبه است، نه موجودی');

    const still = db.prepare('SELECT price_usd FROM variants WHERE sku=?').get(sample.sku);
    add('مقدار عوض نشد', still.price_usd === null);

    const stockOk = await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
      { stock: 7 }, wh);
    add('ولی موجودی را می‌تواند', stockOk.status === 200,
        'مرز دسترسی دقیق است، نه سراسری');
  }

  // ─────────────── ۷) نشت به مشتری
  console.log();
  console.log(h('  ۷) نشت اطلاعات'));

  await put('/api/admin/variants/' + encodeURIComponent(sample.sku),
    { price_usd: 42.75 }, owner);

  const pub = await api('/api/products/' + sample.slug);
  add('مسیر عمومی محصول ۲۰۰', pub.status === 200);
  add('🔴 قیمت دلاری به مشتری نمی‌رود',
      !pub.raw.includes('42.75') && !pub.raw.includes('price_usd'),
      'وگرنه حاشیه سود قابل محاسبه بود');

  const list = await api('/api/products?limit=5');
  add('در فهرست محصولات هم نیست', !list.raw.includes('price_usd'));

  const show = await api('/api/showcase');
  add('در ویترین هم نیست', !show.raw.includes('price_usd'));

  const admView = await api('/api/admin/products/' + sample.slug, {}, owner);
  add('مدیر آن را می‌بیند', admView.status === 200 &&
      admView.json.variants.some(v => v.price_usd === 42.75),
      'پنل باید ببیند');

  if (wh) {
    const whView = await api('/api/admin/products/' + sample.slug, {}, wh);
    add('انباردار محصول را می‌بیند', whView.status === 200);
    add('ولی قیمت دلاری را نه',
        !whView.raw.includes('42.75'),
        'مجوز نرم — نبودش خطا نیست، فقط دیده نمی‌شود');
  }

  // ─────────────── ۸) سابقه کارها
  console.log();
  console.log(h('  ۸) ثبت در سابقه'));

  const audit = db.prepare(`
    SELECT action, detail FROM audit_log
    WHERE target=? ORDER BY id DESC LIMIT 5
  `).all(sample.sku);
  const withUsd = audit.find(a => (a.detail || '').includes('usd'));
  add('تغییر قیمت دلاری ثبت می‌شود', !!withUsd,
      withUsd ? withUsd.action : 'یافت نشد');
  add('مقدار پیش و پس ثبت می‌شود',
      withUsd && /\[.*,.*\]/.test(withUsd.detail || ''),
      'برای پیگیری تغییر قیمت');

  // ─────────────── ۹) پنل
  console.log();
  console.log(h('  ۹) رابط پنل'));

  const ROOT = path.dirname(__dirname);
  const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  add('ورودی قیمت دلاری هست', /id="usd_\$\{v\.sku\}"/.test(adm));
  add('‎step=any برای اعشار', /step="any"/.test(adm),
      'وگرنه مرورگر فقط عدد صحیح می‌پذیرد');
  add('حداقل صفر', /min="0"/.test(adm));
  add('در ذخیره فرستاده می‌شود', /price_usd: usd/.test(adm));
  add('خالی به همان شکل می‌رود', /usdEl\.value\.trim\(\)/.test(adm),
      'سرور تبدیلش می‌کند به NULL');
  add('ستون در جدول هست', /قیمت پایه \(\$\)/.test(adm));
  add('پنل از مسیر مدیریتی می‌خواند',
      /\/api\/admin\/products\/' \+ encodeURIComponent\(slug\)/.test(adm),
      'نه مسیر عمومی که price_usd ندارد');

  // ─────────────── پاک‌سازی
  db.prepare('UPDATE variants SET price_usd=?, stock=? WHERE sku=?')
    .run(before.price_usd ?? null, before.stock, sample.sku);
  /* پاک‌سازی با کد ملی، نه نام مستعار — نام کاربری کارمند کد
     ملی است و الگوی `usdtest%` هرگز نمی‌خواند. */
  cleanupStaff(db, ['usdtest_wh']);

  const restored = db.prepare('SELECT price_usd, stock FROM variants WHERE sku=?')
    .get(sample.sku);
  add('وضعیت به حالت پیش از آزمون برگشت',
      restored.stock === before.stock &&
      (restored.price_usd ?? null) === (before.price_usd ?? null));

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  قیمت دلاری درست کار می‌کند.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));

  console.log(d('  توجه: این فقط نگهداری عدد است.'));
  console.log(d('  فرمول محاسبه خودکار هنوز پیاده نشده.\n'));
  process.exit(failed === 0 ? 0 : 1);
})();
