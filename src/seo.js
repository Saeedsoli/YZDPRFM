/**
 * عطر یزد | تزریق متادیتا سمت سرور
 * ------------------------------------
 * صفحه محصول کلاینت‌ساید رندر می‌شود، اما خزنده‌های گوگل، تلگرام و
 * واتساپ جاوااسکریپت اجرا نمی‌کنند. این ماژول پیش از ارسال HTML،
 * عنوان و متادیتا را با داده واقعی محصول جایگزین می‌کند.
 */

/* منبع واحد تبدیل متن مقاله به HTML — همان منطقی که
   `public/article.html` سمت مرورگر اجرا می‌کند. */
const { renderArticle } = require('./article-render');

const SITE = process.env.SITE_URL || 'https://yazdperfume.ir';
const BRAND = 'عطر یزد';

/** حساب‌های رسمی — برای schema.org/sameAs */
const SOCIAL_LINKS = [
  'https://instagram.com/yazdperfume',
  'https://t.me/yazdperfume_admin'
];

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// JSON embedded in HTML is still parsed by the HTML parser: a literal
// </script> must never be allowed to terminate the data block.
function jsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&]/g, ch => ({'<':'\\u003c','>':'\\u003e','&':'\\u0026'}[ch]));
}

function faNum(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

/** بلوک متای مشترک */
function metaBlock({ title, description, url, image, type = 'website', extra = '' }) {
  const t = esc(title), d = esc(description);
  return `
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:site_name" content="${BRAND}">
  <meta property="og:locale" content="fa_IR">
  <meta property="og:type" content="${esc(type)}">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:url" content="${esc(url)}">
  ${image ? `<meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="1200">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  ${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
${extra}`;
}

/** جایگزینی عنوان، توضیح و افزودن متا در HTML */
function inject(html, { title, description, meta }) {
  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);

  if (/<meta name="description"[^>]*>/.test(out)) {
    out = out.replace(/<meta name="description"[^>]*>/,
      `<meta name="description" content="${esc(description)}">`);
  } else {
    out = out.replace('</title>', `</title>\n  <meta name="description" content="${esc(description)}">`);
  }

  return out.replace('</head>', `${meta}\n</head>`);
}

/* ═══════════ صفحه محصول ═══════════ */
function productPage(html, p) {
  const full = p.brand_fa ? `${p.brand_fa} — ${p.name_fa}` : p.name_fa;

  /* عنوان هم نباید برای همه صفحه‌ها یک الگو باشد. خانواده بویایی
     را داخل عنوان می‌آوریم چون هم متمایزکننده است و هم عبارتی
     است که مشتری واقعاً جستجو می‌کند («عطر چوبی مردانه»). */
  const famShort = String(p.family_fa || '').split(' ').slice(0, 2).join(' ');
  const title = famShort
    ? `${full} | عطر دست‌ساز ${famShort} — ${BRAND}`
    : `${full} | عطر دست‌ساز — ${BRAND}`;

  const notes = [...(p.notes.top || []), ...(p.notes.middle || [])].slice(0, 5).join('، ');
  const gender = p.gender === 'MEN' ? 'مردانه' : p.gender === 'WOMEN' ? 'زنانه' : p.gender === 'UNISEX' ? 'یونیسکس' : '';

  /* ── چرا توضیح متا از داده اختصاصی هر عطر ساخته می‌شود ──
     نسخه پیشین برای محصولات یک جمله ثابت داشت:
     «… از X تومان. سمپل ۳ میلی‌لیتری موجود است.» نمونه‌گیری از
     ۲۵ صفحه نشان داد ۱۰۰٪ توضیح‌ها با همان جمله تمام می‌شوند و
     ۱۰۰٪ عنوان‌ها الگوی «خرید … | عطر دست‌ساز عطر یزد» دارند.

     برای خزنده این یعنی «صفحه‌ها از یک قالب پر شده‌اند» — همان
     سیگنالی که سیاست محتوای انبوه دنبالش می‌گردد. مشکل، AI بودنِ
     متن نیست؛ یکسان بودنِ ساختار است. متنِ دست‌نویسِ قالبی هم
     همین امتیاز را می‌گرفت.

     راه‌حل: به‌جای جمله ثابت، از فیلدهایی استفاده می‌کنیم که در
     دیتابیس برای هر عطر متفاوت‌اند — `taste` (۲٬۰۷۷ مقدار یکتا)
     و `occasion` (۱٬۷۰۱ مقدار یکتا). ترتیب جمله‌ها هم با هش
     پایدارِ اسلاگ می‌چرخد تا حتی اسکلت جمله هم یکسان نماند.

     پایدار بودن هش مهم است: اگر تصادفی بود، هر بار خزنده صفحه
     را می‌خواند توضیح فرق می‌کرد و گوگل صفحه را «بی‌ثبات»
     می‌دید. */
  const seed = [...p.slug].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const price = Number(p.min_price) > 0 ? `از ${faNum(Number(p.min_price).toLocaleString('en-US'))} تومان` : '';

  /* جمله دومِ اختصاصی — اولویت با یکتاترین فیلد موجود. */
  const taste = String(p.taste || '').trim();
  const occasion = String(p.occasion || '').trim();
  const detail =
      taste    ? `طبع ${p.temperature || ''}، ${taste}`.replace(/طبع ، /, '')
    : occasion ? `مناسب ${occasion}`
    : notes    ? `نُت‌های رایحه مرجع: ${notes}`
    : '';

  /* سه اسکلت جمله؛ انتخاب با هش پایدار. */
  const shapes = [
    () => [ `${full} — بازآفرینی دست‌ساز${gender ? ' ' + gender : ''}`, detail, price ],
    () => [ detail, `${full}${gender ? `، ${gender}` : ''}، بازآفرینی دست‌ساز عطر یزد`, price ],
    () => [ `${full} (${p.family_fa || 'رایحه'})${gender ? ' ' + gender : ''}${detail ? ' — ' + detail : ''}`, price ]
  ];
  const description = (shapes[seed % shapes.length]().filter(Boolean).join('. ') + '.')
    .replace(/\s+/g, ' ').trim().slice(0, 300);

  const url = `${SITE}/perfume/${p.slug}`;
  const image = SITE + p.image_url;

  const inStock = (p.variants || []).some(v => v.stock > 0 && v.price_toman > 0);
  const prices = (p.variants || []).map(v => v.price_toman).filter(v => Number.isFinite(v) && v > 0);

  /* ── چرا availability سه‌حالته است، نه دوحالته ──
     پیش‌تر این خط فقط `inStock ? InStock : OutOfStock` بود. چون
     امروز فقط یک محصول از ۲٬۱۱۱ موجودی انبار دارد، عملاً همه
     صفحه‌ها به گوگل می‌گفتند «ناموجود» — در حالی که صفحه به
     مشتری می‌گوید «به سفارش ساخته می‌شود» و دکمه خرید فعال است.

     این «عدم تطابق داده ساختاریافته با صفحه فرود» است؛ همان
     چیزی که در مستندات مرچنت گوگل صراحتاً باعث رد شدن محصول
     می‌شود. یعنی بدترین حالت: هم کارت غنی را از دست می‌دادیم،
     هم به گوگل سیگنال «۲٬۱۱۰ صفحهٔ بی‌فایده» می‌فرستادیم.

     نگاشت درست:
       IN_STOCK  + موجودی    → InStock
       MADE_TO_ORDER         → BackOrder  (سفارش می‌گیریم، بعداً
                               می‌سازیم و می‌فرستیم — دقیقاً تعریف
                               BackOrder در schema.org)
       UNAVAILABLE           → OutOfStock

     ⚠ BackOrder ایجاب می‌کند زمان ارسال روی صفحه دیده شود؛
     صفحه محصول «تحویل ۳ تا ۷ روز کاری» را نشان می‌دهد، پس شرط
     برقرار است. */
  const mode = p.supply_mode || 'UNAVAILABLE';
  const hasPricedVariant = (p.variants || []).some(v => v.price_toman > 0);
  const availability = !['IN_STOCK','MADE_TO_ORDER'].includes(mode) || !hasPricedVariant
    ? 'https://schema.org/OutOfStock'
    : inStock ? 'https://schema.org/InStock'
    : mode === 'MADE_TO_ORDER' ? 'https://schema.org/BackOrder'
    : 'https://schema.org/OutOfStock';

  // Schema.org — گوگل قیمت و موجودی را در نتایج نشان می‌دهد
  const schema = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: full,
    alternateName: p.name_en,
    image: [image],
    description: description.slice(0, 300),
    sku: p.variants?.[0]?.sku,
    /* ── چرا brand نام فروشگاه است، نه «کرید» ──
       ممیزی جعبه‌سیاه این را به‌عنوان ایراد سئو علامت زد: گوگل
       انتظار دارد `brand` سازنده باشد، و «کرید» جستجوی بیشتری
       دارد.

       عمداً تغییر نمی‌دهیم. اعلام «برند: کرید» در داده
       ساختاریافته یعنی به گوگل بگوییم این محصولِ کرید است — که
       نیست. کل هویت این فروشگاه بر شفافیت درباره بازآفرینی
       دست‌ساز بنا شده؛ صفحه «چرا ما» صریح می‌گوید «اورجینال
       نیستند و هرگز چنین ادعایی نداریم».

       نام اصلی در `alternateName` و متن صفحه هست، پس گوگل
       ارتباط را می‌فهمد بدون آنکه ما ادعای دروغ کرده باشیم.

       ترافیک کمتر، ادعای درست. */
    brand: { '@type': 'Brand', name: BRAND },
    category: p.family_fa,
    offers: prices.length ? {
      '@type': 'AggregateOffer',
      /* ── چرا IRR و ضرب در ۱۰ (ممیزی جعبه‌سیاه مرداد ۱۴۰۵) ──
         پیش‌تر `IRT` نوشته شده بود. این کد در استاندارد
         ISO 4217 **وجود ندارد** — تومان واحد رسمی ثبت‌شده نیست.
         گوگل چنین `Offer`ای را نامعتبر می‌داند و قیمت را در
         نتایج جستجو نشان نمی‌دهد؛ یعنی کارت غنی محصول از دست
         می‌رفت.

         کد معتبر `IRR` (ریال) است. ولی قیمت‌های ما به تومان
         ذخیره شده‌اند، پس صرفِ عوض کردن کد یعنی اعلام قیمتی
         ده برابر کمتر — بدتر از نبودش. مقدار هم باید تبدیل شود.

         سایت همچنان به کاربر تومان نشان می‌دهد؛ این تبدیل فقط
         در داده ساختاریافته‌ای است که خزنده می‌خواند. */
      priceCurrency: 'IRR',
      lowPrice: prices.length ? Math.min(...prices) * 10 : 0,
      highPrice: prices.length ? Math.max(...prices) * 10 : 0,
      offerCount: prices.length,
      availability,
      seller: { '@type': 'Organization', name: BRAND }
    } : undefined
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'خانه', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'برندها', item: `${SITE}/brands` },
      { '@type': 'ListItem', position: 3, name: full, item: url }
    ]
  };

  /* پیش‌بارگذاری تصویر اصلی محصول.

     چرا: تصویر گالری با جاوااسکریپت ساخته می‌شود، پس مرورگر تا
     پیش از اجرای اسکریپت و پاسخ API اصلاً نمی‌داند چه عکسی لازم
     دارد. زنجیره می‌شود HTML → JS → API → عکس. روی ۳G بنچمارک
     LCP=۶٫۳ ثانیه نشان داد.

     با این سطر مرورگر همان لحظه‌ای که HTML را می‌خواند دانلود را
     شروع می‌کند — موازی، نه زنجیره‌ای.

     نسخه WebP ترجیح داده می‌شود (۳۹KB در برابر ۱۰۲KB). اگر
     مرورگری WebP نشناسد، `type` باعث می‌شود preload را نادیده
     بگیرد و همان JPG معمولی بارگذاری شود — یعنی بی‌خطر است. */
  const webp = p.image_url.replace(/\.(jpe?g|png)$/i, '.webp');
  const preload = webp !== p.image_url
    ? `  <link rel="preload" as="image" href="${esc(webp)}" type="image/webp" fetchpriority="high">\n`
    : `  <link rel="preload" as="image" href="${esc(p.image_url)}" fetchpriority="high">\n`;

  /* ── noindex برای محصولاتی که نمی‌توانیم تأمین کنیم ──
     این‌ها از sitemap بیرون‌اند، ولی گوگل از راه لینک داخلی
     (کارت‌های «رایحه‌های هم‌خانواده»، جستجوی داخلی) به آن‌ها
     می‌رسد. حذف از sitemap فقط «پیشنهاد نکردن» است، نه «ایندکس
     نکردن».

     `follow` عمدی است و `nofollow` نیست: می‌خواهیم خزنده از
     همین صفحه به محصولات قابل سفارشِ هم‌خانواده برود. صفحه
     خودش ایندکس نشود، ولی مسیر عبور بماند.

     صفحه برای بازدیدکننده کاملاً کار می‌کند — دکمه «خبرم کن»
     دارد. این فقط دستور به خزنده است. */
  const noindex = availability === 'https://schema.org/OutOfStock'
    ? '  <meta name="robots" content="noindex, follow">\n' : '';

  const extra = noindex + preload +
  `  <script type="application/ld+json">${jsonForHtml(schema)}</script>
  <script type="application/ld+json">${jsonForHtml(breadcrumb)}</script>`;

  let out = inject(html, {
    title, description,
    meta: metaBlock({ title, description, url, image, type: 'product', extra })
  });

  /* ── یادداشت عطرساز در HTML خام ──
     چرا سمت سرور و نه فقط با جاوااسکریپت:

     ممیزی سئو نشان داد HTML خام صفحه محصول تنها ۶۳۸ نویسه متن
     خواندنی دارد. یادداشت عطرساز به‌طور میانگین ۲۹۵ نویسه است
     و مهم‌تر: تنها بخشی از صفحه است که در هیچ صفحه دیگری تکرار
     نمی‌شود. اگر فقط با JS ساخته شود، دقیقاً همان محتوایی که
     صفحه را یکتا می‌کند از دید خزنده‌های بدون جاوااسکریپت پنهان
     می‌ماند — و خزنده‌های موتورهای مولد معمولاً همین‌طورند.

     همان الگوی مقاله شاخص در صفحه مجله: بلوک سمت سرور تزریق
     می‌شود و JS بعداً همان را بازنویسی می‌کند. چون محتوا یکی
     است، هیچ جابه‌جایی چیدمانی رخ نمی‌دهد.

     `hidden` هم برداشته می‌شود وگرنه متن در HTML هست ولی
     نمایش داده نمی‌شود — که خودش «متن پنهان» است و در سیاست
     اسپم گوگل مصداق دارد. */
  if (p.maker_note) {
    const by = esc(p.maker_note_by || 'عطرساز عطر یزد');
    out = out.replace(
      '<div class="maker-box" id="makerBox" hidden>',
      '<div class="maker-box" id="makerBox">'
    ).replace(
      '<p id="makerNote"></p>',
      `<p id="makerNote">${esc(p.maker_note)}</p>`
    ).replace(
      '<div class="mk-by" id="makerBy"></div>',
      `<div class="mk-by" id="makerBy">${by}</div>`
    );
  }

  return out;
}

/* ═══════════ صفحه اصلی ═══════════ */
function homePage(html, stats) {
  const title = `${BRAND} | بازآفرینی دست‌ساز رایحه‌های ماندگار`;
  const description =
    `فروشگاه ${BRAND} — ${faNum(stats.products)} رایحه دست‌ساز بازآفرینی‌شده از ` +
    `${faNum(stats.brands)} خانه عطر معتبر جهان. سمپل، ادوپرفیوم و بادی اسپلش دست‌ساز. ` +
    `ارسال به سراسر کشور.`;

  const org = {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: BRAND,
    alternateName: 'Yazd Perfume',
    url: SITE,
    logo: `${SITE}/images/brand-logo-og.png`,
    description,
    /* حساب‌های رسمی — به گوگل می‌گوید این صفحه‌ها متعلق به همین
       فروشگاه‌اند. در پنل دانش گوگل کنار نتیجه نمایش داده می‌شوند
       و از جعل هویت برند جلوگیری می‌کند. */
    sameAs: SOCIAL_LINKS,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/?q={search_term_string}` },
      'query-input': 'required name=search_term_string'
    }
  };

  return inject(html, {
    title, description,
    meta: metaBlock({
      title, description, url: SITE,
      image: `${SITE}/images/products/scene-signature.jpg`,
      extra: `  <script type="application/ld+json">${jsonForHtml(org)}</script>`
    })
  });
}

