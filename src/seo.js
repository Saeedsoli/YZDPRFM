const { renderArticle } = require('./article-render');

const SITE = process.env.SITE_URL || 'https://yazdperfume.ir';
const BRAND = 'عطر یزد';

const SOCIAL_LINKS = [
  'https://instagram.com/yazdperfume',
  'https://t.me/yazdperfume_admin'
];

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&]/g, ch => ({'<':'\\u003c','>':'\\u003e','&':'\\u0026'}[ch]));
}

function faNum(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

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

function productPage(html, p) {
  const full = p.brand_fa ? `${p.brand_fa} — ${p.name_fa}` : p.name_fa;

  const famShort = String(p.family_fa || '').split(' ').slice(0, 2).join(' ');
  const title = famShort
    ? `${full} | عطر دست‌ساز ${famShort} — ${BRAND}`
    : `${full} | عطر دست‌ساز — ${BRAND}`;

  const notes = [...(p.notes.top || []), ...(p.notes.middle || [])].slice(0, 5).join('، ');
  const gender = p.gender === 'MEN' ? 'مردانه' : p.gender === 'WOMEN' ? 'زنانه' : p.gender === 'UNISEX' ? 'یونیسکس' : '';

  const seed = [...p.slug].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const price = Number(p.min_price) > 0 ? `از ${faNum(Number(p.min_price).toLocaleString('en-US'))} تومان` : '';

  const taste = String(p.taste || '').trim();
  const occasion = String(p.occasion || '').trim();
  const detail =
      taste    ? `طبع ${p.temperature || ''}، ${taste}`.replace(/طبع ، /, '')
    : occasion ? `مناسب ${occasion}`
    : notes    ? `نُت‌های رایحه مرجع: ${notes}`
    : '';

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

  const mode = p.supply_mode || 'UNAVAILABLE';
  const hasPricedVariant = (p.variants || []).some(v => v.price_toman > 0);
  const availability = !['IN_STOCK','MADE_TO_ORDER'].includes(mode) || !hasPricedVariant
    ? 'https://schema.org/OutOfStock'
    : inStock ? 'https://schema.org/InStock'
    : mode === 'MADE_TO_ORDER' ? 'https://schema.org/BackOrder'
    : 'https://schema.org/OutOfStock';

  const schema = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: full,
    alternateName: p.name_en,
    image: [image],
    description: description.slice(0, 300),
    sku: p.variants?.[0]?.sku,

    brand: { '@type': 'Brand', name: BRAND },
    category: p.family_fa,
    offers: prices.length ? {
      '@type': 'AggregateOffer',

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

  const webp = p.image_url.replace(/\.(jpe?g|png)$/i, '.webp');
  const preload = webp !== p.image_url
    ? `  <link rel="preload" as="image" href="${esc(webp)}" type="image/webp" fetchpriority="high">\n`
    : `  <link rel="preload" as="image" href="${esc(p.image_url)}" fetchpriority="high">\n`;

  const noindex = availability === 'https://schema.org/OutOfStock'
    ? '  <meta name="robots" content="noindex, follow">\n' : '';

  const extra = noindex + preload +
  `  <script type="application/ld+json">${jsonForHtml(schema)}</script>
  <script type="application/ld+json">${jsonForHtml(breadcrumb)}</script>`;

  let out = inject(html, {
    title, description,
    meta: metaBlock({ title, description, url, image, type: 'product', extra })
  });

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

    sameAs: SOCIAL_LINKS,

    areaServed: { '@type': 'Country', name: 'Iran' },
    currenciesAccepted: 'IRR',
    paymentAccepted: 'کارت بانکی (درگاه زرین‌پال)',
    address: { '@type': 'PostalAddress', addressCountry: 'IR', addressLocality: 'یزد' },
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'پشتیبانی فروش',
      availableLanguage: ['fa'],
      url: `${SITE}/contact`
    }],

    disambiguatingDescription:
      'محصولات این فروشگاه بازآفرینی دست‌ساز رایحه‌های شناخته‌شده هستند و محصول اورجینال برند اصلی نیستند؛ '
      + 'نام برندها فقط برای معرفی پروفایل بویایی ذکر می‌شود.',
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

function featureHTML(a) {
  if (!a) return '';
  const cover = coverOf(a);
  const webp = cover.replace(/\.(jpe?g|png)$/i, '.webp');
  const label = a.category_label || CAT_FA[a.category] || 'مقاله';

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

function journalPage(html, featured) {

  const art = (featured && typeof featured === 'object') ? featured : null;
  const featuredCover = art ? coverOf(art) : (featured || null);
  const title = `مجله آموزشی ${BRAND} | دانشنامه نُت‌ها و راهنمای عطر`;
  const description =
    'دانشنامه نُت‌های بویایی، راهنمای انتخاب رایحه متناسب با شخصیت، ' +
    'و آموزش نگهداری درست عطر — به زبان ساده.';

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

  if (art) {
    out = out.replace(
      '<div id="feature" style="min-height:54vh"></div>',
      `<div id="feature" data-slug="${esc(art.slug)}">${featureHTML(art)}</div>`
    );
  }
  return out;
}

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

function brandsPage(html, brands) {
  const c = SIMPLE['/brands'];
  let out = inject(html, {
    title: c.title, description: c.description,
    meta: metaBlock({ title: c.title, description: c.description, url: SITE + '/brands' })
  });

  if (!brands || !brands.length) return out;

  const cards = brands.map(b =>
    `<a class="bcard" href="/?brand=${encodeURIComponent(b.brand_fa)}">`
    + (b.logo
        ? `<img class="blogo" src="${esc(b.logo)}" alt="${esc(String(b.brand_en || b.brand_fa || ''))}" loading="lazy" decoding="async">`
        : `<div class="en">${esc(String(b.brand_en || '').toUpperCase())}</div>`)
    + `<div class="fa">${esc(b.brand_fa)}</div>`
    + `<div class="ct">${faNum(b.count)} رایحه</div></a>`).join('');

  const letters = [...new Set(brands
    .map(b => String(b.brand_en || '?').trim().charAt(0).toUpperCase()))]
    .filter(ch => /[A-Z]/.test(ch)).sort();
  const alpha = '<button class="on" data-l="">همه</button>'
    + letters.map(ch => `<button data-l="${ch}">${ch}</button>`).join('');

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
