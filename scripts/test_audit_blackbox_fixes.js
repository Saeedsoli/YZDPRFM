#!/usr/bin/env node
/**
 * آزمون رفع یافته‌های ممیزی جعبه‌سیاه (۱۵ مرداد ۱۴۰۵).
 *
 * چرا این آزمون:
 *   ممیزی جعبه‌سیاه نشان داد مسیر پیگیری سفارش با **فقط شماره
 *   موبایل** و بدون احراز هویت، نشانی کامل منزل مشتری را
 *   برمی‌گرداند — و هیچ محدودیت نرخی ندارد. ۲۵ درخواست پیاپی،
 *   هر ۲۵ تا پذیرفته شد.
 *
 *   کسی که فهرستی از شماره‌ها دارد می‌توانست نشانی منزل مشتریان
 *   را استخراج کند. این ریسک امنیت فیزیکی است، نه فقط حریم
 *   خصوصی.
 *
 *   بدون آزمون، این رفع می‌تواند در بازسازی بعدی بی‌صدا برگردد.
 *
 * پوشش:
 *   ۱) محدودیت نرخ روی IP و روی شماره — هر دو
 *   ۲) فهرست سفید میدان‌ها — یادداشت داخلی نشت نکند
 *   ۳) قالب شماره پیش از مصرف سطل بررسی شود
 *   ۴) کد ارز معتبر در داده ساختاریافته
 *   ۵) دسترس‌پذیری — h1 و inputmode
 *
 * اجرا: node scripts/test_audit_blackbox_fixes.js   (سرور بالا)
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

const enc = p => p.replace(/[^\x00-\x7F]/g, encodeURIComponent);
function api(p, opt = {}) {
  return new Promise(res => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: enc(p), method: opt.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b, headers: x.headers });
      });
    });
    req.on('error', () => res({ status: 0, json: {}, raw: '', headers: {} }));
    req.end();
  });
}
const clearRl = () =>
  db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'track-%'").run();

(async () => {
  console.log();
  console.log(h('  آزمون رفع یافته‌های ممیزی جعبه‌سیاه'));
  console.log(d('  ─────────────────────────────────────────────'));

  const sample = db.prepare(
    'SELECT mobile, order_id FROM orders WHERE mobile IS NOT NULL LIMIT 1'
  ).get();

  // ─────────────── ۱) اعتبارسنجی ورودی
  console.log();
  console.log(h('  ۱) اعتبارسنجی شماره'));

  clearRl();
  add('بدون شماره ۴۰۰', (await api('/api/orders/track')).status === 400);

  const badFmt = await api('/api/orders/track?mobile=123');
  add('شماره بدقالب ۴۰۰ می‌دهد', badFmt.status === 400,
      (badFmt.json.error || '').slice(0, 44));

  const evil = await api('/api/orders/track?mobile=' + encodeURIComponent("' OR 1=1--"));
  add('تزریق SQL رد می‌شود', evil.status === 400);

  /* ورودی بدقالب نباید سطل را مصرف کند — وگرنه کاربری که اشتباه
     تایپ کرده، برای تلاش درست بعدی جریمه می‌شود. */
  clearRl();
  for (let i = 0; i < 20; i++) await api('/api/orders/track?mobile=xx');
  const afterBad = await api('/api/orders/track?mobile=' + sample.mobile);
  add('ورودی بدقالب سطل را نمی‌سوزاند', afterBad.status === 200,
      'کاربر بابت اشتباه تایپی جریمه نمی‌شود');

  // ─────────────── ۲) محدودیت نرخ IP
  console.log();
  console.log(h('  ۲) محدودیت نرخ — پویش از یک منبع'));

  clearRl();
  let ok200 = 0, got429 = 0, msg = '';
  for (let i = 0; i < 25; i++) {
    // شماره‌های متفاوت: شبیه‌سازی پویش فهرست
    const res = await api(`/api/orders/track?mobile=0912111${String(1000 + i).slice(-4)}`);
    if (res.status === 200) ok200++;
    else if (res.status === 429) { got429++; msg = msg || res.json.error || ''; }
  }
  add('🔴 پویش ۲۵ شماره‌ای مسدود می‌شود', got429 > 0,
      `${ok200} پذیرفته · ${got429} مسدود`);
  add('پیش از ممیزی هر ۲۵ تا می‌گذشتند', ok200 < 25,
      'یافته اصلی ممیزی');
  add('پیام مسدودی فارسی است', /دقیقه/.test(msg), msg.slice(0, 52));
  add('عدد پیام با رقم فارسی است', /[۰-۹]/.test(msg),
      'تنها جای سایت که رقم لاتین نشان داده می‌شد');

  // ─────────────── ۳) محدودیت نرخ شماره
  console.log();
  console.log(h('  ۳) محدودیت نرخ — کوبیدن یک شماره'));

  clearRl();
  let phBlocked = false, phMsg = '';
  for (let i = 0; i < 12; i++) {
    const res = await api('/api/orders/track?mobile=09121119999');
    if (res.status === 429) {
      phBlocked = true; phMsg = res.json.error || '';
      break;
    }
  }
  add('سطل شماره جدا از سطل IP کار می‌کند', phBlocked, phMsg.slice(0, 50));
  add('پیام سطل شماره متمایز است', /این شماره/.test(phMsg),
      'مهاجمی که IP عوض می‌کند هم متوقف می‌شود');

  // ─────────────── ۴) فهرست سفید میدان‌ها
  console.log();
  console.log(h('  ۴) نشت داده — فهرست سفید'));

  clearRl();
  const real = await api('/api/orders/track?mobile=' + sample.mobile);
  add('سفارش واقعی برمی‌گردد', real.status === 200 && real.json.total > 0,
      `${real.json.total} سفارش`);

  if (real.json.orders && real.json.orders[0]) {
    const o = real.json.orders[0];
    const LEAK = ['admin_note', 'payment_ref', 'payment_gateway',
                  'campaign_note', 'email', 'first_name', 'last_name'];
    const leaked = LEAK.filter(k => k in o);
    add('🔴 یادداشت داخلی کارکنان نشت نمی‌کند', !('admin_note' in o));
    add('شناسه تراکنش درگاه نشت نمی‌کند', !('payment_ref' in o));
    add('هیچ میدان داخلی دیگری نیست', leaked.length === 0,
        leaked.length ? leaked.join(', ') : 'همه بسته');

    const NEED = ['order_id', 'status', 'total_paid', 'tracking_code', 'items'];
    add('اطلاعات لازم مشتری هست', NEED.every(k => k in o),
        NEED.join(', '));
    add('اقلام سفارش ضمیمه‌اند', Array.isArray(o.items) && o.items.length > 0,
        `${o.items?.length} قلم`);

    if (o.items && o.items[0]) {
      add('اقلام هم فهرست سفید دارند',
          !('id' in o.items[0]) && 'product_name' in o.items[0],
          Object.keys(o.items[0]).join(', '));
    }
  } else {
    ['🔴 یادداشت داخلی کارکنان نشت نمی‌کند','شناسه تراکنش درگاه نشت نمی‌کند',
     'هیچ میدان داخلی دیگری نیست','اطلاعات لازم مشتری هست',
     'اقلام سفارش ضمیمه‌اند','اقلام هم فهرست سفید دارند']
      .forEach(t => add(t, false, 'سفارشی برنگشت'));
  }

  // ─────────────── ۵) شماره ناموجود
  console.log();
  console.log(h('  ۵) شماره ناموجود'));

  clearRl();
  const none = await api('/api/orders/track?mobile=09999999999');
  add('۲۰۰ با فهرست خالی، نه ۴۰۴',
      none.status === 200 && none.json.total === 0,
      'وگرنه می‌شد فهمید کدام شماره‌ها مشتری‌اند');

  // ─────────────── ۶) داده ساختاریافته
  console.log();
  console.log(h('  ۶) داده ساختاریافته محصول'));

  const page = await api('/perfume/creed-aventus');
  const ld = (page.raw.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
    .map(s => { try { return JSON.parse(s.replace(/<[^>]*>/g, '')); } catch { return null; } })
    .filter(Boolean);
  const prod = ld.find(x => x['@type'] === 'Product');

  add('داده محصول وجود دارد', !!prod);
  if (prod) {
    add('🔴 کد ارز معتبر ISO است', prod.offers.priceCurrency === 'IRR',
        `${prod.offers.priceCurrency} — IRT در ISO 4217 وجود ندارد`);

    /* قیمت‌ها به تومان ذخیره‌اند؛ با IRR باید ده برابر شوند وگرنه
       گوگل قیمتی ده برابر کمتر می‌بیند. */
    const minToman = db.prepare(`
      SELECT MIN(price_toman) m FROM variants v
      JOIN products p ON p.id = v.product_id WHERE p.slug='creed-aventus'
    `).get().m;
    add('قیمت به ریال تبدیل شده',
        prod.offers.lowPrice === minToman * 10,
        `${prod.offers.lowPrice} = ${minToman} × ۱۰`);

    add('وضعیت موجودی درست است',
        /InStock|OutOfStock/.test(prod.offers.availability));
    add('برند عمداً نام فروشگاه است',
        prod.brand.name === 'عطر یزد',
        'ادعای «محصول کرید» نمی‌کنیم');
    add('نام اصلی در alternateName هست',
        /Creed|CREED/.test(prod.alternateName || ''),
        'گوگل ارتباط را می‌فهمد بدون ادعای دروغ');
  }

  // ─────────────── ۷) دسترس‌پذیری
  console.log();
  console.log(h('  ۷) دسترس‌پذیری'));

  const ROOT = path.dirname(__dirname);
  const quiz = fs.readFileSync(path.join(ROOT, 'public/quiz.html'), 'utf8');
  const login = fs.readFileSync(path.join(ROOT, 'public/login.html'), 'utf8');
  const track = fs.readFileSync(path.join(ROOT, 'public/track.html'), 'utf8');

  add('کوییز h1 دارد', /<h1[^>]*>/.test(quiz));
  add('h1 کوییز پنهان است', /<h1 class="sr-only"/.test(quiz),
      'طراحی تمام‌صفحه تیتر بصری نمی‌خواهد');
  add('ورود فقط یک h1 دارد',
      (login.match(/<h1[^>]*>/g) || []).length === 1,
      `${(login.match(/<h1[^>]*>/g) || []).length} عدد`);
  add('ورودی پیگیری inputmode دارد', /inputmode="numeric"/.test(track),
      'صفحه‌کلید عددی موبایل');
  add('ورودی پیگیری type=tel دارد', /type="tel"/.test(track));
  add('ورودی پیگیری autocomplete دارد', /autocomplete="tel"/.test(track));

  // ─────────────── ۸) محافظ‌های موجود که نشکسته باشند
  console.log();
  console.log(h('  ۸) محافظ‌های پیشین'));

  const cors = await api('/api/orders/track?mobile=09121110000',
    { headers: { Origin: 'https://evil.ir' } });
  add('CORS روی پیگیری بسته است',
      !cors.headers['access-control-allow-origin'],
      'سایت مهاجم نمی‌تواند از مرورگر بازدیدکننده بخواند');

  const pub = await api('/api/products?limit=1',
    { headers: { Origin: 'https://evil.ir' } });
  add('CORS روی کاتالوگ عمومی باز مانده',
      pub.headers['access-control-allow-origin'] === '*',
      'خواندن کاتالوگ عمداً آزاد است');

  const hsts = await api('/', { headers: { 'X-Forwarded-Proto': 'https' } });
  add('HSTS روی HTTPS فعال می‌شود',
      !!hsts.headers['strict-transport-security'],
      hsts.headers['strict-transport-security']);

  const plain = await api('/');
  add('HSTS روی HTTP فعال نیست',
      !plain.headers['strict-transport-security'],
      'روی HTTP بی‌معناست');

  clearRl();
  const alive = await api('/api/health');
  add('سرور سالم است', alive.status === 200);

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  یافته‌های ممیزی رفع شده‌اند.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
