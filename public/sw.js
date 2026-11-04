/**
 * عطر یزد | سرویس‌ورکر
 * ─────────────────────
 *
 * فلسفه این فایل در یک جمله:
 *   **هرگز قیمت یا موجودی کهنه نشان نده.**
 *
 * چرا این قاعده مقدس است:
 *   این یک فروشگاه با پول واقعی است. سرویس‌ورکری که پاسخ API را کش
 *   کند، ممکن است به مشتری قیمت دیروز یا کالای تمام‌شده را نشان
 *   دهد. مشتری سفارش می‌دهد، سرور رد می‌کند، و اعتماد می‌رود.
 *   PWA بد از نداشتن PWA بدتر است.
 *
 *   پس: **هیچ درخواست /api/ هرگز کش نمی‌شود.** نه با
 *   stale-while-revalidate، نه با network-first، هیچ.
 *
 * چه چیزی کش می‌شود:
 *   ۱) پوسته — فونت، CSS، JS، آیکن‌ها  → cache-first
 *      این‌ها با max-age=31536000 immutable سرو می‌شوند و تا وقتی
 *      نامشان عوض نشود، تغییر نمی‌کنند.
 *   ۲) تصاویر محصول → cache-first با سقف تعداد
 *      تصویر محصول هرگز عوض نمی‌شود (نام فایل پایدار است).
 *   ۳) صفحات HTML → network-first با پشتیبان کش
 *      اگر شبکه بود، تازه‌اش را بده. اگر نبود، نسخه ذخیره‌شده
 *      بهتر از صفحه خطای مرورگر است.
 *
 * چه چیزی هرگز کش نمی‌شود:
 *   • هر چیزی زیر /api/
 *   • صفحه‌های پنل مدیریت و حساب کاربری
 *   • فاکتور و برچسب پستی (داده شخصی مشتری)
 *   • درخواست‌های غیر GET
 *
 * نسخه‌بندی:
 *   با هر تغییر در فهرست پوسته، CACHE_VERSION بالا می‌رود. کش
 *   قدیمی در رویداد activate پاک می‌شود.
 */

'use strict';

const CACHE_VERSION = 'yazd-v7';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const PAGE_CACHE  = `${CACHE_VERSION}-pages`;
const IMG_CACHE   = `${CACHE_VERSION}-img`;

/** سقف تصاویر کش‌شده — جلوگیری از پر شدن سهمیه دستگاه */
const IMG_LIMIT = 60;

/* پوسته: چیزهایی که بدون آن‌ها سایت اصلاً شکل نمی‌گیرد.
   عمداً کوتاه است — هر فایل اینجا یعنی تأخیر در نخستین نصب. */
const SHELL = [
  '/',
  '/offline',
  '/assets/theme.css',
  '/assets/app.js',
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

/* مسیرهایی که هرگز نباید کش شوند.
   پنل و حساب کاربری داده شخصی و زنده دارند؛ فاکتور و برچسب
   اطلاعات مشتری را نشان می‌دهند و نباید روی دستگاه بمانند. */
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

  /* ── صفحه محصول ── (ممیزی مرداد ۱۴۰۵)
     ادعای «هیچ قیمت کهنه‌ای نشان داده نمی‌شود» از راه API درست
     بود، ولی از راه دیگری نقض می‌شد: صفحه محصول قیمت را در
     **HTML سمت سرور** دارد (داده ساختاریافته سئو، `offers.price`).

     آزمون واقعی: صفحه کش شد، قیمت در دیتابیس از ۱۹۶٬۰۰۰ به
     ۹۹۹٬۰۰۰ تغییر کرد، و نسخه کش‌شده همچنان عدد قدیمی را در
     HTML داشت.

     گرچه کاربر آن را نمی‌دید (بخش نمایش با جاوااسکریپت پر
     می‌شود و آفلاین شکست می‌خورد)، خزنده گوگل و ابزارهای
     اشتراک‌گذاری همان HTML را می‌خوانند. برای فروشگاهی که موضعش
     شفافیت قیمت است، این ریسک ارزش نگه داشتن ندارد.

     صفحه محصول از شبکه می‌آید یا اصلاً نمی‌آید. */
  /^\/perfume\//
];

const isNeverCache = path => NEVER_CACHE.some(re => re.test(path));

