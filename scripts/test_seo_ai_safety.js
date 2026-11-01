#!/usr/bin/env node
/**
 * آزمون ایمنی سئو در برابر سیاست «محتوای انبوه» گوگل
 * ═══════════════════════════════════════════════════
 *
 * چه چیزی را می‌سنجد
 * ──────────────────
 * گوگل «AI بودن» را تشخیص نمی‌دهد و جریمه نمی‌کند. چیزی که
 * می‌سنجد و جریمه می‌کند، الگوهای «صفحهٔ قالبی انبوه» است. این
 * آزمون همان الگوها را روی سایتِ در حال اجرا می‌گیرد:
 *
 *   ۱) توضیح و عنوان متا واقعاً بین صفحه‌ها فرق می‌کند؟
 *   ۲) داده ساختاریافته با آنچه روی صفحه است می‌خواند؟
 *   ۳) صفحه‌های بی‌ارزش از ایندکس بیرون‌اند؟
 *   ۴) اظهار شفافیت دست‌ساز برای خزنده دیده می‌شود؟
 *
 * سرور خودش را بالا می‌آورد و در پایان می‌کشد — مثل بقیه
 * آزمون‌های این پوشه. اگر به سرور بیرونی تکیه می‌کرد، داخل
 * `smoke_test.sh` که سرورش را جای دیگری مدیریت می‌کند
 * ECONNREFUSED می‌گرفت (یک بار همین اتفاق افتاد).
 *
 * اجرا:  node scripts/test_seo_ai_safety.js
 */

'use strict';
// This legacy fixture explicitly tests the pre-approval unavailable baseline.
process.env.APPROVED_MTO_AUTOSTART ??= '0';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { publicVariantSql } = require('../src/variant-visibility');

const ROOT = path.dirname(__dirname);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'yazd.db');

/* درگاه اختصاصی تا با سرور در حال اجرای توسعه تداخل نکند. */
const PORT = 4917;
const BASE = `http://127.0.0.1:${PORT}`;

const db = new Database(DB_PATH, { readonly: true });
/* اتصال نوشتنی جدا — آزمون باید وضعیت تأمین را موقتاً عوض کند.
   خواندن و نوشتن جدا نگه داشته می‌شود تا اشتباهاً چیزی جز همین
   تغییر کنترل‌شده نوشته نشود. */
const dbw = new Database(DB_PATH);
const sleep = ms => new Promise(res => setTimeout(res, ms));

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH },
    stdio: 'ignore'
  });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch { /* هنوز بالا نیامده */ }
    await sleep(400);
  }
  return proc;
}

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const b = s => `\x1b[1m${s}\x1b[0m`;

const checks = [];
function add(name, ok, note = '') {
  checks.push(ok);
  console.log(`  ${ok ? g('✓') : r('✗')} ${name}${note ? d('  — ' + note) : ''}`);
}

const get = async p => {
  const res = await fetch(BASE + p);
  return { status: res.status, text: await res.text() };
};

function ldJson(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(m[1])); } catch { /* ignore */ } }
  return out;
}

