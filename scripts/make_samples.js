#!/usr/bin/env node
/**
 * ساخت نمونه خروجی‌های پنل مدیریت.
 *
 * ── چرا اسکریپت و نه ساخت دستی ──
 * نمونه‌ای که دستی ساخته شود، با نخستین تغییر قالب فاکتور کهنه
 * می‌شود و کسی متوجه نمی‌شود. با اسکریپت، بازتولیدش یک دستور
 * است.
 *
 * ── سفارش نمونه ──
 * عمداً پیچیده‌ترین حالت ممکن: سه قلم کالا، تخفیف جشنواره **و**
 * کد تخفیف با هم، ارسال رایگان، یادداشت مشتری، کد رهگیری.
 * اگر نمونه ساده باشد، بخش‌های خالی فاکتور آزموده نمی‌شوند.
 *
 * ── پاک‌سازی ──
 * سفارش نمونه در پایان حذف می‌شود. اگر بماند، در گزارش فروش و
 * بخش «پرفروش‌ترین» می‌نشیند و آمار را آلوده می‌کند.
 *
 * پیش‌نیاز: سرور بالا باشد.
 * اجرا: node scripts/make_samples.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { db } = require('../src/db');

const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(path.dirname(__dirname), 'docs', 'samples');
const OID = 'YZD-SAMPLE-DEMO';

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

function api(p, opt = {}, token) {
  return new Promise(res => {
    const body = opt.body || null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    }, x => {
      const chunks = [];
      x.on('data', c => chunks.push(c));
      x.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch {}
        res({ status: x.statusCode, json, buf });
      });
    });
    req.on('error', () => res({ status: 0, json: null, buf: Buffer.alloc(0) }));
    if (body) req.write(body);
    req.end();
  });
}

/** سفارش نمونه با همه حالت‌های ممکن */
function makeOrder() {
  db.prepare('DELETE FROM order_items WHERE order_id=?').run(OID);
  db.prepare('DELETE FROM orders WHERE order_id=?').run(OID);

  const vars = db.prepare(`
    SELECT v.sku, v.price_toman, v.type_label, v.volume_ml,
           p.brand_fa, p.name_fa
    FROM variants v JOIN products p ON p.id = v.product_id
    WHERE v.type='EDP' LIMIT 3
  `).all();
  if (!vars.length) throw new Error('هیچ واریانتی در دیتابیس نیست.');

  const items = vars.map((v, i) => ({ ...v, qty: i === 0 ? 2 : 1 }));
  const subtotal = items.reduce((s, x) => s + x.price_toman * x.qty, 0);
  const campaign = Math.floor(subtotal * 0.10);
  const coupon = 200000;
  const discount = campaign + coupon;
  const shipping = 0;                       // بالای ۲٫۵ میلیون رایگان
  const total = subtotal - discount + shipping;

  db.prepare(`INSERT INTO orders
    (order_id, created_at, updated_at, customer_name, mobile, province, city,
     address, postal_code, subtotal, shipping_fee, discount_code, discount_amount,
     campaign_discount, campaign_note, total_paid, payment_gateway, payment_ref,
     status, tracking_code, carrier, customer_note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    OID, '2026-08-04T10:22:00.000Z', '2026-08-05T14:05:00.000Z',
    'زهرا موسوی', '09121234567', 'تهران', 'تهران',
    'خیابان ولیعصر، کوچه یاس، پلاک ۱۲، واحد ۳', '1969814711',
    subtotal, shipping, 'WELCOME10', discount, campaign, 'جشنواره تابستانه',
    total, 'ZARINPAL', 'A0000000000000000000000123456789', 'SHIPPED',
    '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶۷۸', 'پست پیشتاز', 'لطفاً کادوپیچ شود.');

  const ins = db.prepare(`INSERT INTO order_items
    (order_id, sku, product_name, unit_price, quantity, line_total)
    VALUES (?,?,?,?,?,?)`);
  items.forEach(x => ins.run(OID, x.sku,
    `${x.brand_fa} — ${x.name_fa} — ${x.type_label} ${x.volume_ml} میل`,
    x.price_toman, x.qty, x.price_toman * x.qty));

  return { subtotal, discount, total, count: items.length };
}

function cleanOrder() {
  db.prepare('DELETE FROM order_items WHERE order_id=?').run(OID);
  db.prepare('DELETE FROM orders WHERE order_id=?').run(OID);
}

(async () => {
  console.log();
  console.log('  ساخت نمونه خروجی‌های پنل');
  console.log(d('  ─────────────────────────────────────────────'));

  const health = await api('/api/health');
  if (health.status !== 200) {
    console.log(r('\n  سرور بالا نیست. اول اجرایش کنید.\n'));
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });

  const info = makeOrder();
  console.log(d(`      سفارش نمونه: ${info.count} قلم · ` +
    `جمع ${info.subtotal.toLocaleString('en-US')} · ` +
    `پرداخت ${info.total.toLocaleString('en-US')}`));

  const login = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  const token = login.json && login.json.token;
  if (!token) { cleanOrder(); console.log(r('\n  ورود مدیر ناموفق.\n')); process.exit(1); }

  const made = [];

  // ── CSV ها ──
  console.log();
  for (const [p, name, label] of [
    ['/api/admin/export/csv', 'orders-export.csv', 'CSV سفارش‌ها'],
    ['/api/admin/reports/csv?days=30', 'sales-report.csv', 'CSV گزارش فروش']
  ]) {
    const res = await api(p, {}, token);
    if (res.status !== 200) { console.log(`  ${r('✗')} ${label} — کد ${res.status}`); continue; }

    let buf = res.buf;
    /* CSV سفارش‌ها همه سفارش‌های واقعی را دارد. برای نمونه فقط
       چند سطر نگه می‌داریم — هم سبک‌تر، هم داده مشتریان واقعی
       در مخزن نمی‌ماند. */
    if (name === 'orders-export.csv') {
      const txt = buf.toString('utf8');
      const bom = txt.startsWith('\uFEFF') ? '\uFEFF' : '';
      const lines = txt.replace(/^\uFEFF/, '').split('\n');
      const header = lines[0];
      const mine = lines.filter(l => l.startsWith(OID));
      const others = lines.slice(1).filter(l => l && !l.startsWith(OID)).slice(0, 2);
      buf = Buffer.from(bom + [header, ...mine, ...others].join('\n') + '\n', 'utf8');
    }
    fs.writeFileSync(path.join(OUT, name), buf);
    const hasBom = buf.slice(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]));
    console.log(`  ${g('✓')} ${label}` +
      d(`  — ${(buf.length / 1024).toFixed(1)}KB · BOM: ${hasBom ? 'دارد' : r('ندارد!')}`));
    made.push(name);
  }

  // ── PDF ها ──
  const pdfScript = `
import asyncio, sys
from playwright.async_api import async_playwright
BASE, OID, TOK, OUT = "${BASE}", "${OID}", "${token}", "${OUT}"
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context()
        await ctx.add_cookies([{'name':'yazd_admin','value':TOK,'url':BASE,'httpOnly':True,'sameSite':'Lax'}])
        for path, name, fmt in [
            (f"/invoice?order={OID}",          "invoice-normal", "A4"),
            (f"/invoice?order={OID}&formal=1", "invoice-formal", "A4"),
            (f"/label?order={OID}",            "shipping-label", None)]:
            p = await ctx.new_page()
            await p.goto(BASE + path, wait_until="domcontentloaded")
            await p.wait_for_timeout(2600)
            o = {"path": f"{OUT}/{name}.pdf", "print_background": True}
            if fmt: o["format"] = fmt
            else:   o.update({"width": "10cm", "height": "15cm"})
            await p.pdf(**o)
            print(name)
            await p.close()
        await b.close()
asyncio.run(main())
`;
  try {
    const outNames = execFileSync('python3', ['-c', pdfScript],
      { encoding: 'utf8', timeout: 180000 }).trim().split('\n').filter(Boolean);
    outNames.forEach(n => {
      const f = path.join(OUT, n + '.pdf');
      const kb = (fs.statSync(f).size / 1024).toFixed(0);
      console.log(`  ${g('✓')} ${n}.pdf` + d(`  — ${kb}KB`));
      made.push(n + '.pdf');
    });
  } catch (e) {
    console.log(`  ${r('✗')} ساخت PDF ناموفق` +
      d('  — playwright نصب است؟ pip install playwright'));
  }

  /* سفارش نمونه باید برود — وگرنه در گزارش فروش و «پرفروش‌ترین»
     می‌نشیند و آمار واقعی را آلوده می‌کند. */
  cleanOrder();
  const gone = !db.prepare('SELECT 1 FROM orders WHERE order_id=?').get(OID);
  console.log();
  console.log(gone
    ? d('      سفارش نمونه از دیتابیس پاک شد.')
    : r('      ⚠ سفارش نمونه پاک نشد!'));

  console.log();
  console.log(made.length === 5
    ? g(`  ${made.length} نمونه ساخته شد → docs/samples/\n`)
    : r(`  فقط ${made.length} از ۵ نمونه ساخته شد.\n`));
  process.exit(made.length === 5 && gone ? 0 : 1);
})();
