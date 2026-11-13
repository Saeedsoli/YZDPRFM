#!/usr/bin/env node

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { db } = require('../src/db');

const PORT = process.env.PORT || 3000;
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const h = s => `\x1b[1m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

const enc = p => p.replace(/[^\x00-\x7F]/g, encodeURIComponent);

function api(p, opt = {}, token) {
  return new Promise(res => {
    const body = opt.body || null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: enc(p), method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Cookie: 'yazd_customer=' + token } : {})
      }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b });
      });
    });
    req.on('error', () => res({ status: 0, json: {}, raw: '' }));
    if (body) req.write(body);
    req.end();
  });
}
const post = (p, obj, token) =>
  api(p, { method: 'POST', body: JSON.stringify(obj) }, token);

(async () => {
  console.log();
  console.log(h('  آزمون کاتالوگ عمومی — گام ۷ تفکیک'));
  console.log(d('  ─────────────────────────────────────────────'));

  const sample = db.prepare(
    'SELECT id, slug, brand_fa, family_slug, gender FROM products LIMIT 1'
  ).get();
  const topNote = db.prepare(
    'SELECT note_key, COUNT(*) c FROM product_notes GROUP BY note_key ORDER BY c DESC LIMIT 1'
  ).get();
  const secondNote = db.prepare(
    'SELECT note_key, COUNT(*) c FROM product_notes GROUP BY note_key ORDER BY c DESC LIMIT 1 OFFSET 1'
  ).get();

  console.log();
  console.log(h('  ۱) فهرست محصولات'));

  const list = await api('/api/products?limit=5');
  add('‎/api/products پاسخ ۲۰۰', list.status === 200);
  add('شکل پاسخ کامل است',
      ['total', 'page', 'limit', 'totalPages', 'relaxed', 'products']
        .every(k => k in list.json),
      Object.keys(list.json).join(','));
  add('limit رعایت می‌شود', list.json.products?.length === 5,
      `${list.json.products?.length} قلم`);

  const CATALOG_TOTAL = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  add('کل محصولات با دیتابیس می‌خواند',
      list.json.total === CATALOG_TOTAL,
      `${list.json.total} از ${CATALOG_TOTAL}`);

  const card = list.json.products?.[0] || {};
  add('کارت سبک برگردانده می‌شود (بدون variants)',
      !('variants' in card) && 'min_price' in card && 'in_stock' in card,
      'حالت پیش‌فرض نصف حجم است');
  add('کارت درصد جشنواره دارد', 'campaign_percent' in card);
  add('کارت شمار واریانت دارد', typeof card.variant_count === 'number');

  const full = await api('/api/products?limit=2&full=1');
  add('‎full=1 واریانت‌ها را می‌آورد',
      Array.isArray(full.json.products?.[0]?.variants),
      `${full.json.products?.[0]?.variants?.length} واریانت`);

  console.log();
  console.log(h('  ۲) صفحه‌بندی'));

  const p1 = await api('/api/products?limit=3&page=1');
  const p2 = await api('/api/products?limit=3&page=2');
  add('صفحه دوم محصول متفاوت دارد',
      p1.json.products?.[0]?.id !== p2.json.products?.[0]?.id,
      `${p1.json.products?.[0]?.id} ≠ ${p2.json.products?.[0]?.id}`);
  add('totalPages درست حساب می‌شود',
      p1.json.totalPages === Math.ceil(CATALOG_TOTAL / 3), String(p1.json.totalPages));

  const over = await api('/api/products?limit=500');
  add('limit به ۶۰ مقید می‌شود', over.json.limit === 60,
      'وگرنه یک درخواست می‌تواند کل جدول را بکشد');

  const bad = await api('/api/products?page=-5&limit=0');
  add('پارامتر منفی نمی‌شکند',
      bad.status === 200 && bad.json.page === 1 && bad.json.limit >= 1);

  console.log();
  console.log(h('  ۳) فیلترها'));

  const byBrand = await api(`/api/products?brand=${encodeURIComponent(sample.brand_fa)}&limit=5`);
  add('فیلتر برند کار می‌کند',
      byBrand.status === 200 && byBrand.json.products.length > 0 &&
      byBrand.json.products.every(p => p.brand_fa === sample.brand_fa),
      `${byBrand.json.total} محصول ${sample.brand_fa}`);

  const byFam = await api(`/api/products?family=${sample.family_slug}&limit=5`);
  add('فیلتر خانواده کار می‌کند',
      byFam.json.products.length > 0 &&
      byFam.json.products.every(p => p.family_slug === sample.family_slug),
      `${byFam.json.total} محصول`);

  const byGender = await api('/api/products?gender=women&limit=5');
  const wCount = db.prepare("SELECT COUNT(*) c FROM products WHERE gender='WOMEN'").get().c;
  add('فیلتر جنسیت بزرگ/کوچک را نادیده می‌گیرد',
      byGender.json.total === wCount, `women → ${byGender.json.total} = ${wCount}`);

  const n1 = await api(`/api/products?note=${encodeURIComponent(topNote.note_key)}`);
  const n2 = await api(`/api/products?note=${encodeURIComponent(secondNote.note_key)}`);
  const nBoth = await api(
    `/api/products?note=${encodeURIComponent(topNote.note_key)},${encodeURIComponent(secondNote.note_key)}`
  );
  add(`فیلتر یک نُت (${topNote.note_key})`,
      n1.json.total === topNote.c, `${n1.json.total} = ${topNote.c}`);
  add('دو نُت با AND ترکیب می‌شوند نه OR',
      nBoth.json.total <= Math.min(n1.json.total, n2.json.total) &&
      nBoth.json.total > 0,
      `${topNote.note_key}+${secondNote.note_key} → ${nBoth.json.total} ≤ min(${n1.json.total},${n2.json.total})`);

  const realAnd = db.prepare(`
    SELECT COUNT(*) c FROM products WHERE
      EXISTS (SELECT 1 FROM product_notes pn WHERE pn.product_id=products.id AND pn.note_key=?)
      AND EXISTS (SELECT 1 FROM product_notes pn WHERE pn.product_id=products.id AND pn.note_key=?)
  `).get(topNote.note_key, secondNote.note_key).c;
  add('شمار دو-نُت با دیتابیس می‌خواند',
      nBoth.json.total === realAnd, `${nBoth.json.total} = ${realAnd}`);

  const manyNotes = await api('/api/products?note=a,b,c,d,e,f,g');
  add('بیش از ۴ نُت مقید می‌شود', manyNotes.status === 200,
      'وگرنه هفت EXISTS تودرتو');

  const combo = await api(
    `/api/products?family=${sample.family_slug}&gender=${sample.gender}&limit=5`
  );
  add('دو فیلتر با هم کار می‌کنند',
      combo.status === 200 &&
      combo.json.products.every(p =>
        p.family_slug === sample.family_slug && p.gender === sample.gender),
      `${combo.json.total} محصول`);

  console.log();
  console.log(h('  ۴) جستجو'));

  const s1 = await api('/api/products?q=' + encodeURIComponent('کرید'));
  add('جستجوی فارسی نتیجه می‌دهد', s1.json.total > 0, `${s1.json.total} نتیجه`);

  const s2 = await api('/api/products?q=' + encodeURIComponent('كريد'));
  add('حرف عربی ك/ي یکسان‌سازی می‌شود',
      s2.json.total === s1.json.total, `${s2.json.total} = ${s1.json.total}`);

  const nothing = await api('/api/products?q=' + encodeURIComponent('زقلخبثصضغ'));
  add('جستجوی بی‌معنا ۲۰۰ با صفر نتیجه می‌دهد',
      nothing.status === 200 && nothing.json.total === 0,
      'نه ۴۰۴ — فروشگاه خالی هم فروشگاه است');

  const relaxed = await api('/api/products?q=' + encodeURIComponent('کرید شنل دیور'));
  add('جستجوی چندکلمه‌ای بن‌بست به حالت شل می‌افتد',
      relaxed.json.total > 0 && relaxed.json.relaxed === true,
      `relaxed=${relaxed.json.relaxed}، ${relaxed.json.total} نتیجه نزدیک`);

  const oneWord = await api('/api/products?q=' + encodeURIComponent('زقلخبثصضغ'));
  add('تک‌کلمه بی‌نتیجه به حالت شل نمی‌افتد',
      oneWord.json.relaxed === false,
      'شل کردن یک کلمه با خودش بی‌معناست');

  const inject = await api("/api/products?q=" + encodeURIComponent("' OR 1=1 --"));
  add('تزریق SQL در جستجو بی‌اثر است',
      inject.status === 200 && inject.json.total < CATALOG_TOTAL,
      `${inject.json.total} نتیجه — پارامتری بسته شده`);

  console.log();
  console.log(h('  ۵) مرتب‌سازی — فهرست سفید'));

  const asc  = await api('/api/products?sort=price_asc&limit=10');
  const desc = await api('/api/products?sort=price_desc&limit=10');

  const byStock = res => {
    const g = { inStock: [], outStock: [] };
    for (const p of res.json.products) {
      if (p.min_price == null) continue;
      (p.in_stock ? g.inStock : g.outStock).push(p.min_price);
    }
    return g;
  };
  const isAsc  = a => a.every((v, i) => i === 0 || a[i - 1] <= v);
  const isDesc = a => a.every((v, i) => i === 0 || a[i - 1] >= v);

  const a = byStock(asc), d2 = byStock(desc);

  add('موجودها پیش از ناموجودها می‌آیند',
      asc.json.products.findIndex(p => !p.in_stock) === -1 ||
      asc.json.products.every((p, i, arr) =>
        i === 0 || !(p.in_stock && !arr[i - 1].in_stock)),
      `${a.inStock.length} موجود، سپس ${a.outStock.length} ناموجود`);

  add('price_asc درون هر گروه صعودی است',
      isAsc(a.inStock) && isAsc(a.outStock),
      `موجود: ${a.inStock.join(' ≤ ') || '—'} · ناموجود: ${a.outStock.slice(0, 3).join(' ≤ ')}`);

  add('price_desc درون هر گروه نزولی است',
      isDesc(d2.inStock) && isDesc(d2.outStock),
      `موجود: ${d2.inStock.join(' ≥ ') || '—'} · ناموجود: ${d2.outStock.slice(0, 3).join(' ≥ ')}`);

  add('ارزان‌ترین و گران‌ترین ناموجود یکی نیستند',
      a.outStock.length > 0 && d2.outStock.length > 0 &&
      a.outStock[0] !== d2.outStock[0],
      `${a.outStock[0]} ≠ ${d2.outStock[0]}`);

  const byName = await api('/api/products?sort=name&limit=5');
  add('sort=name کار می‌کند', byName.status === 200 && byName.json.products.length === 5);

  const evil = await api('/api/products?sort=' + encodeURIComponent('id; DROP TABLE products--'));
  const stillThere = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  add('مرتب‌سازی مخرب بی‌اثر است',
      evil.status === 200 && stillThere === CATALOG_TOTAL,
      'فهرست سفید — رشته کاربر هرگز در SQL نمی‌رود');
  add('sort ناشناخته به پیش‌فرض می‌افتد',
      (await api('/api/products?sort=hack')).status === 200);

  console.log();
  console.log(h('  ۶) صفحه محصول'));

  const bySlug = await api('/api/products/' + sample.slug);
  const byId   = await api('/api/products/' + sample.id);
  add('محصول با نامک پیدا می‌شود', bySlug.status === 200 && bySlug.json.id === sample.id);
  add('محصول با شناسه پیدا می‌شود', byId.status === 200 && byId.json.id === sample.id);
  add('واریانت‌ها ضمیمه‌اند', Array.isArray(bySlug.json.variants) &&
      bySlug.json.variants.length > 0, `${bySlug.json.variants?.length} حجم`);
  add('نُت‌ها ضمیمه‌اند', !!bySlug.json.notes && 'top' in bySlug.json.notes);
  const missing = await api('/api/products/' + encodeURIComponent('این-محصول-وجود-ندارد'));
  add('محصول ناموجود ۴۰۴ می‌دهد', missing.status === 404 &&
      /یافت نشد/.test(missing.json.error || ''));

  console.log();
  console.log(h('  ۷) ویترین صفحه اصلی'));

  const show = await api('/api/showcase');
  add('‎/api/showcase پاسخ ۲۰۰', show.status === 200);
  add('هر چهار بخش هست',
      ['bestsellers', 'most_wanted', 'trending', 'seasonal']
        .every(k => Array.isArray(show.json[k])),
      Object.keys(show.json).join(','));
  add('پرچم صداقت پرفروش‌ها هست',
      'bestsellers_fallback' in show.json,
      'اگر فروشی نبوده، سایت نباید بگوید «پرفروش»');
  add('فصل جاری اعلام می‌شود', typeof show.json.season_fa === 'string',
      show.json.season_fa);
  add('ویترین فصلی از روز اول پر است',
      show.json.seasonal.length > 0, `${show.json.seasonal.length} قلم`);
  add('درصد جشنواره در لحظه حساب می‌شود',
      show.json.seasonal.every(x => 'campaign_percent' in x),
      'نه از جدول trending که ساعتی تازه می‌شود');

  console.log();
  console.log(h('  ۸) برند، خانواده، نُت، اسانس'));

  const brands = await api('/api/brands');
  const brandCount = db.prepare(
    'SELECT COUNT(*) c FROM (SELECT 1 FROM products WHERE brand_fa IS NOT NULL GROUP BY brand_fa, brand_en)'
  ).get().c;
  add('‎/api/brands شمار درست دارد',
      brands.json.total === brandCount, `${brands.json.total} برند`);
  add('برندها نزولی مرتب‌اند',
      brands.json.brands.every((b, i) => i === 0 || brands.json.brands[i - 1].count >= b.count));

  const fams = await api('/api/families');
  add('‎/api/families کار می‌کند',
      Array.isArray(fams.json.families) && fams.json.families.length > 0,
      `${fams.json.families.length} خانواده`);

  const notes = await api('/api/notes');
  add('‎/api/notes کار می‌کند', notes.json.notes?.length > 0,
      `${notes.json.notes.length} نُت`);
  add('نُت‌های کم‌محصول فیلتر می‌شوند',
      notes.json.notes.every(n => n.count >= 12),
      'پیش‌فرض min=12 — نُت تک‌محصولی بن‌بست کاوش است');
  const notesMin = await api('/api/notes?min=200');
  add('پارامتر min اثر دارد',
      notesMin.json.notes.length < notes.json.notes.length &&
      notesMin.json.notes.every(n => n.count >= 200),
      `min=200 → ${notesMin.json.notes.length} نُت`);

  const notesHuge = await api('/api/notes?min=99999');
  add('min بیش از حد به ۲۰۰ مقید می‌شود',
      notesHuge.json.notes.length === notesMin.json.notes.length,
      `${notesHuge.json.notes.length} = ${notesMin.json.notes.length}`);
  const notesPos = await api('/api/notes?position=base&limit=5');
  add('فیلتر جایگاه نُت کار می‌کند',
      notesPos.status === 200 && notesPos.json.position === 'base');
  const notesEvil = await api('/api/notes?position=DROP');
  add('جایگاه نامعتبر رد می‌شود',
      notesEvil.json.position === null, 'فهرست سفید');

  const ess = await api('/api/essences');
  add('‎/api/essences شش خانه دارد', ess.json.total === 6, String(ess.json.total));
  add('اسانس‌ها شاخص و هشدار دارند',
      Array.isArray(ess.json.featured) && !!ess.json.short_notice && !!ess.json.full_notice);
  add('ژیوودان در فهرست هست',
      JSON.stringify(ess.json.houses).includes('ژیوودان'));

  console.log();
  console.log(h('  ۹) کوییز و پروفایل بویایی'));

  const REAL = { gender: 'MEN', temperature: 'گرم', family: 'چوبی',
                 season: 'پاییز و زمستان' };

  const quiz = await post('/api/quiz', { answers: REAL });
  add('‎/api/quiz پاسخ ۲۰۰', quiz.status === 200);
  add('کوییز شش پیشنهاد می‌دهد', quiz.json.results?.length === 6,
      `${quiz.json.results?.length} قلم`);
  add('کوییز شمار کل محصولات را می‌گوید',
      quiz.json.total_products === CATALOG_TOTAL,
      `برای «از میان ${CATALOG_TOTAL} عطر»`);
  add('پروفایل برگردانده می‌شود', !!quiz.json.profile);
  add('مهمان پروفایلش ذخیره نمی‌شود',
      quiz.json.profile_saved === false, 'مرورگر خودش نگه می‌دارد');

  const emptyQuiz = await post('/api/quiz', {});
  add('کوییز بدون پاسخ هم نتیجه می‌دهد',
      emptyQuiz.status === 200 && emptyQuiz.json.results?.length > 0,
      'کوییز باید همیشه چیزی نشان دهد');

  const sug = await post('/api/taste/suggest', { answers: REAL });
  add('‎/api/taste/suggest برای مهمان کار می‌کند',
      sug.status === 200 && sug.json.items?.length > 0,
      `${sug.json.items?.length} پیشنهاد`);
  add('منبع پیشنهاد اعلام می‌شود', sug.json.source === 'guest');
  add('خلاصه سلیقه به فارسی است',
      Array.isArray(sug.json.summary) && sug.json.summary.length > 0,
      (sug.json.summary || []).join(' · '));
  add('پیشنهادها درصد جشنواره دارند',
      sug.json.items.every(x => 'campaign_percent' in x));

  const junk = await post('/api/taste/suggest',
    { answers: { gender: ['MEN'], family: 'DROP TABLE', budget: -1 } });
  add('پاسخ نامعتبر بی‌صدا دور ریخته می‌شود',
      junk.status === 200 && junk.json.items.length === 0,
      'فهرست سفید taste.sanitize');

  const noProfile = await post('/api/taste/suggest', {});
  add('بدون سلیقه چیزی پیشنهاد نمی‌شود',
      noProfile.status === 200 && noProfile.json.items.length === 0,
      'ادعای «پیشنهاد برای شما» بدون سلیقه بی‌معناست');

  const prof = await api('/api/taste/profile');
  add('پروفایل مهمان ۲۰۰ با authenticated=false',
      prof.status === 200 && prof.json.authenticated === false,
      'نه ۴۰۱ — مهمان خطا نمی‌بیند');
  const delProf = await api('/api/taste/profile', { method: 'DELETE' });
  add('حذف پروفایل بدون ورود ۴۰۱', delProf.status === 401);

  const before = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
  await api('/api/taste/profile');
  await api('/api/taste/profile', { method: 'DELETE' });
  const after = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
  add('خواندن و حذف رکورد مشتری نمی‌سازند',
      before === after, `${before} = ${after} — یافته ۴ ممیزی مرداد`);

  console.log();
  console.log(h('  ۱۰) جشنواره و کد تخفیف عمومی'));

  const camps = await api('/api/campaigns');
  add('‎/api/campaigns پاسخ ۲۰۰', camps.status === 200 &&
      Array.isArray(camps.json.campaigns));

  const noCode = await api('/api/coupons/public');
  add('کد نامشخص ۴۰۰ می‌دهد', noCode.status === 400);

  const cpn = db.prepare('SELECT * FROM coupons WHERE active=1 LIMIT 1').get();
  const good = await api('/api/coupons/public?code=' + cpn.code);
  add(`کد فعال (${cpn.code}) ۲۰۰ می‌دهد`, good.status === 200);
  add('قرارداد type/value رعایت شده',
      good.json.type === cpn.type && good.json.value === cpn.value,
      `${good.json.type}=${good.json.value} — نه percent`);
  add('کد کوچک‌نوشته هم پذیرفته می‌شود',
      (await api('/api/coupons/public?code=' + cpn.code.toLowerCase())).status === 200);
  add('کد ناموجود ۴۰۴ می‌دهد',
      (await api('/api/coupons/public?code=HICHKODAM')).status === 404);
  add('ظرفیت باقی‌مانده اعلام می‌شود', 'remaining' in good.json,
      String(good.json.remaining));
  add('هش یا ستون داخلی نشت نمی‌کند',
      !('id' in good.json) && !('created_at' in good.json),
      'فهرست سفید فیلدها');

  console.log();
  console.log(h('  ۱۱) محافظ‌ها و مسیرهای همسایه'));

  add('‎/api/track (خارج ماژول) سالم است',
      (await post('/api/track', { kind: 'view', target: sample.id })).status === 200);
  add('‎/api/notice (خارج ماژول) سالم است',
      (await api('/api/notice')).status === 200);
  add('‎/api/cart/sync (خارج ماژول) سالم است',
      (await post('/api/cart/sync', { skus: [] })).status === 200);
  add('‎/api/health سالم است', (await api('/api/health')).status === 200);
  add('‎/api/contact-info سالم است', (await api('/api/contact-info')).status === 200);
  add('مسیر ناشناخته ۴۰۴ می‌دهد',
      (await api('/api/hich-koja')).status === 404);
  add('صفحه اصلی رندر می‌شود',
      (await api('/')).status === 200);

  console.log(d('    (‎۳۵ درخواست پیاپی به taste/suggest…)'));
  let throttled = false, sawError = false;
  for (let i = 0; i < 35; i++) {
    const x = await post('/api/taste/suggest', { answers: REAL });
    if (x.status !== 200) sawError = true;
    if (x.json.throttled) throttled = true;
  }
  add('محدودیت نرخ taste فعال است', throttled, 'سقف ۳۰ در دقیقه');
  add('رد شدن ۲۰۰ است نه ۴۲۹', !sawError,
      'نبود پیشنهاد نباید صفحه اصلی را بشکند');

  db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'taste%'").run();

  console.log();
  console.log(h('  ۱۲) سلامت ساختاری تفکیک'));

  const ROOT = path.dirname(__dirname);
  const mod = fs.readFileSync(path.join(ROOT, 'src/routes/catalog.js'), 'utf8');
  const srv = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');

  add('ماژول قرارداد handle را دارد',
      /async function handle\(ctx\)/.test(mod) && /module\.exports = \{ handle \}/.test(mod));
  add('در پایان false برمی‌گرداند', /return false;\s*\/\//.test(mod));
  add('پوشش sendJSON با return true هست',
      /const sendJSON = \(code, data\) => \{ ctx\.sendJSON\(code, data\); return true; \};/.test(mod),
      'تله شماره‌یک تفکیک');

  const body = mod.slice(mod.indexOf('const sendJSON'));
  add('هیچ `return;` خالی نیست', !/\breturn;\s*$/m.test(body));
  add('هیچ pipe(res) نیست', !/pipe\(res\)/.test(body));
  add('هیچ res.end() نیست', !/res\.end\(/.test(body));
  add('هیچ setHeader نیست', !/setHeader/.test(body),
      'این ماژول اصلاً res را نمی‌گیرد');
  add('ماژول res را در ctx نمی‌خواهد', !/\bres\b\s*[,}]/.test(mod.slice(0, mod.indexOf('const sendJSON'))) ||
      !/ctx\.res/.test(mod));

  add('server.js ماژول را صدا می‌زند', /routeCatalog\.handle\(/.test(srv));
  add('بلوک /api/products از server.js رفته',
      !/pathname === '\/api\/products'/.test(srv));
  add('بلوک /api/showcase از server.js رفته',
      !/pathname === '\/api\/showcase'/.test(srv));
  add('بلوک /api/quiz از server.js رفته',
      !/pathname === '\/api\/quiz'/.test(srv));
  add('بلوک /api/coupons/public از server.js رفته',
      !/pathname === '\/api\/coupons\/public'/.test(srv));
  add('‎/api/coupons/validate در server.js مانده',
      /pathname === '\/api\/coupons\/validate'/.test(srv),
      'مسیر مالی است، با سبد گره خورده');

  const srvLines = srv.split('\n').length;
  const modLines = mod.split('\n').length;
  add('server.js زیر ۲۵۰۰ خط رسید', srvLines < 2500, `${srvLines} خط`);
  console.log(d(`      ماژول catalog: ${modLines} خط`));

  console.log();
  console.log(h('  ۱۳) سرور پس از همه اینها'));
  const alive = await api('/api/products?limit=1');
  add('سرور هنوز پاسخ می‌دهد', alive.status === 200,
      'تله ERR_HTTP_HEADERS_SENT فرآیند را می‌کشد');

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  کاتالوگ عمومی سالم است.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