/* ═══════════ مجله ═══════════ */

/**
 * تصویر جلد یک مقاله.
 *
 * ⚠ این تابع باید **دقیقاً** با `coverOf` در `public/journal.html`
 * یکی بماند. اگر واگرا شوند، سرور یک فایل را preload می‌کند و
 * مرورگر فایل دیگری می‌خواهد — نتیجه دو دانلود و LCP بدتر از
 * حالت بدون preload. یک بار در صفحه محصول همین اتفاق افتاد و
 * LCP از ۶٫۳۵ به ۷٫۱۶ ثانیه رفت.
 */
const JOURNAL_COVERS = {
  notes: '/images/products/family-citrus.jpg',
  guide: '/images/products/scene-signature.jpg',
  video: '/images/products/family-ambery-oriental.jpg'
};

function coverOf(a) {
  return (a && a.cover_image && a.cover_image.startsWith('/images/products'))
    ? a.cover_image
    : (JOURNAL_COVERS[a && a.category] || JOURNAL_COVERS.guide);
}

const CAT_FA = {
  guide: 'راهنمای خرید', notes: 'دانشنامه نُت‌ها', video: 'ویدیوی آموزشی'
};

/**
 * HTML مقاله شاخص — از سمت سرور.
 *
 * چرا: preload تصویر را در ۴۷۰ms می‌رساند، ولی LCP همچنان
 * ۳٬۵۸۴ms بود. علتش با ردیابی نامزدهای LCP معلوم شد — تصویر
 * **دانلود** شده بود ولی هنوز **رندر** نشده، چون تگ `<img>` را
 * جاوااسکریپت پس از پاسخ `/api/articles` می‌سازد.
 *
 * یعنی preload نیمی از مسئله را حل می‌کند: فایل زودتر می‌آید
 * ولی جایی برای نشستن ندارد. حل کامل یعنی تگ از همان اول در
 * HTML باشد.
 *
 * فقط همین یک بلوک سمت سرور رندر می‌شود، نه کل صفحه — تغییر
 * معماری لازم نیست. جاوااسکریپت بعداً همین بلوک را بازنویسی
 * می‌کند (برای فیلتر دسته و جستجو) و چون محتوا یکی است، هیچ
 * جابه‌جایی چیدمانی رخ نمی‌دهد.
 */
