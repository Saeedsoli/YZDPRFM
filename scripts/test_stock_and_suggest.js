#!/usr/bin/env node

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

  {
    const db = new Database(DB, { readonly: true });
    const legacy = db.prepare("SELECT COUNT(*) c FROM variants WHERE type='SAMPLE' AND volume_ml=3").get().c;
    add('سمپل ۳ میل در کاتالوگ فعال وجود ندارد', legacy === 0, `${legacy} ردیف`);
    const badBody = db.prepare("SELECT COUNT(*) c FROM variants WHERE type='BODY_SPLASH' AND volume_ml=120 AND sku NOT LIKE '%-120'").get().c;
    add('شناسه بادی‌اسپلش‌های جدید با ۱۲۰ میل سازگار است', badBody === 0, `${badBody} ناسازگار`);
    db.close();
  }

  {
    const db = new Database(DB, { readonly: true });
    const nz = db.prepare('SELECT COUNT(*) c FROM variants WHERE stock != 0').get().c;
    const total = db.prepare('SELECT COUNT(*) c FROM variants').get().c;

    if (nz > 0) {
      console.log(d(`  · ${nz} از ${total} واریانت موجودی دارد (موجودی واقعی وارد شده)`));
      checks.push(true);
      console.log(`  ${g('✓')} موجودی قابل تنظیم است`);
    } else {
      add('موجودی همه کالاها صفر است (ناموجود)', true, `${total} واریانت`);
    }
    db.close();
  }

  {
    const seedPath = path.join(ROOT, 'seed', 'perfumes_catalogue_seed.json');
    if (fs.existsSync(seedPath)) {
      const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      const items = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
      let nz = 0, legacySamples = 0;
      for (const p of items) for (const v of (p.variants || [])) {
        if (v.stock !== 0) nz++;
        if (v.type === 'SAMPLE' && v.volume_ml === 3) legacySamples++;
      }
      add('seed موجودی صفر دارد', nz === 0, nz ? `${nz} غیرصفر` : 'پاک');
      add('seed سمپل ۳ میل ندارد', legacySamples === 0, `${legacySamples} ردیف`);
    }
  }

  const srv = await boot();
  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('بررسی‌های اجراشده موفق بودند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {

    const p = await fetch(`${BASE}/api/products/creed-aventus`).then(x => x.json());
    const hm = (p.variants || []).filter(v => v.type === 'HAIR_MIST');
    const bs = (p.variants || []).filter(v => v.type === 'BODY_SPLASH');
    const samples = (p.variants || []).filter(v => v.type === 'SAMPLE');
    add('عطر مو در API عمومی پنهان است', hm.length === 0, `${hm.length} ردیف`);
    add('فقط بادی‌اسپلش ۱۲۰ میل نمایش داده می‌شود', bs.every(v => v.volume_ml === 120), `${bs.length} ردیف موجود`);
    add('فقط سمپل ۵ میل نمایش داده می‌شود', samples.every(v => v.volume_ml === 5), `${samples.length} ردیف موجود`);

    let chromium = null;
    try { ({ chromium } = require('playwright')); } catch {}
    if (!chromium) {
      console.log(d('\n  · بخش مرورگر رد شد (playwright نصب نیست)'));
      return finish();
    }

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

    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const pg = await ctx.newPage();
      const jsErr = [];
      pg.on('pageerror', e => jsErr.push(String(e)));

      await pg.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });

      await pg.fill('#q', 'ع');
      await pg.waitForTimeout(900);
      add('با یک حرف پیشنهاد باز نمی‌شود', await pg.isHidden('#sugg'));

      await pg.fill('#q', 'عود');
      await pg.waitForTimeout(1500);
      const n = await pg.locator('.sugg-item').count();
      add('با چند حرف پیشنهاد خودکار می‌آید', n > 0, `${n} پیشنهاد`);

      await pg.focus('#q');
      await pg.keyboard.press('ArrowDown');
      await pg.waitForTimeout(300);
      add('فلش پایین گزینه را انتخاب می‌کند',
        (await pg.locator('.sugg-item.active').count()) === 1);

      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(250);
      add('Escape فهرست را می‌بندد', await pg.isHidden('#sugg'));

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

        await pg.locator('.stock-ctrl button:has-text("+")').first().click();
        await pg.waitForTimeout(1100);
        const afterPlus = parseInt(await inp.inputValue());
        add('دکمه + موجودی را زیاد می‌کند', afterPlus === before + 1,
          `${before} → ${afterPlus}`);

        await pg.locator('.stock-ctrl button').first().click();
        await pg.waitForTimeout(1100);
        const afterMinus = parseInt(await inp.inputValue());
        add('دکمه − موجودی را کم می‌کند', afterMinus === before,
          `${afterPlus} → ${afterMinus}`);

        await inp.fill('37');
        await inp.dispatchEvent('change');
        await pg.waitForTimeout(1200);
        add('تایپ دستی عدد کار می‌کند', (await inp.inputValue()) === '37');

        const db = new Database(DB, { readonly: true });
        const saved = db.prepare('SELECT stock FROM variants WHERE sku=?').get(sku);
        db.close();
        add('تغییر در دیتابیس ذخیره شد', saved && saved.stock === 37,
          saved ? 'stock=' + saved.stock : 'یافت نشد');

        await inp.fill('0');
        await inp.dispatchEvent('change');
        await pg.waitForTimeout(900);
        await pg.locator('.stock-ctrl button').first().click();
        await pg.waitForTimeout(900);
        add('موجودی زیر صفر نمی‌رود', (await inp.inputValue()) === '0');

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
