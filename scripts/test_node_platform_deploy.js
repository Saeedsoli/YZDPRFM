#!/usr/bin/env node
/**
 * آزمون استقرار روی «پلتفرم Node» لیارا — نه Docker.
 *
 * چرا این آزمون جدا لازم است:
 *   `liara.json` می‌گوید `"platform": "node"`. در این حالت لیارا
 *   Dockerfile را **نمی‌خواند** — package.json را می‌خواند و
 *   `npm start` را اجرا می‌کند. یعنی:
 *     • ENV های داخل Dockerfile (از جمله DB_PATH) اعمال نمی‌شوند
 *     • هیچ `COPY` انتخابی‌ای در کار نیست؛ کل پوشه آپلود می‌شود
 *       مگر آنکه `.dockerignore` جلویش را بگیرد
 *
 *   آزمون `test_cold_deploy.js` فقط سناریوی Docker را می‌سنجد.
 *   این آزمون سناریویی را می‌سنجد که واقعاً اتفاق می‌افتد.
 *
 * اجرا: node scripts/test_node_platform_deploy.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.dirname(__dirname);
const STAGE = path.join('/tmp', 'yazd-node-deploy-test');
const PORT = 4438;
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

/** الگوهای .dockerignore را می‌خواند */
function ignorePatterns() {
  const f = path.join(ROOT, '.dockerignore');
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('!'));
}

