#!/usr/bin/env node
/**
 * آزمون پروفایل بویایی.
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) پاک‌سازی ورودی — آرایه، مقدار نامعتبر، کلید ناشناس، null
 *   ۲) امتیازدهی: وزن‌ها درست و نتیجه مرتبط
 *   ۳) بودجه: اعمال می‌شود و در صورت لزوم بازتر می‌شود
 *   ۴) تنوع برند
 *   ۵) ذخیره و خواندن پروفایل برای کاربر واردشده
 *   ۶) ساخت رکورد مشتری در صورت نبود (ورود با کد یکبارمصرف)
 *   ۷) حذف پروفایل
 *   ۸) سیم‌کشی رابط
 *
 * چرا این آزمون لازم است:
 *   دو باگ در همین قابلیت فقط با اجرای واقعی پیدا شدند — یکی
 *   افزودن ستون به جدول اشتباه، و یکی ذخیره‌نشدن بی‌صدای پروفایل
 *   برای کاربری که با پیامک وارد شده ولی ثبت‌نام نکرده بود.
 *   هیچ‌کدام خطا تولید نمی‌کردند.
 *
 * اجرا: node scripts/test_taste.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { db, parseProduct, attachVariants } = require('../src/db');
const taste = require('../src/taste').build(db, { parseProduct, attachVariants });

const ROOT = path.dirname(__dirname);
const PORT = process.env.PORT || 3000;
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

function api(method, p, body, hdr) {
  return new Promise(res => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(hdr || {})
      }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        try { res({ s: x.statusCode, b: JSON.parse(b) }); }
        catch { res({ s: x.statusCode, b }); }
      });
    });
    req.on('error', () => res({ s: 0, b: null }));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('\n  آزمون پروفایل بویایی\n');

  // ══ ۱) پاک‌سازی ورودی ══
  console.log(d('  پاک‌سازی ورودی'));

  add('پاسخ معتبر می‌ماند',
      taste.sanitize({ gender: 'MEN', family: 'چوبی' }).gender === 'MEN');
  add('«فرقی نمی‌کند» حذف می‌شود',
      taste.sanitize({ gender: 'ANY', family: 'چوبی' }).gender === undefined);
  add('آرایه به‌جای رشته رد می‌شود',
      taste.sanitize({ gender: ['MEN'], family: 'چوبی' }).gender === undefined);
  add('مقدار خارج از فهرست رد می‌شود',
      taste.sanitize({ gender: 'HACK', family: 'چوبی' }).gender === undefined);
  add('کلید ناشناس رد می‌شود',
      taste.sanitize({ evil: 'x', family: 'چوبی' }).evil === undefined);
  add('null و آرایه امن‌اند',
      Object.keys(taste.sanitize(null)).length === 0 &&
      Object.keys(taste.sanitize([1, 2])).length === 0);
  add('عدد و شیء تودرتو رد می‌شوند',
      taste.sanitize({ gender: 5, family: { a: 1 } }).gender === undefined);

  add('پروفایل با یک معیار بی‌معنا شمرده می‌شود',
      !taste.isMeaningful({ gender: 'MEN' }));
  add('پروفایل با دو معیار معتبر است',
      taste.isMeaningful({ gender: 'MEN', family: 'چوبی' }));

  // ══ ۲) کیفیت پیشنهاد ══
  console.log(d('\n  کیفیت پیشنهاد'));

  const rec = taste.recommend({ gender: 'MEN', family: 'چوبی', temperature: 'گرم' }, 8);
  add('پیشنهاد تولید می‌شود', rec.items.length === 8, `${rec.items.length} قلم`);

  const menRatio = rec.items.filter(p => p.gender === 'MEN' ||
                                          p.gender === 'UNISEX').length;
  add('جنسیت رعایت می‌شود', menRatio === rec.items.length,
      `${menRatio} از ${rec.items.length}`);

  const woody = rec.items.filter(p => /چوب|چرم/.test(p.family_fa || '')).length;
  add('خانواده بویایی رعایت می‌شود', woody >= rec.items.length / 2,
      `${woody} از ${rec.items.length} چوبی`);

  add('نُت‌های آغازین در نتیجه هست',
      rec.items.some(p => (p.notes_top || []).length > 0));

  const brands = {};
  rec.items.forEach(p => { brands[p.brand_fa] = (brands[p.brand_fa] || 0) + 1; });
  add('از هر برند حداکثر دو تا', Math.max(...Object.values(brands)) <= 2,
      `بیشینه ${Math.max(...Object.values(brands))}`);

  /* کوییز باید همیشه نتیجه بدهد — حتی وقتی کاربر به همه سؤال‌ها
     «فرقی نمی‌کند» داده. نسخه اول اینجا فهرست خالی برمی‌گرداند و
     کوییز را برای کاربرِ «همه را نشانم بده» به بن‌بست می‌برد. */
  add('کوییز با همه ANY هم نتیجه می‌دهد',
      taste.recommend({ gender: 'ANY', family: 'ANY' }, 6).items.length === 6);
  add('کوییز با پاسخ خالی هم نتیجه می‌دهد',
      taste.recommend({}, 6).items.length === 6);

  /* ولی «پیشنهاد برای شما» بدون سلیقه بی‌معناست */
  add('پیشنهاد شخصی بدون سلیقه چیزی نمی‌دهد',
      taste.recommend({ gender: 'ANY' }, 8, { requireProfile: true })
        .items.length === 0);
  add('پیشنهاد شخصی با سلیقه مشخص کار می‌کند',
      taste.recommend({ gender: 'MEN', family: 'چوبی' }, 8,
        { requireProfile: true }).items.length === 8);

  // ══ ۳) بودجه ══
  console.log(d('\n  بودجه'));

  const cheap = taste.recommend(
    { gender: 'MEN', family: 'چوبی', budget: 'low' }, 8);
  const allCheap = cheap.items.every(p => p.min_price < 2000000);
  add('بودجه اقتصادی رعایت می‌شود', cheap.relaxed || allCheap,
      cheap.relaxed ? 'بازتر شد' : `${cheap.items.length} قلم زیر ۲ میلیون`);

  add('وقتی بودجه بازتر شود، اعلام می‌شود',
      typeof cheap.relaxed === 'boolean');

  add('inBudget درست کار می‌کند',
      taste.inBudget(1500000, 'low') === true &&
      taste.inBudget(3000000, 'low') === false &&
      taste.inBudget(3000000, 'mid') === true &&
      taste.inBudget(6000000, 'high') === true &&
      taste.inBudget(100, 'ANY') === true);

  // ══ ۴) خلاصه خوانا ══
  console.log(d('\n  خلاصه خوانا'));

  const sum = taste.describe({ gender: 'WOMEN', family: 'گلی', temperature: 'خنک' });
  add('خلاصه فارسی تولید می‌شود', sum.includes('زنانه') && sum.includes('گلی'),
      sum.join(' · '));
  add('خلاصه پروفایل خالی، خالی است',
      taste.describe({}).length === 0);

  // ══ ۵) ذخیره‌سازی ══
  console.log(d('\n  ذخیره‌سازی'));

  const cols = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  add('ستون taste_profile در جدول customers است',
      cols.includes('taste_profile') && cols.includes('taste_updated_at'));

  /* این بررسی از یک باگ واقعی آمده: نسخه اول ستون‌ها را با
     `addCol` اضافه می‌کرد که به جدول `orders` اشاره داشت. */
  const ocols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  add('جدول orders آلوده نشده', !ocols.includes('taste_profile'));

  const TEST_MOBILE = '09129998877';
  db.prepare('DELETE FROM customers WHERE mobile=?').run(TEST_MOBILE);

  /* ورود با کد یکبارمصرف رکورد مشتری نمی‌سازد — فقط نشست.
     بدون resolveCustomerId، پروفایل بی‌صدا ذخیره نمی‌شد. */
  const cid = taste.resolveCustomerId(TEST_MOBILE);
  add('رکورد مشتری در صورت نبود ساخته می‌شود', !!cid, `id=${cid}`);
  add('فراخوانی دوباره همان شناسه را می‌دهد',
      taste.resolveCustomerId(TEST_MOBILE) === cid);

  const ok = taste.saveProfile(cid, { gender: 'WOMEN', family: 'گلی', season: 'بهار و تابستان' });
  add('پروفایل ذخیره می‌شود', ok);

  const back = taste.getProfile(cid);
  add('پروفایل بازخوانی می‌شود',
      back && back.answers.gender === 'WOMEN' && back.answers.family === 'گلی');
  add('زمان به‌روزرسانی ثبت می‌شود', !!(back && back.updated_at));

  add('پروفایل بی‌معنا ذخیره نمی‌شود',
      taste.saveProfile(cid, { gender: 'MEN' }) === false);

  taste.clearProfile(cid);
  add('پروفایل پاک می‌شود', taste.getProfile(cid) === null);

  db.prepare('DELETE FROM customers WHERE mobile=?').run(TEST_MOBILE);

  // ══ ۶) مسیرهای API ══
  console.log(d('\n  مسیرهای API'));

  const health = await api('GET', '/api/health');
  if (health.s !== 200) {
    add('سرور در دسترس است', false, 'سرور بالا نیست — بخش API رد شد');
  } else {
    const q = await api('POST', '/api/quiz',
      { answers: { gender: 'MEN', family: 'چوبی', temperature: 'گرم' } });
    add('کوییز نتیجه می‌دهد', q.s === 200 && (q.b.results || []).length > 0,
        `${(q.b.results || []).length} نتیجه`);
    add('کوییز پروفایل پاک‌شده برمی‌گرداند',
        q.b.profile && q.b.profile.gender === 'MEN');
    add('نُت‌ها در نتیجه کوییز هست',
        (q.b.results || []).some(x => (x.notes_top || []).length > 0));

    const sug = await api('POST', '/api/taste/suggest',
      { answers: { gender: 'WOMEN', family: 'گلی' } });
    add('مهمان بدون ورود پیشنهاد می‌گیرد',
        sug.s === 200 && (sug.b.items || []).length >= 3,
        `${(sug.b.items || []).length} قلم · source=${sug.b.source}`);
    add('خلاصه پروفایل برمی‌گردد', (sug.b.summary || []).length >= 2,
        (sug.b.summary || []).join(' · '));

    const bad = await api('POST', '/api/taste/suggest',
      { answers: { gender: ['MEN'], evil: 'x' } });
    add('ورودی نامعتبر ۵۰۰ نمی‌دهد', bad.s === 200,
        `status ${bad.s}`);

    const noAuth = await api('DELETE', '/api/taste/profile');
    add('حذف پروفایل بدون ورود ۴۰۱ می‌دهد', noAuth.s === 401);

    // چرخه کامل با ورود
    const M = '09121110002';
    await api('POST', '/api/auth/request-code', { mobile: M });
    const row = db.prepare('SELECT code FROM otp_codes WHERE mobile=?').get(M);
    if (row) {
      const v = await api('POST', '/api/auth/verify-code', { mobile: M, code: row.code });
      const H = { 'X-Customer-Token': v.b.token };

      const q2 = await api('POST', '/api/quiz',
        { answers: { gender: 'WOMEN', family: 'گلی', season: 'بهار و تابستان' } }, H);
      add('کاربر واردشده: پروفایل ذخیره می‌شود', q2.b.profile_saved === true);

      const p2 = await api('GET', '/api/taste/profile', null, H);
      add('پروفایل از حساب خوانده می‌شود',
          p2.b.authenticated && p2.b.profile && p2.b.profile.family === 'گلی');

      /* ── ممیزی مرداد ۱۴۰۵ ──
         خواندن نباید بنویسد. نسخه اول در GET و DELETE هم
         `resolveCustomerId` را صدا می‌زد که رکورد مشتری می‌ساخت. */
      const M2 = '09121110099';
      db.prepare('DELETE FROM customers WHERE mobile=?').run(M2);
      await api('POST', '/api/auth/request-code', { mobile: M2 });
      const row2 = db.prepare('SELECT code FROM otp_codes WHERE mobile=?').get(M2);
      if (row2) {
        const v2 = await api('POST', '/api/auth/verify-code',
          { mobile: M2, code: row2.code });
        const H2 = { 'X-Customer-Token': v2.b.token };
        const n0 = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
        await api('GET', '/api/taste/profile', null, H2);
        await api('POST', '/api/taste/suggest', {}, H2);
        await api('DELETE', '/api/taste/profile', null, H2);
        const n1 = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
        add('خواندن پروفایل رکورد نمی‌سازد', n0 === n1,
            n0 === n1 ? '' : `${n1 - n0} ردیف اضافه`);
        db.prepare('DELETE FROM customers WHERE mobile=?').run(M2);
      }

      const s2 = await api('POST', '/api/taste/suggest', {}, H);
      add('پیشنهاد بدون ارسال پاسخ‌ها کار می‌کند',
          (s2.b.items || []).length >= 3 && s2.b.source === 'account',
          `source=${s2.b.source}`);

      const del = await api('DELETE', '/api/taste/profile', null, H);
      add('حذف پروفایل با ورود کار می‌کند', del.s === 200);

      const p3 = await api('GET', '/api/taste/profile', null, H);
      add('پس از حذف، پروفایل null است', p3.b.profile === null);

      db.prepare('DELETE FROM customers WHERE mobile=?').run(M);
    } else {
      add('چرخه ورود آزموده شد', false, 'کد یکبارمصرف ساخته نشد');
    }
  }

  // ══ محدودیت نرخ ══
  // آخر اجرا می‌شود چون سهمیه را مصرف می‌کند
  console.log(d('\n  محدودیت نرخ'));

  if (health.status === 200) {
    /* ── ممیزی مرداد ۱۴۰۵ ──
       `/api/taste/suggest` کل جدول محصولات را پویش می‌کند: ۵۰
       میلی‌ثانیه در برابر ۲.۵ میلی‌ثانیه `/api/products`. بدون
       محدودیت، ۴۰ درخواست موازی در ۲.۲ ثانیه همه پذیرفته می‌شدند
       — ارزان‌ترین راه از پا درآوردن سرور دو هسته‌ای لیارا. */
    db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'taste%'").run();

    let accepted = 0, throttled = 0;
    for (let i = 0; i < 45; i++) {
      const x = await api('POST', '/api/taste/suggest',
        { answers: { gender: 'MEN', family: 'چوبی' } });
      if (x.b && x.b.throttled) throttled++; else accepted++;
    }
    add('پیشنهاد بویایی محدودیت نرخ دارد', throttled > 0,
        `${accepted} پذیرفته · ${throttled} محدود`);
    add('سقف سخاوتمندانه است (کاربر واقعی نمی‌خورد)', accepted >= 20,
        `سقف ${accepted}`);
    add('محدودیت بی‌صدا رد می‌شود نه با خطا',
        (await api('POST', '/api/taste/suggest', { answers: {} })).s === 200);

    // سهمیه پاک می‌شود تا اجرای بعدی و محیط توسعه گیر نکند
    db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'taste%'").run();
  }

  // ══ ۷) سیم‌کشی رابط ══
  console.log(d('\n  سیم‌کشی رابط'));

  const appJs  = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
  const indexH = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const quizH  = fs.readFileSync(path.join(ROOT, 'public/quiz.html'), 'utf8');
  const css    = fs.readFileSync(path.join(ROOT, 'public/assets/theme.css'), 'utf8');

  add('ماژول YazdTaste تعریف شده', /const YazdTaste\s*=/.test(appJs));
  add('پروفایل محلی انقضا دارد', /TTL_DAYS:\s*\d+/.test(appJs.slice(appJs.indexOf('YazdTaste'))));
  add('کوییز پروفایل را ذخیره می‌کند', /YazdTaste\.save\(/.test(quizH));
  add('صفحه اصلی ظرف #tasteBox دارد', /id="tasteBox"/.test(indexH));
  add('ظرف پیش‌فرض پنهان است (بدون CLS)',
      /id="tasteBox"[^>]*display:\s*none/.test(indexH));
  add('رندر تا پس از رنگ‌آمیزی عقب می‌افتد',
      /requestIdleCallback[\s\S]{0,120}YazdTaste\.render/.test(indexH));
  add('مهمان بدون پروفایل درخواست بی‌فایده نمی‌زند',
      /if \(!local && !YazdAuth\.token\(\)\) return 0/.test(appJs));
  add('کاربر می‌تواند پروفایل را فراموش کند',
      /taste-clear/.test(appJs) && /taste-clear/.test(css));
  add('لینک تغییر سلیقه به کوییز هست', /href="\/quiz"/.test(appJs));
  add('خلاصه پروفایل به کاربر نشان داده می‌شود',
      /taste-chip/.test(appJs) && /\.taste-chip/.test(css));
  add('دکمه‌ها focus-visible دارند', /\.taste-clear:focus-visible/.test(css));

  // ══ نتیجه ══
  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  پروفایل بویایی درست کار می‌کند.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
