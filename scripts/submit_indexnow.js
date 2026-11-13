#!/usr/bin/env node

'use strict';
const fs = require('fs');
const path = require('path');

const KEY = fs.readFileSync(path.join(__dirname, '..', 'seed', 'indexnow_key.txt'), 'utf8').trim();
const ENDPOINT = 'https://api.indexnow.org/indexnow';

async function collect(site) {
  const res = await fetch(`${site}/sitemap.xml`);
  if (!res.ok) throw new Error(`sitemap.xml: ${res.status}`);
  const index = await res.text();
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const urls = [];
  for (const map of maps) {
    const r = await fetch(map);
    if (!r.ok) continue;
    const body = await r.text();
    for (const m of body.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
  }
  return [...new Set(urls)];
}

(async () => {
  const site = (process.argv[2] || process.env.SITE_URL || '').replace(/\/$/, '');
  const dry = process.argv.includes('--dry-run');
  if (!/^https:\/\//.test(site)) {
    console.error('نشانی سایت را با https بدهید: node scripts/submit_indexnow.js https://example.com');
    process.exit(1);
  }

  const keyFile = await fetch(`${site}/${KEY}.txt`).then(r => r.ok ? r.text() : null).catch(() => null);
  if (!keyFile || keyFile.trim() !== KEY) {
    console.error(`کلید در ${site}/${KEY}.txt پیدا نشد یا مطابق نیست.`);
    console.error('یعنی سایت هنوز مستقر نشده یا فایل کلید منتشر نشده است.');
    process.exit(1);
  }

  const urls = await collect(site);
  console.log(`نشانی‌های پیدا‌شده: ${urls.length}`);
  if (dry) { console.log(urls.slice(0, 5).join('\n')); return; }

  for (let i = 0; i < urls.length; i += 10000) {
    const chunk = urls.slice(i, i + 10000);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(site).host, key: KEY, keyLocation: `${site}/${KEY}.txt`, urlList: chunk })
    });
    console.log(`دسته ${i / 10000 + 1}: ${res.status} ${res.status === 200 || res.status === 202 ? '✓' : '✗'}`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
