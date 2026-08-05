#!/usr/bin/env node
/**
 * خزنده لینک — هر href و src در هر صفحه را واقعاً درخواست می‌کند.
 *
 * چرا لازم است: لینک شکسته تنها چیزی است که هیچ آزمون واحدی
 * نمی‌گیرد ولی هر بازدیدکننده‌ای فوراً می‌بیند. مسیرها در این پروژه
 * چند بار عوض شده‌اند (‎.html → مسیر تمیز) و هر بار احتمال جاماندن
 * یک لینک هست.
 *
 * اجرا: node scripts/audit_links.js   (سرور باید روی ۳۰۰۰ باشد)
 */
'use strict';

const BASE = process.env.BASE || 'http://localhost:3000';

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

// صفحاتی که کاربر واقعاً می‌بیند
const PAGES = [
  '/', '/cart', '/checkout', '/account', '/wishlist', '/track',
  '/contact', '/terms', '/privacy', '/quiz', '/brands', '/essences',
  '/journal', '/login', '/admin', '/check',
  '/perfume/creed-aventus', '/journal/vetiver-note',
  '/invoice.html', '/label.html', '/404.html', '/payment-result.html'
];

/* هدر، منو و فوتر با جاوااسکریپت از app.js ساخته می‌شوند و در HTML
   خام هیچ‌جا نیستند. اگر این فایل‌ها را نخزیم، لینک‌های منو — یعنی
   پربازدیدترین لینک‌های سایت — اصلاً بررسی نمی‌شوند. */
const JS_FILES = ['/assets/app.js'];

const results = { ok: 0, broken: [], external: [], skipped: 0 };
const seen = new Map();   // url → status

/** استخراج همه نشانی‌ها از HTML */
function extractLinks(html) {
  const out = new Set();
  /* کامنت‌های HTML حذف می‌شوند. بدون این، توضیحات فارسی داخل کد
     که نمونه‌ای از یک تگ را نقل می‌کنند به‌اشتباه «لینک شکسته»
     گزارش می‌شدند. */
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  /* محتوای <script> هم کنار گذاشته می‌شود.
     قالب‌های رشته‌ای مثل href="/perfume/${p.slug}" را الگوی
     استخراج نصفه می‌بُرد و «‎/perfume/» را لینک شکسته می‌شمرد.
     لینک‌های واقعیِ داخل جاوااسکریپت جداگانه از فایل app.js
     خزیده می‌شوند. */
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  // href="..." و src="..."
  const re = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) out.add(m[1].trim());
  /* نشانی‌های داخل CSS: url(...)
     نکته: بدون شرطِ «پیش از url حرف نباشد»، این الگو با کد
     جاوااسکریپتِ writeURL(push) و createObjectURL(blob) هم مطابقت
     می‌کرد و چهار لینک شکسته جعلی می‌ساخت. */
  const reCss = /(?<![A-Za-z_$])url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = reCss.exec(html))) out.add(m[1].trim());
  return [...out];
}

/** آیا این نشانی را باید بررسی کنیم؟ */
function classify(link) {
  if (!link) return 'skip';
  if (link.startsWith('data:')) return 'skip';           // فونت base64
  if (link.startsWith('#')) return 'skip';               // لنگر
  if (link.startsWith('javascript:')) return 'skip';
  if (link.startsWith('mailto:') || link.startsWith('tel:')) return 'skip';
  if (/^https?:\/\//i.test(link)) {
    return link.startsWith(BASE) ? 'internal' : 'external';
  }
  if (link.startsWith('//')) return 'external';
  // نشانی‌های قالبی داخل جاوااسکریپت مثل /perfume/${slug}
  if (link.includes('${') || link.includes('{{')) return 'skip';
  return 'internal';
}

async function head(url) {
  if (seen.has(url)) return seen.get(url);
  let status;
  try {
    // بعضی سرورها HEAD را درست پاسخ نمی‌دهند؛ GET مطمئن‌تر است
    const res = await fetch(url, { redirect: 'manual' });
    status = res.status;
  } catch (e) {
    status = 'ERR:' + e.message;
  }
  seen.set(url, status);
  return status;
}

