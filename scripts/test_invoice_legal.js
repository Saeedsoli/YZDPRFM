#!/usr/bin/env node
/**
 * آزمون تفکیک «فاکتور عادی» از «فاکتور رسمی».
 *
 * پس‌زمینه — خواسته صریح مالک فروشگاه (مرداد ۱۴۰۵):
 *   «ما در فاکتور یا جای دیگر، اصلا نیازی به درج اطلاعات حقوقی
 *    نداریم. خود ای‌نماد کفایت می‌کند.»
 *
 * ولی یک تفکیک لازم بود:
 *   • کد اقتصادی / شناسه ملی / شماره ثبت → فقط فاکتور رسمی
 *   • تلفن / نشانی / کد پستی → **الزام خودِ اینماد**، می‌مانند
 *
 * چرا آزمون لازم است: اگر روزی کسی سهواً اطلاعات حقوقی را به
 * فاکتور عادی برگرداند، سندی به دست مشتری می‌رسد که ممکن است
 * مقدارش ساختگی باشد — مسئولیت حقوقی مستقیم.
 *
 * پوشش:
 *   • فاکتور عادی هیچ فیلد حقوقی ندارد
 *   • فاکتور رسمی آن‌ها را دارد (اگر ثبت شده باشند)
 *   • تلفن و نشانی در هر دو حالت هستند
 *   • برچسب پستی نشانی فرستنده را نگه می‌دارد
 *   • فوتر تلفن و نشانی نشان می‌دهد (الزام اینماد)
 *   • بررسی آمادگی: حقوقی خطا نیست، تماس خطاست
 *   • /api/contact-info کد اقتصادی لو نمی‌دهد
 *
 * اجرا: node scripts/test_invoice_legal.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4495;
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

/* مقادیر آزمونی — واقعی‌نما ولی نه در فهرست PLACEHOLDER،
   تا بررسی آمادگی آن‌ها را «نمونه» نشمارد. */
const T = {
  legal_name: 'شرکت رایحه پارس یزد',
  economic_code: '411777888999',
  national_id: '10861234567',
  register_no: '54321',
  phone: '03538887766',
  address: 'یزد، بلوار آزمون، پلاک ۲۲',
  postal_code: '8915551234'
};

let saved = {};

function setSettings(obj) {
  const db = new Database(DB);
  const put = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  const del = db.prepare('DELETE FROM settings WHERE key=?');
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) del.run(k); else put.run(k, v);
  }
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