function featureHTML(a) {
  if (!a) return '';
  const cover = coverOf(a);
  const webp = cover.replace(/\.(jpe?g|png)$/i, '.webp');
  const label = a.category_label || CAT_FA[a.category] || 'مقاله';
  /* زمان مطالعه داخل bdi می‌رود.
     بدون آن، نقطه‌وسط بین «راهنمای خرید» و «۷ دقیقه» در الگوریتم
     دوطرفه جابه‌جا می‌شد و روی صفحه «راهنمای خرید ۷ ۰ دقیقه»
     خوانده می‌شد — عددی که مشتری آن را «۷۰ دقیقه» می‌فهمد.
     با چشم دیده شد، نه با آزمون. */
  /* ── جداکننده با CSS ساخته می‌شود، نه با نویسه در متن ──
     نقطه‌وسط نویسه «خنثی» است و جهتش را از همسایه می‌گیرد. بین
     متن فارسی و رشته‌ای که با رقم فارسی شروع می‌شود، مرورگر آن
     را **بعد** از عدد می‌گذارد: «راهنمای خرید ۷ · دقیقه» که چشم
     آن را «۷۰ دقیقه» می‌خواند.

     در بزرگ‌نمایی ۳ برابر کشف شد. `bdi` کافی نبود — چه دور عدد
     چه شامل جداکننده — چون نویسه خنثی داخل بلوک RTL باز هم به
     انتها می‌رود.

     راه قطعی: جداکننده اصلاً در جریان متن نباشد. یک `<span>`
     جدا با `::before` که مرورگر آن را عنصر مستقل می‌بیند و
     جابه‌جا نمی‌کند. */
  const read = a.read_time ? `<span class="sep"></span>${esc(a.read_time)}` : '';
  const excerpt = esc(
    (a.excerpt || String(a.content || '').replace(/<[^>]*>/g, '').slice(0, 150) || '')
      .replace(/\s+/g, ' ').trim().slice(0, 165)
  );

  return `<a class="feature" href="/journal/${esc(a.slug)}">
      <div class="im">
        <span class="tag-new">تازه‌ترین</span>
        <picture>
          <source srcset="${esc(webp)}" type="image/webp">
          <img src="${esc(cover)}" alt="" fetchpriority="high" decoding="async">
        </picture>
      </div>
      <div class="bd">
        <div class="k">${esc(label)}${read}</div>
        <h2>${esc(a.title)}</h2>
        <p>${excerpt}</p>
        <div class="go">خواندن مطلب ←</div>
      </div>
    </a>`;
}

