'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {detect:detectFormat} = require('./image-validation');

const ROOT_DIR = path.resolve(__dirname, '..');

const MEDIA_DIR = process.env.MEDIA_DIR
  || (process.env.DB_PATH
        ? path.join(path.dirname(process.env.DB_PATH), 'journal')
        : path.join(ROOT_DIR, 'public', 'images', 'journal'));
const MEDIA_URL = '/images/journal';

const DEFAULT_MAX_BYTES=3*1024*1024;
const configuredMax=Number(process.env.MEDIA_MAX_BYTES);

const MAX_BYTES=Number.isSafeInteger(configuredMax)&&configuredMax>=1024&&configuredMax<=16*1024*1024 ? configuredMax : DEFAULT_MAX_BYTES;

function ensureDir() {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

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

async function saveUpload(req, originalName) {
  let buf;
  try { buf = await readBinary(req); }
  catch (e) { return { ok: false, error: e.message }; }

  if (!buf.length) return { ok: false, error: 'فایلی دریافت نشد.' };

  const fmt = detectFormat(buf);
  if (!fmt) {

    return { ok: false, error: 'محتوای فایل تصویر معتبر نیست. تنها JPG، PNG، WebP و GIF پذیرفته می‌شود.' };
  }

  try {
    ensureDir();
    for(let attempt=0;attempt<4;attempt++){
      const name=safeName(originalName,fmt.ext),full=path.join(MEDIA_DIR,name);
      if(path.resolve(path.dirname(full))!==path.resolve(MEDIA_DIR))return {ok:false,error:'نام فایل نامعتبر است.'};
      try {

        fs.writeFileSync(full,buf,{flag:'wx',mode:0o600});
        return {ok:true,name,url:`${MEDIA_URL}/${name}`,size:buf.length,format:fmt.ext};
      } catch(e) {if(e.code!=='EEXIST')throw e;}
    }
    return {ok:false,error:'ذخیره فایل ناموفق بود؛ دوباره تلاش کنید.'};
  } catch {return {ok:false,error:'ذخیره فایل ناموفق بود.'};}
}

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

function stockImages(limit = 200) {
  const out = [];
  const push = (dir, urlBase) => {
    const abs = path.join(ROOT_DIR, 'public', dir);
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs)

      .filter(f => /\.jpg$/i.test(f) && !/-sm\.jpg$/i.test(f))
      .forEach(f => out.push({ name: f, url: `${urlBase}/${f}` }));
  };
  push('images', '/images');
  push('images/products', '/images/products');
  return out.slice(0, limit);
}

function aparatId(input) {
  const s = String(input || '').trim();
  if (!s) return null;

  const patterns = [
    /aparat\.com\/v\/([A-Za-z0-9]+)/i,
    /aparat\.com\/video\/video\/embed\/videohash\/([A-Za-z0-9]+)/i,
    /^aparat\/([A-Za-z0-9]+)$/i,
    /^([A-Za-z0-9]{5,20})$/
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

function aparatEmbed(id) {
  return `https://www.aparat.com/video/video/embed/videohash/${id}/vt/frame`;
}

module.exports = {
  saveUpload, list, remove, stockImages,
  aparatId, aparatEmbed,
  MEDIA_DIR, MEDIA_URL, MAX_BYTES,
  _internals: { detectFormat, safeName }
};
