#!/usr/bin/env node
'use strict';

const assert = require('assert');
const seo = require('../src/seo');
const html = '<html><head><title>old</title></head><body><div id="feature" style="min-height:54vh"></div><article id="content" style="display:none"><img id="cover" src="" alt="" loading="eager" fetchpriority="high"><h1 id="title"></h1><div class="excerpt" id="excerpt"></div><div class="content" id="body"></div></article></body></html>';
const payload = '</script><script>globalThis.pwned=1</script>&"';
const image = '/images/products/test" onerror="globalThis.pwned=1';
const product = {slug:'test',name_fa:payload,name_en:payload,brand_fa:'brand',family_fa:'wood',notes:{top:[],middle:[],base:[]},variants:[],image_url:image,supply_mode:'UNAVAILABLE'};
const article = {slug:'test',title:payload,excerpt:payload,content:payload,cover_image:image,category:'guide'};
function verify(out, count) {
  assert(!out.includes(payload));
  assert(!out.includes('<script>globalThis.pwned=1</script>'));
  assert(!out.includes('" onerror="globalThis.pwned=1'));
  assert(out.includes('&quot; onerror=&quot;'));
  const blocks = [...out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.strictEqual(blocks.length,count);
  return blocks.map(m=>JSON.parse(m[1]));
}
const p = verify(seo.productPage(html, product),2);
assert(p[0].name.includes(payload));
assert(p[1].itemListElement[2].name.includes(payload));
const a = verify(seo.articlePage(html, article),2);
assert(a[0].headline.includes(payload));
assert(a[0].articleBody.includes(payload));
assert(a[1].itemListElement[2].name.includes(payload));
verify(seo.journalPage(html, article),0);
const home = seo.homePage(html,{products:2,brands:1});
const block = home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert(block); assert.equal(JSON.parse(block[1])['@type'],'OnlineStore');
console.log('PASS SEO JSON-LD script termination and HTML attribute escaping; JSON round-trip preserved');
