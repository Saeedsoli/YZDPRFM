#!/usr/bin/env node
/**
 * آزمون اطلاع‌رسانی داخلی — خبر به کارکنان، نه مشتری.
 *
 * چرا این ماژول ساخته شد:
 *   تا امروز هر اطلاع‌رسانی سایت به **مشتری** می‌رفت. اگر ساعت
 *   ۱۱ شب سفارشی ثبت می‌شد، تا وقتی کسی پنل را باز نمی‌کرد
 *   هیچ‌کس خبر نداشت.
 *
 * چرا این آزمون سخت‌گیر است:
 *   این ماژول در **مسیر داغ** صدا زده می‌شود — درست بعد از تأیید
 *   پرداخت. اگر خطا بدهد یا کند باشد، سفارش مشتری آسیب می‌بیند.
 *   پس باید ثابت شود که هرگز throw نمی‌کند و هرگز منتظر نمی‌ماند.
 *
 * پوشش:
 *   ۱) گیرندگان بر پایه **مجوز** انتخاب می‌شوند نه نقش
 *   ۲) ساعت آرام رعایت می‌شود، مگر رویداد فوری
 *   ۳) ضد سیل کار می‌کند
 *   ۴) هرگز throw نمی‌کند — حتی با داده خراب
 *   ۵) خاموش‌کردن واقعاً خاموش می‌کند
 *   ۶) به نقاط واقعی وصل شده
 *
 * اجرا: node scripts/test_alerts.js   (سرور لازم نیست)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const h = s => `\x1b[1m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

/** ماژول را با محیط دلخواه تازه بارگذاری می‌کند */
function fresh(env = {}) {
  const keep = {};
  Object.keys(env).forEach(k => { keep[k] = process.env[k]; process.env[k] = env[k]; });
  const p = require.resolve('../src/alerts');
  delete require.cache[p];
  const mod = require('../src/alerts');
  return {
    mod,
    restore() {
      Object.keys(env).forEach(k => {
        if (keep[k] === undefined) delete process.env[k];
        else process.env[k] = keep[k];
      });
      delete require.cache[p];
    }
  };
}

