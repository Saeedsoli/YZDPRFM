#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');
const analytics = require('../src/analytics').build(db, () => {});

const ROOT = path.dirname(__dirname);
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

console.log('\n  آزمون پویایی سایت\n');

console.log(d('  تشخیص فصل'));

const SEASON_CASES = [
  ['2026-04-15', 'spring',  'اردیبهشت'],
  ['2026-07-15', 'summer',  'مرداد'],
  ['2026-10-15', 'autumn',  'مهر'],
  ['2026-01-15', 'winter',  'دی'],
  ['2026-03-21', 'spring',  'مرز نوروز'],
  ['2026-03-20', 'winter',  'یک روز پیش از نوروز'],
  ['2026-12-22', 'winter',  'مرز زمستان']
];
let seasonOk = true;
for (const [date, want, label] of SEASON_CASES) {
  const got = analytics.seasonNow(new Date(date + 'T12:00:00Z'));
  if (got !== want) { seasonOk = false; console.log(d(`      ${label}: ${got} ≠ ${want}`)); }
}
add('فصل از تاریخ درست استخراج می‌شود', seasonOk, `${SEASON_CASES.length} تاریخ`);

console.log(d('\n  تناسب با فصل'));

const SEASONS = [
  ['2026-04-15', 'بهار'],
  ['2026-07-15', 'تابستان'],
  ['2026-10-15', 'پاییز'],
  ['2026-01-15', 'زمستان']
];

let allMatch = true, allFull = true;
const famCounts = [];
for (const [date, faWant] of SEASONS) {
  const s = analytics.seasonalPicks(8, new Date(date + 'T12:00:00Z'));

  if (s.season_fa !== faWant) allMatch = false;
  if (s.items.length < 8) allFull = false;

  const bad = s.items.filter(p =>
    !String(p.season || '').includes(faWant) && p.season !== 'چهارفصل');
  if (bad.length) {
    allMatch = false;
    console.log(d(`      ${faWant}: ${bad[0].name_fa} → ${bad[0].season}`));
  }

  const fam = {};
  s.items.forEach(p => { fam[p.family_slug] = (fam[p.family_slug] || 0) + 1; });
  famCounts.push({ faWant, families: Object.keys(fam).length,
                   max: Math.max(...Object.values(fam)) });
}
add('همه پیشنهادها مناسب فصل‌اند', allMatch, '۴ فصل بررسی شد');
add('هر فصل ۸ پیشنهاد کامل دارد', allFull);

console.log(d('\n  تنوع'));

const minFamilies = Math.min(...famCounts.map(f => f.families));
const maxSameFamily = Math.max(...famCounts.map(f => f.max));

add('هر فصل دست‌کم ۴ خانواده بویایی دارد', minFamilies >= 4,
    `کمینه ${minFamilies} خانواده`);
add('از هر خانواده حداکثر ۲ پیشنهاد', maxSameFamily <= 2,
    `بیشینه ${maxSameFamily}`);

let brandDup = 0;
for (const [date] of SEASONS) {
  const s = analytics.seasonalPicks(8, new Date(date + 'T12:00:00Z'));
  const b = {};
  s.items.forEach(p => { b[p.brand_fa] = (b[p.brand_fa] || 0) + 1; });
  brandDup = Math.max(brandDup, Math.max(...Object.values(b)));
}
add('از هر برند حداکثر یکی (ویترین تبلیغ یک برند نشود)', brandDup <= 1,
    `بیشینه ${brandDup}`);

console.log(d('\n  چرخش هفتگی'));

const ids = dt => analytics.seasonalPicks(8, new Date(dt)).items.map(p => p.id).join(',');

const sameWeek = ids('2026-07-13T08:00:00Z') === ids('2026-07-15T20:00:00Z');
add('در طول یک هفته پایدار می‌ماند', sameWeek);

const w1 = analytics.seasonalPicks(8, new Date('2026-07-13T12:00:00Z')).items.map(p => p.id);
const w2 = analytics.seasonalPicks(8, new Date('2026-07-27T12:00:00Z')).items.map(p => p.id);
const shared = w1.filter(x => w2.includes(x)).length;
add('بین هفته‌ها تازه می‌شود', w1.join() !== w2.join(),
    `${shared} از ۸ مشترک`);

