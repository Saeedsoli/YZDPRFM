#!/usr/bin/env node
/**
 * آزمون استقرار از صفر — شبیه‌سازی دقیق رفتار Liara.
 *
 * چرا این آزمون هست:
 *   Liara یک Disk پایدار روی `/app/data` سوار می‌کند. هر فایلی که
 *   هنگام build داخل آن پوشه کپی شده باشد، پس از mount شدن دیسک
 *   دیده نمی‌شود — دیسک خالی روی آن می‌نشیند.
 *
 *   وقتی فایل seed داخل `data/` بود، نخستین استقرار با پیام
 *   «فایل seed یافت نشد» بالا می‌آمد و فروشگاه با صفر محصول و صفر
 *   مقاله شروع می‌کرد. روی لپ‌تاپ هیچ‌وقت دیده نمی‌شد چون آنجا
 *   دیسکی سوار نمی‌شود.
 *
 * این آزمون همان وضعیت را می‌سازد: فقط چیزهایی که Dockerfile کپی
 * می‌کند، به‌علاوه یک `data/` خالی.
 *
 * اجرا: node scripts/test_cold_deploy.js
 */
'use strict';

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.dirname(__dirname);
const PORT = 4419;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

/** پوشه‌هایی که Dockerfile به تصویر کپی می‌کند */
function dockerCopiedDirs() {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf-8');
  return df.split('\n')
    .map(l => l.trim())
    .filter(l => /^COPY\s+/i.test(l) && !l.includes('package'))
    .map(l => l.split(/\s+/)[1])
    .filter(x => x && x !== '.');
}

