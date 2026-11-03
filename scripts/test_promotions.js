#!/usr/bin/env node
/**
 * آزمون سامانه تخفیف پیشرفته — کوپن دامنه‌دار، جشنواره، نوار اعلان.
 *
 * چرا این آزمون حیاتی است: هر باگ در محاسبه تخفیف **ضرر مستقیم
 * مالی** است. کوپنی که باید فقط روی عطرهای چوبی کار کند ولی روی
 * کل سبد اعمال شود، یعنی چند برابر تخفیف ناخواسته.
 *
 * پوشش:
 *   • دامنه (خانواده، برند، نوع، جنسیت) درست محدود می‌کند
 *   • کوپن دامنه‌دار روی سبد نامرتبط رد می‌شود
 *   • جشنواره فقط روی محصول مشمول اعمال می‌شود
 *   • دو جشنواره روی یک کالا جمع نمی‌شوند (بهترین اعمال می‌شود)
 *   • ترتیب: جشنواره پیش از کوپن
 *   • مبلغ فاکتور با مبلغ پرداختی می‌خواند
 *   • کد اختصاصی مشتری و «فقط اولین خرید»
 *   • نوار اعلان و ایمنی لینک
 *
 * اجرا: node scripts/test_promotions.js
 */
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4451;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

const MARK = 'TSTPROMO';
let fixturePhone = null, fixtureToken = null;

function cleanup() {
  const db = new Database(DB);
  db.prepare(`DELETE FROM coupons WHERE code LIKE '${MARK}%'`).run();
  db.prepare(`DELETE FROM campaigns WHERE title LIKE '${MARK}%'`).run();
  db.prepare(`DELETE FROM notices WHERE text LIKE '${MARK}%'`).run();
  if (fixtureToken) db.prepare('DELETE FROM sessions WHERE token=?').run(fixtureToken);
  if (fixturePhone) {
    db.prepare('DELETE FROM otp_codes WHERE mobile=?').run(fixturePhone);
    db.prepare('DELETE FROM customer_phone_verifications WHERE mobile=?').run(fixturePhone);
  }
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
}

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore'
  });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

const api = (p, opt = {}, tok = null) =>
  fetch(BASE + p, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: 'Bearer ' + tok } : {}),
      ...(opt.headers || {})
    }
  }).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) }));