add('چرخش تدریجی است نه انفجاری', shared <= 6,
    `${shared} مشترک`);

console.log(d('\n  اولویت موجودی'));

const inStockTotal = db.prepare(
  'SELECT COUNT(DISTINCT product_id) c FROM variants WHERE stock > 0').get().c;

if (inStockTotal > 0) {
  const s = analytics.seasonalPicks(8);
  const stocked = s.items.filter(p => p.in_stock).length;

  add('میدان in_stock در خروجی هست',
      s.items.every(p => typeof p.in_stock === 'boolean'));
  console.log(d(`      ${stocked} از ۸ پیشنهاد موجودند (${inStockTotal} محصول موجود در کل)`));
} else {
  add('میدان in_stock در خروجی هست',
      analytics.seasonalPicks(8).items.every(p => typeof p.in_stock === 'boolean'),
      'هیچ کالایی موجود نیست');
}

console.log(d('\n  ذخیره‌سازی'));

const res = analytics.refreshTrending();
add('refreshTrending اسلات فصلی را می‌سازد', res.seasonal > 0, `${res.seasonal} قلم`);

const stored = analytics.getTrending('seasonal');
add('اسلات فصلی از جدول خوانده می‌شود',
    stored && Array.isArray(stored.items) && stored.items.length > 0,
    `${stored?.items?.length || 0} قلم`);
add('نام فارسی فصل ذخیره شده', !!stored.season_fa, stored.season_fa);

console.log(d('\n  سیم‌کشی رابط'));

const appJs   = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
const indexH  = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const prodH   = fs.readFileSync(path.join(ROOT, 'public/product.html'), 'utf8');
const css     = fs.readFileSync(path.join(ROOT, 'public/assets/theme.css'), 'utf8');

add('ماژول YazdRecent تعریف شده', /const YazdRecent\s*=/.test(appJs));
add('سقف تاریخچه و انقضا دارد',
    /MAX:\s*\d+/.test(appJs) && /TTL_DAYS:\s*\d+/.test(appJs));
add('خطای localStorage بی‌صدا رد می‌شود',
    /catch\s*\{[\s\S]{0,200}\}/.test(appJs.slice(appJs.indexOf('YazdRecent'))));

add('صفحه اصلی ظرف #recent دارد', /id="recent"/.test(indexH));
add('صفحه محصول ظرف #recent دارد', /id="recent"/.test(prodH));
add('ظرف پیش‌فرض پنهان است (بدون CLS)',
    /id="recent"[^>]*display:\s*none/.test(indexH) &&
    /id="recent"[^>]*display:\s*none/.test(prodH));

add('صفحه محصول بازدید را ثبت می‌کند', /YazdRecent\.push\(/.test(prodH));
add('رندر پیش از ثبت انجام می‌شود (محصول جاری در ردیف نیاید)',
    prodH.indexOf('YazdRecent.render') < prodH.indexOf('YazdRecent.push'));
add('محصول جاری از ردیف کنار گذاشته می‌شود', /exclude:\s*p\.slug/.test(prodH));

add('اسلات فصلی در ویترین صفحه اصلی هست', /key:\s*'seasonal'/.test(indexH));
add('عنوان فصل از سرور می‌آید نه ثابت', /d\.season_fa/.test(indexH));

add('استایل «اخیراً دیدید» تعریف شده',
    /\.recent-head/.test(css) && /\.recent-clear/.test(css));
add('دکمه پاک کردن focus-visible دارد',
    /\.recent-clear:focus-visible/.test(css));

console.log(d('\n  صداقت محتوا'));

const noFakeUrgency = !/در حال مشاهده|نفر دیگر|فروش می‌رود|به پایان/.test(indexH);
add('هیچ شمارنده یا فوریت جعلی اضافه نشده', noFakeUrgency);

const s2 = analytics.seasonalPicks(8);
add('ادعای فصل با داده محصول پشتیبانی می‌شود',
    s2.items.every(p => p.season),
    'همه اقلام ستون season دارند');

const failed = checks.filter(x => !x).length;
console.log();
console.log(failed === 0
  ? g(`  پویایی سایت درست کار می‌کند.  ${checks.length}/${checks.length}\n`)
  : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
process.exit(failed === 0 ? 0 : 1);