/**
 * @param {string} html
 * @param {string} [featuredCover] نشانی تصویر تازه‌ترین مقاله
 */
function journalPage(html, featured) {
  /* سازگاری با گذشته: پیش‌تر فقط نشانی تصویر می‌گرفت. */
  const art = (featured && typeof featured === 'object') ? featured : null;
  const featuredCover = art ? coverOf(art) : (featured || null);
  const title = `مجله آموزشی ${BRAND} | دانشنامه نُت‌ها و راهنمای عطر`;
  const description =
    'دانشنامه نُت‌های بویایی، راهنمای انتخاب رایحه متناسب با شخصیت، ' +
    'و آموزش نگهداری درست عطر — به زبان ساده.';

  /* ── پیش‌بارگذاری تصویر شاخص ──
     تصویر مقاله شاخص، عنصر LCP این صفحه است. ولی جاوااسکریپت
     می‌سازدش، پس مرورگر تا پیش از «HTML → JS → /api/articles»
     اصلاً نمی‌داند چه عکسی لازم دارد.

     ردیابی روی ۳G کند نشان داد تصویر تازه در ۲٬۵۸۵ms شروع
     می‌شود در حالی که HTML در ۴۴۲ms آماده بوده — یعنی بیش از
     دو ثانیه انتظار محض.

     سرور تازه‌ترین مقاله را می‌داند، پس همان‌جا preload می‌زند.
     `fetchpriority=high` تصویر را جلوی صف می‌اندازد تا با فونت‌ها
     رقابت نکند.

     ⚠ درس گران‌بها از صفحه محصول: preload تنها وقتی کار می‌کند
     که نشانی **دقیقاً** با چیزی که مرورگر بعداً می‌خواهد یکی
     باشد. اینجا نسخه WebP را می‌زنیم چون `<picture>` هم همان را
     انتخاب می‌کند. اگر ناهماهنگ باشد، دو فایل دانلود می‌شود و
     LCP بدتر می‌گردد — دقیقاً همان اشتباهی که یک بار کردیم. */
  let extra = '';
  if (featuredCover) {
    const webp = featuredCover.replace(/\.(jpe?g|png)$/i, '.webp');
    extra = webp !== featuredCover
      ? `  <link rel="preload" as="image" href="${esc(webp)}" type="image/webp" fetchpriority="high">`
      : `  <link rel="preload" as="image" href="${esc(featuredCover)}" fetchpriority="high">`;
  }

  let out = inject(html, {
    title, description,
    meta: metaBlock({
      title, description, url: `${SITE}/journal`,
      image: `${SITE}/images/products/scene-signature.jpg`, type: 'article',
      extra
    })
  });

  /* تزریق مقاله شاخص در خودِ HTML — تا تصویر بدون انتظار برای
     جاوااسکریپت رندر شود. جای‌گیر `min-height` هم برداشته
     می‌شود چون دیگر محتوای واقعی آنجاست. */
  if (art) {
    out = out.replace(
      '<div id="feature" style="min-height:54vh"></div>',
      `<div id="feature" data-slug="${esc(art.slug)}">${featureHTML(art)}</div>`
    );
  }
  return out;
}

