'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4488;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join('/tmp', `yazd-seo-test-${process.pid}.db`);
const SITE = 'https://yazdperfume.ir';

const AI_AGENTS = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Applebot-Extended'];

async function get(pathname, accept) {
  const res = await fetch(BASE + pathname, accept ? { headers: { Accept: accept } } : undefined);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}

(async () => {
  const child = require('child_process').spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB, SITE_URL: SITE },
    stdio: 'ignore'
  });

  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(BASE + '/api/health');
        if (res.ok) { up = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    assert(up, 'سرور آزمون بالا نیامد');

    const robots = await get('/robots.txt');
    assert.equal(robots.status, 200);
    assert(robots.type.includes('text/plain'), 'نوع robots.txt درست نیست');
    for (const agent of AI_AGENTS) {
      assert(new RegExp(`User-agent: ${agent}`, 'i').test(robots.body), `خزنده ${agent} در robots نیست`);
    }
    for (const closed of ['/admin', '/api/', '/checkout', '/account', '/payment/']) {
      assert(robots.body.includes(`Disallow: ${closed}`), `مسیر خصوصی ${closed} بسته نشده`);
    }
    assert(robots.body.includes(`${SITE}/sitemap.xml`), 'robots نشانی نقشه سایت ندارد');

    const index = await get('/sitemap.xml');
    assert.equal(index.status, 200);
    assert(index.type.includes('xml'), 'نوع نقشه سایت درست نیست');
    assert(index.body.includes('sitemapindex'), 'نقشه سایت فهرست نیست');
    const maps = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert(maps.length >= 3, 'نقشه‌های زیرمجموعه کم‌اند');

    const pages = await get('/sitemap-pages.xml');
    assert.equal(pages.status, 200);
    for (const required of ['/', '/samples', '/journal', '/essences', '/brands', '/why-us', '/terms', '/privacy']) {
      assert(pages.body.includes(`${SITE}${required}<`), `صفحه ${required} در نقشه نیست`);
    }
    assert(!pages.body.includes('/admin'), 'پنل نباید در نقشه باشد');
    assert(!pages.body.includes('/account'), 'حساب نباید در نقشه باشد');

    const products = await get('/sitemap-products.xml');
    assert.equal(products.status, 200);
    const productUrls = [...products.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert(productUrls.length > 50, `محصول‌های نقشه کم‌اند: ${productUrls.length}`);
    assert(productUrls.every(u => u.startsWith(`${SITE}/perfume/`)), 'نشانی غیر محصول در نقشه محصول‌ها');

    const articles = await get('/sitemap-articles.xml');
    assert.equal(articles.status, 200);
    assert([...articles.body.matchAll(/<loc>([^<]+)<\/loc>/g)].length >= 3, 'مقاله‌های نقشه کم‌اند');

    const llms = await get('/llms.txt');
    assert.equal(llms.status, 200);
    assert(llms.type.includes('text/plain'), 'نوع llms.txt درست نیست');
    assert(llms.body.startsWith('# '), 'llms.txt با عنوان شروع نمی‌شود');
    for (const fact of ['اورجینال برند اصلی نیستند', 'تأیید نشده', 'متانول', 'سمپل ۵ میلی‌لیتر',
                        '۱۰۰٬۰۰۰', '۲٬۰۰۰٬۰۰۰', '۷۲ ساعت']) {
      assert(llms.body.includes(fact), `واقعیت «${fact}» در llms.txt نیست`);
    }
    assert(llms.body.includes('چه چیزی را نقل نکنید'), 'مرز ادعا در llms.txt نیست');
    assert(/\[.+?\]\(https:\/\/yazdperfume\.ir\/samples\)/.test(llms.body), 'لینک صفحه‌ها در llms.txt نیست');

    const feed = await get('/feed.xml');
    assert.equal(feed.status, 200);
    assert(feed.type.includes('rss'), 'نوع فید درست نیست');
    assert(feed.body.includes('<rss version="2.0">'), 'فید RSS معتبر نیست');
    assert((feed.body.match(/<item>/g) || []).length >= 3, 'فید آیتم کافی ندارد');

    const home = await get('/', 'text/html');
    assert(home.status, 200);
    assert(home.body.includes('application/ld+json'), 'صفحه اصلی داده ساختاریافته ندارد');
    assert(home.body.includes('"@type":"OnlineStore"') || home.body.includes('"@type": "OnlineStore"'),
      'schema نوع OnlineStore نیست');
    assert(home.body.includes('disambiguatingDescription'), 'مرز ادعا در schema نیست');
    assert(home.body.includes('areaServed'), 'محدوده خدمات در schema نیست');

    const key = fs.readFileSync(path.join(ROOT, 'seed', 'indexnow_key.txt'), 'utf8').trim();
    assert(/^[a-f0-9]{32}$/.test(key), 'کلید IndexNow معتبر نیست');
    const keyFile = path.join(ROOT, 'public', `${key}.txt`);
    assert(fs.existsSync(keyFile), 'فایل کلید IndexNow در public نیست');
    assert.equal(fs.readFileSync(keyFile, 'utf8').trim(), key, 'محتوای فایل کلید مطابق نیست');
    const served = await get(`/${key}.txt`);
    assert.equal(served.status, 200, 'فایل کلید از سرور سرو نمی‌شود');
    const tool = fs.readFileSync(path.join(ROOT, 'scripts', 'submit_indexnow.js'), 'utf8');
    assert(tool.includes('api.indexnow.org'), 'ابزار ارسال به IndexNow وصل نیست');

    assert(pages.body.includes(SITE), 'نقشه با SITE_URL ساخته نشده');

    console.log('PASS: robots (AI crawlers) · sitemap index + 3 maps · llms.txt · RSS · OnlineStore schema · IndexNow key');
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(DB, { force: true });
    fs.rmSync(DB + '-wal', { force: true });
    fs.rmSync(DB + '-shm', { force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
