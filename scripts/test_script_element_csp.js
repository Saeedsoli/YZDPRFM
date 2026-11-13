'use strict';
const assert=require('assert/strict'),crypto=require('crypto');
const {scriptHashes,forTemplate}=require('../src/script-element-csp');
const hash=s=>"'sha256-"+crypto.createHash('sha256').update(s).digest('base64')+"'";
const template='<script src="/assets/app.js"></script><script>window.x=1;\r\nwindow.y=2;</script><script>window.x=1;\r\nwindow.y=2;</script>';
assert.deepEqual(scriptHashes(template),[hash('window.x=1;\nwindow.y=2;')]);
const basePolicy="default-src 'self'; script-src 'self' 'unsafe-inline'; script-src-elem 'self'; script-src-attr 'unsafe-inline'";
const csp=forTemplate(basePolicy,template);
assert(csp.includes("script-src-elem 'self' "+hash('window.x=1;\nwindow.y=2;')));
assert(!csp.includes(hash('alert(1)')));assert.throws(()=>forTemplate("default-src 'self'",template));
const strict=forTemplate(basePolicy,template,{disallowInlineHandlers:true});
assert(strict.includes("script-src-attr 'none'"));assert(!strict.includes("'unsafe-inline'"));assert(strict.includes("script-src 'self' "+hash('window.x=1;\nwindow.y=2;')));
assert.throws(()=>forTemplate("script-src-elem 'self'",template,{disallowInlineHandlers:true}));
const fs=require('fs'),path=require('path');
const account=fs.readFileSync(path.join(__dirname,'../public/account.html'),'utf8');
assert(!/\son[a-z]+\s*=/i.test(account),'Account contains an inline event attribute');
const login=fs.readFileSync(path.join(__dirname,'../public/login.html'),'utf8');
assert(!/\son[a-z]+\s*=/i.test(login),'Login contains an inline event attribute');
const checkout=fs.readFileSync(path.join(__dirname,'../public/checkout.html'),'utf8');
assert(!/\son[a-z]+\s*=/i.test(checkout),'Checkout contains an inline event attribute');
for(const file of ['invoice.html','label.html','track.html']){const html=fs.readFileSync(path.join(__dirname,'../public',file),'utf8');assert(!/\son[a-z]+\s*=/i.test(html),file+' contains an inline event attribute');}
console.log('PASS template-only script hashes, strict account/login/checkout policies and fail-closed rules');

const {hasInlineHandlers}=require('../src/script-element-csp');
assert.equal(hasInlineHandlers('<meta content="width=device-width">'), false, 'content= is not a handler');
assert.equal(hasInlineHandlers('<video controls="sugg"></video>'), false, 'controls= is not a handler');
assert.equal(hasInlineHandlers('<button onclick="x()">'), true);
assert.equal(hasInlineHandlers('<img onerror="this.src=1">'), true);
assert.equal(hasInlineHandlers('<body onload="boot()">'), true);
assert.equal(hasInlineHandlers('data-onclick="x"'), false, 'data- attributes are not handlers');

const pages = fs.readdirSync(path.join(__dirname, '../public')).filter(f => f.endsWith('.html'));
const strictPages = [], loosePages = [];
for (const name of pages) {
  const html = fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
  (hasInlineHandlers(html) ? loosePages : strictPages).push(name);
}
assert(strictPages.length >= 12, 'at least twelve pages must run under the strict policy');
for (const name of strictPages) {
  const html = fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
  const policy = forTemplate(basePolicy, html);
  const strict = !hasInlineHandlers(html);
  assert(policy.includes(strict ? "script-src-attr 'none'" : "script-src-attr 'unsafe-inline'"), name + ': attribute policy must match source');
  assert(!/script-src 'self' 'unsafe-inline'/.test(policy), name + ': script-src must never keep the inline fallback');
}
console.log(`PASS handler detection and strict script policy on ${pages.length} pages (${strictPages.length} strict attributes, ${loosePages.length} remaining inline-handler pages)`);
console.log('     strict: ' + strictPages.join(', '));
console.log('     inline-handler pages: ' + loosePages.join(', '));

const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
assert(/const CACHE_VERSION = 'yazd-v8'/.test(sw), 'UI script update must invalidate old offline shell');
assert(sw.includes("'/assets/csp-actions.js'"), 'offline shell must cache the delegated action module');
let actionPages = 0;
for (const name of pages) {
  const html = fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
  assert(!/\son[a-z][a-z0-9:_-]*\s*=/i.test(html), name + ': inline event handler remains');
  if (html.includes('data-csp-')) {
    actionPages++;
    assert(html.includes('<script src="/assets/csp-actions.js"></script>'), name + ': delegated action module missing');
  }
}
assert(actionPages > 0, 'delegated actions are in use');
console.log(`PASS: ${actionPages} pages use external delegated actions; all ${pages.length} pages have no inline handler; offline shell updated`);