/* ═══════════ صفحه مقاله ═══════════ */
function articlePage(html, a) {
  const title = `${a.title} | مجله ${BRAND}`;
  const description = (a.excerpt || String(a.content || '').slice(0, 160) || a.title)
    .replace(/\s+/g, ' ').trim().slice(0, 200);
  const url = `${SITE}/journal/${a.slug}`;

  const covers = {
    notes: '/images/products/family-citrus.jpg',
    guide: '/images/products/scene-signature.jpg',
    video: '/images/products/family-ambery-oriental.jpg'
  };
  const img = SITE + ((a.cover_image && a.cover_image.startsWith('/images/products'))
    ? a.cover_image : (covers[a.category] || covers.guide));

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description,
    image: [img],
    datePublished: a.created_at,
    dateModified: a.created_at,
    author: { '@type': 'Organization', name: BRAND },
    publisher: {
      '@type': 'Organization', name: BRAND,
      logo: { '@type': 'ImageObject', url: `${SITE}/images/brand-logo-og.png` }
    },
    /* شمار واژه و متن مقاله — گوگل با این‌ها عمق محتوا را می‌سنجد.
       بدونشان مقاله «کم‌محتوا» ارزیابی می‌شود حتی اگر خوب نوشته
       شده باشد. متن به ۵۰۰۰ نویسه محدود می‌شود تا اندازه صفحه
       بی‌جهت بزرگ نشود. */
    wordCount: String(a.content || '').trim().split(/\s+/).filter(Boolean).length,
    articleBody: String(a.content || '').replace(/\s+/g, ' ').trim().slice(0, 5000),
    inLanguage: 'fa-IR',
    isAccessibleForFree: true,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url }
  };

  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'خانه', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'مجله', item: `${SITE}/journal` },
      { '@type': 'ListItem', position: 3, name: a.title, item: url }
    ]
  };

  /* پیش‌بارگذاری تصویر جلد — عنصر LCP این صفحه است و چون
     سمت سرور تزریقش می‌کنیم، نشانی را از همین‌جا می‌دانیم. */
  const coverPath = (a.cover_image && a.cover_image.startsWith('/images/products'))
    ? a.cover_image : (covers[a.category] || covers.guide);
  const coverWebp = coverPath.replace(/\.(jpe?g|png)$/i, '.webp');
  const preload = coverWebp !== coverPath
    ? `  <link rel="preload" as="image" href="${esc(coverWebp)}" type="image/webp" fetchpriority="high">\n`
    : `  <link rel="preload" as="image" href="${esc(coverPath)}" fetchpriority="high">\n`;

  const extra = preload
    + `  <script type="application/ld+json">${jsonForHtml(schema)}</script>
  <script type="application/ld+json">${jsonForHtml(crumb)}</script>`;

  let out = inject(html, {
    title, description,
    meta: metaBlock({ title, description, url, image: img, type: 'article', extra })
  });

  /* ── رندر متن مقاله سمت سرور ──
     مسئله: HTML خام این صفحه تنها ۱۱۱ نویسه متن داشت، در حالی
     که مقاله‌ها ۲٬۰۰۰ تا ۲٬۴۰۰ نویسه محتوای واقعی دارند. کل
     ارزش صفحه در متنی بود که خزنده بدون اجرای جاوااسکریپت
     نمی‌دید.

     ⚠ نکته‌ای که یک بار نادیده گرفتنش صفحه را خراب می‌کرد:
     `<article id="content">` با `style="display:none"` شروع
     می‌شود و JS پس از بارگذاری نمایشش می‌دهد. اگر فقط متن را
     تزریق می‌کردیم، محتوا در HTML بود ولی **پنهان** —
     که خودش مصداق «متن پنهان» در سیاست اسپم گوگل است. پس
     display هم برداشته می‌شود و اسپینر بارگذاری حذف می‌گردد.

     JS بعداً همین بلوک‌ها را بازنویسی می‌کند. چون از یک ماژول
     مشترک می‌آیند، خروجی یکسان است و جابه‌جایی چیدمان رخ
     نمی‌دهد. */
  const bodyHTML = renderArticle(a.content || '');
  if (bodyHTML) {
    out = out
      .replace('<article id="content" style="display:none">', '<article id="content">')
      .replace(/<div id="loading" role="status">[\s\S]*?<\/div>\s*<\/div>/,
               '<div id="loading" role="status" style="display:none"></div>')
      .replace('<img id="cover" alt="" loading="eager">',
               `<img id="cover" src="${esc(coverPath)}" alt="${esc(a.title)}" loading="eager" fetchpriority="high">`)
      .replace('<h1 id="title"></h1>', `<h1 id="title">${esc(a.title)}</h1>`)
      .replace('<div class="excerpt" id="excerpt"></div>',
               `<div class="excerpt" id="excerpt">${esc(a.excerpt || '')}</div>`)
      .replace('<div class="content" id="body"></div>',
               `<div class="content" id="body">${bodyHTML}</div>`)
      .replace('<div class="art-meta" id="meta"></div>',
               `<div class="art-meta" id="meta"><span class="tag">${esc(a.category_label || CAT_FA[a.category] || 'مقاله')}</span>`
               + (a.read_time ? `<span class="dot">·</span><span class="t">${esc(a.read_time)} مطالعه</span>` : '')
               + '</div>');
  }
  return out;
}

