/**
 * استخراج وابستگی یک بلوک کد — با تحلیل نحوی، نه regex.
 *
 * چرا وجود دارد:
 *   در تفکیک RBAC از regex استفاده شد و **چهار وابستگی جا افتاد**
 *   (`otp`, `notify`, `faNum`, `getToken`). الگوی
 *   `otp.normalizeMobile()` به‌عنوان استفاده از متغیر `otp`
 *   تشخیص داده نشد.
 *
 *   نتیجه: `node -c` سبز داد، سرور بالا آمد، ولی
 *   `POST /api/admin/staff` خطای داخلی می‌داد. فقط آزمون واقعی
 *   گرفتش.
 *
 * روش:
 *   کد را با `new Function` می‌سنجیم و از پیام خطای موتور
 *   جاوااسکریپت استفاده نمی‌کنیم — به‌جایش شناسه‌ها را با
 *   توکن‌سازی ساده ولی **آگاه از رشته و کامنت** استخراج می‌کنیم.
 *
 *   چرا توکن‌سازی دستی و نه یک پارسر کامل:
 *   پروژه هیچ وابستگی بیرونی ندارد و افزودن یک پارسر برای
 *   ابزار توسعه، خلاف همان اصلی است که کل پروژه رویش بنا شده.
 *   این توکن‌ساز برای هدفش کافی است: رشته‌ها، کامنت‌ها، الگوهای
 *   قالبی و ویژگی‌های شیء را کنار می‌گذارد.
 *
 * محدودیت صادقانه:
 *   این ابزار **جایگزین آزمون نیست**. فهرست نامزد می‌دهد تا
 *   انسان بررسی کند. تنها تأیید واقعی، اجرای هر مسیر است.
 */
'use strict';

/** کلیدواژه‌ها و سراسری‌هایی که وابستگی به شمار نمی‌روند */
const IGNORE = new Set([
  // کلیدواژه‌های زبان
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'function', 'const', 'let', 'var',
  'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'this',
  'try', 'catch', 'finally', 'throw', 'await', 'async', 'yield',
  'class', 'extends', 'super', 'void', 'null', 'true', 'false',
  'undefined', 'NaN', 'Infinity',
  // سراسری‌های استاندارد
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Proxy',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'console',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'process', 'Buffer', 'require', 'module', 'exports', '__dirname',
  '__filename', 'globalThis', 'structuredClone', 'queueMicrotask'
]);

/**
 * توکن‌سازی آگاه از متن: رشته، کامنت و الگوی قالبی را رد می‌کند.
 * @returns {Set<string>} شناسه‌های سطح بالا (نه ویژگی شیء)
 */
function identifiers(src) {
  const out = new Set();
  let i = 0;
  const n = src.length;
  let prevMeaningful = '';   // آخرین نویسه معنادار پیش از توکن

  const isIdStart = c => /[A-Za-z_$]/.test(c);
  const isIdPart  = c => /[A-Za-z0-9_$]/.test(c);

  while (i < n) {
    const c = src[i];

    // ── کامنت خطی ──
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // ── کامنت بلوکی ──
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // ── رشته ساده ──
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      prevMeaningful = q;
      continue;
    }
    // ── الگوی قالبی ──
    // درون ${…} کد واقعی است، پس بازگشتی پردازش می‌شود
    if (c === '`') {
      i++;
      let depth = 0;
      let expr = '';
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`' && depth === 0) { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          depth = 1; i += 2; expr = '';
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (!depth) break; }
            expr += src[i]; i++;
          }
          i++;                                   // بستن }
          for (const id of identifiers(expr)) out.add(id);
          continue;
        }
        i++;
      }
      prevMeaningful = '`';
      continue;
    }
    // ── شناسه ──
    if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdPart(src[j])) j++;
      const word = src.slice(i, j);

      /* ویژگی شیء نیست؟ `a.b` یعنی b وابستگی نیست.
         ولی `a?.b` هم همین است. `obj.prop` را رد می‌کنیم. */
      const isProp = prevMeaningful === '.';

      /* کلید شیء در object literal: `{ key: value }`
         تشخیص ساده: پس از شناسه، دونقطه بیاید و پیش از آن
         `{` یا `,` باشد. این حالت هم وابستگی نیست. */
      let k = j;
      while (k < n && /\s/.test(src[k])) k++;
      const followedByColon = src[k] === ':' && src[k + 1] !== ':';
      const isObjKey = followedByColon &&
                       (prevMeaningful === '{' || prevMeaningful === ',');

      if (!isProp && !isObjKey && !IGNORE.has(word)) out.add(word);

      i = j;
      prevMeaningful = word;
      continue;
    }
    // ── فضای خالی ──
    if (/\s/.test(c)) { i++; continue; }

    prevMeaningful = c;
    i++;
  }
  return out;
}

/**
 * شناسه‌هایی که خودِ بلوک تعریف می‌کند (پس وابستگی بیرونی نیستند).
 * پوشش: const/let/var، پارامترهای تابع پیکانی ساده، تخریب ساده.
 */
function declared(src) {
  const out = new Set();
  const patterns = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s*\{([^}]+)\}/g,
    /\b(?:const|let|var)\s*\[([^\]]+)\]/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      for (const part of m[1].split(',')) {
        const name = part.split(':').pop().split('=')[0].trim()
                         .replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
      }
    }
  }
  return out;
}

/**
 * وابستگی‌های بیرونی یک بلوک.
 * @param {string} block کد بلوک
 * @param {Set<string>|string[]} [available] شناسه‌های موجود در فایل مبدأ
 * @returns {string[]} مرتب‌شده
 */
function externalDeps(block, available) {
  const used = identifiers(block);
  const local = declared(block);
  const avail = available ? new Set(available) : null;

  const deps = [...used]
    .filter(x => !local.has(x))
    .filter(x => (avail ? avail.has(x) : true));

  return deps.sort();
}

module.exports = { identifiers, declared, externalDeps, IGNORE };
