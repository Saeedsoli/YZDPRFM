/**
 * عطر یزد | رسانه مقالات — آپلود تصویر و جاسازی ویدیو
 * ═══════════════════════════════════════════════════
 *
 * ── چرا ماژول جدا ──
 * `parseBody` سقف یک مگابایت دارد و JSON می‌خواند. تصویر نه JSON
 * است نه در آن سقف جا می‌شود. جدا کردنش یعنی سقف و قواعد امنیتی
 * مخصوص خودش را داشته باشد، بدون شل کردن مسیرهای دیگر.
 *
 * ── چرا `multipart/form-data` پیاده نشد ──
 * تجزیه multipart یعنی نوشتن یک parser دستی (چند صد خط، با
 * حالت‌های مرزی فراوان) یا افزودن وابستگی. هر دو برای کاری که
 * با ارسال باینری خام انجام می‌شود، بی‌جهت است.
 *
 * مرورگر فایل را با `fetch(file)` مستقیم می‌فرستد و نام و نوعش
 * در سرآیند می‌آید. ساده‌تر، کم‌خطرتر، بدون وابستگی.
 *
 * ── سه لایه محافظ ──
 *
 *   ۱) **ساختار فایل، نه پسوند.** سربرگ، بخش‌های اصلی و ابعاد
 *      تصویر بررسی می‌شوند. این کنترل رمزگشایی کامل تصویر نیست.
 *
 *   ۲) **نام بازساخته می‌شود.** نام کاربر هرگز مستقیم روی دیسک
 *      نمی‌نشیند — نه `../` می‌ماند، نه نویسه عجیب. نام تازه از
 *      زمان و یک قطعه تصادفی ساخته می‌شود.
 *
 *   ۳) **سقف حجم پیش از خواندن کامل.** اگر `Content-Length` از
 *      سقف بگذرد، اتصال بسته می‌شود؛ و حین دریافت هم شمرده
 *      می‌شود تا سرآیند دروغ کارساز نباشد.
 *
 * ── ویدیو: چرا فقط جاسازی ──
 * سرور لیارا ۲ هسته و ۲ گیگ رم دارد. یک ویدیوی ۵ دقیقه‌ای حدود
 * ۵۰ مگابایت است و پخش همزمان، همان پهنای باند و رمی را می‌بلعد
 * که فروشگاه برای ثبت سفارش لازم دارد. آپارات این بار را برمی‌دارد.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {detect:detectFormat} = require('./image-validation');

const ROOT_DIR = path.resolve(__dirname, '..');

/* ── پوشه مقصد ──
   محلی: `public/images/journal/` — مستقیم سرو می‌شود.

   روی لیارا: `/app/data/journal/` — چون **تنها** `/app/data`
   دیسک پایدار دارد. اگر تصاویر داخل `public/` بمانند، با هر
   استقرار تازه پاک می‌شوند و مقاله‌های منتشرشده تصویرشان را از
   دست می‌دهند.

   این را آزمون نمی‌گرفت: محلی همه‌چیز کار می‌کرد و خرابی فقط
   پس از دومین استقرار روی سرور دیده می‌شد — جایی که کشفش
   گران‌ترین است. */
const MEDIA_DIR = process.env.MEDIA_DIR
  || (process.env.DB_PATH
        ? path.join(path.dirname(process.env.DB_PATH), 'journal')
        : path.join(ROOT_DIR, 'public', 'images', 'journal'));
const MEDIA_URL = '/images/journal';

/** سقف حجم — ۳ مگابایت. تصویر مقاله بیش از این لازم ندارد. */
const DEFAULT_MAX_BYTES=3*1024*1024;
const configuredMax=Number(process.env.MEDIA_MAX_BYTES);
// Invalid or excessive configuration must never silently remove the limit.
const MAX_BYTES=Number.isSafeInteger(configuredMax)&&configuredMax>=1024&&configuredMax<=16*1024*1024 ? configuredMax : DEFAULT_MAX_BYTES;

// Format detection performs bounded container and dimension checks, but it is
// not a full decoder or a guarantee that an uploaded image is harmless.