/* ═══════════ صفحات ساده ═══════════ */
const SIMPLE = {
  '/quiz': {
    title: `کوییز هوشمند پیشنهاد عطر | ${BRAND}`,
    description: 'با پاسخ به شش سؤال کوتاه، عطر متناسب با سلیقه و طبع خود را از کاتالوگ ما پیدا کنید.'
  },
  '/essences': {
    title: `خانه‌های اسانس | ${BRAND}`,
    description: 'اسانس عطرهای دست‌ساز عطر یزد از خانه‌های معتبر جهانی ژیوودان، '
      + 'فیرمنیش، ایبرکم و لوزی تأمین می‌شود — همان خانه‌هایی که برای برندهای '
      + 'بین‌المللی اسانس می‌سازند.'
  },
  '/brands': {
    title: `خانه‌های عطر | ${BRAND}`,
    description: 'فهرست کامل برندهای معتبر جهانی موجود در عطر یزد، به همراه تعداد رایحه هر خانه عطر.'
  },
  '/samples': {
    title: `سمپل ۵ میل | امتحان کنید، بعد بخرید — ${BRAND}`,
    description: 'سمپل ۵ میلی‌لیتری عطر یزد؛ رایحه‌های قابل سفارش را پیش از خرید بطری کامل امتحان کنید.'
  },
  '/why-us': {
    title: `چرا عطر یزد؟ | تخصص، ایمنی و شفافیت`,
    description: 'حلال ما اتانول آرایشی است نه متانول. مدرک رسمی مدرسه عطرسازی '
      + 'ایران، بیش از دوازده سال فروش حضوری عمده و خرده، و اسانس از خانه‌های '
      + 'معتبر جهانی. صریح می‌گوییم چه می‌فروشیم و چه چیزی را ادعا نمی‌کنیم.'
  },
  '/terms': {
    title: `قوانین و مقررات | ${BRAND}`,
    description: 'شرایط خرید، ارسال، مرجوعی و ماهیت محصولات دست‌ساز عطر یزد.'
  },
  '/privacy': {
    title: `حریم خصوصی | ${BRAND}`,
    description: 'سیاست عطر یزد در جمع‌آوری، استفاده و محافظت از اطلاعات مشتریان.'
  },
  '/contact': {
    title: `تماس با ما و ثبت مرجوعی | ${BRAND}`,
    description: 'راه‌های ارتباط با پشتیبانی عطر یزد و ثبت درخواست مرجوعی. پاسخ حداکثر ۲۴ ساعت.'
  },
  '/track': {
    title: `پیگیری سفارش | ${BRAND}`,
    description: 'وضعیت سفارش خود را با شماره موبایل پیگیری کنید.'
  }
};

