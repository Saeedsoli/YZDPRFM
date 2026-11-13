'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const ALLOWED_HOSTS = new Set([
  'www.cdc.gov', 'www.ecfr.gov', 'eur-lex.europa.eu', 'www.iso.org', 'www.fda.gov',
  'www.givaudan.com', 'www.firmenich.com', 'www.iff.com', 'www.symrise.com',
  'www.aparat.com', 'commons.wikimedia.org', 'upload.wikimedia.org',
  'www.ncbi.nlm.nih.gov', 'www.acs.org',
  'wa.me', 'www.instagram.com', 'instagram.com', 't.me', 'telegram.me', 'zarinpal.com', 'www.zarinpal.com'
]);
const REQUIRED_REL = ['noopener', 'noreferrer', 'nofollow'];

function pages() {
  return fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html')).map(f => path.join(PUBLIC, f));
}

const anchors = [];
for (const file of pages()) {
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = match[1];
    const href = (attrs.match(/href\s*=\s*"([^"]*)"/i) || [])[1];
    if (!href || !/^https?:/i.test(href)) continue;
    anchors.push({ file: path.basename(file), href, attrs });
  }
}

assert(anchors.length > 0, 'هیچ لینک بیرونی پیدا نشد');

const badProtocol = anchors.filter(a => !/^https:\/\//i.test(a.href));
assert.deepEqual(badProtocol.map(a => `${a.file} → ${a.href}`), [], 'لینک غیر https');

const badHost = anchors.filter(a => !ALLOWED_HOSTS.has(new URL(a.href).host));
assert.deepEqual(badHost.map(a => `${a.file} → ${a.href}`), [], 'میزبان خارج از فهرست سفید');

const badRel = [];
const badTarget = [];
for (const a of anchors) {
  const rel = (a.attrs.match(/rel\s*=\s*"([^"]*)"/i) || [])[1] || '';
  const tokens = rel.toLowerCase().split(/\s+/);
  for (const required of REQUIRED_REL) {
    if (!tokens.includes(required)) badRel.push(`${a.file} → ${a.href} (بدون ${required})`);
  }
  if (!/target\s*=\s*"_blank"/i.test(a.attrs)) badTarget.push(`${a.file} → ${a.href}`);
}
assert.deepEqual([...new Set(badRel)], [], 'لینک بدون rel امن');
assert.deepEqual([...new Set(badTarget)], [], 'لینک بدون target=_blank');

const why = fs.readFileSync(path.join(PUBLIC, 'why-us.html'), 'utf8');
const requiredSources = [
  'cdc.gov/niosh', 'ecfr.gov', 'eur-lex.europa.eu', 'iso.org', 'fda.gov'
];
for (const source of requiredSources) {
  assert(why.includes(source), `منبع ${source} در صفحه چرا ما لینک نشده`);
}
assert(why.includes('class="src-list"'), 'فهرست منابع صفحه چرا ما ساختار ندارد');

const essences = fs.readFileSync(path.join(PUBLIC, 'essences.html'), 'utf8');
for (const host of ['givaudan.com', 'firmenich.com', 'iff.com', 'symrise.com']) {
  assert(essences.includes(host), `خانه اسانس ${host} لینک نشده`);
}

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed', 'articles_db.json'), 'utf8'));
let articleSources = 0;
for (const article of seed) {
  if (!Array.isArray(article.sources)) continue;
  for (const source of article.sources) {
    assert(typeof source.label === 'string' && source.label.trim(), `منبع بی‌نام در ${article.slug}`);
    if (source.url) {
      assert(/^https:\/\//i.test(source.url), `${article.slug}: منبع غیر https`);
      assert(ALLOWED_HOSTS.has(new URL(source.url).host),
        `${article.slug}: میزبان ${new URL(source.url).host} در فهرست سفید نیست`);
    }
    articleSources++;
  }
}
assert(articleSources >= 3, 'مقاله‌های دارای ادعای بیرونی منبع ندارند');
const articlePage = fs.readFileSync(path.join(PUBLIC, 'article.html'), 'utf8');
assert(articlePage.includes('id="sources"'), 'بلوک منابع در صفحه مقاله نیست');
assert(/rel="noopener noreferrer nofollow"/.test(articlePage), 'لینک منابع مقاله rel امن ندارد');

console.log(`PASS: ${anchors.length} لینک بیرونی در ${new Set(anchors.map(a => a.file)).size} صفحه · ${articleSources} منبع مقاله — https، فهرست سفید، rel امن`);
