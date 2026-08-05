/**
 * عطر یزد | پروفایل بویایی
 * ────────────────────────
 *
 * چه مسئله‌ای را حل می‌کند:
 *   کوییز پیشنهاد رایحه ساخته شده بود ولی یک اسباب‌بازی یک‌بارمصرف
 *   بود: کاربر شش سؤال جواب می‌داد، شش پیشنهاد می‌گرفت، و همه‌چیز
 *   همان‌جا تمام می‌شد. دفعه بعد که برمی‌گشت، سایت هیچ‌چیز از او
 *   به یاد نداشت.
 *
 *   حالا پاسخ‌ها به‌عنوان «پروفایل بویایی» ذخیره می‌شوند و صفحه
 *   اصلی بر اساسشان تغییر می‌کند.
 *
 * چرا این ماژول جداست:
 *   منطق امتیازدهی داخل مسیر `/api/quiz` در server.js نوشته شده
 *   بود. برای استفاده دوباره در «پیشنهاد برای شما» یا باید کپی
 *   می‌شد یا بیرون کشیده. کپی کردن یعنی دو نسخه که دیر یا زود
 *   واگرا می‌شوند — همان دسته باگی که در این پروژه با `coverOf`
 *   یک بار اتفاق افتاد.
 *
 * ذخیره‌سازی — دو لایه:
 *   ۱) کاربر واردشده  → ستون `taste_profile` در جدول customers
 *   ۲) مهمان          → localStorage در مرورگر
 *
 *   لایه دوم مهم‌تر است: اکثر بازدیدکنندگان ثبت‌نام نمی‌کنند و
 *   قابلیتی که فقط برای کاربر واردشده کار کند، عملاً برای هیچ‌کس
 *   کار نمی‌کند.
 */

'use strict';

/** پاسخ‌های معتبر — هر چیز دیگری دور ریخته می‌شود */
const VALID = {
  gender:      ['MEN', 'WOMEN', 'UNISEX', 'ANY'],
  temperature: ['گرم', 'خنک', 'معتدل', 'ANY'],
  season:      ['بهار و تابستان', 'پاییز و زمستان', 'چهارفصل', 'ANY'],
  occasion:    ['رسمی', 'روزمره', 'عاشقانه', 'ANY'],
  family:      ['شرقی', 'چوبی', 'گلی', 'مرکباتی', 'آروماتیک', 'ANY'],
  budget:      ['low', 'mid', 'high', 'ANY']
};

const KEYS = Object.keys(VALID);

/**
 * پاک‌سازی پاسخ‌های ورودی.
 *
 * چرا فهرست سفید و نه بررسی نوع:
 *   ورودی از مرورگر می‌آید و ممکن است آرایه، عدد منفی یا شیء
 *   تودرتو باشد. با فهرست سفید، هر چیزی که دقیقاً در فهرست نباشد
 *   کنار می‌رود — بدون نیاز به حدس زدن حمله‌های ممکن.
 *
 * @returns {object} فقط کلیدهای معتبر با مقادیر معتبر
 */
function sanitize(answers) {
  const out = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return out;

  for (const k of KEYS) {
    const v = answers[k];
    if (typeof v !== 'string') continue;      // آرایه، عدد، undefined
    if (!VALID[k].includes(v)) continue;      // مقدار خارج از فهرست
    if (v === 'ANY') continue;                // «فرقی نمی‌کند» = بی‌قید
    out[k] = v;
  }
  return out;
}

/** آیا پروفایل به‌قدر کافی مشخص است که ارزش ذخیره داشته باشد؟ */
function isMeaningful(clean) {
  return Object.keys(clean || {}).length >= 2;
}

/**
 * امتیاز یک محصول در برابر پاسخ‌های کوییز.
 *
 * وزن‌ها عمدی‌اند:
 *   جنسیت و خانواده بویایی ۳ — تعیین‌کننده‌ترین لایه‌های سلیقه
 *   طبع، فصل و موقعیت ۲     — مهم ولی انعطاف‌پذیرتر
 *
 * `matches` شمار معیارهایی است که کاربر واقعاً مشخص کرده، تا
 * `norm` بتواند کسی که دو سؤال جواب داده را با کسی که شش سؤال
 * جواب داده مقایسه کند.
 */