const metaOf = (html, name) => {
  const m = html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`));
  return m ? m[1] : null;
};
const titleOf = html => {
  const m = html.match(/<title>([\s\S]*?)<\/title>/);
  return m ? m[1].trim() : null;
};

(async () => {
  console.log();
  console.log(b('  آزمون ایمنی سئو در برابر سیاست محتوای انبوه'));
  console.log(d('  ────────────────────────────────────────────'));

  const server = await boot();

  /* نمونه ثابت — نه تصادفی. آزمونی که هر بار روی داده متفاوتی
     اجرا شود، شکست‌های متناوب می‌دهد و کسی جدی‌اش نمی‌گیرد. */
  const slugs = db.prepare(
    'SELECT slug FROM products ORDER BY id LIMIT 40'
  ).all().map(x => x.slug);

  /* ── چرا آزمون خودش محصول را قابل‌سفارش می‌کند ──
     پیش‌فرض کاتالوگ UNAVAILABLE است (تصمیم مالک: تا تأیید
     نشده، ادعای ساخت نمی‌کنیم). ولی چیزی که اینجا می‌سنجیم
     رفتار صفحهٔ **قابل سفارش** است: کارت غنی، BackOrder،
     حضور در sitemap.

     اگر به وضعیت دیتابیس تکیه می‌کردیم، آزمون یا همیشه رد
     می‌شد یا با تغییر یک سوئیچ در پنل بی‌صدا بی‌معنا می‌شد.
     پس حالت لازم را خودمان می‌سازیم و در پایان دقیقاً به حالت
     قبل برمی‌گردانیم. */
  const prevModes = db.prepare(
    `SELECT slug, supply_mode FROM products WHERE slug IN (${slugs.map(() => '?').join(',')})`
  ).all(...slugs);
  const setMode = dbw.prepare('UPDATE products SET supply_mode=? WHERE slug=?');
  dbw.transaction(() => {
    for (const s of slugs) setMode.run('MADE_TO_ORDER', s);
  })();
  const restoreModes = () => dbw.transaction(() => {
    for (const r of prevModes) setMode.run(r.supply_mode, r.slug);
  })();

  const pages = [];
  for (const s of slugs) pages.push(await get('/perfume/' + s));

  /* ═══ ۱) تمایز متادیتا ═══ */
  console.log();
  console.log(b('  ۱) تمایز متادیتا بین صفحه‌ها'));

  const descs = pages.map(p => metaOf(p.text, 'description')).filter(Boolean);
  const titles = pages.map(p => titleOf(p.text)).filter(Boolean);

  add('همه صفحه‌ها توضیح متا دارند', descs.length === slugs.length,
      `${descs.length}/${slugs.length}`);
  add('توضیح‌ها یکتا هستند', new Set(descs).size === descs.length,
      `${new Set(descs).size} یکتا از ${descs.length}`);
  add('عنوان‌ها یکتا هستند', new Set(titles).size === titles.length,
      `${new Set(titles).size} یکتا از ${titles.length}`);

  /* اسکلت جمله هم نباید یکسان باشد. «۳۰ نویسه نخست» نماینده
     خوبی از ساختار جمله است: اگر همه با «خرید » شروع شوند،
     مجموعه‌شان کوچک می‌ماند. */
  const heads = new Set(descs.map(x => x.slice(0, 12)));
  add('اسکلت جمله متنوع است', heads.size > descs.length * 0.5,
      `${heads.size} شروع متفاوت از ${descs.length}`);

  /* جمله ثابتِ ته توضیح — امضای قالب. */
  const boiler = 'سمپل ۳ میلی‌لیتری موجود است.';
  const withBoiler = descs.filter(x => x.includes(boiler)).length;
  add('جمله قالبی تکرارشونده حذف شده', withBoiler === 0,
      withBoiler ? `${withBoiler} صفحه هنوز دارد` : 'هیچ توضیحی جمله ثابت ندارد');

  /* ═══ ۲) تطابق داده ساختاریافته با صفحه ═══ */
  console.log();
  console.log(b('  ۲) تطابق داده ساختاریافته با واقعیت صفحه'));

  let prodSchemas = 0, availOk = 0, badAvail = [];
  for (let i = 0; i < pages.length; i++) {
    const prod = ldJson(pages[i].text).find(x => x['@type'] === 'Product');
    if (!prod) continue;
    prodSchemas++;

    const row = db.prepare('SELECT supply_mode FROM products WHERE slug=?').get(slugs[i]);
    const v = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(v.stock),0) s FROM variants v
      JOIN products p ON p.id=v.product_id WHERE p.slug=? AND ${publicVariantSql('v')} AND v.price_toman>0`).get(slugs[i]);
    const mode=row.supply_mode;
    const want = !v.n ? 'NoOffer' : !['IN_STOCK','MADE_TO_ORDER'].includes(mode) ? 'OutOfStock'
      : v.s>0 ? 'InStock' : mode==='MADE_TO_ORDER' ? 'BackOrder' : 'OutOfStock';
    const got = prod.offers ? String(prod.offers.availability || '').replace('https://schema.org/', '') : 'NoOffer';
    if (got === want) availOk++; else badAvail.push(`${slugs[i]}: ${got}≠${want}`);
  }

  add('همه صفحه‌های محصول اسکیمای Product دارند',
      prodSchemas === slugs.length, `${prodSchemas}/${slugs.length}`);
  add('availability با وضعیت واقعی تأمین می‌خواند',
      availOk === prodSchemas, badAvail.slice(0, 2).join(' · ') || `${availOk}/${prodSchemas}`);

  /* دکمه خرید فعال + OutOfStock = عدم تطابق. چون کاتالوگ ما
     «به سفارش» است، هیچ صفحه‌ای نباید OutOfStock بدهد مگر
     صریحاً UNAVAILABLE علامت خورده باشد. */
  const unavail = db.prepare(
    "SELECT COUNT(*) c FROM products WHERE supply_mode='UNAVAILABLE'").get().c;
  const oos = pages.filter(p => {
    const s = ldJson(p.text).find(x => x['@type'] === 'Product');
    return String(s?.offers?.availability || '').endsWith('OutOfStock');
  }).length;
  add('صفحه قابل‌سفارش خودش را ناموجود اعلام نمی‌کند',
      oos === 0 || unavail > 0,
      `${oos} صفحه OutOfStock · ${unavail} محصول واقعاً UNAVAILABLE`);

  /* ═══ ۳) مهار ایندکس ═══ */
  console.log();
  console.log(b('  ۳) مهار ایندکس'));

  const robots = await get('/robots.txt');
  add('robots.txt سرو می‌شود', robots.status === 200);
  for (const p of ['/admin', '/api/', '/cart', '/checkout', '/account', '/invoice']) {
    add(`${p} از خزش بیرون است`, robots.text.includes(`Disallow: ${p}`));
  }
  add('sitemap در robots معرفی شده', /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(robots.text));

  const sm = await get('/sitemap.xml');
  const urls = (sm.text.match(/<loc>/g) || []).length;

  /* ── چرا آستانه ثابت نیست ──
     نسخه پیشین `urls > 100` را شرط می‌گذاشت، چون آن زمان هر
     ۲٬۱۱۱ محصول در sitemap بودند. حالا فقط محصولات قابل سفارش
     معرفی می‌شوند و این عدد کاملاً به تصمیم مالک وابسته است —
     امروز ممکن است ۴۰ باشد، فردا ۷۰۰.

     آزمون باید **قرارداد** را بسنجد نه یک عدد لحظه‌ای: تعداد
     نشانی‌های محصول باید دقیقاً برابر تعداد محصولات قابل سفارش
     باشد. این رابطه همیشه درست می‌ماند. */
  const orderable = db.prepare(`SELECT COUNT(*) c FROM products p
    WHERE p.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS (
      SELECT 1 FROM variants v WHERE v.product_id=p.id AND ${publicVariantSql('v')}
      AND v.price_toman>0 AND (v.stock>0 OR p.supply_mode='MADE_TO_ORDER'))`).get().c;
  const productUrls = (sm.text.match(/\/perfume\//g) || []).length;

  add('sitemap ساخته می‌شود', sm.status === 200 && urls > 0, `${urls} نشانی`);
  add('فقط محصولات قابل سفارش در sitemap‌اند',
      productUrls === orderable, `${productUrls} نشانی = ${orderable} محصول قابل سفارش`);

  /* صفحه‌های فنی نباید در sitemap باشند — همان صفحه‌هایی که
     robots هم بسته است. تناقض بین این دو، سیگنال بی‌دقتی است. */
  const leak = ['/cart', '/checkout', '/account', '/wishlist', '/login', '/invoice', '/label']
    .filter(p => sm.text.includes(`<loc>${process.env.SITE_URL || 'https://yazdperfume.ir'}${p}</loc>`));
  add('صفحه شخصی در sitemap نشت نکرده', leak.length === 0, leak.join(', ') || 'پاک');

  /* ═══ ۳٫۵) یادداشت عطرساز — تجربه دست‌اول ═══ */
  console.log();
  console.log(b('  ۳٫۵) یادداشت عطرساز'));

  // Generated draft text must not be presented as first-hand experience.
  // A genuinely reviewed note can be short; never fabricate one to meet a length quota.
  const withNote = db.prepare(
    "SELECT COUNT(*) c FROM products WHERE maker_note_approved=1 AND maker_note IS NOT NULL AND maker_note != ''").get().c;
  const invalidApproved = db.prepare(
    "SELECT COUNT(*) c FROM products WHERE maker_note_approved=1 AND (maker_note IS NULL OR TRIM(maker_note)='')").get().c;
  const drafts = db.prepare(
    "SELECT COUNT(*) c FROM products WHERE maker_note_approved=0 AND maker_note IS NOT NULL AND maker_note != ''").get().c;
  const uniqNote = db.prepare(
    "SELECT COUNT(DISTINCT maker_note) c FROM products WHERE maker_note_approved=1 AND maker_note IS NOT NULL AND maker_note != ''").get().c;
  add('یادداشت تأییدشده خالی نیست', invalidApproved === 0, `${withNote} تأییدشده · ${drafts} پیش‌نویس`);
  add('یادداشت‌های منتشرشده عمدتاً یکتا هستند', uniqNote >= withNote * 0.9, `${uniqNote} یکتا از ${withNote}`);
  const tooLong = db.prepare(
    "SELECT COUNT(*) c FROM products WHERE maker_note_approved=1 AND LENGTH(maker_note) > 1500").get().c;
  add('یادداشت‌های منتشرشده محدودیت طول را رعایت می‌کنند', tooLong === 0, `${tooLong} مورد`);

  const draftRow = db.prepare(
    "SELECT slug, maker_note FROM products WHERE maker_note_approved=0 AND maker_note IS NOT NULL AND maker_note != '' ORDER BY id LIMIT 1").get();
  if (draftRow) {
    const pg = await get('/perfume/' + draftRow.slug);
    add('پیش‌نویس در HTML عمومی نشت نمی‌کند', !pg.text.includes(draftRow.maker_note.slice(0, 40)), draftRow.slug);
  }
  // Published-note rendering is tested over HTTP when an approved note exists.
  // The dedicated test_maker_note_review.py exercises publication on an isolated DB even when none exist here.
  const noteRow = db.prepare(
    "SELECT slug, maker_note FROM products WHERE maker_note_approved=1 AND maker_note IS NOT NULL AND maker_note != '' ORDER BY id LIMIT 1").get();
  if (noteRow) {
    const pg = await get('/perfume/' + noteRow.slug);
    add('یادداشت تأییدشده در HTML خام سرو می‌شود', pg.text.includes(noteRow.maker_note.slice(0, 40)), noteRow.slug);
    add('جعبه یادداشت تأییدشده پنهان نمانده', !/id="makerBox" hidden/.test(pg.text), noteRow.slug);
  }

  /* ═══ ۳٫۶) مهار ایندکس محصولات غیرقابل تأمین ═══ */
  console.log();
  console.log(b('  ۳٫۶) محصولات غیرقابل تأمین'));

  const unav = db.prepare(
    "SELECT slug FROM products WHERE supply_mode='UNAVAILABLE' ORDER BY id LIMIT 1").get();
  if (unav) {
    const pg = await get('/perfume/' + unav.slug);
    add('صفحه غیرقابل تأمین noindex دارد',
        /name="robots" content="noindex/.test(pg.text), unav.slug);
    /* follow عمدی است: خزنده باید از این صفحه به محصولات
       قابل سفارش هم‌خانواده برود. */
    add('ولی follow باقی مانده',
        /content="noindex,\s*follow"/.test(pg.text),
        'مسیر عبور خزنده بسته نمی‌شود');
    add('در sitemap نیست', !sm.text.includes(`/perfume/${unav.slug}<`), unav.slug);
    add('صفحه‌اش برای بازدیدکننده کار می‌کند', pg.status === 200,
        'حذف از ایندکس ≠ حذف از سایت');
  } else {
    add('محصول غیرقابل تأمین برای آزمون هست', false, 'هیچ محصول UNAVAILABLE نبود');
  }

  /* Pick an actually sellable product, not an active row with no priced variants. */
  const sellable = db.prepare(`SELECT p.slug FROM products p WHERE p.slug IN (${slugs.map(() => '?').join(',')})
    AND p.supply_mode IN ('IN_STOCK','MADE_TO_ORDER') AND EXISTS (
      SELECT 1 FROM variants v WHERE v.product_id=p.id AND ${publicVariantSql('v')}
      AND v.price_toman>0 AND (v.stock>0 OR p.supply_mode='MADE_TO_ORDER')) LIMIT 1`).get(...slugs);
  const okPg = sellable ? await get('/perfume/' + sellable.slug) : null;
  add('صفحه قابل سفارش noindex ندارد',
      !!okPg && !/name="robots" content="noindex/.test(okPg.text));
  add('صفحه قابل سفارش در sitemap هست',
      !!sellable && sm.text.includes(`/perfume/${sellable.slug}<`), sellable?.slug || 'مورد قابل سفارش یافت نشد');

  /* ═══ ۴) شفافیت برای خزنده ═══ */
  console.log();
  console.log(b('  ۴) شفافیت — آنچه خزنده بدون اجرای JS می‌بیند'));

  const one = pages[0].text;
  add('اطلاعیه شفافیت در HTML خام هست',
      one.includes('اطلاعیه شفافیت') || one.includes('بازآفرینی دست‌ساز'),
      'خزنده جاوااسکریپت اجرا نمی‌کند');
  add('عبارت ممنوع «Inspired by» به کار نرفته',
      !/Inspired by/i.test(one));

  const prod0 = ldJson(one).find(x => x['@type'] === 'Product');
  add('brand در اسکیما نام فروشگاه است، نه برند اصلی',
      prod0 && prod0.brand?.name === 'عطر یزد',
      'ادعای مالکیت برند نمی‌کنیم');
  add('نام لاتین اصلی در alternateName آمده',
      !!(prod0 && prod0.alternateName), 'ارتباط بدون ادعای دروغ');

  /* صفحه «چرا ما» جایی است که E-E-A-T می‌نشیند: تخصص، مدرک،
     سابقه. اگر خالی باشد، هیچ سیگنال اعتمادی نداریم. */
  const why = await get('/why-us');
  add('صفحه چرا ما در دسترس است', why.status === 200);
  add('سابقه و مدرک واقعی در صفحه ذکر شده',
      why.text.includes('مدرسه عطرسازی') && why.text.includes('متانول'),
      'سیگنال تخصص برای ارزیاب کیفیت');

  /* ═══ خلاصه ═══ */
  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  ایمنی سئو تأیید شد.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));

  restoreModes();
  db.close();
  dbw.close();
  server.kill();
  process.exit(failed === 0 ? 0 : 1);
})();
