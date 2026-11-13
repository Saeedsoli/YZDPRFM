'use strict';

const CACHE_VERSION = 'yazd-v8';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const PAGE_CACHE  = `${CACHE_VERSION}-pages`;
const IMG_CACHE   = `${CACHE_VERSION}-img`;

const IMG_LIMIT = 60;

const SHELL = [
  '/',
  '/offline',
  '/assets/theme.css',
  '/assets/app.js',
  '/assets/csp-actions.js',
  '/assets/jalaali-core.js',
  '/assets/fonts.css',
  '/fonts/Vazirmatn-Regular.woff2',
  '/fonts/Vazirmatn-Medium.woff2',
  '/fonts/Vazirmatn-Bold.woff2',
  '/images/brand-mark-light.svg',
  '/images/brand_logo.png',
  '/icon-192.png',
  '/favicon.ico'
];

const NEVER_CACHE = [
  /^\/api\//,
  /^\/admin/,
  /^\/account/,
  /^\/invoice/,
  /^\/label/,
  /^\/checkout/,
  /^\/payment/,
  /^\/login/,
  /^\/review-invite/,
  /^\/review\//,
  /^\/track(?:\/|\.html|$)/,
  /^\/wishlist(?:\/|\.html|$)/,

  /^\/perfume\//
];

const isNeverCache = path => NEVER_CACHE.some(re => re.test(path));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);

    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch {  }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => !k.startsWith(CACHE_VERSION))
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const k of keys.slice(0, keys.length - limit)) {
    await cache.delete(k);
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);

  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirstAsset(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(new Request(req, { cache: 'no-cache' }));
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreVary:true });
    if (hit) return hit;
    throw err;
  }
}

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;

    const off = await cache.match('/offline')
             || await (await caches.open(SHELL_CACHE)).match('/offline');
    if (off) return off;
    return new Response('آفلاین هستید.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function imageStrategy(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      cache.put(req, res.clone());
      trimCache(IMG_CACHE, IMG_LIMIT);
    }
    return res;
  } catch {
    if (hit) return hit;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  if (isNeverCache(url.pathname)) return;

  if (/^\/assets\//.test(url.pathname)) {
    event.respondWith(networkFirstAsset(req));
    return;
  }
  if (/^\/fonts\//.test(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  if (/^\/(favicon|icon-|apple-touch-icon)/.test(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  if (/^\/images\//.test(url.pathname) ||
      /\.(jpg|jpeg|png|webp|svg|gif)$/i.test(url.pathname)) {
    event.respondWith((async () => {

      const shell = await caches.open(SHELL_CACHE);
      const inShell = await shell.match(req, { ignoreVary: true });
      if (inShell) return inShell;
      return imageStrategy(req);
    })());
    return;
  }

  const wantsHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (wantsHTML) {
    event.respondWith(networkFirst(req));
    return;
  }

});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