(async () => {
  console.log('\n  خزش لینک‌ها\n');

  for (const page of PAGES) {
    let html;
    try {
      const res = await fetch(BASE + page);
      if (!res.ok) {
        console.log(`  ${r('✗')} صفحه ${page} → ${res.status}`);
        results.broken.push({ page, link: page, status: res.status });
        continue;
      }
      html = await res.text();
    } catch (e) {
      console.log(`  ${r('✗')} صفحه ${page} → ${e.message}`);
      results.broken.push({ page, link: page, status: 'ERR' });
      continue;
    }

    const links = extractLinks(html);
    let pageBroken = 0;

    for (const link of links) {
      const kind = classify(link);
      if (kind === 'skip') { results.skipped++; continue; }
      if (kind === 'external') {
        if (!results.external.includes(link)) results.external.push(link);
        continue;
      }
      const url = link.startsWith('http') ? link
        : BASE + (link.startsWith('/') ? link : '/' + link);
      const status = await head(url);
      // ۲۰۰ خوب، ۳۰۱/۳۰۲ هم قابل قبول (ریدایرکت عمدی)
      if (status === 200 || status === 301 || status === 302 || status === 304) {
        results.ok++;
      } else {
        pageBroken++;
        results.broken.push({ page, link, status });
      }
    }

    console.log(`  ${pageBroken ? r('✗') : g('✓')} ${page} ` +
      d(`(${links.length} لینک${pageBroken ? '، ' + pageBroken + ' شکسته' : ''})`));
  }

  // ── فایل‌های جاوااسکریپت (منو و فوتر) ──
  for (const jsFile of JS_FILES) {
    let js;
    try {
      const res = await fetch(BASE + jsFile);
      if (!res.ok) {
        console.log(`  ${r('✗')} ${jsFile} → ${res.status}`);
        results.broken.push({ page: jsFile, link: jsFile, status: res.status });
        continue;
      }
      js = await res.text();
    } catch (e) { continue; }

    // فقط href='/...' های ثابت — قالبی‌ها (${...}) خودبه‌خود رد می‌شوند
    const re = /href\s*=\s*\\?["']([^"'`$]+)\\?["']/gi;
    const links = new Set();
    let m;
    while ((m = re.exec(js))) links.add(m[1].trim());

    let jsBroken = 0;
    for (const link of links) {
      const kind = classify(link);
      if (kind === 'skip') { results.skipped++; continue; }
      if (kind === 'external') {
        if (!results.external.includes(link)) results.external.push(link);
        continue;
      }
      const url = BASE + (link.startsWith('/') ? link : '/' + link);
      const status = await head(url);
      if ([200, 301, 302, 304].includes(status)) results.ok++;
      else { jsBroken++; results.broken.push({ page: jsFile, link, status }); }
    }
    console.log(`  ${jsBroken ? r('✗') : g('✓')} ${jsFile} ` +
      d(`(${links.size} لینک${jsBroken ? '، ' + jsBroken + ' شکسته' : ''})`));
  }

  console.log(`\n  لینک داخلی سالم: ${results.ok}`);
  console.log(`  رد شده (data:/#/mailto): ${results.skipped}`);

  if (results.external.length) {
    console.log(`\n  ${y('لینک بیرونی')} (بررسی نشد، دستی تأیید کنید):`);
    results.external.forEach(l => console.log('    ' + l));
  }

  if (results.broken.length) {
    console.log(`\n  ${r('لینک شکسته:')}`);
    results.broken.forEach(b =>
      console.log(`    ${b.page}  →  ${b.link}  [${b.status}]`));
    console.log('');
    process.exit(1);
  }

  console.log(`\n  ${g('هیچ لینک داخلی شکسته‌ای نیست.')}\n`);
})();