(async () => {
  console.log('\n  آزمون سامانه تخفیف پیشرفته\n');
  cleanup();

  const srv = await boot();
  let restoreStock = null;

  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    try { if (restoreStock) restoreStock(); } catch {}
    cleanup();
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('سامانه تخفیف درست کار می‌کند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    // ── دو محصول از دو خانواده متفاوت با موجودی موقت ──
    const db = new Database(DB);
    const A = db.prepare(`
      SELECT p.id, p.family_slug, p.brand_fa, v.sku, v.price_toman
      FROM products p JOIN variants v ON v.product_id = p.id
      WHERE p.family_slug = 'woody' AND v.type = 'EDP' AND v.volume_ml = 30 LIMIT 1`).get();
    const B = db.prepare(`
      SELECT p.id, p.family_slug, p.brand_fa, v.sku, v.price_toman
      FROM products p JOIN variants v ON v.product_id = p.id
      WHERE p.family_slug = 'floral' AND v.type = 'EDP' AND v.volume_ml = 30 LIMIT 1`).get();

    if (!A || !B) { add('دو محصول از دو خانواده', false); return finish(); }

    const prev = [A.sku, B.sku].map(sku =>
      ({ sku, stock: db.prepare('SELECT stock FROM variants WHERE sku=?').get(sku).stock }));
    const prevModes = [A.id,B.id].map(id => db.prepare('SELECT id,supply_mode FROM products WHERE id=?').get(id));
    db.transaction(() => {
      db.prepare('UPDATE variants SET stock=20 WHERE sku IN (?,?)').run(A.sku, B.sku);
      db.prepare("UPDATE products SET supply_mode='IN_STOCK' WHERE id IN (?,?)").run(A.id,B.id);
    })();
    db.close();

    restoreStock = () => {
      const d2 = new Database(DB);
      d2.transaction(() => {
        prev.forEach(p => d2.prepare('UPDATE variants SET stock=? WHERE sku=?').run(p.stock, p.sku));
        prevModes.forEach(p => d2.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(p.supply_mode,p.id));
      })();
      d2.close();
    };

    const both = [{ sku: A.sku, quantity: 1 }, { sku: B.sku, quantity: 1 }];
    const onlyA = [{ sku: A.sku, quantity: 1 }];
    const sum = A.price_toman + B.price_toman;

    // هیچ جشنواره فعالی نباید از اجرای قبلی مانده باشد
    {
      const camps = await api('/api/campaigns');
      add('محیط آزمون تمیز است (بدون جشنواره فعال)',
        (camps.body.campaigns || []).length === 0,
        `${(camps.body.campaigns || []).length} جشنواره فعال`);
    }

    const login = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: process.env.ADMIN_USERNAME || 'owner',
        password: process.env.ADMIN_PASSWORD || 'yazd1404'
      })
    });
    const TOK = login.body.token;
    add('ورود مدیر', !!TOK);
    if (!TOK) return finish();

    /* ═══ کوپن دامنه‌دار ═══
       این بخش پیش از ساخت جشنواره اجرا می‌شود تا تخفیف کوپن
       دقیقاً روی قیمت کامل سنجیده شود. اگر جشنواره‌ای فعال
       باشد، مبلغ پایه عوض می‌شود و مقایسه بی‌معنا می‌گردد —
       یک بار همین اشتباه در خود آزمون رخ داد. */
    {
      const mk = await api('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: MARK + 'WOOD', type: 'PERCENT', value: 10,
          scope_families: 'woody', per_user_once: false,
          description: 'چوبی'
        })
      }, TOK);
      add('کوپن دامنه‌دار ساخته شد', mk.status === 201, JSON.stringify(mk.body).slice(0, 50));

      const c = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: both, province: 'یزد', city: 'یزد',
                               coupon_code: MARK + 'WOOD' })
      });
      const expect = Math.floor(A.price_toman * 0.10);
      add('تخفیف فقط روی کالای مشمول', c.body.discount === expect,
        `${c.body.discount} (انتظار ${expect})`);
      add('کالای غیرمشمول تخفیف نگرفت',
        c.body.discount < Math.floor(sum * 0.10),
        `اگر روی کل سبد بود: ${Math.floor(sum * 0.10)}`);

      // سبدی که هیچ کالای مشمول ندارد
      const bad = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: [{ sku: B.sku, quantity: 1 }],
                               province: 'یزد', city: 'یزد',
                               coupon_code: MARK + 'WOOD' })
      });
      add('کوپن روی سبد نامرتبط رد می‌شود',
        bad.body.discount === 0 && !!bad.body.coupon_error,
        bad.body.coupon_error || 'بدون خطا!');
    }

    /* ═══ جشنواره ═══ */
    {
      const mk = await api('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({ title: MARK + ' چوبی', percent: 20, scope_families: 'woody' })
      }, TOK);
      add('جشنواره ساخته شد', mk.status === 201);

      const c = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: both, province: 'یزد', city: 'یزد' })
      });
      const expect = Math.floor(A.price_toman * 0.20);
      add('جشنواره بدون کد اعمال می‌شود', c.body.campaign_discount === expect,
        `${c.body.campaign_discount} (انتظار ${expect})`);
      add('فقط کالای مشمول تخفیف گرفت',
        (c.body.campaign_lines || []).length === 1
        && c.body.campaign_lines[0].sku === A.sku);
      add('جمع نهایی درست است',
        c.body.total_payable === sum - c.body.campaign_discount + c.body.shipping_fee,
        `${sum} − ${c.body.campaign_discount} + ${c.body.shipping_fee}`);

      // جشنواره دوم روی همان کالا — نباید جمع شود
      await api('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({ title: MARK + ' دوم', percent: 30, scope_families: 'woody' })
      }, TOK);
      const c2 = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: onlyA, province: 'یزد', city: 'یزد' })
      });
      const best = Math.floor(A.price_toman * 0.30);
      const summed = Math.floor(A.price_toman * 0.50);
      add('دو جشنواره جمع نمی‌شوند — بهترین اعمال می‌شود',
        c2.body.campaign_discount === best,
        `${c2.body.campaign_discount} (بهترین ${best}، جمع ${summed})`);

      // ترتیب: کوپن روی مبلغ پس از جشنواره
      const c3 = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: onlyA, province: 'یزد', city: 'یزد',
                               coupon_code: MARK + 'WOOD' })
      });
      const afterCamp = A.price_toman - best;
      const couponOnAfter = Math.floor(afterCamp * 0.10);
      add('کوپن روی مبلغ پس از جشنواره حساب می‌شود',
        c3.body.discount === couponOnAfter,
        `${c3.body.discount} (انتظار ${couponOnAfter})`);
      add('مجموع تخفیف از خود کالا بیشتر نیست',
        c3.body.campaign_discount + c3.body.discount < A.price_toman);
    }

    /* ═══ سفارش واقعی — مبلغ باید با فاکتور بخواند ═══ */
    {
      const mob = '0919' + String(5000000 + Math.floor(Math.random() * 900000)).slice(-7);
      const o = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: 'آزمون تخفیف', first_name: 'آزمون', last_name: 'تخفیف',
          mobile: mob, province: 'یزد', city: 'یزد',
          address: 'نشانی آزمون سامانه تخفیف پیشرفته',
          postal_code: '8916100000', items: onlyA
        })
      });
      add('سفارش با جشنواره ثبت شد', o.status === 201, o.body.order_id || JSON.stringify(o.body).slice(0, 60));

      if (o.body.order_id) {
        const db2 = new Database(DB, { readonly: true });
        const row = db2.prepare(
          'SELECT subtotal, discount_amount, shipping_fee, total_paid FROM orders WHERE order_id=?'
        ).get(o.body.order_id);
        db2.close();
        add('تخفیف جشنواره در سفارش ثبت شد', row.discount_amount > 0,
          String(row.discount_amount));
        add('جمع فاکتور با مبلغ پرداختی می‌خواند',
          row.subtotal - row.discount_amount + row.shipping_fee === row.total_paid,
          `${row.subtotal} − ${row.discount_amount} + ${row.shipping_fee} = ${row.total_paid}`);

        // پاک‌سازی
        const d3 = new Database(DB);
        d3.prepare('DELETE FROM order_items WHERE order_id=?').run(o.body.order_id);
        d3.prepare('DELETE FROM order_status_log WHERE order_id=?').run(o.body.order_id);
        d3.prepare('DELETE FROM orders WHERE order_id=?').run(o.body.order_id);
        d3.close();
      }
    }

    /* ═══ کد اختصاصی مشتری ═══ */
    {
      const fixtureDb = new Database(DB,{readonly:true});
      const exists=fixtureDb.prepare(`SELECT
        EXISTS(SELECT 1 FROM customers WHERE mobile=@m) OR
        EXISTS(SELECT 1 FROM customer_phone_verifications WHERE mobile=@m) OR
        EXISTS(SELECT 1 FROM otp_codes WHERE mobile=@m) OR
        EXISTS(SELECT 1 FROM orders WHERE mobile=@m) OR
        EXISTS(SELECT 1 FROM sessions WHERE subject=@m) AS occupied`);
      for(let i=0;i<20&&!fixturePhone;i++){
        const candidate='0919'+String(crypto.randomInt(0,10000000)).padStart(7,'0');
        if(!exists.get({m:candidate}).occupied)fixturePhone=candidate;
      }
      fixtureDb.close();
      if(!fixturePhone)throw Error('Could not allocate isolated customer fixture');
      await api('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: MARK + 'MINE', type: 'FIXED', value: 50000,
          assigned_mobile: fixturePhone, per_user_once: false
        })
      }, TOK);

      const other = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: onlyA, province: 'یزد', city: 'یزد',
                               coupon_code: MARK + 'MINE', mobile: '09129998888' })
      });
      add('کد اختصاصی برای دیگری کار نمی‌کند',
        other.body.discount === 0 && !!other.body.coupon_error,
        other.body.coupon_error);

      const forged = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: onlyA, province: 'یزد', city: 'یزد',
                               coupon_code: MARK + 'MINE', mobile: fixturePhone })
      });
      add('شماره بدون تأیید برای کد اختصاصی کافی نیست', forged.body.discount === 0 && !!forged.body.coupon_error);
      // This test runs against an isolated smoke fixture; use the genuine OTP
      // flow, not an invented trusted session or the customer's real data.
      await api('/api/auth/request-code',{method:'POST',body:JSON.stringify({mobile:fixturePhone})});
      const otpDb = new Database(DB,{readonly:true});
      const otpCode = otpDb.prepare('SELECT code FROM otp_codes WHERE mobile=?').get(fixturePhone)?.code;
      otpDb.close();
      const verified = await api('/api/auth/verify-code',{method:'POST',body:JSON.stringify({mobile:fixturePhone,code:otpCode})});
      fixtureToken = verified.body.token || null;
      const mine = await api('/api/cart/calculate', {
        method: 'POST', headers: {'X-Customer-Token':fixtureToken || ''},
        body: JSON.stringify({ items: onlyA, province: 'یزد', city: 'یزد',
                               coupon_code: MARK + 'MINE', mobile: fixturePhone })
      });
      add('کد اختصاصی برای صاحب شماره تأییدشده کار می‌کند', mine.body.discount === 50000,
        String(mine.body.discount));

      const anon = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: onlyA, province: 'یزد', city: 'یزد',
                               coupon_code: MARK + 'MINE' })
      });
      add('کد اختصاصی بدون شناسایی رد می‌شود', anon.body.discount === 0);
    }

    /* ═══ اعتبارسنجی ورودی ═══ */
    {
      const badPct = await api('/api/admin/campaigns', {
        method: 'POST', body: JSON.stringify({ title: MARK + 'X', percent: 95 })
      }, TOK);
      add('درصد بالای ۹۰ رد می‌شود', badPct.status === 400, String(badPct.status));

      const badDate = await api('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({ code: MARK + 'BAD', type: 'PERCENT', value: 10,
                               expires_at: '2027-06-31' })
      }, TOK);
      add('تاریخ نامعتبر (۳۱ ژوئن) رد می‌شود', badDate.status === 400,
        JSON.stringify(badDate.body).slice(0, 50));

      const badOrder = await api('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({ code: MARK + 'REV', type: 'PERCENT', value: 10,
                               starts_at: '2027-05-10', expires_at: '2027-05-01' })
      }, TOK);
      add('شروع بعد از پایان رد می‌شود', badOrder.status === 400);

      const badMob = await api('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({ code: MARK + 'MOB', type: 'FIXED', value: 1000,
                               assigned_mobile: '12345' })
      }, TOK);
      add('موبایل نامعتبر رد می‌شود', badMob.status === 400);
    }

    /* ═══ نوار اعلان ═══ */
    {
      const mk = await api('/api/admin/notices', {
        method: 'POST',
        body: JSON.stringify({ text: MARK + ' اعلان آزمایشی', link: '/samples',
                               link_label: 'دیدن', tone: 'gold' })
      }, TOK);
      add('اعلان منتشر شد', mk.status === 201);

      const pub = await api('/api/notice');
      add('اعلان عمومی برگردانده می‌شود',
        pub.body.notice && pub.body.notice.text.includes(MARK));

      const badLink = await api('/api/admin/notices', {
        method: 'POST',
        body: JSON.stringify({ text: MARK + ' بد', link: 'https://evil.example' })
      }, TOK);
      add('لینک بیرونی در اعلان رد می‌شود', badLink.status === 400,
        'جلوگیری از هدایت بازدیدکننده به سایت دیگر');
    }

    /* ═══ سازگاری با گذشته ═══ */
    {
      const old = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: both, province: 'یزد', city: 'یزد',
                               coupon_code: 'WELCOME10' })
      });
      // WELCOME10 دامنه ندارد → باید روی کل سبد پس از جشنواره کار کند
      add('کوپن بدون دامنه مثل قبل کار می‌کند',
        old.body.discount > 0 || !!old.body.coupon_error,
        old.body.coupon_error || `تخفیف ${old.body.discount}`);
    }

    /* ═══ دسترسی ═══ */
    {
      const noAuth = await api('/api/admin/campaigns', {
        method: 'POST', body: JSON.stringify({ title: 'x', percent: 10 })
      });
      add('ساخت جشنواره بدون ورود ممکن نیست',
        noAuth.status === 401 || noAuth.status === 403, String(noAuth.status));
    }

  } catch (e) {
    add('اجرای آزمون بدون خطا', false, e.message);
  }

  finish();
})();