function simplePage(html, path) {
  const c = SIMPLE[path];
  if (!c) return html;
  return inject(html, {
    title: c.title, description: c.description,
    meta: metaBlock({ title: c.title, description: c.description, url: SITE + path })
  });
}

function hasSimple(path) { return !!SIMPLE[path]; }

/* ═══════════ صفحه خانه‌های عطر ═══════════ */

/**
 * فهرست برندها را سمت سرور تزریق می‌کند.
 *
 * چرا: HTML خام این صفحه تنها **۱۰۹ نویسه** متن داشت. کل
 * ارزشش — نام و شمار خانه‌های عطر — با جاوااسکریپت ساخته
 * می‌شد و برای خزنده نامرئی بود.
 *
 * این فهرست برای سئو ارزش ویژه دارد: هر نام برند عبارتی است
 * که مشتری واقعاً جستجو می‌کند («عطر دست‌ساز آمواج»). صفحه‌ای
 * که این ۱۲۴ نام را در متن دارد، برای هر کدامشان نامزد نتیجه
 * می‌شود.
 *
 * ⚠ خروجی باید با `draw()` در `public/brands.html` یکی باشد،
 * وگرنه پس از اجرای JS چیدمان می‌پرد. آزمون مرورگر این را
 * می‌سنجد.
 *
 * @param {string} html
 * @param {Array<{brand_fa:string, brand_en:string, count:number}>} brands
 */
