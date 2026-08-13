/**
 * عطر یزد | تزریق متادیتا سمت سرور
 * ------------------------------------
 * صفحه محصول کلاینت‌ساید رندر می‌شود، اما خزنده‌های گوگل، تلگرام و
 * واتساپ جاوااسکریپت اجرا نمی‌کنند. این ماژول پیش از ارسال HTML،
 * عنوان و متادیتا را با داده واقعی محصول جایگزین می‌کند.
 */

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

function faNum(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

/** بلوک متای مشترک */
function metaBlock({ title, description, url, image, type = 'website', extra = '' }) {
  const t = esc(title), d = esc(description);
  return `
  <link rel="canonical" href="${url}">
  <meta property="og:site_name" content="${BRAND}">
  <meta property="og:locale" content="fa_IR">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:url" content="${url}">
  ${image ? `<meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="1200">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  ${image ? `<meta name="twitter:image" content="${image}">` : ''}
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
  const title = `خرید ${full} | عطر دست‌ساز ${BRAND}`;

  const notes = [...(p.notes.top || []), ...(p.notes.middle || [])].slice(0, 5).join('، ');
  const gender = p.gender === 'MEN' ? 'مردانه' : p.gender === 'WOMEN' ? 'زنانه' : 'یونیسکس';
  const description =
    `${full} — عطر دست‌ساز ${gender} با رایحه ${p.family_fa || ''}. ` +
    (notes ? `نُت‌های ${notes}. ` : '') +
    `از ${faNum(Number(p.min_price).toLocaleString('en-US'))} تومان. ` +
    `سمپل ۳ میلی‌لیتری موجود است.`;

  const url = `${SITE}/perfume/${p.slug}`;
  const image = SITE + p.image_url;

  const inStock = (p.variants || []).some(v => v.stock > 0);
  const prices = (p.variants || []).map(v => v.price_toman).filter(Boolean);

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
    offers: {
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
      offerCount: (p.variants || []).length,
      availability: inStock
        ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: BRAND }
    }
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
    ? `  <link rel="preload" as="image" href="${webp}" type="image/webp" fetchpriority="high">\n`
    : `  <link rel="preload" as="image" href="${p.image_url}" fetchpriority="high">\n`;

  const extra = preload +
  `  <script type="application/ld+json">${JSON.stringify(schema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>`;

  return inject(html, {
    title, description,
    meta: metaBlock({ title, description, url, image, type: 'product', extra })
  });
}

/* ═══════════ صفحه اصلی ═══════════ */
function homePage(html, stats) {
  const title = `${BRAND} | بازآفرینی دست‌ساز رایحه‌های ماندگار`;
  const description =
    `فروشگاه ${BRAND} — ${faNum(stats.products)} رایحه دست‌ساز بازآفرینی‌شده از ` +
    `${faNum(stats.brands)} خانه عطر معتبر جهان. سمپل ۳ میل، ادوپرفیوم، عطر مو و بادی اسپلش. ` +
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
      extra: `  <script type="application/ld+json">${JSON.stringify(org)}</script>`
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
          <source srcset="${webp}" type="image/webp">
          <img src="${cover}" alt="" fetchpriority="high" decoding="async">
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
      ? `  <link rel="preload" as="image" href="${webp}" type="image/webp" fetchpriority="high">`
      : `  <link rel="preload" as="image" href="${featuredCover}" fetchpriority="high">`;
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

  const extra = `  <script type="application/ld+json">${JSON.stringify(schema)}</script>
  <script type="application/ld+json">${JSON.stringify(crumb)}</script>`;

  return inject(html, {
    title, description,
    meta: metaBlock({ title, description, url, image: img, type: 'article', extra })
  });
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
    title: `سمپل ۳ میل | امتحان کنید، بعد بخرید — ${BRAND}`,
    description: 'سمپل ۳ میلی‌لیتری عطر یزد. با کمتر از یک‌دهم '
      + 'قیمت بطری کامل، رایحه را چند روز روی پوست خودتان امتحان کنید.'
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

module.exports = {
  productPage, homePage, journalPage, articlePage, simplePage, hasSimple,
  coverOf, SITE
};
