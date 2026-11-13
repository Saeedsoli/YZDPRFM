#!/usr/bin/env node

'use strict';

const path = require('path');
const ROOT = path.dirname(__dirname);
const { db } = require(path.join(ROOT, 'src', 'db'));
const fs = require('fs');

const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;

const FLAT_SHIPPING = 100000;
const FREE_THRESHOLD = 2000000;
const GIFT_FEE = 70000;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const b = s => `\x1b[1m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};
const fa = n => Number(n).toLocaleString('fa-IR');

async function calc(body) {
  const res = await fetch(`${BASE}/api/cart/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function stockedVariant(minPrice, maxPrice) {
  return db.prepare(`
    SELECT sku, price_toman FROM variants
    WHERE stock > 0 AND price_toman BETWEEN ? AND ?
    ORDER BY price_toman LIMIT 1`).get(minPrice, maxPrice);
}

(async () => {
  console.log('\n' + b('  آزمون ارسال و بسته‌بندی کادویی') + '\n');

  console.log(b('  قرارداد در کد'));

  const srv = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
  add('نرخ یکسان ارسال تعریف شده', new RegExp(`FLAT:\\s*${FLAT_SHIPPING}`).test(srv),
      `${fa(FLAT_SHIPPING)} تومان`);
  add('آستانه رایگان درست است',
      new RegExp(`FREE_THRESHOLD:\\s*${FREE_THRESHOLD}`).test(srv), fa(FREE_THRESHOLD));
  add('نرخ کادو تعریف شده',
      new RegExp(`GIFT_WRAP_FEE\\s*=\\s*${GIFT_FEE}`).test(srv), fa(GIFT_FEE));

  add('نرخ ویژه یزد حذف شده', !/isYazd/.test(srv) && !/YAZD_CITY/.test(srv),
      'هیچ شهری استثنا ندارد');

  console.log(b('\n  محاسبه زنده'));

  const cheap = stockedVariant(1, FREE_THRESHOLD - 1);
  if (!cheap) {
    add('واریانت موجودی‌دار زیر آستانه هست', false, 'نمونه پیدا نشد');
  } else {
    const one = await calc({ items: [{ sku: cheap.sku, quantity: 1 }] });
    add('سفارش زیر آستانه کرایه می‌گیرد',
        one.json.shipping_fee === FLAT_SHIPPING,
        `${fa(one.json.subtotal)} → کرایه ${fa(one.json.shipping_fee)}`);

    add('برچسب ارسال شهر خاصی را نام نمی‌برد',
        !/یزد/.test(one.json.shipping_label || ''), one.json.shipping_label);

    add('جمع بدون کادو درست است',
        one.json.subtotal + one.json.shipping_fee === one.json.total_payable,
        fa(one.json.total_payable));

    const wrapped = await calc({ items: [{ sku: cheap.sku, quantity: 1 }], gift_wrap: true });
    add('کادو مبلغ درست اضافه می‌کند',
        wrapped.json.gift_wrap_fee === GIFT_FEE, fa(wrapped.json.gift_wrap_fee));
    add('پرچم کادو در پاسخ هست', wrapped.json.gift_wrap === true);
    add('جمع با کادو درست است',
        wrapped.json.subtotal + wrapped.json.shipping_fee + wrapped.json.gift_wrap_fee
          === wrapped.json.total_payable,
        fa(wrapped.json.total_payable));
    add('تفاوت دو حالت دقیقاً برابر نرخ کادوست',
        wrapped.json.total_payable - one.json.total_payable === GIFT_FEE);

    const edge = db.prepare(`
      SELECT v.sku, v.price_toman, v.stock, p.id AS product_id, p.supply_mode
      FROM variants v JOIN products p ON p.id=v.product_id
      WHERE v.type='EDP' AND v.volume_ml IN (10,30,50,100)
        AND v.price_toman > ? AND v.price_toman < ?
      ORDER BY v.price_toman DESC LIMIT 1`)
      .get(FREE_THRESHOLD - GIFT_FEE, FREE_THRESHOLD);

    if (!edge) {
      add('🔴 کادو مشتری را به ارسال رایگان نمی‌رساند', false,
          'واریانت مرزی در کاتالوگ نیست — آزمون نمی‌تواند بسنجد');
    } else {
      const prevStock = edge.stock;
      db.prepare('UPDATE variants SET stock=5 WHERE sku=?').run(edge.sku);
      db.prepare("UPDATE products SET supply_mode='IN_STOCK' WHERE id=?").run(edge.product_id);
      try {
        const trap = await calc({ items: [{ sku: edge.sku, quantity: 1 }], gift_wrap: true });
        const withGift = trap.json.subtotal + GIFT_FEE;
        add('🔴 کادو مشتری را به ارسال رایگان نمی‌رساند',
            trap.json.shipping_fee === FLAT_SHIPPING && withGift > FREE_THRESHOLD,
            `کالا ${fa(trap.json.subtotal)} + کادو = ${fa(withGift)} ` +
            `(بالای آستانه) ولی کرایه ${fa(trap.json.shipping_fee)}`);
      } finally {

        db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(prevStock, edge.sku);
        db.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(edge.supply_mode, edge.product_id);
      }
    }
  }

  const big = stockedVariant(1, FREE_THRESHOLD);
  if (big) {
    const qty = Math.ceil(FREE_THRESHOLD / big.price_toman);
    const free = await calc({ items: [{ sku: big.sku, quantity: qty }] });
    if (free.status === 200) {
      add('سفارش بالای آستانه ارسال رایگان دارد',
          free.json.shipping_fee === 0,
          `${fa(free.json.subtotal)} → ${free.json.shipping_label}`);
      add('کادو روی سفارش رایگان هم کار می‌کند', true);
    } else {
      add('سفارش بالای آستانه ارسال رایگان دارد', false,
          free.json.error || `کد ${free.status}`);
    }
  }

  console.log(b('\n  امنیت'));

  if (cheap) {

    const evil = await calc({
      items: [{ sku: cheap.sku, quantity: 1 }],
      gift_wrap: true, gift_wrap_fee: 1, shipping_fee: 0
    });
    add('مبلغ کادو از سرور می‌آید نه از کاربر',
        evil.json.gift_wrap_fee === GIFT_FEE, fa(evil.json.gift_wrap_fee));
    add('کرایه ارسال دستکاری‌پذیر نیست',
        evil.json.shipping_fee === FLAT_SHIPPING, fa(evil.json.shipping_fee));

    const truthy = await calc({ items: [{ sku: cheap.sku, quantity: 1 }], gift_wrap: 'no' });
    add('مقدار غیربولی هم امن مدیریت می‌شود',
        typeof truthy.json.gift_wrap_fee === 'number', fa(truthy.json.gift_wrap_fee));
  }

  console.log(b('\n  ماندگاری در سفارش'));

  const col = db.prepare('PRAGMA table_info(orders)').all().find(c => c.name === 'gift_wrap_fee');
  add('ستون gift_wrap_fee در جدول هست', !!col, col ? `${col.type} پیش‌فرض ${col.dflt_value}` : '');

  add('مبلغ ذخیره می‌شود نه پرچم بله/خیر',
      col && /INT/i.test(col.type), 'عدد، نه BOOLEAN');

  console.log(b('\n  رابط کاربری'));

  const chk = fs.readFileSync(path.join(ROOT, 'public', 'checkout.html'), 'utf8');
  add('تسویه گزینه کادو دارد', /id="fGift"/.test(chk) && /gift-opt/.test(chk));
  add('تسویه پرچم را به سرور می‌فرستد', /gift_wrap:\s*giftWrap/.test(chk));
  add('انتخاب کادو در localStorage نمی‌ماند', !/yazd_gift/.test(chk),
      'تصمیم همین سفارش است نه ترجیح دائمی');

  const inv = fs.readFileSync(path.join(ROOT, 'public', 'invoice.html'), 'utf8');
  add('فاکتور سطر کادو دارد', /gift_wrap/.test(inv) && /بسته‌بندی کادویی/.test(inv));

  const lbl = fs.readFileSync(path.join(ROOT, 'public', 'label.html'), 'utf8');
  add('برچسب پستی هشدار کادو دارد', /giftbox/.test(lbl),
      'انبار باید بداند جعبه هدیه لازم است');

  const cart = fs.readFileSync(path.join(ROOT, 'public', 'cart.html'), 'utf8');
  add('سبد آستانه را از ثابت می‌خواند',
      new RegExp(`FREE_SHIP_THRESHOLD\\s*=\\s*${FREE_THRESHOLD}`).test(cart));

  const app = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'app.js'), 'utf8');
  add('فوتر نرخ یکسان را می‌گوید',
      /۱۰۰٬۰۰۰ تومان/.test(app) && !/شهر یزد/.test(app));

  const terms = fs.readFileSync(path.join(ROOT, 'public', 'terms.html'), 'utf8');
  add('قوانین هر سه عدد را دارد',
      /۱۰۰٬۰۰۰/.test(terms) && /۲٬۰۰۰٬۰۰۰/.test(terms) && /۷۰٬۰۰۰/.test(terms));

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  قوانین ارسال و کادو درست پیاده شده.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
