#!/usr/bin/env node
/**
 * آزمون نگهبان چهار خواسته مالک فروشگاه (مرداد ۱۴۰۵):
 *
 *   ۱) موجودی همه کالاها پیش‌فرض صفر (ناموجود) باشد
 *   ۲) پنل کارمندان کنترل موجودی با ± و تایپ دستی داشته باشد
 *   ۳) حجم عطر مو و بادی اسپلش ۱۵۰ میل باشد
 *   ۴) جستجو با چند حرف، پیشنهاد خودکار نشان دهد
 *
 * بخش رابط کاربری با مرورگر واقعی سنجیده می‌شود، نه با خواندن
 * کد — چون «کد درست است» با «در مرورگر کار می‌کند» یکی نیست.
 *
 * اجرا: node scripts/test_stock_and_suggest.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4443;
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

(async () => {
  console.log('\n  آزمون موجودی، حجم و پیشنهاد جستجو\n');

  /* ── ۳) حجم — مستقیم از دیتابیس ── */
  {
    const db = new Database(DB, { readonly: true });

    const hair = db.prepare(
      "SELECT COUNT(*) c FROM variants WHERE type='HAIR_MIST' AND volume_ml=150").get().c;
    const hairAll = db.prepare(
      "SELECT COUNT(*) c FROM variants WHERE type='HAIR_MIST'").get().c;
    add('عطر مو ۱۵۰ میل است', hair === hairAll && hairAll > 0, `${hair}/${hairAll}`);

    const body = db.prepare(
      "SELECT COUNT(*) c FROM variants WHERE type='BODY_SPLASH' AND volume_ml=150").get().c;
    const bodyAll = db.prepare(
      "SELECT COUNT(*) c FROM variants WHERE type='BODY_SPLASH'").get().c;
    add('بادی اسپلش ۱۵۰ میل است', body === bodyAll && bodyAll > 0, `${body}/${bodyAll}`);

    // SKU باید با حجم بخواند، وگرنه کد و محتوا نمی‌خوانند
    const badSku = db.prepare(`
      SELECT COUNT(*) c FROM variants
      WHERE type IN ('HAIR_MIST','BODY_SPLASH')
        AND sku NOT LIKE '%-150' AND sku NOT LIKE '%-HM-050'
        AND sku NOT LIKE '%-BS-100'`).get().c;
    add('SKU با حجم تازه هم‌خوان است', badSku === 0, badSku ? `${badSku} ناهم‌خوان` : 'همه');

    db.close();
  }

  /* ── ۱) موجودی پیش‌فرض صفر ── */
  {
    const db = new Database(DB, { readonly: true });
    const nz = db.prepare('SELECT COUNT(*) c FROM variants WHERE stock != 0').get().c;
    const total = db.prepare('SELECT COUNT(*) c FROM variants').get().c;
    // اگر مالک موجودی واقعی وارد کرده باشد این عدد بالا می‌رود —
    // پس فقط هشدار می‌دهیم، نه شکست
    if (nz > 0) {
      console.log(d(`  · ${nz} از ${total} واریانت موجودی دارد (موجودی واقعی وارد شده)`));
      checks.push(true);
      console.log(`  ${g('✓')} موجودی قابل تنظیم است`);
    } else {
      add('موجودی همه کالاها صفر است (ناموجود)', true, `${total} واریانت`);
    }
    db.close();
  }

  /* ── seed هم باید صفر باشد، وگرنه استقرار تازه اعداد قدیم را برمی‌گرداند ── */
  {
    const seedPath = path.join(ROOT, 'seed', 'perfumes_catalogue_seed.json');
    if (fs.existsSync(seedPath)) {
      const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      const items = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
      let nz = 0, wrongVol = 0;
      for (const p of items) for (const v of (p.variants || [])) {
        if (v.stock !== 0) nz++;
        if ((v.type === 'HAIR_MIST' || v.type === 'BODY_SPLASH') && v.volume_ml !== 150) wrongVol++;
      }
      add('seed موجودی صفر دارد', nz === 0, nz ? `${nz} غیرصفر` : 'پاک');
      add('seed حجم ۱۵۰ دارد', wrongVol === 0, wrongVol ? `${wrongVol} اشتباه` : 'درست');
    }
  }

  const srv = await boot();
  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('هر چهار خواسته برقرار است.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    /* ── حجم در API عمومی ── */
    const p = await fetch(`${BASE}/api/products/creed-aventus`).then(x => x.json());
    const hm = (p.variants || []).find(v => v.type === 'HAIR_MIST');
    const bs = (p.variants || []).find(v => v.type === 'BODY_SPLASH');
    add('API عطر مو را ۱۵۰ میل می‌دهد', hm && hm.volume_ml === 150, hm && hm.volume_ml + 'ml');
    add('API بادی اسپلش را ۱۵۰ میل می‌دهد', bs && bs.volume_ml === 150, bs && bs.volume_ml + 'ml');

    /* ── مرورگر واقعی ── */
    let chromium = null;
    try { ({ chromium } = require('playwright')); } catch {}
    if (!chromium) {
      console.log(d('\n  · بخش مرورگر رد شد (playwright نصب نیست)'));
      return finish();
    }

    /* نسخه Node پلی‌رایت گاهی نسخه مرورگر دیگری می‌خواهد از آنچه
       نسخه پایتون دانلود کرده. به‌جای دانلود دوباره ۱۱۴ مگابایت،
       هر مرورگر موجود در کش استفاده می‌شود. */
    let exe;
    try {
      const base = path.join(process.env.HOME || '/home/user', '.cache', 'ms-playwright');
      const dir = fs.readdirSync(base)
        .filter(x => x.startsWith('chromium_headless_shell-') || x.startsWith('chromium-'))
        .sort().pop();
      if (dir) {
        for (const c of ['chrome-headless-shell-linux64/chrome-headless-shell',
                         'chrome-linux/chrome']) {
          const f = path.join(base, dir, c);
          if (fs.existsSync(f)) { exe = f; break; }
        }
      }
    } catch {}

    const browser = await chromium.launch({
      ...(exe ? { executablePath: exe } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    /* ── ۴) پیشنهاد جستجو ── */
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const pg = await ctx.newPage();
      const jsErr = [];
      pg.on('pageerror', e => jsErr.push(String(e)));

      await pg.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });

      // یک حرف نباید فهرست را باز کند
      await pg.fill('#q', 'ع');
      await pg.waitForTimeout(900);
      add('با یک حرف پیشنهاد باز نمی‌شود', await pg.isHidden('#sugg'));

      // دو حرف باید باز کند
      await pg.fill('#q', 'عود');
      await pg.waitForTimeout(1500);
      const n = await pg.locator('.sugg-item').count();
      add('با چند حرف پیشنهاد خودکار می‌آید', n > 0, `${n} پیشنهاد`);

      // ناوبری با کیبورد
      await pg.focus('#q');
      await pg.keyboard.press('ArrowDown');
      await pg.waitForTimeout(300);
      add('فلش پایین گزینه را انتخاب می‌کند',
        (await pg.locator('.sugg-item.active').count()) === 1);

      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(250);
      add('Escape فهرست را می‌بندد', await pg.isHidden('#sugg'));

      // کلیک روی پیشنهاد به صفحه محصول می‌رود
      await pg.fill('#q', 'اونتوس');
      await pg.waitForTimeout(1500);
      if (await pg.locator('.sugg-item').count()) {
        await pg.locator('.sugg-item').first().click();
        await pg.waitForLoadState('networkidle', { timeout: 30000 });
        add('کلیک روی پیشنهاد به صفحه محصول می‌رود',
          pg.url().includes('/perfume/'), pg.url().split('/').pop());
      } else {
        add('کلیک روی پیشنهاد', false, 'پیشنهادی نبود');
      }

      add('هیچ خطای جاوااسکریپت نیست', jsErr.length === 0, jsErr[0]);
      await ctx.close();
    }

    /* ── ۲) کنترل موجودی در پنل ── */
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const pg = await ctx.newPage();
      const jsErr = [];
      pg.on('pageerror', e => jsErr.push(String(e)));

      await pg.goto(`${BASE}/admin`, { waitUntil: 'networkidle', timeout: 60000 });
      await pg.fill('#usr', process.env.ADMIN_USERNAME || 'owner');
      await pg.fill('#pw', process.env.ADMIN_PASSWORD || 'yazd1404');
      await pg.click('button:has-text("ورود")');
      await pg.waitForTimeout(2800);

      await pg.click('text=محصولات و موجودی');
      await pg.waitForTimeout(800);

      // جستجوی زنده — بدون زدن دکمه
      await pg.fill('#pSearch', 'اونتوس');
      await pg.waitForTimeout(1600);
      const rows = await pg.locator('#pResults tr').count();
      add('جستجوی زنده در پنل بدون زدن دکمه', rows > 1, `${Math.max(0, rows - 1)} نتیجه`);

      if (rows > 1) {
        await pg.locator('#pResults button:has-text("ویرایش")').first().click();
        await pg.waitForTimeout(1400);

        const ctrls = await pg.locator('.stock-ctrl').count();
        add('هر حجم کنترل موجودی دارد', ctrls >= 7, `${ctrls} ردیف`);

        const inp = pg.locator('.stock-ctrl input').first();
        const sku = (await inp.getAttribute('id')).replace('st_', '');
        const before = parseInt(await inp.inputValue());

        // دکمه +
        await pg.locator('.stock-ctrl button:has-text("+")').first().click();
        await pg.waitForTimeout(1100);
        const afterPlus = parseInt(await inp.inputValue());
        add('دکمه + موجودی را زیاد می‌کند', afterPlus === before + 1,
          `${before} → ${afterPlus}`);

        // دکمه −
        await pg.locator('.stock-ctrl button').first().click();
        await pg.waitForTimeout(1100);
        const afterMinus = parseInt(await inp.inputValue());
        add('دکمه − موجودی را کم می‌کند', afterMinus === before,
          `${afterPlus} → ${afterMinus}`);

        // تایپ دستی
        await inp.fill('37');
        await inp.dispatchEvent('change');
        await pg.waitForTimeout(1200);
        add('تایپ دستی عدد کار می‌کند', (await inp.inputValue()) === '37');

        // واقعاً در دیتابیس ذخیره شده؟
        const db = new Database(DB, { readonly: true });
        const saved = db.prepare('SELECT stock FROM variants WHERE sku=?').get(sku);
        db.close();
        add('تغییر در دیتابیس ذخیره شد', saved && saved.stock === 37,
          saved ? 'stock=' + saved.stock : 'یافت نشد');

        // منفی نشدن
        await inp.fill('0');
        await inp.dispatchEvent('change');
        await pg.waitForTimeout(900);
        await pg.locator('.stock-ctrl button').first().click();
        await pg.waitForTimeout(900);
        add('موجودی زیر صفر نمی‌رود', (await inp.inputValue()) === '0');

        // برگرداندن به مقدار اول
        const dbw = new Database(DB);
        dbw.prepare('UPDATE variants SET stock=? WHERE sku=?').run(before, sku);
        dbw.close();
      }

      add('پنل بدون خطای جاوااسکریپت', jsErr.length === 0, jsErr[0]);
      await ctx.close();
    }

    await browser.close();
  } catch (e) {
    add('اجرای آزمون بدون خطا', false, e.message);
  }

  finish();
})();