function scoreProduct(row, a) {
  let score = 0, matches = 0;

  if (a.gender) {
    matches++;
    if (row.gender === a.gender) score += 3;
    else if (row.gender === 'UNISEX') score += 1;
  }

  if (a.temperature) {
    matches++;
    const t = row.temperature || '';
    if (t.includes(a.temperature)) score += 2;
    else if (a.temperature === 'معتدل' && (t.includes('گرم') || t.includes('خنک'))) score += 1;
  }

  if (a.season) {
    matches++;
    const s = row.season || '';
    if (s.includes(a.season.replace(' و ', '')) || a.season.includes(s.replace(' و ', ''))) score += 2;
    else if (s === 'چهارفصل') score += 1;
  }

  if (a.occasion) {
    matches++;
    const o = row.occasion || '';
    if (a.occasion === 'رسمی'    && /رسمی|اداری|مجلسی/.test(o)) score += 2;
    else if (a.occasion === 'روزمره'  && /روزمره|کژوال|ورزشی/.test(o)) score += 2;
    else if (a.occasion === 'عاشقانه' && /عاشقانه|شبانه|قرار/.test(o)) score += 2;
    else if (o.includes(a.occasion)) score += 2;
  }

  if (a.family) {
    matches++;
    const f = row.family_fa || '';
    if (f.includes(a.family)) score += 3;
    else if (a.family === 'شرقی'     && /عود|شرقی|تنباکو/.test(f)) score += 2;
    else if (a.family === 'چوبی'     && /چوب|چرم/.test(f)) score += 2;
    else if (a.family === 'گلی'      && /گل|پودر/.test(f)) score += 2;
    else if (a.family === 'مرکباتی'  && /مرکبات|آبزی|میوه/.test(f)) score += 2;
    else if (a.family === 'آروماتیک' && /آروماتیک|فوژه|سبز/.test(f)) score += 2;
  }

  return { score, matches, norm: matches ? score / matches : 0 };
}

/** آیا قیمت در محدوده بودجه انتخابی هست؟ */
function inBudget(minPrice, budget) {
  if (!budget || budget === 'ANY') return true;
  const mp = minPrice || 0;
  if (budget === 'low')  return mp < 2000000;
  if (budget === 'mid')  return mp >= 2000000 && mp < 5000000;
  if (budget === 'high') return mp >= 5000000;
  return true;
}

/**
 * خلاصه خوانا از پروفایل — برای نمایش به کاربر.
 *
 * چرا لازم است: کاربر باید ببیند سایت چه چیزی از او به یاد دارد.
 * «پیشنهاد بر اساس سلیقه شما» بدون توضیح، مبهم و کمی نگران‌کننده
 * است؛ با توضیح، شفاف و قابل کنترل.
 */
function describe(clean) {
  const parts = [];
  const G = { MEN: 'مردانه', WOMEN: 'زنانه', UNISEX: 'یونیسکس' };
  if (clean.gender)      parts.push(G[clean.gender] || clean.gender);
  if (clean.family)      parts.push(clean.family);
  if (clean.temperature) parts.push(`طبع ${clean.temperature}`);
  if (clean.season)      parts.push(clean.season);
  if (clean.occasion)    parts.push(clean.occasion);
  return parts;
}

/**
 * ساخت لایه پروفایل بویایی.
 *
 * @param {object} db          نمونه better-sqlite3
 * @param {function} parseProduct  تبدیل ردیف خام به شیء محصول
 */