function brandsPage(html, brands) {
  const c = SIMPLE['/brands'];
  let out = inject(html, {
    title: c.title, description: c.description,
    meta: metaBlock({ title: c.title, description: c.description, url: SITE + '/brands' })
  });

  if (!brands || !brands.length) return out;

  const cards = brands.map(b =>
    `<a class="bcard" href="/?brand=${encodeURIComponent(b.brand_fa)}">`
    + `<div class="en">${esc(String(b.brand_en || '').toUpperCase())}</div>`
    + `<div class="fa">${esc(b.brand_fa)}</div>`
    + `<div class="ct">${faNum(b.count)} رایحه</div></a>`).join('');

  /* ── نوار الفبا هم باید سمت سرور بیاید ──
     آزمون مرورگر CLS=۰٫۴۳ گرفت (حد «خوب» ۰٫۱ است). علتش این
     نوار بود: خالی رندر می‌شد و پس از اجرای JS ناگهان یک ردیف
     دکمه ظاهر می‌کرد که کل فهرست برندها را به پایین هل می‌داد.

     تزریق کارت‌ها به‌تنهایی مشکل را حل نمی‌کرد — فقط جایش را
     عوض می‌کرد. هر عنصری که پس از JS ارتفاع می‌گیرد، باید از
     همان اول ارتفاع داشته باشد.

     منطق باید مو‌به‌مو با `drawAlpha()` یکی بماند: حرف اول
     نام لاتین، فقط A–Z، مرتب، با دکمه «همه» در ابتدا. */
  const letters = [...new Set(brands
    .map(b => String(b.brand_en || '?').trim().charAt(0).toUpperCase()))]
    .filter(ch => /[A-Z]/.test(ch)).sort();
  const alpha = '<button class="on" data-l="">همه</button>'
    + letters.map(ch => `<button data-l="${ch}">${ch}</button>`).join('');

  /* `min-height:100vh` رزرو جای اسکلت بارگذاری است. حالا که
     محتوای واقعی از همان اول آنجاست، رزرو باید برداشته شود —
     وگرنه زیر فهرست یک فضای خالی می‌ماند. همان کاری که
     `draw()` سمت مرورگر می‌کند. */
  return out
    .replace('<div class="alpha" id="alpha"></div>',
             `<div class="alpha" id="alpha">${alpha}</div>`)
    .replace('<div class="bgrid stagger" id="bg" style="min-height:100vh"></div>',
             `<div class="bgrid stagger" id="bg">${cards}</div>`);
}

module.exports = {
  productPage, homePage, journalPage, articlePage, simplePage, hasSimple,
  brandsPage,
  coverOf, SITE
};