(async () => {
  console.log();
  console.log(h('  آزمون اطلاع‌رسانی داخلی'));
  console.log(d('  ─────────────────────────────────────────────'));

  const { db } = require('../src/db');

  // ─────────────── ۱) ساختار
  console.log();
  console.log(h('  ۱) ساختار رویدادها'));

  const alerts = require('../src/alerts');
  const kinds = Object.keys(alerts.EVENTS);
  add('رویدادها تعریف شده‌اند', kinds.length >= 5, `${kinds.length} رویداد`);
  add('سفارش تازه پوشش دارد', kinds.includes('newOrder'));
  add('تیکت مرجوعی پوشش دارد', kinds.includes('newTicket'));
  add('هشدار امنیتی پوشش دارد', kinds.includes('securityAlert'));

  let allValid = true;
  for (const k of kinds) {
    const ev = alerts.EVENTS[k];
    if (!ev.perm || typeof ev.text !== 'function') allValid = false;
  }
  add('هر رویداد مجوز و قالب متن دارد', allValid);

  const urgent = kinds.filter(k => alerts.EVENTS[k].urgent);
  add('فقط رویداد واقعاً فوری، فوری علامت خورده',
      urgent.length === 1 && urgent[0] === 'securityAlert',
      urgent.join(', ') || 'هیچ');

  // ─────────────── ۲) انتخاب گیرنده بر پایه مجوز
  console.log();
  console.log(h('  ۲) گیرندگان — بر پایه مجوز نه نقش'));

  const MOB_A = '09121230001';   // انباردار — سفارش می‌بیند
  const MOB_B = '09121230002';   // محتوانویس — سفارش نمی‌بیند

  db.prepare("DELETE FROM staff WHERE username LIKE 'alerttest%'").run();
  const mk = (u, role, mobile) => db.prepare(`
    INSERT INTO staff (username, display_name, mobile, role_key,
                       pass_hash, pass_salt, must_change, active)
    VALUES (?,?,?,?,'x','y',0,1)`).run(u, u, mobile, role);

  mk('alerttest_wh', 'warehouse', MOB_A);
  mk('alerttest_ed', 'editor',    MOB_B);

  const orderTo = alerts.recipients('orders.view');
  add('انباردار خبر سفارش می‌گیرد', orderTo.includes(MOB_A));
  add('محتوانویس خبر سفارش نمی‌گیرد', !orderTo.includes(MOB_B),
      'مرز مجوز رعایت شد');

  // کارمند غیرفعال نباید خبر بگیرد
  db.prepare("UPDATE staff SET active=0 WHERE username='alerttest_wh'").run();
  add('کارمند غیرفعال خبر نمی‌گیرد',
      !alerts.recipients('orders.view').includes(MOB_A));
  db.prepare("UPDATE staff SET active=1 WHERE username='alerttest_wh'").run();

  // بدون موبایل
  db.prepare("UPDATE staff SET mobile=NULL WHERE username='alerttest_wh'").run();
  add('کارمند بدون موبایل رد می‌شود',
      !alerts.recipients('orders.view').includes(MOB_A));
  db.prepare("UPDATE staff SET mobile=? WHERE username='alerttest_wh'").run(MOB_A);

  // شماره اضافی از متغیر محیطی
  {
    const { mod, restore } = fresh({ ALERTS_EXTRA_MOBILES: '09129998877,بد' });
    const to = mod.recipients('orders.view');
    add('شماره اضافی محیطی اضافه می‌شود', to.includes('09129998877'));
    add('شماره نامعتبر محیطی رد می‌شود', !to.includes('بد'));
    restore();
  }

  // ─────────────── ۳) ساعت آرام
  console.log();
  console.log(h('  ۳) ساعت آرام'));

  /* مالک همه مجوزها را دارد؛ با دادن موبایل به او، رویداد
     امنیتی گیرنده پیدا می‌کند و آزمون فوری بودن معنادار می‌شود. */
  const ownerMob = db.prepare("SELECT mobile FROM staff WHERE username='owner'").get();
  db.prepare("UPDATE staff SET mobile=? WHERE username='owner'").run('09121230009');

  {
    // بازه‌ای که همیشه آرام است (۰ تا ۲۴)
    const { mod, restore } = fresh({ ALERTS_QUIET_FROM: '0', ALERTS_QUIET_TO: '24' });
    add('در ساعت آرام تشخیص داده می‌شود', mod._internals.inQuietHours() === true);

    const res = await mod.fire('newOrder', { order_id: 'X', total_paid: 1 });
    add('رویداد غیرفوری در ساعت آرام نمی‌رود',
        res.sent === 0 && res.skipped === 'ساعت آرام', res.skipped);

    /* رویداد فوری باید **واقعاً بفرستد**، نه اینکه صرفاً به
       دلیل دیگری رد شود. نسخه اول فقط `skipped !== 'ساعت آرام'`
       را می‌سنجید و با «گیرنده‌ای ندارد» سبز می‌شد — سبزِ توخالی.
       پس گیرنده‌ای با مجوز لازم موقتاً اضافه می‌شود. */
    const urg = await mod.fire('securityAlert', { count: 3, ip: '1.2.3.4' });
    add('رویداد فوری ساعت آرام را نادیده می‌گیرد',
        urg.skipped !== 'ساعت آرام' && urg.sent > 0,
        urg.skipped || `${urg.sent} ارسال`);
    restore();
  }

  {
    // بازه‌ای که هرگز آرام نیست
    const { mod, restore } = fresh({ ALERTS_QUIET_FROM: '3', ALERTS_QUIET_TO: '3' });
    add('بیرون ساعت آرام، عبور می‌کند',
        mod._internals.inQuietHours() === false);
    restore();
  }

  add('ساعت به وقت تهران حساب می‌شود',
      typeof alerts._internals.tehranHour() === 'number' &&
      alerts._internals.tehranHour() >= 0 && alerts._internals.tehranHour() <= 23,
      `ساعت ${alerts._internals.tehranHour()} تهران`);

  // ─────────────── ۴) ضد سیل
  console.log();
  console.log(h('  ۴) ضد سیل'));

  {
    const { mod, restore } = fresh({
      ALERTS_QUIET_FROM: '3', ALERTS_QUIET_TO: '3',   // هرگز آرام نباشد
      ALERTS_HOURLY_CAP: '3'
    });
    let capped = false, passed = 0;
    for (let i = 0; i < 8; i++) {
      const res = await mod.fire('lowStock', { count: 5, threshold: 3 });
      if (res.skipped === 'سقف ساعتی') { capped = true; break; }
      passed++;
    }
    add('سقف ساعتی اعمال می‌شود', capped, `${passed} بار عبور کرد`);
    add('سقف هر رویداد جداست',
        (await mod.fire('newTicket', { ticket_id: 'T1' })).skipped !== 'سقف ساعتی',
        'سیل موجودی نباید تیکت را ببندد');
    restore();
  }

  // ─────────────── ۵) خاموش کردن
  console.log();
  console.log(h('  ۵) خاموش کردن'));

  {
    const { mod, restore } = fresh({ ALERTS_ENABLED: '0' });
    const res = await mod.fire('newOrder', { order_id: 'X', total_paid: 1 });
    add('‏ALERTS_ENABLED=0 واقعاً خاموش می‌کند',
        res.sent === 0 && res.skipped === 'خاموش');
    add('وضعیت خاموش بودن را گزارش می‌کند', mod.status().enabled === false);
    restore();
  }

  // ─────────────── ۶) مقاومت در برابر خطا
  console.log();
  console.log(h('  ۶) مقاومت — مسیر داغ نباید بشکند'));

  {
    const { mod, restore } = fresh({ ALERTS_QUIET_FROM: '3', ALERTS_QUIET_TO: '3' });

    let threw = false;
    try { await mod.fire('newOrder', null); } catch { threw = true; }
    add('داده null باعث throw نمی‌شود', !threw);

    threw = false;
    try { await mod.fire('رویداد-نامعلوم', {}); } catch { threw = true; }
    add('رویداد ناشناخته باعث throw نمی‌شود', !threw);

    const bad = await mod.fire('رویداد-نامعلوم', {});
    add('رویداد ناشناخته گزارش می‌شود', bad.skipped === 'رویداد ناشناخته');

    threw = false;
    try { mod.fireAsync('newOrder', { order_id: 'X', total_paid: 500000 }); }
    catch { threw = true; }
    add('‏fireAsync همگام throw نمی‌کند', !threw, 'برای مسیر داغ');

    // زمان‌سنجی: نباید مسیر اصلی را کند کند
    const t0 = Date.now();
    mod.fireAsync('newOrder', { order_id: 'Y', total_paid: 1 });
    const dt = Date.now() - t0;
    add('‏fireAsync بی‌درنگ برمی‌گردد', dt < 50, `${dt}ms`);

    restore();
  }

  // ─────────────── ۷) متن پیام
  console.log();
  console.log(h('  ۷) متن پیام'));

  const orderText = alerts.EVENTS.newOrder.text({
    order_id: 'YZD-TEST-1234', total_paid: 2500000,
    customer_name: 'مریم احمدی', city: 'یزد'
  });
  add('شماره سفارش در متن هست', orderText.includes('YZD-TEST-1234'));
  add('مبلغ با رقم فارسی است', /[۰-۹]/.test(orderText));
  add('نام فروشگاه در متن هست', orderText.includes('عطر یزد'));
  add('متن کوتاه است', orderText.length < 200, `${orderText.length} نویسه`);
  console.log(d('      ┌─'));
  orderText.split('\n').forEach(l => console.log(d('      │ ' + l)));
  console.log(d('      └─'));

  // ─────────────── ۸) اتصال به نقاط واقعی
  console.log();
  console.log(h('  ۸) اتصال به کد'));

  const ROOT = path.dirname(__dirname);
  const srv = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  const tck = fs.readFileSync(path.join(ROOT, 'src/routes/tickets.js'), 'utf8');
  const eng = fs.readFileSync(path.join(ROOT, 'src/routes/engagement.js'), 'utf8');

  add('server.js ماژول را می‌شناسد', /require\('\.\/alerts'\)/.test(srv));
  add('سفارش موفق خبر می‌دهد',
      (srv.match(/alerts\.fireAsync\('newOrder'/g) || []).length >= 2,
      'هر دو مسیر پرداخت');
  add('پرداخت ناموفق خبر می‌دهد', /alerts\.fireAsync\('paymentFailed'/.test(srv));
  add('تیکت تازه خبر می‌دهد', /fireAsync\('newTicket'/.test(tck));
  add('نظر تازه خبر می‌دهد', /fireAsync\('newReview'/.test(eng));

  add('همه‌جا بدون await صدا زده شده',
      !/await\s+alerts\.fire\(/.test(srv),
      'وگرنه سفارش منتظر پیامک می‌ماند');

  // ─────────────── ۹) وضعیت
  console.log();
  console.log(h('  ۹) گزارش وضعیت'));

  const st = alerts.status();
  add('وضعیت کامل برمی‌گردد',
      ['enabled', 'events', 'staff_with_mobile', 'reachable'].every(k => k in st));
  add('شمار گیرندگان درست است', st.reachable >= 1, `${st.reachable} گیرنده`);
  add('ساعت آرام گزارش می‌شود', !!st.quiet_hours, st.quiet_hours);

  // پاک‌سازی — وضعیت دقیقاً به حالت پیش از آزمون برمی‌گردد
  db.prepare("DELETE FROM staff WHERE username LIKE 'alerttest%'").run();
  db.prepare("UPDATE staff SET mobile=? WHERE username='owner'")
    .run(ownerMob ? ownerMob.mobile : null);

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  اطلاع‌رسانی داخلی درست کار می‌کند.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));

  console.log(d('  توجه: در حالت console پیامکی ارسال نمی‌شود.'));
  console.log(d('  تأیید نهایی نیازمند اعتبارنامه واقعی پیامیتوست.\n'));
  process.exit(failed === 0 ? 0 : 1);
})();