// ═══════════════════════════════════════════
//  نصب
// ═══════════════════════════════════════════
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    /* هر فایل جدا اضافه می‌شود، نه با addAll.
       addAll اگر یک فایل ۴۰۴ بدهد، کل نصب را می‌شکند — و آن‌وقت
       سرویس‌ورکر هرگز فعال نمی‌شود بدون اینکه خطای روشنی ببینی. */
    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch { /* این فایل بی‌خیال — نصب نباید بشکند */ }
    }));
    await self.skipWaiting();
  })());
});

// ═══════════════════════════════════════════
//  فعال‌سازی — پاک کردن کش نسخه قبل
// ═══════════════════════════════════════════
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

/** نگه داشتن سقف کش تصاویر — قدیمی‌ترین‌ها اول می‌روند */
async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const k of keys.slice(0, keys.length - limit)) {
    await cache.delete(k);
  }
}

// ═══════════════════════════════════════════
//  راهبردها
// ═══════════════════════════════════════════

/** پوسته و فونت: کش اول — این‌ها immutable سرو می‌شوند */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  // ignoreVary — سرور برای تصویر و فونت `Vary: Accept` می‌فرستد
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Mutable JS/CSS paths do not contain content hashes. Revalidate over the
// network on every online request; cache only for an offline fallback.
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

/** صفحه: شبکه اول، کش پشتیبان */
async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    /* هیچ نسخه‌ای نداریم — صفحه آفلاین.
       بهتر از صفحه دایناسور مرورگر: دست‌کم می‌گوید مشکل از
       اینترنت است نه از فروشگاه، و راه تماس می‌دهد. */
    const off = await cache.match('/offline')
             || await (await caches.open(SHELL_CACHE)).match('/offline');
    if (off) return off;
    return new Response('آفلاین هستید.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/** تصویر: کش اول با سقف تعداد */
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

// ═══════════════════════════════════════════
//  رهگیری درخواست‌ها
// ═══════════════════════════════════════════
self.addEventListener('fetch', event => {
  const req = event.request;

  // فقط GET — POST سفارش و پرداخت هرگز نباید دست بخورد
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // فقط دامنه خودمان
  if (url.origin !== self.location.origin) return;

  /* ── قاعده طلایی ──
     API و صفحات حساس اصلاً از سرویس‌ورکر رد نمی‌شوند. با
     `return` بدون respondWith، مرورگر مثل حالت عادی رفتار
     می‌کند — انگار سرویس‌ورکری وجود ندارد. */
  if (isNeverCache(url.pathname)) return;

  // Paths under assets/ are not versioned; do not pin old code or CSS online.
  if (/^\/assets\//.test(url.pathname)) {
    event.respondWith(networkFirstAsset(req));
    return;
  }
  if (/^\/fonts\//.test(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // آیکن‌های ریشه
  if (/^\/(favicon|icon-|apple-touch-icon)/.test(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  /* تصاویر.
     نکته‌ای که یک بار گرفت: لوگوی برند در فهرست پوسته است و در
     SHELL_CACHE می‌نشیند، ولی چون مسیرش با /images/ شروع می‌شود
     به imageStrategy می‌رفت — و آنجا فقط IMG_CACHE نگاه می‌شد.
     نتیجه: آفلاین، لوگو شکسته نشان داده می‌شد در حالی که واقعاً
     در کش بود.

     حالا اول پوسته بررسی می‌شود، بعد کش تصویر. */
  if (/^\/images\//.test(url.pathname) ||
      /\.(jpg|jpeg|png|webp|svg|gif)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      /* `ignoreVary` لازم است: سرور برای تصویر هدر
         `Vary: Accept` می‌فرستد (به‌خاطر ارائه خودکار WebP). بدون
         این گزینه، مرورگر پاسخ کش‌شده را با درخواست تازه هم‌خوان
         نمی‌داند و رد می‌کند — حتی وقتی نشانی دقیقاً یکی است.

         این دقیقاً همان چیزی بود که لوگوی برند را در صفحه آفلاین
         می‌شکست، در حالی که فایل واقعاً در کش بود. */
      const shell = await caches.open(SHELL_CACHE);
      const inShell = await shell.match(req, { ignoreVary: true });
      if (inShell) return inShell;
      return imageStrategy(req);
    })());
    return;
  }

  // صفحات HTML
  const wantsHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (wantsHTML) {
    event.respondWith(networkFirst(req));
    return;
  }

  // بقیه: دست نمی‌زنیم
});

/**
 * پیام از صفحه — برای به‌روزرسانی فوری پس از استقرار تازه.
 * صفحه می‌تواند `postMessage({type:'SKIP_WAITING'})` بفرستد تا
 * نسخه تازه بدون بستن همه تب‌ها فعال شود.
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
