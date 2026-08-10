#!/usr/bin/env node
/**
 * آزمون نگهبان — «هیچ مبلغ اضافه‌ای وجود ندارد»
 *
 * خواسته صریح مالک فروشگاه (تیر ۱۴۰۵):
 *   «لازم نیست جایی اسم از مالیات و غیره بیاید. پرداختی مشتری همان
 *    مبالغی است که در سایت اعلام شده و نیازی به محاسبه مبلغ اضافه‌ای
 *    در فاکتور یا جای دیگر نیست.»
 *
 * این آزمون سه چیز را تضمین می‌کند:
 *   ۱) هیچ واژه مالیاتی در کد اجرایی و صفحات نمانده باشد
 *   ۲) پاسخ /api/orders/:id/invoice هیچ کلید مبلغی بیرون از
 *      فهرست سفید نداشته باشد (هر عدد ناشناخته یعنی هزینه پنهان)
 *   ۳) رابطه ریاضی برقرار باشد: جمع − تخفیف + ارسال = پرداختی
 *      یعنی هیچ عدد ناشناسی وسط راه اضافه نشده
 *
 * سرور را خودش روی پورت جدا بالا می‌آورد (مثل test_accounts.js)
 * تا به سرور کهنه‌ی احتمالی روی ۳۰۰۰ پاسخ ندهد.
 *
 * اجرا: node scripts/test_no_extra_charges.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4437;
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

/* ═══ ۱) پویش متن فایل‌ها — ایستا، سرور لازم ندارد ═══ */
const FORBIDDEN = [
  'مالیات', 'ارزش افزوده', 'ارزش‌افزوده', 'عوارض',
  'vat_percent', 'vat_included', 'net_goods'
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

function staticScan() {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'public'))]
    .filter(f => !f.includes('/assets/fonts/'));
  const hits = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const w of FORBIDDEN) {
      if (txt.includes(w)) hits.push(`${path.relative(ROOT, f)} → «${w}»`);
    }
  }
  add('هیچ واژه مالیاتی در src/ و public/ نمانده', hits.length === 0,
    hits.slice(0, 4).join(' | '));
}

/* ═══ راه‌اندازی سرور اختصاصی ═══ */
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

const api = (p, opt = {}, token = null) =>
  fetch(BASE + p, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opt.headers || {})
    }
  }).then(async res => ({ status: res.status, json: await res.json().catch(() => ({})) }));

