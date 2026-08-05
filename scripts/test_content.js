#!/usr/bin/env node
/**
 * آزمون محتوای مجله و کوییز پیشنهاد رایحه.
 *
 * چرا لازم است:
 *   مجله و کوییز دو ابزار اصلی جذب مشتری‌اند. مجله باید در گوگل
 *   رتبه بگیرد و کوییز باید کسی را که نمی‌داند چه می‌خواهد به
 *   محصول برساند. هیچ‌کدام تا حالا آزمون خودکار نداشتند.
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) مقالات عمق کافی دارند (سئو)
 *   ۲) هر مقاله چکیده و زمان مطالعه دارد
 *   ۳) ساختار پرسش‌محور حفظ شده (برای عنوان‌بندی خودکار)
 *   ۴) کوییز از هر ترکیب پاسخی نتیجه می‌دهد
 *   ۵) پیشنهادها واقعاً با پاسخ‌ها هم‌خوان‌اند
 *   ۶) کوییز با پاسخ‌های متناقض هم خالی برنمی‌گردد
 *
 * اجرا: node scripts/test_content.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { db } = require('../src/db');

const ROOT = path.dirname(__dirname);
const PORT = 4429;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT) },
    stdio: 'ignore'
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

const post = (p, body) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async res => ({ status: res.status, json: await res.json().catch(() => ({})) }));

(async () => {
  console.log('\n  آزمون محتوای مجله و کوییز\n');
  const srv = await boot();

  const checks = [];
  const add = (label, ok, note) => {
    console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
    checks.push(ok);
  };
  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    const failed = checks.filter(x => !x).length;
    console.log();
    console.log(failed === 0
      ? g('  محتوا و کوییز سالم‌اند.\n')
      : r(`  ${failed} بررسی ناموفق.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  // ══ ۱) عمق مقالات ══
  console.log(d('  عمق محتوای مجله'));

  const arts = db.prepare('SELECT slug, title, content, excerpt, read_time FROM articles').all();
  add('مجله دست‌کم ۵ مقاله دارد', arts.length >= 5, `${arts.length} مقاله`);

  const wordsOf = a => String(a.content || '').trim().split(/\s+/).filter(Boolean).length;
  const shallow = arts.filter(a => wordsOf(a) < 300);
  add('هیچ مقاله‌ای کم‌عمق نیست (زیر ۳۰۰ واژه)', shallow.length === 0,
      shallow.length ? `${shallow[0].slug}: ${wordsOf(shallow[0])} واژه`
                     : `کمینه ${Math.min(...arts.map(wordsOf))} واژه`);

  const noExcerpt = arts.filter(a => !a.excerpt || a.excerpt.trim().length < 40);
  add('همه مقالات چکیده معنادار دارند', noExcerpt.length === 0,
      noExcerpt.length ? noExcerpt[0].slug : '');

  const noTime = arts.filter(a => !a.read_time);
  add('همه مقالات زمان مطالعه دارند', noTime.length === 0);

  /* ساختار پرسش‌محور: `renderArticle()` خط کوتاهِ پرسشی را عنوان
     می‌کند. اگر مقاله‌ای هیچ پرسشی نداشته باشد، در صفحه یک توده
     متن می‌شود. */
  const flat = arts.filter(a => {
    const blocks = String(a.content).split(/\n\s*\n/);
    return !blocks.some(b => {
      const first = b.trim().split('\n')[0].trim();
      return first.length <= 70 && (first.endsWith('؟') ||
             (first.length <= 40 && !/[.!،؛:]$/.test(first)));
    });
  });
  add('همه مقالات ساختار عنوان‌پذیر دارند', flat.length === 0,
      flat.length ? flat[0].slug : '');

  // ══ ۲) سئو مقاله ══
  console.log(d('\n  داده ساختاریافته مقاله'));

  const html = await fetch(`${BASE}/journal/${arts[0].slug}`).then(r => r.text());
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let ld = null;
  try { ld = m ? JSON.parse(m[1]) : null; } catch {}

  add('صفحه مقاله JSON-LD دارد', !!ld && ld['@type'] === 'Article');
  add('wordCount در JSON-LD هست', !!ld && ld.wordCount > 0, `${ld?.wordCount}`);
  add('articleBody در JSON-LD هست', !!ld && !!ld.articleBody);
  add('زبان fa-IR اعلام شده', ld?.inLanguage === 'fa-IR');

  // ══ ۳) کوییز: ترکیب‌های مختلف ══
  console.log(d('\n  کوییز — ترکیب‌های واقعی'));

  const combos = [
    { name: 'مردانه · گرم · زمستان',
      a: { gender: 'MEN', temperature: 'گرم', season: 'پاییز و زمستان',
           occasion: 'رسمی', family: 'شرقی', budget: 'اقتصادی' } },
    { name: 'زنانه · خنک · تابستان',
      a: { gender: 'WOMEN', temperature: 'خنک', season: 'بهار و تابستان',
           occasion: 'روزمره', family: 'گلی', budget: 'متوسط' } },
    { name: 'یونیسکس · همه',
      a: { gender: 'ANY', temperature: 'ANY', season: 'ANY',
           occasion: 'ANY', family: 'ANY', budget: 'ANY' } },
    { name: 'پاسخ خالی',
      a: {} }
  ];

  for (const c of combos) {
    const res = await post('/api/quiz', { answers: c.a });
    const list = res.json.results || res.json.products || [];
    add(`«${c.name}» نتیجه می‌دهد`, res.status === 200 && list.length > 0,
        `${list.length} پیشنهاد`);
  }

  // ══ ۴) هم‌خوانی نتیجه با پاسخ ══
  console.log(d('\n  هم‌خوانی پیشنهاد با سلیقه'));

  const menRes = await post('/api/quiz', {
    answers: { gender: 'MEN', temperature: 'گرم', season: 'پاییز و زمستان',
               occasion: 'رسمی', family: 'شرقی', budget: 'اقتصادی' }
  });
  const menList = menRes.json.results || [];
  const menOk = menList.filter(p => p.gender === 'MEN' || p.gender === 'UNISEX').length;
  add('پیشنهاد مردانه واقعاً مردانه/یونیسکس است',
      menList.length > 0 && menOk === menList.length,
      `${menOk} از ${menList.length}`);

  const womenRes = await post('/api/quiz', {
    answers: { gender: 'WOMEN', temperature: 'خنک', season: 'بهار و تابستان',
               occasion: 'روزمره', family: 'گلی', budget: 'متوسط' }
  });
  const womenList = womenRes.json.results || [];
  const womenOk = womenList.filter(p => p.gender === 'WOMEN' || p.gender === 'UNISEX').length;
  add('پیشنهاد زنانه واقعاً زنانه/یونیسکس است',
      womenList.length > 0 && womenOk === womenList.length,
      `${womenOk} از ${womenList.length}`);

  // نتیجه دو سلیقه متفاوت نباید یکسان باشد
  const menIds = menList.map(p => p.id).join(',');
  const womenIds = womenList.map(p => p.id).join(',');
  add('سلیقه‌های متفاوت نتیجه متفاوت می‌دهند', menIds !== womenIds);

  // ══ ۵) کیفیت داده پیشنهاد ══
  console.log(d('\n  کیفیت داده پیشنهادها'));

  add('هر پیشنهاد slug و نام دارد',
      menList.every(p => p.slug && p.name_fa),
      `${menList.length} مورد`);
  add('هر پیشنهاد قیمت معتبر دارد',
      menList.every(p => p.min_price > 0));
  add('هر پیشنهاد تصویر دارد',
      menList.every(p => p.image_url && p.image_url.startsWith('/images/')));

  // صفحه محصول پیشنهادشده باید واقعاً باز شود
  const firstSlug = menList[0]?.slug;
  if (firstSlug) {
    const code = await fetch(`${BASE}/perfume/${firstSlug}`).then(r => r.status);
    add('صفحه محصول پیشنهادی باز می‌شود', code === 200, `کد ${code}`);
  } else {
    add('صفحه محصول پیشنهادی باز می‌شود', false, 'پیشنهادی نبود');
  }

  finish();
})();