function build(db, helpers) {
  const { parseProduct, attachVariants } = helpers;

  /**
   * پیشنهاد بر پایه پروفایل.
   *
   * سه قاعده که از درس‌های ویترین خودکار آمده‌اند:
   *   ۱) از هر برند حداکثر دو تا — وگرنه شبیه تبلیغ یک برند می‌شود
   *   ۲) بودجه روی قیمت واقعی اعمال می‌شود، نه حدسی
   *   ۳) اگر پروفایل خیلی سخت‌گیر بود و نتیجه کم آمد، بودجه
   *      نادیده گرفته می‌شود — فهرست خالی بدترین حالت است
   */
  function recommend(answers, limit = 8, opts = {}) {
    const a = sanitize(answers);

    /* ── حالت بی‌قید ──
       اگر کاربر به همه سؤال‌ها «فرقی نمی‌کند» بدهد (یا هیچ پاسخی
       ندهد)، هیچ معیاری برای امتیازدهی نمی‌ماند و همه محصولات
       امتیاز صفر می‌گیرند.

       نسخه اول اینجا فهرست خالی برمی‌گرداند — که کوییز را برای
       کاربرِ «همه را نشانم بده» به بن‌بست می‌برد. آزمون محتوا
       همین را گرفت.

       `requireProfile` فقط برای «پیشنهاد برای شما» روشن است: آنجا
       ادعای «بر اساس سلیقه شما» بدون سلیقه، بی‌معناست. ولی کوییز
       باید همیشه چیزی نشان دهد. */
    const unconstrained = Object.keys(a).filter(k => k !== 'budget').length === 0;
    if (unconstrained && opts.requireProfile) {
      return { items: [], profile: a, relaxed: false };
    }

    const rows = db.prepare('SELECT * FROM products').all();

    const scored = rows
      .map(row => ({ row, ...scoreProduct(row, a) }))
      // در حالت بی‌قید همه امتیاز صفرند، پس فیلتر امتیاز کنار می‌رود
      .filter(s => unconstrained || s.score > 0)
      .sort((x, y) => y.score - x.score || y.norm - x.norm ||
                      String(x.row.id).localeCompare(String(y.row.id)));

    const pick = (respectBudget) => {
      const brandCount = {};
      const out = [];
      for (const s of scored) {
        if (out.length >= limit) break;
        const b = s.row.brand_fa || '—';
        if ((brandCount[b] || 0) >= 2) continue;

        const p = attachVariants(parseProduct(s.row));
        if (respectBudget && !inBudget(p.min_price, a.budget)) continue;

        brandCount[b] = (brandCount[b] || 0) + 1;
        out.push({
          id: p.id, slug: p.slug,
          name_fa: p.name_fa, name_en: p.name_en,
          brand_fa: p.brand_fa, brand_en: p.brand_en,
          gender: p.gender, family_fa: p.family_fa, family_slug: p.family_slug,
          season: p.season, occasion: p.occasion,
          /* نُت‌های آغازین همین‌جا برمی‌گردند. نسخه اول در server.js
             برای هر نتیجه یک کوئری جدا می‌زد تا نُت‌ها را بگیرد —
             ۸ کوئری اضافه برای داده‌ای که همین‌جا در دست بود. */
          notes_top: (p.notes?.top || []).slice(0, 3),
          image_url: p.image_url, min_price: p.min_price,
          _score: s.score
        });
      }
      return out;
    };

    let items = pick(true);
    let relaxed = false;

    /* اگر بودجه فهرست را تقریباً خالی کرد، بدون آن دوباره
       می‌گردیم و صادقانه اعلام می‌کنیم. کاربری که بودجه اقتصادی
       زده و سلیقه‌اش فقط در محصولات گران پیدا می‌شود، بهتر است
       گزینه‌ها را با هشدار ببیند تا اینکه صفحه خالی بگیرد. */
    if (items.length < 3 && a.budget) {
      const wider = pick(false);
      if (wider.length > items.length) { items = wider; relaxed = true; }
    }

    return { items, profile: a, relaxed };
  }

  /**
   * یافتن شناسه مشتری از روی موبایل — و ساخت رکورد اگر نبود.
   *
   * چرا لازم شد: ورود با کد یکبارمصرف فقط یک **نشست** می‌سازد و
   * رکورد `customers` ایجاد نمی‌کند. یعنی کاربری که با پیامک وارد
   * شده ولی هرگز ثبت‌نام نکرده، جایی برای ذخیره پروفایل نداشت و
   * `profile_saved` بی‌صدا false برمی‌گشت — بدون هیچ خطایی.
   *
   * این دقیقاً همان دسته باگی است که فقط با آزمون واقعیِ مسیر
   * ورود پیدا می‌شود، نه با خواندن کد.
   *
   * رکورد حداقلی ساخته می‌شود: فقط موبایل. نام واقعی هنگام
   * نخستین سفارش یا تکمیل پروفایل پر می‌شود.
   */
  function resolveCustomerId(mobile) {
    if (!mobile) return null;
    const row = db.prepare('SELECT id FROM customers WHERE mobile=?').get(mobile);
    if (row) return row.id;
    try {
      const r = db.prepare(
        `INSERT INTO customers (mobile, first_name) VALUES (?, ?)`
      ).run(mobile, 'مشتری');
      return r.lastInsertRowid;
    } catch {
      // رقابت هم‌زمانی: رکورد بین SELECT و INSERT ساخته شد
      const again = db.prepare('SELECT id FROM customers WHERE mobile=?').get(mobile);
      return again ? again.id : null;
    }
  }

  /** خواندن پروفایل ذخیره‌شده یک مشتری */
  function getProfile(customerId) {
    const row = db.prepare(
      'SELECT taste_profile, taste_updated_at FROM customers WHERE id=?'
    ).get(customerId);
    if (!row || !row.taste_profile) return null;
    try {
      const parsed = JSON.parse(row.taste_profile);
      return { answers: sanitize(parsed), updated_at: row.taste_updated_at };
    } catch { return null; }
  }

  /**
   * ذخیره پروفایل.
   *
   * فقط پاسخ‌های پاک‌شده ذخیره می‌شوند — نه هر چیزی که مرورگر
   * فرستاده. اگر پروفایل بی‌معنا باشد (کمتر از دو معیار)، چیزی
   * ذخیره نمی‌شود تا «پیشنهاد اختصاصی» بر پایه یک جواب ساخته نشود.
   */
  function saveProfile(customerId, answers) {
    const clean = sanitize(answers);
    if (!isMeaningful(clean)) return false;
    db.prepare(
      `UPDATE customers SET taste_profile=?, taste_updated_at=datetime('now')
       WHERE id=?`
    ).run(JSON.stringify(clean), customerId);
    return true;
  }

  /** حذف پروفایل — کاربر باید بتواند فراموش شود */
  function clearProfile(customerId) {
    db.prepare(
      'UPDATE customers SET taste_profile=NULL, taste_updated_at=NULL WHERE id=?'
    ).run(customerId);
    return true;
  }

  return {
    recommend, getProfile, saveProfile, clearProfile, resolveCustomerId,
    sanitize, isMeaningful, describe, scoreProduct, inBudget, VALID
  };
}

module.exports = { build, sanitize, isMeaningful, describe, VALID };
