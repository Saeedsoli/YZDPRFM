#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4457;
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

const MARK = 'TSTDISP';

function cleanup() {
  const db = new Database(DB);
  db.prepare(`DELETE FROM campaigns WHERE title LIKE '${MARK}%'`).run();

  db.prepare(`DELETE FROM coupon_usage WHERE code LIKE '${MARK}%'`).run();
  db.prepare(`DELETE FROM coupons   WHERE code  LIKE '${MARK}%'`).run();
  db.prepare(`DELETE FROM order_items WHERE order_id IN
              (SELECT order_id FROM orders WHERE customer_name LIKE '${MARK}%')`).run();
  db.prepare(`DELETE FROM order_status_log WHERE order_id IN
              (SELECT order_id FROM orders WHERE customer_name LIKE '${MARK}%')`).run();
  db.prepare(`DELETE FROM orders WHERE customer_name LIKE '${MARK}%'`).run();
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
}

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
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
  console.log('\n  آزمون نمایش جشنواره — از دیتابیس تا چشم مشتری\n');
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
      : `\n  ${g('جشنواره همه‌جا یکسان دیده می‌شود.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    const db = new Database(DB);

    const P = db.prepare(`
      SELECT p.id, p.slug, p.family_slug, p.brand_fa, p.gender, p.supply_mode
      FROM products p
      WHERE p.family_slug = 'woody'
        AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.type='SAMPLE')
        AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.type='EDP')
      LIMIT 1`).get();

    const Q = db.prepare(`
      SELECT p.id, p.slug, p.family_slug FROM products p
      WHERE p.family_slug = 'floral' LIMIT 1`).get();

    if (!P || !Q) { add('محصول آزمون یافت شد', false); db.close(); return finish(); }

    const vEdp = db.prepare(
      `SELECT sku, price_toman FROM variants
       WHERE product_id=? AND type='EDP' ORDER BY volume_ml LIMIT 1`).get(P.id);
    const vSmp = db.prepare(
      `SELECT sku, price_toman FROM variants
       WHERE product_id=? AND type='SAMPLE' LIMIT 1`).get(P.id);

    const prev = [vEdp.sku, vSmp.sku].map(sku =>
      ({ sku, stock: db.prepare('SELECT stock FROM variants WHERE sku=?').get(sku).stock }));
    db.prepare('UPDATE variants SET stock=20 WHERE sku IN (?,?)').run(vEdp.sku, vSmp.sku);
    db.prepare("UPDATE products SET supply_mode='IN_STOCK' WHERE id=?").run(P.id);
    db.close();
    restoreStock = () => {
      const d2 = new Database(DB);
      prev.forEach(x => d2.prepare('UPDATE variants SET stock=? WHERE sku=?').run(x.stock, x.sku));
      d2.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(P.supply_mode, P.id);
      d2.close();
    };

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

    console.log('\n  ── پیش از جشنواره: هیچ تخفیفی نباید دیده شود ──');

    {
      const before = await api(`/api/products?family=woody&limit=3`);
      const p0 = (before.body.products || [])[0];
      add('میدان campaign_percent در پاسخ هست (حتی وقتی صفر است)',
        p0 && p0.campaign_percent === 0,
        `مقدار: ${p0 && p0.campaign_percent}`);

      const pd = await api(`/api/products/${P.slug}`);
      const anyOld = (pd.body.variants || []).some(v => v.old_price);
      add('بدون جشنواره، هیچ واریانتی قیمت خط‌خورده ندارد', !anyOld);
      add('بدون جشنواره، final_price برابر قیمت اصلی است',
        (pd.body.variants || []).every(v => v.final_price === v.price_toman));
    }

    console.log('\n  ── جشنواره خانواده‌محور ۲۵٪ ──');

    const mk = await api('/api/admin/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        title: `${MARK} چوبی‌ها`, percent: 25,
        scope_families: 'woody', active: 1
      })
    }, TOK);
    add('ساخت جشنواره', mk.status === 200 || mk.status === 201, `status ${mk.status}`);

    {
      const list = await api(`/api/products?family=woody&limit=3`);
      const p0 = (list.body.products || [])[0];
      add('کارت محصول درصد جشنواره را می‌گیرد', p0 && p0.campaign_percent === 25,
        `${p0 && p0.campaign_percent}٪`);

      const other = await api(`/api/products?family=${Q.family_slug}&limit=3`);
      const q0 = (other.body.products || [])[0];
      add('محصول خارج از دامنه تخفیف نمی‌گیرد', q0 && q0.campaign_percent === 0,
        `${q0 && q0.campaign_percent}٪`);
    }

    {
      const pd = await api(`/api/products/${P.slug}`);
      const v = (pd.body.variants || []).find(x => x.sku === vEdp.sku);
      const expect = vEdp.price_toman - Math.floor(vEdp.price_toman * 25 / 100);
      add('صفحه محصول: final_price درست است', v && v.final_price === expect,
        `${v && v.final_price} (انتظار ${expect})`);
      add('صفحه محصول: قیمت پیش از تخفیف نگه داشته می‌شود',
        v && v.old_price === vEdp.price_toman);
      add('min_price دست‌نخورده می‌ماند (مرتب‌سازی نشکند)',
        pd.body.min_price === Math.min(...pd.body.variants.map(x => x.price_toman)));
      add('min_price_final کمتر از min_price است',
        pd.body.min_price_final < pd.body.min_price,
        `${pd.body.min_price_final} < ${pd.body.min_price}`);
    }

    {

      const list = await api(`/api/products?family=woody&limit=60`);
      const card = (list.body.products || []).find(x => x.slug === P.slug);
      const pd = await api(`/api/products/${P.slug}`);
      const cardPrice = card
        ? card.min_price - Math.floor(card.min_price * card.campaign_percent / 100) : -1;
      add('قیمت کارت فهرست با صفحه محصول یکی است',
        cardPrice === pd.body.min_price_final,
        `کارت ${cardPrice} · صفحه ${pd.body.min_price_final}`);
    }

    console.log('\n  ── سازگاری سبد و تسویه ──');

    const cartItems = [{ sku: vEdp.sku, quantity: 2 }];
    let cartCalc, coupCalc;
    {
      cartCalc = await api('/api/cart/calculate', {
        method: 'POST', body: JSON.stringify({ items: cartItems })
      });
      const lineTotal = vEdp.price_toman * 2;
      const expect = Math.floor(lineTotal * 25 / 100);
      add('سبد: تخفیف جشنواره محاسبه می‌شود',
        cartCalc.body.campaign_discount === expect,
        `${cartCalc.body.campaign_discount} (انتظار ${expect})`);
      add('سبد: عنوان جشنواره برای نمایش می‌آید',
        (cartCalc.body.campaign_lines || [])[0]?.title === `${MARK} چوبی‌ها`);
    }

    {

      await api('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: `${MARK}10`, type: 'PERCENT', value: 10,
          active: 1, description: 'آزمون سازگاری'
        })
      }, TOK);

      coupCalc = await api('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({ code: `${MARK}10`, items: cartItems })
      });
      const full = await api('/api/cart/calculate', {
        method: 'POST',
        body: JSON.stringify({ items: cartItems, coupon_code: `${MARK}10` })
      });

      add('کوپن: هر دو مسیر یک مبلغ تخفیف می‌دهند',
        coupCalc.body.discount === full.body.discount,
        `validate ${coupCalc.body.discount} · calculate ${full.body.discount}`);
      add('کوپن: جشنواره در پاسخ validate هم می‌آید',
        coupCalc.body.campaign_discount === full.body.campaign_discount);

      const lineTotal = vEdp.price_toman * 2;
      const afterCamp = lineTotal - Math.floor(lineTotal * 25 / 100);
      add('کوپن روی مبلغ پس از جشنواره حساب می‌شود',
        full.body.discount === Math.floor(afterCamp * 10 / 100),
        `${full.body.discount} (انتظار ${Math.floor(afterCamp * 10 / 100)})`);
      add('جمع نهایی = کالا − جشنواره − کوپن + ارسال',
        full.body.total_payable ===
          full.body.subtotal - full.body.campaign_discount
          - full.body.discount + full.body.shipping_fee);
    }

    console.log('\n  ── جشنواره نوع‌محور (فقط سمپل) ──');

    {

      const camps = await api('/api/admin/campaigns', {}, TOK);
      const famC = (camps.body.campaigns || []).find(c => c.title === `${MARK} چوبی‌ها`);
      await api(`/api/admin/campaigns/${famC.id}`, {
        method: 'PUT', body: JSON.stringify({ ...famC, active: 0 })
      }, TOK);

      await api('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          title: `${MARK} سمپل‌ها`, percent: 30,
          scope_types: 'SAMPLE', active: 1
        })
      }, TOK);

      const list = await api(`/api/products?family=woody&limit=3`);
      const p0 = (list.body.products || [])[0];

      add('جشنواره نوع‌محور روی کارت فهرست نمی‌آید',
        p0 && p0.campaign_percent === 0, `${p0 && p0.campaign_percent}٪`);

      const pd = await api(`/api/products/${P.slug}`);
      const smp = (pd.body.variants || []).find(v => v.sku === vSmp.sku);
      const edp = (pd.body.variants || []).find(v => v.sku === vEdp.sku);
      add('صفحه محصول: سمپل ۳۰٪ می‌خورد', smp && smp.campaign_percent === 30,
        `${smp && smp.campaign_percent}٪`);
      add('صفحه محصول: ادوپرفیوم تخفیف نمی‌خورد',
        edp && edp.campaign_percent === 0, `${edp && edp.campaign_percent}٪`);
    }

    console.log('\n  ── سقف تخفیف، درصد نمایشی را واقعی می‌کند ──');

    {
      const camps = await api('/api/admin/campaigns', {}, TOK);
      for (const c of camps.body.campaigns || []) {
        if (c.title.startsWith(MARK)) {
          await api(`/api/admin/campaigns/${c.id}`, {
            method: 'PUT', body: JSON.stringify({ ...c, active: 0 })
          }, TOK);
        }
      }

      const cap = 20000;
      await api('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          title: `${MARK} سقف‌دار`, percent: 50, max_discount: cap,
          scope_products: String(P.id), active: 1
        })
      }, TOK);

      const pd = await api(`/api/products/${P.slug}`);
      const v = (pd.body.variants || []).find(x => x.sku === vEdp.sku);

      const effective = Math.floor(cap / vEdp.price_toman * 100);
      add('درصد نمایشی واریانت، درصد مؤثر است نه درصد خام',
        v && v.campaign_percent === effective && v.campaign_percent < 50,
        `${v && v.campaign_percent}٪ (خام ۵۰٪، مؤثر ${effective}٪)`);
      add('تخفیف نمایشی از سقف بیشتر نمی‌شود',
        v && (v.price_toman - v.final_price) <= cap + 1,
        `${v && (v.price_toman - v.final_price)} ≤ ${cap}`);
    }

    console.log('\n  ── ثبت سفارش: تفکیک در دیتابیس و فاکتور ──');

    {
      const camps = await api('/api/admin/campaigns', {}, TOK);
      for (const c of camps.body.campaigns || []) {
        if (c.title.startsWith(MARK)) {
          await api(`/api/admin/campaigns/${c.id}`, {
            method: 'PUT', body: JSON.stringify({ ...c, active: 0 })
          }, TOK);
        }
      }
      await api('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          title: `${MARK} پاییزه`, percent: 20,
          scope_families: 'woody', active: 1
        })
      }, TOK);

      const ord = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: `${MARK} خریدار`, mobile: '09121110000',
          province: 'یزد', city: 'یزد', address: 'نشانی آزمایشی طولانی برای عبور از اعتبارسنجی',
          items: cartItems, coupon_code: `${MARK}10`
        })
      });
      add('ثبت سفارش با جشنواره + کوپن', ord.status === 200 || ord.status === 201,
        `status ${ord.status} ${ord.body.error || ''}`);

      const oid = ord.body.order_id || ord.body.order?.order_id;
      if (oid) {
        const db2 = new Database(DB);
        const row = db2.prepare('SELECT * FROM orders WHERE order_id=?').get(oid);
        db2.close();

        const lineTotal = vEdp.price_toman * 2;
        const campExpect = Math.floor(lineTotal * 20 / 100);
        add('سهم جشنواره جدا در دیتابیس ذخیره شد',
          row.campaign_discount === campExpect,
          `${row.campaign_discount} (انتظار ${campExpect})`);
        add('عنوان جشنواره برای فاکتور ذخیره شد',
          row.campaign_note === `${MARK} پاییزه`, row.campaign_note);
        add('discount_amount همچنان مجموع هر دو است',
          row.discount_amount > row.campaign_discount,
          `${row.discount_amount} > ${row.campaign_discount}`);
        add('مبلغ پرداختی با تفکیک می‌خواند',
          row.total_paid === row.subtotal - row.discount_amount + row.shipping_fee,
          `${row.subtotal} − ${row.discount_amount} + ${row.shipping_fee} = ${row.total_paid}`);

        const inv = await api(`/api/orders/${oid}/invoice`, {}, TOK);
        const t = inv.body.totals || {};
        add('فاکتور: سطر جشنواره جدا دارد', t.campaign === campExpect,
          `${t.campaign}`);
        add('فاکتور: سطر کد تخفیف جدا دارد',
          t.coupon === row.discount_amount - campExpect, `${t.coupon}`);
        add('فاکتور: جمع دو سطر برابر کل تخفیف است',
          t.campaign + t.coupon === t.discount);
        add('فاکتور: جمع نهایی با پرداختی یکی است',
          t.subtotal - t.discount + t.shipping === t.grand_total,
          `${t.grand_total}`);
      }
    }

    console.log('\n  ── جشنواره منقضی نباید دیده شود ──');

    {
      const camps = await api('/api/admin/campaigns', {}, TOK);
      for (const c of camps.body.campaigns || []) {
        if (c.title.startsWith(MARK)) {
          await api(`/api/admin/campaigns/${c.id}`, {
            method: 'PUT', body: JSON.stringify({ ...c, active: 0 })
          }, TOK);
        }
      }
      await api('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          title: `${MARK} تمام‌شده`, percent: 40,
          scope_families: 'woody',
          starts_at: '2020-01-01', ends_at: '2020-12-31', active: 1
        })
      }, TOK);

      const list = await api(`/api/products?family=woody&limit=3`);
      const p0 = (list.body.products || [])[0];
      add('جشنواره تاریخ‌گذشته روی کارت نمی‌آید',
        p0 && p0.campaign_percent === 0, `${p0 && p0.campaign_percent}٪`);

      const pd = await api(`/api/products/${P.slug}`);
      add('جشنواره تاریخ‌گذشته روی صفحه محصول نمی‌آید',
        (pd.body.variants || []).every(v => !v.campaign_percent));

      const pub = await api('/api/campaigns');
      add('جشنواره تاریخ‌گذشته در فهرست عمومی نیست',
        !(pub.body.campaigns || []).some(c => c.title === `${MARK} تمام‌شده`));

      const calc = await api('/api/cart/calculate', {
        method: 'POST', body: JSON.stringify({ items: cartItems })
      });
      add('جشنواره تاریخ‌گذشته در سبد اثری ندارد',
        calc.body.campaign_discount === 0, `${calc.body.campaign_discount}`);
    }

    console.log('\n  ── ویترین صفحه اصلی ──');

    {
      const camps = await api('/api/admin/campaigns', {}, TOK);
      for (const c of camps.body.campaigns || []) {
        if (c.title.startsWith(MARK)) {
          await api(`/api/admin/campaigns/${c.id}`, {
            method: 'PUT', body: JSON.stringify({ ...c, active: 0 })
          }, TOK);
        }
      }

      await api('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({ title: `${MARK} همگانی`, percent: 15, active: 1 })
      }, TOK);

      const sc = await api('/api/showcase');
      const all = [...(sc.body.bestsellers || []), ...(sc.body.most_wanted || []),
        ...(sc.body.trending || [])];
      add('ویترین محصول دارد', all.length > 0, `${all.length} کالا`);
      add('ویترین درصد جشنواره را در لحظه می‌گیرد',
        all.length > 0 && all.every(x => x.campaign_percent === 15),
        `${all.filter(x => x.campaign_percent === 15).length}/${all.length}`);
    }

    console.log('\n  ── تخفیف نباید پرداختی را بالا ببرد ──');

    {

      const camps0 = await api('/api/admin/campaigns', {}, TOK);
      for (const c of camps0.body.campaigns || []) {
        if (c.title.startsWith(MARK)) {
          await api(`/api/admin/campaigns/${c.id}`, {
            method: 'PUT', body: JSON.stringify({ ...c, active: 0 })
          }, TOK);
        }
      }

      const db3 = new Database(DB);

      const FREE_SHIP = 2000000;
      const edge = db3.prepare(`
        SELECT v.sku, v.price_toman, p.id AS product_id, p.supply_mode
        FROM variants v JOIN products p ON p.id=v.product_id
        WHERE v.type='EDP' AND v.volume_ml IN (10,30,50,100)
          AND v.price_toman > ? AND v.price_toman < ? LIMIT 1`)
        .get(FREE_SHIP, Math.floor(FREE_SHIP / 0.9));
      let edgePrev = null;
      if (edge) {
        edgePrev = db3.prepare('SELECT stock FROM variants WHERE sku=?').get(edge.sku).stock;
        db3.prepare('UPDATE variants SET stock=5 WHERE sku=?').run(edge.sku);
        db3.prepare("UPDATE products SET supply_mode='IN_STOCK' WHERE id=?").run(edge.product_id);
      }
      db3.close();

      if (!edge) {
        add('واریانت مرزی برای آزمون یافت شد', false);
      } else {
        try {
        const one = [{ sku: edge.sku, quantity: 1 }];

        const noCamp = await api('/api/cart/calculate', {
          method: 'POST', body: JSON.stringify({ items: one })
        });
        add('بدون جشنواره: سبد بالای آستانه، ارسال رایگان',
          noCamp.body.shipping_fee === 0, `${noCamp.body.subtotal}`);

        await api('/api/admin/campaigns', {
          method: 'POST',
          body: JSON.stringify({ title: `${MARK} مرزی`, percent: 10, active: 1 })
        }, TOK);

        const withCamp = await api('/api/cart/calculate', {
          method: 'POST', body: JSON.stringify({ items: one })
        });
        add('جشنواره ارسال رایگان را پس نمی‌گیرد',
          withCamp.body.shipping_fee === 0,
          `کرایه ${withCamp.body.shipping_fee}`);
        add('پرداختی با تخفیف کمتر از پرداختی بدون تخفیف است',
          withCamp.body.total_payable < noCamp.body.total_payable,
          `${withCamp.body.total_payable} < ${noCamp.body.total_payable}`);
        add('تخفیف دقیقاً به اندازه درصد جشنواره است',
          noCamp.body.total_payable - withCamp.body.total_payable
            === withCamp.body.campaign_discount,
          `${noCamp.body.total_payable - withCamp.body.total_payable}`);

        const ord2 = await api('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: `${MARK} مرزی`, mobile: '09121110002',
            province: 'تهران', city: 'تهران',
            address: 'نشانی آزمایشی به‌اندازه کافی طولانی',
            items: one
          })
        });
        const oid2 = ord2.body.order_id || ord2.body.order?.order_id;
        if (oid2) {
          const db4 = new Database(DB);
          const row2 = db4.prepare('SELECT * FROM orders WHERE order_id=?').get(oid2);
          db4.close();
          add('ثبت سفارش هم ارسال را رایگان نگه می‌دارد',
            row2.shipping_fee === 0, `${row2.shipping_fee}`);
          add('مبلغ ثبت‌شده کمتر از قیمت بدون تخفیف است',
            row2.total_paid < noCamp.body.total_payable,
            `${row2.total_paid} < ${noCamp.body.total_payable}`);
        } else {
          add('ثبت سفارش مرزی', false, ord2.body.error);
        }

        } finally {
          if (edgePrev !== null) {
            const db5 = new Database(DB);
            try {
              db5.prepare('UPDATE variants SET stock=? WHERE sku=?').run(edgePrev, edge.sku);
              db5.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(edge.supply_mode, edge.product_id);
            } finally { db5.close(); }
          }
        }
      }
    }

    console.log('\n  ── دارایی‌های رابط کاربری ──');

    {
      const fs = require('fs');
      const appjs = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
      const css = fs.readFileSync(path.join(ROOT, 'public/assets/theme.css'), 'utf8');
      const prod = fs.readFileSync(path.join(ROOT, 'public/product.html'), 'utf8');
      const cart = fs.readFileSync(path.join(ROOT, 'public/cart.html'), 'utf8');
      const chk = fs.readFileSync(path.join(ROOT, 'public/checkout.html'), 'utf8');

      add('productCard قیمت خط‌خورده می‌سازد', /price-old/.test(appjs));
      add('نشان درصد روی کارت هست', /card-off/.test(appjs));
      add('درصد با bdi نوشته می‌شود (وارونه نشدن عدد در RTL)',
        /<bdi>\$\{esc\(toFa\(pct\)\)\}٪<\/bdi>/.test(appjs));
      add('استایل قیمت قدیمی و نشان تخفیف در CSS هست',
        /\.price-old/.test(css) && /\.card-off/.test(css));
      add('نشان تخفیف روی موبایل پنهان نمی‌شود',
        !/\.card-peek,\s*\.card-badge,\s*\.card-off/.test(css));
      add('صفحه محصول جعبه جشنواره دارد', /campFlag/.test(prod) && /camp-flag/.test(prod));
      add('صفحه محصول از final_price استفاده می‌کند', /final_price/.test(prod));
      add('سبد سطر جشنواره دارد', /camp-row/.test(cart) && /campOff/.test(cart));
      add('سبد از منبع واحد calculate می‌خواند', /calcTotals/.test(cart));
      add('تسویه سطر جشنواره دارد', /campaign_discount/.test(chk));

      add('آستانه ارسال رایگان در سبد روی جمع کالاها سنجیده می‌شود',
        /const freeShip = subtotal >= FREE_SHIP_THRESHOLD/.test(cart));
    }

  } catch (e) {
    add('اجرای آزمون بدون خطای غیرمنتظره', false, e.message);
  }

  finish();
})();
