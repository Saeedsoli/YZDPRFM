#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4447;
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

function findChromium() {
  const base = path.join(process.env.HOME || '/home/user', '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter(x => x.startsWith('chromium')).sort();
  for (const dir of dirs.reverse()) {
    for (const c of ['chrome-headless-shell-linux64/chrome-headless-shell',
                     'chrome-linux/chrome']) {
      const f = path.join(base, dir, c);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

(async () => {
  console.log('\n  آزمون صفحات «چرا ما؟» و «سمپل»\n');

  const srv = await boot();
  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('هر دو صفحه سالم‌اند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {

    for (const [p, name] of [['/why-us', 'چرا ما؟'], ['/samples', 'سمپل']]) {
      const res = await fetch(BASE + p);
      add(`${name} با ۲۰۰ باز می‌شود`, res.status === 200, String(res.status));
    }

    {
      const html = await fetch(BASE + '/why-us').then(x => x.text());
      add('متانول توضیح داده شده', html.includes('متانول'));
      add('اتانول به‌عنوان جایگزین ایمن آمده', html.includes('اتانول'));
      add('مدرک مدرسه عطرسازی ذکر شده', html.includes('مدرسه عطرسازی ایران'));
      add('سابقه دوازده ساله ذکر شده', /۱۲\+|دوازده سال/.test(html));
      add('صریحاً می‌گوید اورجینال نیست',
        html.includes('اورجینال نیست') || html.includes('بازآفرینی'));
      add('بخش «آنچه ادعا نمی‌کنیم» هست', html.includes('ادعا نمی‌کنیم'));
      add('جدول مقایسه ضعف هم دارد', html.includes('class="no"'),
        'صداقت: ردیف قرمز');

      add('اعداد با bdi ایزوله شده‌اند', html.includes('<bdi>'),
        '۱۵+ نباید +۱۵ دیده شود');
    }

    {
      const html = await fetch(BASE + '/samples').then(x => x.text());
      add('راهنمای امتحان سمپل هست', html.includes('چطور سمپل را درست امتحان'));
      add('فیلتر خانواده از family_slug می‌خواند',
        html.includes('family_slug'),
        'نام فیلد API — یک بار اشتباه بود و فیلتر بی‌اثر شد');
      add('قیمت دستی نوشته نشده',
        html.includes('fromPrice') && html.includes('/api/products'),
        'از کاتالوگ خوانده می‌شود');
    }

    {
      const fam = await fetch(`${BASE}/api/families`).then(x => x.json());
      const list = fam.families || [];
      add('API خانواده‌ها پاسخ می‌دهد', list.length > 0, list.length + ' خانواده');
      add('فیلد family_slug موجود است',
        list.length > 0 && 'family_slug' in list[0],
        list[0] ? Object.keys(list[0]).join(', ') : '');

      if (list.length) {
        const all = await fetch(`${BASE}/api/products?limit=1`).then(x => x.json());
        const one = await fetch(
          `${BASE}/api/products?limit=1&family=${encodeURIComponent(list[0].family_slug)}`
        ).then(x => x.json());
        add('فیلتر خانواده نتیجه را محدود می‌کند',
          one.total > 0 && one.total < all.total,
          `${all.total} → ${one.total}`);
      }

      const w = await fetch(`${BASE}/api/products?limit=1&gender=WOMEN`).then(x => x.json());
      const a = await fetch(`${BASE}/api/products?limit=1`).then(x => x.json());
      add('فیلتر جنسیت کار می‌کند', w.total > 0 && w.total < a.total,
        `${a.total} → ${w.total}`);
    }

    {
      const home = await fetch(BASE + '/').then(x => x.text());
      add('صفحه اصلی به سمپل لینک دارد', home.includes('/samples'));
      add('صفحه اصلی به چرا-ما لینک دارد', home.includes('/why-us'));

      const appjs = await fetch(BASE + '/assets/app.js').then(x => x.text());
      add('منوی سراسری هر دو را دارد',
        appjs.includes('/samples') && appjs.includes('/why-us'));

      add('لینک قدیمیِ «‎?q=سمپل» حذف شده',
        !home.includes('q=%D8%B3%D9%85%D9%BE%D9%84'),
        'صفر نتیجه می‌داد');
    }

    {
      const ok = await fetch(`${BASE}/api/coupons/public?code=SAMPLE20`);
      add('مسیر کوپن عمومی پاسخ می‌دهد', ok.status === 200, String(ok.status));
      if (ok.status === 200) {
        const c = await ok.json();
        add('کوپن نوع و مقدار دارد', !!c.type && c.value != null,
          `${c.type} ${c.value}`);
        add('اطلاعات حساس برنمی‌گردد', !('used_count' in c) && !('active' in c),
          Object.keys(c).join(', '));
      }
      const bad = await fetch(`${BASE}/api/coupons/public?code=DOESNOTEXIST`);
      add('کد ناموجود ۴۰۴ می‌دهد', bad.status === 404, String(bad.status));

      const Database = require('better-sqlite3');
      const dbc = new Database(DB, { readonly: true });
      const rows = dbc.prepare(
        'SELECT code, expires_at FROM coupons WHERE expires_at IS NOT NULL').all();
      dbc.close();
      const invalid = rows.filter(x => {
        const dt = new Date(x.expires_at);
        return isNaN(dt) || dt.toISOString().slice(0, 10) !== x.expires_at;
      });
      add('تاریخ انقضای همه کوپن‌ها معتبر است', invalid.length === 0,
        invalid.map(x => x.code + '=' + x.expires_at).join('، ') || 'همه درست');
    }

    {

      const smIndex = await fetch(BASE + '/sitemap.xml').then(x => x.text());
      const sm = smIndex + '\n' + await fetch(BASE + '/sitemap-pages.xml').then(x => x.text());
      add('sitemap شامل /samples است', sm.includes('/samples'));
      add('sitemap شامل /why-us است', sm.includes('/why-us'));
    }

    let chromium = null;
    try { ({ chromium } = require('playwright')); } catch {}
    if (!chromium) {
      console.log(d('\n  · بخش مرورگر رد شد (playwright نصب نیست)'));
      return finish();
    }

    const exe = findChromium();
    const browser = await chromium.launch({
      ...(exe ? { executablePath: exe } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const jsErr = [];
    pg.on('pageerror', e => jsErr.push(String(e)));

    await pg.goto(`${BASE}/samples`, { waitUntil: 'networkidle', timeout: 60000 });
    await pg.waitForTimeout(2200);

    const cards = await pg.locator('.sc').count();
    add('کارت‌های سمپل رندر می‌شوند', cards > 0, cards + ' کارت');

    const chips = await pg.locator('#famRow .fchip2').count();
    add('چیپ خانواده ساخته می‌شود', chips > 1, chips + ' چیپ');

    const before = await pg.locator('#cnt').innerText();
    if (chips > 1) {
      await pg.locator('#famRow .fchip2').nth(1).click();
      await pg.waitForTimeout(1900);
      const after = await pg.locator('#cnt').innerText();
      add('کلیک روی خانواده نتیجه را عوض می‌کند', before !== after,
        `${before.trim().slice(0, 12)} → ${after.trim().slice(0, 12)}`);
    }

    await pg.locator('#genderRow .fchip2[data-g="WOMEN"]').click();
    await pg.waitForTimeout(1900);
    add('فیلتر جنسیت در مرورگر کار می‌کند',
      (await pg.locator('.sc').count()) > 0);

    for (const [p, name] of [['/samples', 'سمپل'], ['/why-us', 'چرا ما؟']]) {
      await pg.goto(BASE + p, { waitUntil: 'networkidle', timeout: 60000 });
      await pg.waitForTimeout(1300);
      const over = await pg.evaluate(
        'document.documentElement.scrollWidth - document.documentElement.clientWidth');
      add(`${name} سرریز افقی ندارد`, over <= 1, over + 'px');
    }

    add('هیچ خطای جاوااسکریپت نیست', jsErr.length === 0, jsErr[0]);

    await ctx.close();
    await browser.close();

  } catch (e) {
    add('اجرای آزمون بدون خطا', false, e.message);
  }

  finish();
})();