(async () => {
  console.log('\n  آزمون استقرار از صفر (شبیه‌سازی Liara)\n');

  const checks = [];
  const add = (label, pass, note) => {
    console.log(`  ${pass ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
    checks.push(pass);
  };

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'yazd-cold-'));
  let proc = null;

  const finish = () => {
    try { if (proc) proc.kill('SIGKILL'); } catch {}
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    const failed = checks.filter(x => !x).length;
    console.log();
    console.log(failed === 0
      ? g('  استقرار از صفر سالم است.\n')
      : r(`  ${failed} بررسی ناموفق — استقرار روی Liara خراب می‌شود.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  try {
    // ── فقط چیزهایی که Dockerfile کپی می‌کند ──
    const copied = dockerCopiedDirs();
    console.log(d(`  Dockerfile کپی می‌کند: ${copied.join('، ')}`));

    add('Dockerfile پوشه seed را کپی می‌کند', copied.includes('seed'));
    add('Dockerfile پوشه data را کپی نمی‌کند', !copied.includes('data'),
        copied.includes('data') ? 'دیسک Liara آن را می‌پوشاند' : '');

    for (const dir of copied) {
      const src = path.join(ROOT, dir);
      if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(stage, dir), { recursive: true });
      }
    }
    fs.copyFileSync(path.join(ROOT, 'package.json'),
                    path.join(stage, 'package.json'));
    fs.symlinkSync(path.join(ROOT, 'node_modules'),
                   path.join(stage, 'node_modules'));

    // ── دیسک پایدار خالی روی data/ ──
    fs.mkdirSync(path.join(stage, 'data'));
    add('دیتابیسی از قبل وجود ندارد',
        !fs.existsSync(path.join(stage, 'data', 'yazd.db')));

    // ── بالا آوردن ──
    console.log(d('\n  بالا آوردن سرور روی دیسک خالی'));
    const t0 = Date.now();
    proc = spawn('node', ['src/server.js'], {
      cwd: stage,
      env: { ...process.env, ADMIN_USERNAME: 'owner', ADMIN_PASSWORD: 'yazd1404', BACKUP_DISABLED: '1', PORT: String(PORT),
             DB_PATH: path.join(stage, 'data', 'yazd.db') },
      stdio: 'ignore'
    });

    let up = false;
    for (let i = 0; i < 90; i++) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) { up = true; break; } } catch {}
      await sleep(500);
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    add('سرور بالا آمد', up, `${secs} ثانیه`);
    if (!up) return finish();

    // ── محتوا واقعاً پر شده؟ ──
    console.log(d('\n  محتوای فروشگاه پس از نخستین اجرا'));

    const prods = await fetch(`${BASE}/api/products?limit=1`).then(r => r.json());
    /* آستانه به‌جای عدد دقیق: این آزمون «استقرار سرد» را می‌سنجد
       — یعنی آیا seed روی دیتابیس خالی کار کرد؟ عدد دقیق کاتالوگ
       ربطی به آن ندارد و با هر تعویض منبع داده می‌شکند. */
    add('کاتالوگ پر شده است', prods.total >= 2000, `${prods.total} محصول`);

    const arts = await fetch(`${BASE}/api/articles`).then(r => r.json());
    add('مقالات منتقل شده‌اند', (arts.total || 0) >= 5, `${arts.total} مقاله`);

    /* عمق محتوا هم باید منتقل شود. اگر مقالات در دیتابیس زنده
       بلند شوند ولی seed عقب بماند، نخستین استقرار نسخه کوتاه
       را می‌سازد و سئو ضربه می‌خورد. */
    const full = await fetch(`${BASE}/api/articles/handmade-transparency`)
      .then(r => r.json()).catch(() => null);
    const words = full && full.content
      ? full.content.trim().split(/\s+/).filter(Boolean).length : 0;
    add('مقالات محتوای کامل دارند', words >= 300, `${words} واژه`);

    /* ── چرا شمار برند از دیتابیس گرفته می‌شود، نه از API ──
       `/api/brands` عمداً فقط برندهایی را برمی‌گرداند که محصول
       قابل سفارش دارند. روی دیتابیس تازهٔ استقرار، پیش‌فرض همه
       UNAVAILABLE است، پس این فهرست درست و انتظارآمیز خالی
       است — نه خرابی.

       چیزی که واقعاً باید بسنجیم این است که کاتالوگ با تنوع
       برند پر شده باشد. آن را از خود دیتابیس می‌پرسیم. */
    const cold = new (require('better-sqlite3'))(
      path.join(stage, 'data', 'yazd.db'), { readonly: true });
    const brandsInDb = cold.prepare(
      'SELECT COUNT(DISTINCT brand_fa) c FROM products WHERE brand_fa IS NOT NULL').get().c;
    const orderable = cold.prepare(
      "SELECT COUNT(DISTINCT brand_fa) c FROM products WHERE supply_mode != 'UNAVAILABLE'").get().c;
    const obsoleteSamples = cold.prepare("SELECT COUNT(*) n FROM variants WHERE type='SAMPLE' AND volume_ml=3").get().n;
    const identitySources = cold.prepare("SELECT COUNT(*) n FROM official_identity_evidence WHERE status='official_original_found_supplier_essence_unverified'").get().n;
    const referencePrices = cold.prepare('SELECT COUNT(*) n FROM products WHERE essence_usd_per_kg IS NOT NULL').get().n;
    const secondarySources = cold.prepare("SELECT COUNT(*) n FROM secondary_reference_evidence WHERE status='secondary_original_found_supplier_essence_unverified' AND provider='Fragrantica'").get().n;
    const refManifest = ['lv_reference_prices_v1.json','official_reference_prices_v1.json','official_reference_prices_v2.json','official_reference_prices_v3.json','official_reference_prices_v4.json','official_reference_prices_v5.json','official_reference_prices_v6.json','official_reference_prices_v7.json','official_reference_prices_v8.json','official_reference_prices_v9.json','official_reference_prices_v10.json','official_reference_prices_v11.json','official_reference_prices_v12.json','official_reference_prices_v13.json','official_reference_prices_v14.json','official_reference_prices_v15.json','official_reference_prices_v16.json','official_reference_prices_v17.json','official_reference_prices_v18.json','official_reference_prices_v19.json','official_reference_prices_v20.json','official_reference_prices_v21.json','official_reference_prices_v22.json','official_reference_prices_v23.json'];
    const officialPrices = refManifest.reduce((n,f) => n + JSON.parse(fs.readFileSync(path.join(stage,'seed',f),'utf8')).items.length,0);
    const expectedSecondary = ['secondary_reference_prices_v1.json','secondary_reference_prices_v2.json','secondary_reference_prices_v3.json','secondary_reference_prices_v4.json','secondary_reference_prices_v5.json','secondary_reference_prices_v6.json','secondary_reference_prices_v7.json'].reduce((n,f) => n + JSON.parse(fs.readFileSync(path.join(stage,'seed',f),'utf8')).items.length,0);
    const expectedPrices = officialPrices + expectedSecondary;
    cold.close();
    add('قیمت‌های مرجع موقت در نصب تازه بازسازی می‌شوند', referencePrices === expectedPrices, `${referencePrices}/${expectedPrices}`);
    add('منابع مستقل جدا از منابع رسمی بارگذاری شدند', secondarySources === expectedSecondary, `${secondarySources}/${expectedSecondary}`);
    add('سمپل ۳ میل در دیتابیس تازه ایجاد نمی‌شود', obsoleteSamples === 0, `${obsoleteSamples} ردیف`);
    const expectedIdentities = ['official_identity_evidence_v1.json','official_identity_evidence_v2.json','official_identity_evidence_v3.json','official_identity_evidence_v4.json','official_identity_evidence_v5.json','official_identity_evidence_v6.json','official_identity_evidence_v7.json','official_identity_evidence_v8.json','official_identity_evidence_v9.json','official_identity_evidence_v10.json','official_identity_evidence_v11.json','official_identity_evidence_v12.json','official_identity_evidence_v13.json','official_identity_evidence_v14.json','official_identity_evidence_v15.json','official_identity_evidence_v16.json','official_identity_evidence_v17.json','official_identity_evidence_v18.json','official_identity_evidence_v19.json','official_identity_evidence_v20.json','official_identity_evidence_v21.json','official_identity_evidence_v22.json'].reduce((n,f) => n + JSON.parse(fs.readFileSync(path.join(stage,'seed',f),'utf8')).items.length,0);
    add('منابع رسمی مرجع با برچسب عدم تأیید اسانس بارگذاری می‌شوند', identitySources === expectedIdentities, `${identitySources}/${expectedIdentities}`);

    add('کاتالوگ تنوع برند دارد', brandsInDb >= 100, `${brandsInDb} برند در دیتابیس`);

    const brands = await fetch(`${BASE}/api/brands`).then(r => r.json());
    add('API فقط برندهای قابل سفارش را می‌دهد',
        (brands.brands || []).length === orderable,
        `${(brands.brands || []).length} = ${orderable}`);

    // The first row can legitimately be a newly sourced draft with no prices.
    const one = await fetch(`${BASE}/api/products/creed-jasmal`).then(r => r.json());
    const v = one.variants || [];
    add('متغیرها و قیمت‌ها ساخته شده‌اند', v.length > 0 && v[0].price_toman > 0,
        `${v.length} متغیر`);

    // ── صفحه اصلی واقعاً محصول نشان می‌دهد؟ ──
    const home = await fetch(`${BASE}/`).then(r => r.text());
    add('صفحه اصلی بالا می‌آید', home.includes('عطر یزد'));

    const pdp = await fetch(`${BASE}/perfume/${one.slug}`)
      .then(r => r.status);
    add('صفحه محصول باز می‌شود', pdp === 200, `کد ${pdp}`);

    /* ── نگارش فارسی نام برندها ──
       اصلاح‌های نگارشی روی دیتابیس زنده اعمال می‌شوند، ولی اگر
       فایل seed به‌روز نشود، نخستین استقرار واقعی دوباره املای
       غلط می‌سازد — همان جایی که کمترین فرصت اصلاح هست. */
    console.log(d('\n  نگارش فارسی برندها در seed'));

    const brandList = await fetch(`${BASE}/api/brands`).then(r => r.json());
    const byEn = Object.fromEntries(
      (brandList.brands || []).map(b => [b.brand_en, b.brand_fa]));

    const expect = { Amouage: 'آمواج', Creed: 'کرید', Nishane: 'نیشان' };
    const wrongBrand = Object.entries(expect)
      .filter(([en, fa]) => byEn[en] && byEn[en] !== fa)
      .map(([en, fa]) => `${en}: «${byEn[en]}» به‌جای «${fa}»`);
    add('نگارش برندها درست است', wrongBrand.length === 0,
        wrongBrand[0] || `${Object.keys(expect).length} برند`);

    /* نام‌هایی که برند جزء لاینفکشان است — تکرار زائد نیستند.
       «دیور هوم» (Dior Homme)، «بلو د شنل»، «میس دیور» نام رسمی و
       جهانی‌اند و حذف برند نابودشان می‌کند.
       همان منطق test_brand_names.js — اگر این دو ناهماهنگ شوند،
       یکی همیشه قرمز می‌ماند. */
    const CONNECTORS = ['د', 'دو', 'آو', 'او', 'له', 'لا', 'میس', 'مای',
                        'مستر', 'مون', 'لو', 'بلو', 'تق', 'پاشا', 'هوم',
                        'ویاژ', 'لنستان'];
    const sample = await fetch(`${BASE}/api/products?limit=60`).then(r => r.json());
    const dupName = (sample.products || []).filter(p => {
      if (!p.brand_fa || !p.name_fa || !p.name_fa.includes(p.brand_fa)) return false;
      if (/\([^)]*\)/.test(p.name_fa)) return false;      // پرانتز توضیحی بازار
      const rest = p.name_fa.split(p.brand_fa).join(' ').replace(/\s+/g, ' ').trim();
      if (rest.length < 3) return false;
      return !rest.split(/\s+/).some(w => CONNECTORS.includes(w));
    });
    add('نام محصول برند را بی‌جهت تکرار نمی‌کند', dupName.length === 0,
        dupName.length ? `${dupName[0].brand_fa} — ${dupName[0].name_fa}` : '');

    // ── حساب مدیر کل ساخته شد؟ ──
    console.log(d('\n  حساب مدیر و نقش‌ها'));
    const login = await fetch(`${BASE}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner',
        password: 'yazd1404'
      })
    }).then(r => r.json());
    add('مدیر کل می‌تواند وارد شود', !!login.token);
    add('نقش‌های پیش‌فرض ساخته شده‌اند',
        (login.user?.permissions || []).length >= 30,
        `${login.user?.permissions?.length} مجوز`);
    add('رمز اولیه باید عوض شود', login.user?.must_change === true);

    /* ── sitemap با محتوای واقعی ──
       آستانه پیشین `> 100` بود چون آن زمان همه محصولات در
       sitemap می‌آمدند. حالا فقط محصولات قابل سفارش معرفی
       می‌شوند و روی دیتابیس تازهٔ استقرار، پیش‌فرض همه
       UNAVAILABLE است — یعنی sitemap عمداً فقط صفحات ثابت را
       دارد. این درست است، نه خرابی.

       چیزی که واقعاً باید بسنجیم: sitemap ساخته می‌شود، معتبر
       است، و صفحات کلیدی در آن هستند. */
    const sm = await fetch(`${BASE}/sitemap.xml`).then(r => r.text());
    const urls = (sm.match(/<loc>/g) || []).length;
    add('sitemap ساخته شد و معتبر است',
        urls > 0 && sm.includes('<urlset'), `${urls} نشانی`);
    add('صفحات کلیدی در sitemap هستند',
        ['/journal', '/samples', '/why-us', '/brands'].every(p => sm.includes(p)));

  } catch (e) {
    console.error(r('  خطای غیرمنتظره: ' + e.message));
    checks.push(false);
  }

  finish();
})();