function ensureDir() {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/**
 * نام امن می‌سازد.
 *
 * بخشی از نام اصلی نگه داشته می‌شود تا مدیر بعداً فایل را بشناسد،
 * ولی فقط حرف و رقم لاتین — هر چیز دیگری حذف می‌شود. اگر چیزی
 * نماند، `img` جایگزین می‌شود.
 */
function safeName(original, ext) {
  const base = String(original || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .toLowerCase() || 'img';
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${base}-${stamp}${rand}.${ext}`;
}

/**
 * بدنه باینری را می‌خواند، با سقف حجم.
 *
 * سقف دو بار بررسی می‌شود: یک بار روی `Content-Length` که سریع
 * است، و یک بار حین دریافت که سرآیند دروغ را هم می‌گیرد.
 */
function readBinary(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BYTES) {
      req.destroy();
      return reject(new Error(`حجم فایل بیش از ${Math.round(MAX_BYTES / 1024 / 1024)} مگابایت است.`));
    }
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BYTES) {
        req.destroy();
        return reject(new Error(`حجم فایل بیش از ${Math.round(MAX_BYTES / 1024 / 1024)} مگابایت است.`));
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new Error('خطا در دریافت فایل.')));
  });
}

/**
 * ذخیره تصویر آپلودشده.
 * @returns {{ok:true, name:string, url:string, size:number} | {ok:false, error:string}}
 */
async function saveUpload(req, originalName) {
  let buf;
  try { buf = await readBinary(req); }
  catch (e) { return { ok: false, error: e.message }; }

  if (!buf.length) return { ok: false, error: 'فایلی دریافت نشد.' };

  const fmt = detectFormat(buf);
  if (!fmt) {
    /* پیام عمداً می‌گوید «محتوا»، نه «پسوند» — چون کاربری که
       فایل PDF را به `.jpg` تغییر نام داده باید بفهمد مشکل کجاست. */
    return { ok: false, error: 'محتوای فایل تصویر معتبر نیست. تنها JPG، PNG، WebP و GIF پذیرفته می‌شود.' };
  }

  try {
    ensureDir();
    for(let attempt=0;attempt<4;attempt++){
      const name=safeName(originalName,fmt.ext),full=path.join(MEDIA_DIR,name);
      if(path.resolve(path.dirname(full))!==path.resolve(MEDIA_DIR))return {ok:false,error:'نام فایل نامعتبر است.'};
      try {
        // Exclusive creation never overwrites an existing image or follows a
        // pre-existing symlink, even if name generation collides.
        fs.writeFileSync(full,buf,{flag:'wx',mode:0o600});
        return {ok:true,name,url:`${MEDIA_URL}/${name}`,size:buf.length,format:fmt.ext};
      } catch(e) {if(e.code!=='EEXIST')throw e;}
    }
    return {ok:false,error:'ذخیره فایل ناموفق بود؛ دوباره تلاش کنید.'};
  } catch {return {ok:false,error:'ذخیره فایل ناموفق بود.'};}
}

/** فهرست تصاویر آپلودشده — تازه‌ترین اول */
function list(limit = 60) {
  ensureDir();
  try {
    return fs.readdirSync(MEDIA_DIR)
      .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
      .map(f => {
        const st = fs.statSync(path.join(MEDIA_DIR, f));
        return { name: f, url: `${MEDIA_URL}/${f}`, size: st.size, at: st.mtimeMs };
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  } catch { return []; }
}

/** حذف یک تصویر آپلودشده */
function remove(name) {
  const clean = path.basename(String(name || ''));
  if (!clean || !/\.(jpe?g|png|webp|gif)$/i.test(clean)) {
    return { ok: false, error: 'نام فایل نامعتبر است.' };
  }
  const full = path.join(MEDIA_DIR, clean);
  if (!full.startsWith(MEDIA_DIR) || !fs.existsSync(full)) {
    return { ok: false, error: 'فایل یافت نشد.' };
  }
  try { fs.unlinkSync(full); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

/* ═══════════════════════════════════════════
   تصاویر موجود پروژه — برای انتخاب کاور
   ═══════════════════════════════════════════
   ۲۵۲ تصویر محصول از قبل هست. مدیر باید بتواند از همان‌ها هم
   استفاده کند، نه اینکه مجبور به آپلود دوباره شود. */
function stockImages(limit = 200) {
  const out = [];
  const push = (dir, urlBase) => {
    const abs = path.join(ROOT_DIR, 'public', dir);
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs)
      /* نسخه‌های `-sm` کنار گذاشته می‌شوند: نسخه کوچک همان تصویر
         بزرگ است و نمایش هر دو، فهرست را دو برابر و بی‌فایده
         می‌کند. `.webp` هم همین‌طور — همتای `.jpg` دارد. */
      .filter(f => /\.jpg$/i.test(f) && !/-sm\.jpg$/i.test(f))
      .forEach(f => out.push({ name: f, url: `${urlBase}/${f}` }));
  };
  push('images', '/images');
  push('images/products', '/images/products');
  return out.slice(0, limit);
}

/* ═══════════════════════════════════════════
   ویدیوی آپارات
   ═══════════════════════════════════════════ */

/**
 * شناسه ویدیوی آپارات را از هر شکل ورودی بیرون می‌کشد.
 *
 * مدیر ممکن است نشانی کامل، کد جاسازی، یا فقط شناسه را بچسباند.
 * هر سه باید کار کند — وگرنه باید مستندات بخواند تا یک ویدیو
 * بگذارد.
 *
 * شناسه آپارات ترکیبی از حرف و رقم است، معمولاً ۸ تا ۱۵ نویسه.
 *
 * @returns {string|null} شناسه پاک‌شده، یا null اگر معتبر نبود
 */
function aparatId(input) {
  const s = String(input || '').trim();
  if (!s) return null;

  const patterns = [
    /aparat\.com\/v\/([A-Za-z0-9]+)/i,          // نشانی معمولی
    /aparat\.com\/video\/video\/embed\/videohash\/([A-Za-z0-9]+)/i,  // کد جاسازی
    /^aparat\/([A-Za-z0-9]+)$/i,                 // نحو خودمان
    /^([A-Za-z0-9]{5,20})$/                      // فقط شناسه
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/** نشانی جاسازی از شناسه */
function aparatEmbed(id) {
  return `https://www.aparat.com/video/video/embed/videohash/${id}/vt/frame`;
}

module.exports = {
  saveUpload, list, remove, stockImages,
  aparatId, aparatEmbed,
  MEDIA_DIR, MEDIA_URL, MAX_BYTES,
  _internals: { detectFormat, safeName }
};