(async () => {
  console.log('\n  آزمون «قیمت اعلام‌شده = قیمت پرداختی»\n');
  staticScan();

  const srv = await boot();
  const db = new Database(DB, { readonly: true });

  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    try { db.close(); } catch {}
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(`\n  ${fail ? r(`${fail} بررسی ناموفق`) : g('هیچ مبلغ اضافه‌ای در سامانه نیست.')}`);
    console.log(`  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    const login = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: process.env.ADMIN_USERNAME || 'owner',
        password: process.env.ADMIN_PASSWORD || 'yazd1404'
      })
    });
    const TOK = login.json.token;
    add('ورود مدیر برای دیدن فاکتور', !!TOK, 'وضعیت ' + login.status);
    if (!TOK) return finish();

    // سفارش تسویه‌شده را مستقیم از دیتابیس بردار — به ترتیب صفحه‌بندی وابسته نباشیم
    const paid = db.prepare(`
      SELECT order_id, subtotal, discount_amount, shipping_fee, total_paid
      FROM orders
      WHERE status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')
      ORDER BY rowid DESC LIMIT 1`).get();

    add('سفارش تسویه‌شده برای آزمون فاکتور موجود است', !!paid);
    if (!paid) return finish();

    const inv = await api(`/api/orders/${paid.order_id}/invoice`, {}, TOK);
    add('فاکتور برگردانده شد', inv.status === 200, 'وضعیت ' + inv.status);

    const t = inv.json.totals || {};

    /* فهرست سفید به‌جای شمردن کلیدها.
       نسخه اول «دقیقاً چهار کلید» را می‌سنجید و با افزودن تفکیک
       جشنواره قرمز شد — در حالی که تفکیک، شفافیت را **بیشتر**
       می‌کند نه کمتر. روحِ این آزمون «هیچ عدد پنهان» است، پس
       معیار درست این است: هر کلید مبلغی باید شناخته‌شده باشد و
       رابطه ریاضی برقرار بماند. */
    const ALLOWED = new Set([
      'subtotal',        // جمع کالاها
      'discount',        // کل تخفیف (جشنواره + کد)
      'campaign',        // سهم جشنواره — زیرمجموعه discount
      'campaign_note',   // عنوان جشنواره، متنی
      'coupon',          // سهم کد تخفیف — زیرمجموعه discount
      'shipping',        // هزینه ارسال
      /* بسته‌بندی کادویی — سرویس **انتخابی** مشتری، نه مبلغ
         تحمیلی. تفاوتش با مالیات و کارمزد بنیادی است:
           • پیش‌فرض خاموش است
           • مشتری خودش تیک می‌زند و مبلغ را پیش از پرداخت می‌بیند
           • در فاکتور سطر جدا دارد، پنهان نیست
         قاعده برند «هیچ مبلغ اضافه‌ای» درباره چیزی است که مشتری
         نخواسته و نمی‌بیند. سرویس اختیاریِ شفاف نقضش نمی‌کند. */
      'gift_wrap',
      'grand_total'      // مبلغ پرداختی
    ]);
    const unknown = Object.keys(t).filter(k => !ALLOWED.has(k));
    add('هیچ کلید مبلغی ناشناخته‌ای در totals نیست',
      unknown.length === 0, unknown.join(',') || 'فقط کلیدهای شناخته‌شده');

    add('تفکیک تخفیف با کل تخفیف می‌خواند (زیرمجموعه است، نه اضافه)',
      (t.campaign || 0) + (t.coupon || 0) === t.discount,
      `${t.campaign || 0} + ${t.coupon || 0} = ${t.discount}`);

    add('هیچ کلید مالیاتی در totals نیست',
      !Object.keys(t).some(k => /vat|tax|net_goods/i.test(k)));

    /* معادله کامل — هر جزء مبلغ باید در آن باشد.
       اگر جزء تازه‌ای اضافه شود ولی اینجا نیاید، آزمون سبز
       می‌ماند در حالی که عدد پنهان وجود دارد. کادو هم به همین
       دلیل صریح آمده، نه اینکه در grand_total حل شود. */
    const wrap = t.gift_wrap || 0;
    add('جمع کالاها − تخفیف + ارسال + کادو = مبلغ پرداختی (بدون عدد پنهان)',
      t.subtotal - t.discount + t.shipping + wrap === t.grand_total,
      `${t.subtotal} − ${t.discount} + ${t.shipping}` +
      (wrap ? ` + ${wrap}` : '') + ` = ${t.grand_total}`);

    add('مبلغ فاکتور با مبلغی که مشتری واقعاً پرداخت کرده یکی است',
      t.grand_total === paid.total_paid);

    add('تنظیمات فروشگاه دیگر کلید vat_percent ندارد',
      !('vat_percent' in (inv.json.settings || {})));

    const invHtml = await fetch(`${BASE}/invoice?order=${paid.order_id}`).then(x => x.text());
    add('صفحه چاپی فاکتور هیچ سطر مالیاتی ندارد',
      !/مالیات|ارزش افزوده/.test(invHtml));

    const adminHtml = await fetch(`${BASE}/admin`).then(x => x.text());
    add('فرم تنظیمات پنل دیگر فیلد مالیات ندارد',
      !/مالیات|sVat/.test(adminHtml));

    // تلاش برای برگرداندن مالیات از راه API باید بی‌اثر بماند
    const inject = await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ vat_percent: '9' })
    }, TOK);
    add('API تنظیمات کلید vat_percent را نمی‌پذیرد',
      !('vat_percent' in (inject.json.settings || {})));

    const dbHas = new Database(DB, { readonly: true })
      .prepare("SELECT COUNT(*) n FROM settings WHERE key='vat_percent'").get().n;
    add('کلید vat_percent در دیتابیس ذخیره نشد', dbHas === 0);

    // صفحه تسویه نباید هیچ سطر اضافه‌ای نشان بدهد
    const checkoutHtml = await fetch(`${BASE}/checkout`).then(x => x.text());
    add('صفحه تسویه فقط تخفیف و ارسال دارد',
      !/مالیات|کارمزد|عوارض/.test(checkoutHtml));

  } catch (e) {
    add('اجرای آزمون بدون خطا', false, e.message);
  }

  finish();
})();