(async () => {
  console.log('\n  آزمون تفکیک فاکتور عادی و رسمی\n');

  // وضعیت فعلی را نگه می‌داریم تا آخر برگردانیم
  {
    const db = new Database(DB);
    for (const k of Object.keys(T)) {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
      saved[k] = row ? row.value : null;
    }
    db.close();
  }

  const srv = await boot();

  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    try { setSettings(saved); } catch {}
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('تفکیک فاکتور درست کار می‌کند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    // ── منبع فاکتور ──
    console.log('  ── قالب صفحه فاکتور ──');

    const inv = fs.readFileSync(path.join(ROOT, 'public/invoice.html'), 'utf8');

    add('پارامتر formal خوانده می‌شود', /get\('formal'\) === '1'/.test(inv));
    for (const [field, label] of [
      ['legal_name', 'نام حقوقی'], ['economic_code', 'کد اقتصادی'],
      ['national_id', 'شناسه ملی'], ['register_no', 'شماره ثبت']
    ]) {
      /* هر فیلد حقوقی باید پشت شرط formal باشد. اگر کسی شرط را
         بردارد، اینجا قرمز می‌شود. */
      const re = new RegExp(`formal && st\\.${field}`);
      add(`«${label}» فقط در حالت رسمی چاپ می‌شود`, re.test(inv));
    }
    add('تلفن پشت شرط formal نیست (در هر دو حالت)',
      /(?<!formal && )st\.phone && `تلفن/.test(inv));
    add('عنوان سند در حالت رسمی فرق می‌کند',
      /formal \? 'فاکتور رسمی فروش کالا'/.test(inv));

    // ── رفتار واقعی با داده ثبت‌شده ──
    console.log('\n  ── با اطلاعات حقوقی ثبت‌شده ──');

    setSettings(T);

    const shop = await fetch(`${BASE}/api/contact-info`).then(r => r.json());
    add('اطلاعات تماس عمومی تلفن دارد', shop.phone === T.phone, shop.phone);
    add('اطلاعات تماس عمومی نشانی دارد', !!shop.address);
    add('اطلاعات تماس عمومی کد پستی دارد', shop.postal_code === T.postal_code);
    /* حیاتی: این مسیر باز است و هر کسی می‌تواند صدایش بزند. */
    add('کد اقتصادی در API عمومی نیست',
      !JSON.stringify(shop).includes(T.economic_code));
    add('شناسه ملی در API عمومی نیست',
      !JSON.stringify(shop).includes(T.national_id));
    add('شماره ثبت در API عمومی نیست',
      !JSON.stringify(shop).includes(T.register_no));

    // ── بررسی آمادگی ──
    console.log('\n  ── بررسی آمادگی افتتاح ──');

    const login = await fetch(`${BASE}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.ADMIN_USERNAME || 'owner',
        password: process.env.ADMIN_PASSWORD || 'yazd1404'
      })
    }).then(r => r.json());
    const TOK = login.token;
    add('ورود مدیر', !!TOK);
    if (!TOK) return finish();

    const rd = () => fetch(`${BASE}/api/admin/readiness`, {
      headers: { Authorization: 'Bearer ' + TOK }
    }).then(r => r.json());

    {
      const d1 = await rd();
      const legal = d1.items.find(i => i.key === 'legal');
      const formal = d1.items.find(i => i.key === 'legal_formal');
      add('بررسی «اطلاعات تماس» جدا شده', !!legal && /اینماد/.test(legal.title));
      add('اطلاعات تماس معتبر سبز است', legal.level === 'ok', legal.message);
      add('بررسی «اطلاعات حقوقی» جدا وجود دارد', !!formal);
      add('اطلاعات حقوقی معتبر سبز است', formal.level === 'ok', formal.message);
    }

    {
      /* حالت اصلی مورد نظر مالک: هیچ اطلاعات حقوقی‌ای ثبت نشده. */
      setSettings({ legal_name: '', economic_code: null,
        national_id: null, register_no: null });
      const d2 = await rd();
      const formal = d2.items.find(i => i.key === 'legal_formal');
      add('نبودِ اطلاعات حقوقی **خطا نیست**',
        formal.level === 'ok', `${formal.level} — ${formal.message}`);
      add('پیام صریح می‌گوید اشکالی ندارد',
        /اشکالی ندارد/.test(formal.message));

      const legal = d2.items.find(i => i.key === 'legal');
      add('اطلاعات تماس همچنان سنجیده می‌شود', legal.level === 'ok');
    }

    {
      /* مقدار نمونه در فیلد اختیاری → هشدار، نه خطا */
      setSettings({ economic_code: '411358697643' });
      const d3 = await rd();
      const formal = d3.items.find(i => i.key === 'legal_formal');
      add('مقدار نمونه در فیلد اختیاری هشدار می‌دهد',
        formal.level === 'warn', formal.level);
      add('هشدار می‌گوید روی فاکتور رسمی چاپ می‌شود',
        /فاکتور رسمی/.test(formal.message));
      setSettings({ economic_code: null });
    }

    {
      /* نبودِ تلفن → خطا، چون اینماد الزام کرده */
      setSettings({ phone: '' });
      const d4 = await rd();
      const legal = d4.items.find(i => i.key === 'legal');
      add('نبودِ تلفن خطاست (الزام اینماد)',
        legal.level === 'error', legal.message);
      add('پیام به اینماد اشاره می‌کند', /اینماد/.test(legal.message));
      setSettings({ phone: T.phone });
    }

    // ── برچسب پستی ──
    console.log('\n  ── برچسب پستی ──');

    {
      const lab = fs.readFileSync(path.join(ROOT, 'public/label.html'), 'utf8');
      add('نشانی فرستنده روی برچسب می‌ماند', /st\.address/.test(lab));
      add('کد پستی فرستنده روی برچسب می‌ماند', /st\.postal_code/.test(lab));
      /* پست بدون نشانی فرستنده مرسوله را نمی‌پذیرد و مرسوله
         برگشتی جایی برای رفتن ندارد. */
      add('برچسب کد اقتصادی چاپ نمی‌کند', !/economic_code/.test(lab));
      add('برچسب شناسه ملی چاپ نمی‌کند', !/national_id/.test(lab));
    }

    // ── فوتر ──
    console.log('\n  ── فوتر سایت (الزام اینماد) ──');

    {
      const app = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
      add('فوتر جای اطلاعات تماس دارد', /footContact/.test(app));
      add('تابع پرکننده تعریف شده', /async function loadFooterContact/.test(app));
      add('از /api/contact-info می‌خواند', /api\/contact-info/.test(app));
      add('به تعویق افتاده تا LCP آسیب نبیند',
        /whenIdle\(loadFooterContact\)/.test(app));
      add('تلفن قابل کلیک است (tel:)', /href="tel:/.test(app));

      const css = fs.readFileSync(path.join(ROOT, 'public/assets/theme.css'), 'utf8');
      add('استایل فوتر تماس در CSS هست', /\.foot-contact/.test(css));
    }

    // ── پنل ──
    console.log('\n  ── دکمه فاکتور رسمی در پنل ──');

    {
      const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
      add('دکمه فاکتور عادی هست', /\/invoice\?order=\$\{x\.order_id\}"/.test(adm));
      add('دکمه فاکتور رسمی جدا هست', /formal=1/.test(adm));
      add('توضیح کاربردش داده شده', /خریدار عمده/.test(adm));
    }

    // ── سرو شدن هر دو نسخه ──
    console.log('\n  ── هر دو نسخه سرو می‌شوند ──');

    {
      const db = new Database(DB);
      const o = db.prepare(
        `SELECT order_id FROM orders WHERE status IN
         ('PAID','PROCESSING','SHIPPED','DELIVERED') ORDER BY rowid DESC LIMIT 1`).get();
      db.close();

      if (!o) {
        add('سفارش پرداخت‌شده برای آزمون هست', false);
      } else {
        for (const [q, label] of [['', 'عادی'], ['&formal=1', 'رسمی']]) {
          const res = await fetch(`${BASE}/invoice?order=${o.order_id}${q}`);
          const html = await res.text();
          add(`فاکتور ${label} سرو می‌شود`,
            res.status === 200 && html.includes('invoice'), `status ${res.status}`);
        }
      }
    }

  } catch (e) {
    add('اجرای آزمون بدون خطای غیرمنتظره', false, e.message);
  }

  finish();
})();