function isIgnored(rel, patterns) {
  const first = rel.split('/')[0];
  return patterns.some(p => {
    const pp = p.replace(/\/$/, '');
    if (rel === pp || first === pp) return true;
    if (rel.startsWith(pp + '/')) return true;
    // الگوی ساده با *
    if (pp.includes('*')) {
      const re = new RegExp('^' + pp.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return re.test(rel) || re.test(first);
    }
    return false;
  });
}

/** پوشه را با احترام به .dockerignore کپی می‌کند */
function copyRespectingIgnore(src, dst, patterns, base = src) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const rel = path.relative(base, s);
    if (['node_modules', '.git', '.cache', '.npm'].includes(e.name)) continue;
    if (isIgnored(rel, patterns)) continue;
    const t = path.join(dst, e.name);
    if (e.isDirectory()) copyRespectingIgnore(s, t, patterns, base);
    else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

(async () => {
  console.log('\n  آزمون استقرار روی پلتفرم Node لیارا\n');

  // ── ۱) پیش‌شرط‌های پیکربندی ──
  const patterns = ignorePatterns();
  add('فایل .dockerignore وجود دارد', patterns !== null,
    patterns ? patterns.length + ' الگو' : 'بدون آن دیتابیس محلی آپلود می‌شود');
  if (!patterns) {
    console.log(`\n  ${r('بدون .dockerignore ادامه بی‌معناست.')}\n`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  add('package.json اسکریپت start دارد', !!pkg.scripts?.start, pkg.scripts?.start);
  add('نسخه Node در engines قید شده', !!pkg.engines?.node, pkg.engines?.node);

  /* ── هم‌راستایی نسخه بین سه فایل ──
     پیش از این بررسی، پروژه در وضعیت زیر بود:
       engines: ">=20" · Dockerfile: node:20 · liara.json: هیچ
     یعنی کد روی ۲۰ آزموده می‌شد ولی لیارا با پیش‌فرض خودش (۲۲)
     اجرایش می‌کرد. ناسازگاری خاموشی که هیچ آزمونی نمی‌گرفت.

     Node 20 از مارس ۲۰۲۶ EOL است و وصله امنیتی نمی‌گیرد. */
  const TARGET = 22;
  {
    const eng = pkg.engines?.node || '';
    add(`engines به Node ${TARGET} اشاره می‌کند`,
      eng.includes(String(TARGET)), eng);
    /* بازه باید سقف داشته باشد؛ `>=22` تنها یعنی نسخه Current
       (که LTS نیست) هم پذیرفته می‌شود. */
    add('engines سقف نسخه دارد (نسخه Current نگذرد)',
      /<\s*\d+/.test(eng), eng);
  }

  const liara = JSON.parse(fs.readFileSync(path.join(ROOT, 'liara.json'), 'utf8'));
  add('liara.json دیسک پایدار روی /app/data دارد',
    (liara.disks || []).some(x => x.mountTo === '/app/data'),
    JSON.stringify(liara.disks));
  add('پورت liara.json با کد یکی است', liara.port === 3000);

  /* اتکا به «پیش‌فرض لیارا» شکننده است: روزی که پیش‌فرض را عوض
     کنند، سایت بدون هیچ هشداری روی نسخه دیگری اجرا می‌شود. */
  add('liara.json نسخه Node را صریح تعیین کرده',
    !!liara.node?.version, liara.node?.version || 'تعریف نشده');
  add(`liara.json روی Node ${TARGET} است`,
    parseInt(liara.node?.version) === TARGET, liara.node?.version);

  {
    /* لیارا حداکثر Node 22 ارائه می‌دهد (بررسی‌شده: مرداد ۱۴۰۵).
       اگر روزی نسخه بالاتری بنویسیم، استقرار شکست می‌خورد. */
    const LIARA_MAX = 22;
    add('نسخه انتخابی در دسترس لیارا هست',
      parseInt(liara.node?.version || 0) <= LIARA_MAX,
      `سقف لیارا: ${LIARA_MAX}`);
  }

  {
    const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const m = df.match(/^FROM\s+node:(\d+)/mi);
    /* Dockerfile با platform=node خوانده نمی‌شود، ولی نباید عدد
       غلط داشته باشد — سندی که دروغ بگوید بدتر از نبودنش است. */
    add('Dockerfile هم همان نسخه را دارد',
      m && parseInt(m[1]) === TARGET, m ? 'node:' + m[1] : 'یافت نشد');
  }

  // ── ۲) بسته استقرار ──
  fs.rmSync(STAGE, { recursive: true, force: true });
  copyRespectingIgnore(ROOT, STAGE, patterns);

  const staged = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else staged.push(path.relative(STAGE, p));
    }
  })(STAGE);

  add('دیتابیس محلی در بسته نیست',
    !staged.some(f => f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm')),
    staged.filter(f => f.includes('.db')).join('، ') || 'پاک');

  add('فایل‌های JSON بازمانده در بسته نیستند',
    !staged.some(f => /orders_db\.json|tickets_db\.json|admin_config\.json/.test(f)));

  add('پیش‌نمایش طراحی در بسته نیست',
    !staged.some(f => f.startsWith('design-preview')));

  for (const need of ['package.json', 'src/server.js', 'src/retire-sample3-cli.js', 'seed/perfumes_catalogue_seed.json',
                      'seed/articles_db.json', 'public/index.html', 'public/assets/app.js']) {
    add(`${need} در بسته هست`, staged.includes(need));
  }

  const imgCount = staged.filter(f => f.startsWith('public/images/products/')).length;
  add('تصاویر محصول در بسته هستند', imgCount > 100, imgCount + ' فایل');

  const fontCount = staged.filter(f => f.includes('fonts/')).length;
  add('فونت وزیرمتن در بسته هست', fontCount > 0, fontCount + ' فایل');

  // ── ۳) اجرای واقعی از بسته ──
  // node_modules را از پروژه اصلی قرض می‌گیریم (لیارا خودش npm install می‌زند)
  const nm = path.join(ROOT, 'node_modules');
  if (fs.existsSync(nm)) {
    try { fs.symlinkSync(nm, path.join(STAGE, 'node_modules'), 'dir'); } catch {}
  }

  const dbPath = path.join(STAGE, 'data', 'yazd.db');
  add('پوشه data در بسته خالی است (مثل سرور تازه)', !fs.existsSync(dbPath));

  const proc = spawn('npm', ['start'], {
    cwd: STAGE,
    env: { ...process.env, PORT: String(PORT), BACKUP_DISABLED: '1', DB_PATH: dbPath },
    stdio: 'ignore', detached: process.platform !== 'win32'
  });
  // npm spawns a shell and node child; terminate the whole test process group.
  const stopServer = () => {
    try { if (process.platform !== 'win32') process.kill(-proc.pid, 'SIGTERM'); else proc.kill('SIGTERM'); } catch {}
  };
  process.once('exit', stopServer);

  let up = false;
  for (let i = 0; i < 120; i++) {
    if (proc.exitCode !== null) break;
    try { if (fs.existsSync(dbPath) && (await fetch(`${BASE}/api/health`)).ok) { up = true; break; } } catch {}
    await sleep(500);
  }
  add('سرور با `npm start` بالا آمد (همان دستور لیارا)', up);

  if (up) {
    const j = async p => {
      const res = await fetch(BASE + p);
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const prods = await j('/api/products?limit=1');
    const total = prods.body.total ?? prods.body.count ?? 0;
    add('کاتالوگ از seed پر شد', total > 2000, total + ' محصول');

    const arts = await j('/api/articles');
    const na = (arts.body.articles || arts.body || []).length;
    add('مقالات از seed پر شدند', na >= 5, na + ' مقاله');

    /* `/api/brands` فقط برندهای دارای محصول قابل سفارش را
       می‌دهد. روی دیتابیس تازه همه UNAVAILABLE‌اند، پس فهرست
       عمداً خالی است. تنوع کاتالوگ را از خود دیتابیس می‌پرسیم. */
    const brands = await j('/api/brands');
    const nb = (brands.body.brands || brands.body || []).length;
    const coldDb = new (require('better-sqlite3'))(dbPath, { readonly: true });
    const brandsInDb = coldDb.prepare(
      'SELECT COUNT(DISTINCT brand_fa) c FROM products WHERE brand_fa IS NOT NULL').get().c;
    const orderableBrands = coldDb.prepare(
      "SELECT COUNT(DISTINCT brand_fa) c FROM products WHERE supply_mode != 'UNAVAILABLE'").get().c;
    coldDb.close();

    add('کاتالوگ تنوع برند دارد', brandsInDb > 100, brandsInDb + ' برند');
    add('API فقط برندهای قابل سفارش را می‌دهد', nb === orderableBrands,
        `${nb} = ${orderableBrands}`);

    const home = await fetch(BASE + '/');
    add('صفحه اصلی ۲۰۰ می‌دهد', home.status === 200);

    const sm = await fetch(BASE + '/sitemap.xml');
    const smTxt = await sm.text();
    add('sitemap ساخته شد', sm.status === 200 && smTxt.includes('<urlset'),
      (smTxt.match(/<loc>/g) || []).length + ' نشانی');

    // مهم‌ترین: دیتابیس در مسیر دیسک ساخته شد نه جای دیگر
    add('دیتابیس در مسیر DB_PATH ساخته شد', fs.existsSync(dbPath),
      fs.existsSync(dbPath) ? (fs.statSync(dbPath).size / 1048576).toFixed(1) + 'MB' : 'نساخت');

    // فروشگاه تازه نباید سفارش داشته باشد
    const Database = require('better-sqlite3');
    const fresh = new Database(dbPath, { readonly: true });
    const nOrders = fresh.prepare('SELECT COUNT(*) c FROM orders').get().c;
    const nStaff = fresh.prepare('SELECT COUNT(*) c FROM staff').get().c;
    const legacySamples = fresh.prepare("SELECT COUNT(*) c FROM variants WHERE type='SAMPLE' AND volume_ml=3").get().c;
    const identitySources = fresh.prepare("SELECT COUNT(*) c FROM official_identity_evidence WHERE status='official_original_found_supplier_essence_unverified'").get().c;
    const referencePrices = fresh.prepare('SELECT COUNT(*) c FROM products WHERE essence_usd_per_kg IS NOT NULL').get().c;
    const secondarySources = fresh.prepare("SELECT COUNT(*) c FROM secondary_reference_evidence WHERE status='secondary_original_found_supplier_essence_unverified' AND provider='Fragrantica'").get().c;
    const refManifest = ['lv_reference_prices_v1.json','official_reference_prices_v1.json','official_reference_prices_v2.json','official_reference_prices_v3.json','official_reference_prices_v4.json','official_reference_prices_v5.json','official_reference_prices_v6.json','official_reference_prices_v7.json','official_reference_prices_v8.json','official_reference_prices_v9.json','official_reference_prices_v10.json','official_reference_prices_v11.json','official_reference_prices_v12.json','official_reference_prices_v13.json','official_reference_prices_v14.json','official_reference_prices_v15.json','official_reference_prices_v16.json','official_reference_prices_v17.json','official_reference_prices_v18.json','official_reference_prices_v19.json','official_reference_prices_v20.json','official_reference_prices_v21.json','official_reference_prices_v22.json','official_reference_prices_v23.json','official_reference_prices_v24.json','official_reference_prices_v25.json','official_reference_prices_v26.json','official_reference_prices_v27.json','official_reference_prices_v28.json','official_reference_prices_v29.json'];
    const officialPrices = refManifest.reduce((n,f) => n + JSON.parse(fs.readFileSync(path.join(STAGE,'seed',f),'utf8')).items.length,0);
    const expectedSecondary = ['secondary_reference_prices_v1.json','secondary_reference_prices_v2.json','secondary_reference_prices_v3.json','secondary_reference_prices_v4.json','secondary_reference_prices_v5.json','secondary_reference_prices_v6.json','secondary_reference_prices_v7.json','secondary_reference_prices_v8.json','secondary_reference_prices_v9.json','secondary_reference_prices_v10.json','secondary_reference_prices_v11.json','secondary_reference_prices_v12.json'].reduce((n,f) => n + JSON.parse(fs.readFileSync(path.join(STAGE,'seed',f),'utf8')).items.length,0);
    const expectedPrices = officialPrices + expectedSecondary;
    fresh.close();
    add('قیمت‌های مرجع موقت در نصب تازه بازسازی می‌شوند', referencePrices === expectedPrices, `${referencePrices}/${expectedPrices}`);
    add('منابع مستقل جدا از منابع رسمی بارگذاری شدند', secondarySources === expectedSecondary, `${secondarySources}/${expectedSecondary}`);
    add('سمپل ۳ میل در نصب تازه نیست', legacySamples === 0, legacySamples + ' واریانت');
    const expectedIdentities = ['official_identity_evidence_v1.json','official_identity_evidence_v2.json','official_identity_evidence_v3.json','official_identity_evidence_v4.json','official_identity_evidence_v5.json','official_identity_evidence_v6.json','official_identity_evidence_v7.json','official_identity_evidence_v8.json','official_identity_evidence_v9.json','official_identity_evidence_v10.json','official_identity_evidence_v11.json','official_identity_evidence_v12.json','official_identity_evidence_v13.json','official_identity_evidence_v14.json','official_identity_evidence_v15.json','official_identity_evidence_v16.json','official_identity_evidence_v17.json','official_identity_evidence_v18.json','official_identity_evidence_v19.json','official_identity_evidence_v20.json','official_identity_evidence_v21.json','official_identity_evidence_v22.json','official_identity_evidence_v23.json','official_identity_evidence_v24.json','official_identity_evidence_v25.json','official_identity_evidence_v26.json','official_identity_evidence_v27.json','official_identity_evidence_v28.json','official_identity_evidence_v29.json','official_identity_evidence_v30.json','official_identity_evidence_v31.json','official_identity_evidence_v32.json','official_identity_evidence_v33.json','official_identity_evidence_v34.json','official_identity_evidence_v35.json','official_identity_evidence_v36.json'].reduce((n,f) => n + JSON.parse(fs.readFileSync(path.join(STAGE,'seed',f),'utf8')).items.length,0);
    add('مدارک هویت رایحه مرجع بارگذاری شدند', identitySources === expectedIdentities, `${identitySources}/${expectedIdentities}`);
    add('فروشگاه تازه صفر سفارش دارد', nOrders === 0, nOrders + ' سفارش');
    add('فقط حساب مدیر اولیه ساخته شد', nStaff === 1, nStaff + ' کارمند');
  }

  stopServer();
  process.removeListener('exit', stopServer);
  await sleep(200);
  fs.rmSync(STAGE, { recursive: true, force: true });

  const pass = checks.filter(Boolean).length;
  const fail = checks.length - pass;
  console.log(fail
    ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
    : `\n  ${g('استقرار روی پلتفرم Node سالم است.')}  ${pass}/${checks.length}\n`);
  process.exit(fail ? 1 : 0);
})();
