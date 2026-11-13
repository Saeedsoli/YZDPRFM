#!/usr/bin/env node

'use strict';

const BASE = process.env.BASE || 'http://localhost:3000';

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const PAGES = [
  '/', '/cart', '/checkout', '/account', '/wishlist', '/track',
  '/contact', '/terms', '/privacy', '/quiz', '/brands', '/essences',
  '/journal', '/login', '/admin', '/check',
  '/perfume/creed-aventus', '/journal/vetiver-note',
  '/invoice.html', '/label.html', '/404.html', '/payment-result.html'
];

const JS_FILES = ['/assets/app.js'];

const results = { ok: 0, broken: [], external: [], skipped: 0 };
const seen = new Map();

function extractLinks(html) {
  const out = new Set();

  html = html.replace(/<!--[\s\S]*?-->/g, '');

  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  const re = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) out.add(m[1].trim());

  const reCss = /(?<![A-Za-z_$])url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = reCss.exec(html))) out.add(m[1].trim());
  return [...out];
}

function classify(link) {
  if (!link) return 'skip';
  if (link.startsWith('data:')) return 'skip';
  if (link.startsWith('#')) return 'skip';
  if (link.startsWith('javascript:')) return 'skip';
  if (link.startsWith('mailto:') || link.startsWith('tel:')) return 'skip';
  if (/^https?:\/\//i.test(link)) {
    return link.startsWith(BASE) ? 'internal' : 'external';
  }
  if (link.startsWith('//')) return 'external';

  if (link.includes('${') || link.includes('{{')) return 'skip';
  return 'internal';
}

async function head(url) {
  if (seen.has(url)) return seen.get(url);
  let status;
  try {

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
