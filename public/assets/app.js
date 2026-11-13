const SOCIAL = {
  instagram: {
    handle: '@yazdperfume',
    url: 'https://instagram.com/yazdperfume'
  },
  telegram: {
    handle: '@yazdperfume_admin',
    url: 'https://t.me/yazdperfume_admin'
  }
};

function track(kind, target, meta) {
  try {
    const body = JSON.stringify({ kind, target, meta });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track',
        new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body, keepalive: true
    }).catch(() => {});
  } catch {  }
}

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escLines(v) {
  return esc(v).replace(/\r?\n/g, '<br>');
}

const YazdCart = {
  KEY: 'yazd_cart_v1',

  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
    catch { return []; }
  },

  save(items) {
    localStorage.setItem(this.KEY, JSON.stringify(items));
    this.updateBadge();
  },

  add(sku, name, price, image, qty = 1, slug = null) {
    const items = this.get();
    const found = items.find(i => i.sku === sku);
    if (found) {
      found.quantity += qty;
      if (slug && !found.slug) found.slug = slug;
      if (image && !found.image) found.image = image;
    } else items.push({ sku, name, price, image, quantity: qty, ...(slug ? { slug } : {}) });
    this.save(items);
    toast(`${name} به سبد خرید افزوده شد`);
    track('add_cart', sku, { qty });
  },

  remove(sku) {
    this.save(this.get().filter(i => i.sku !== sku));
  },

  setQty(sku, qty) {
    const items = this.get();
    const it = items.find(i => i.sku === sku);
    if (!it) return;
    if (qty <= 0) return this.remove(sku);
    it.quantity = qty;
    this.save(items);
  },

  clear() { localStorage.removeItem(this.KEY); this.updateBadge(); },

  count() { return this.get().reduce((s, i) => s + i.quantity, 0); },

  subtotal() { return this.get().reduce((s, i) => s + i.price * i.quantity, 0); },

  updateBadge() {
    const n = this.count();
    document.querySelectorAll('[data-cart-badge]').forEach(el => {
      el.textContent = toFa(n);
      el.style.display = n > 0 ? 'flex' : 'none';
    });
  }
};

const YazdStats = {
  KEY: 'yazd_stats_v1',
  _data: null,

  async load() {
    if (this._data) return this._data;
    try {
      const cached = sessionStorage.getItem(this.KEY);
      if (cached) {
        const p = JSON.parse(cached);
        if (Date.now() - p.at < 300000) { this._data = p.d; return p.d; }
      }
    } catch {}
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) return null;
      const d = await r.json();
      this._data = d;
      try {
        sessionStorage.setItem(this.KEY, JSON.stringify({ at: Date.now(), d }));
      } catch {}
      return d;
    } catch { return null; }
  },

  async paint(root = document) {
    const nodes = root.querySelectorAll('[data-stat]');
    if (!nodes.length) return;
    const d = await this.load();
    if (!d) return;
    nodes.forEach(el => {
      const v = d[el.dataset.stat];
      if (v == null) return;

      el.textContent = (el.dataset.statPrefix || '') + toFa(v);
    });
  }
};

function toFa(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

function money(n) {
  return toFa(Number(n || 0).toLocaleString('en-US'));
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function renderHeader(active = '') {

  const logo = '/images/brand-mark-light.svg';

  return `
  <div class="announce" id="announceBar">✨ «رایحه، نامرئی‌ترین و ماندگارترین اثر حضور شماست.»</div>
  <header class="glass-header" role="banner">
    <div class="header-row">
      <a href="/" class="logo-brand" aria-label="عطر یزد — صفحه اصلی">
        <img src="${logo}" alt="لوگوی عطر یزد" width="15" height="43"
             decoding="async">
        <div>
          <div class="brand-title">عطر یزد</div>
          <div class="brand-sub">YAZD PERFUME</div>
        </div>
      </a>
      <nav aria-label="منوی اصلی"><ul class="nav-links">
        <li><a href="/" class="${active === 'home' ? 'active' : ''}">کاتالوگ عطرها</a></li>
        <li><a href="/brands" class="${active === 'brands' ? 'active' : ''}">برندها</a></li>
        <li><a href="/quiz" class="${active === 'quiz' ? 'active' : ''}">پیشنهاد هوشمند</a></li>
        <li><a href="/samples" class="${active === 'samples' ? 'active' : ''}">سمپل ۵ میل</a></li>
        <li><a href="/essences" class="${active === 'essences' ? 'active' : ''}">خانه‌های اسانس</a></li>
        <li><a href="/why-us" class="${active === 'why-us' ? 'active' : ''}">چرا ما؟</a></li>
        <li><a href="/journal" class="${active === 'journal' ? 'active' : ''}">مجله آموزشی</a></li>
        <li><a href="/wishlist" class="${active === 'wishlist' ? 'active' : ''}">علاقه‌مندی‌ها</a></li>
      </ul></nav>
      <div class="header-actions">
        <a href="/account" class="icon-btn" title="حساب کاربری" data-account-btn>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          <span data-account-dot style="display:none;position:absolute;bottom:-1px;left:-1px;
            width:11px;height:11px;border-radius:50%;background:#2ECC71;border:2px solid var(--obsidian)"></span>
        </a>
        <a href="/cart" class="icon-btn cart" title="سبد خرید" aria-label="سبد خرید">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2c0 .55.45 1 1 1s1-.45 1-1V8h4v2c0 .55.45 1 1 1s1-.45 1-1V8h2v12z"/></svg>
          <span class="cart-badge" data-cart-badge style="display:none" aria-live="polite">۰</span>
        </a>
      </div>
    </div>
  </header>`;
}

window.YazdDate=window.YazdDate||{
  ready:false,formatDate:()=> '—',formatDateTime:()=> '—',now:()=>Date.now(),
  setClock:()=>false,inputISO:()=>null,setInput:()=>false,
  mountAll:parent=>(parent||document).querySelectorAll('[data-jalali-date]').forEach(el=>{
    el.disabled=true;el.placeholder='تقویم در دسترس نیست';
  })
};

const footerDateFormatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {timeZone:'Asia/Tehran',year:'numeric',month:'numeric',day:'numeric'});
let footerClock=null;
function footerNow(){return footerClock ? footerClock.ms+(performance.now()-footerClock.at) : Date.now();}
function footerYear(ms=footerNow()) {
  const p=Object.fromEntries(footerDateFormatter.formatToParts(new Date(ms)).filter(x=>['year','month','day'].includes(x.type)).map(x=>[x.type,Number(x.value)]));
  if(typeof jalaali!=='undefined')return toFa(jalaali.toJalaali(p.year,p.month,p.day).jy);

  return new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',year:'numeric'}).formatToParts(new Date(ms)).find(x=>x.type==='year')?.value || '';
}
function updateFooterYear() {
  const year=footerYear();
  document.querySelectorAll('[data-footer-year]').forEach(el=>{if(el.textContent!==year)el.textContent=year;});
}
function renderFooter() {

  return `
  <footer role="contentinfo">
    <div class="footer-grid">
      <div class="foot-brand">
        <h4>عطر یزد | Yazd Perfume</h4>
        <p>بازآفرینی دست‌ساز رایحه‌های ماندگار جهان با عصاره غلیظ اولیه و فرمولاسیون اختصاصی؛ بیش از دوازده سال تجربه فروش حضوری.</p>
        <div class="social-row">
          <a class="social-btn" href="${SOCIAL.instagram.url}" target="_blank"
             rel="noopener noreferrer" aria-label="اینستاگرام عطر یزد" title="${SOCIAL.instagram.handle}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.13 1.38C1.35 2.68.93 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.13.67.66 1.34 1.08 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.3 1.46-.72 2.13-1.38.66-.67 1.08-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91-.3-.79-.72-1.46-1.38-2.13C21.32 1.35 20.65.93 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 100 12.32A6.16 6.16 0 0012 5.84zm0 10.16a4 4 0 110-8 4 4 0 010 8zm7.85-10.4a1.44 1.44 0 11-2.88 0 1.44 1.44 0 012.88 0z"/></svg>
            <span class="sr-only">${SOCIAL.instagram.handle}</span>
          </a>
          <a class="social-btn" href="${SOCIAL.telegram.url}" target="_blank"
             rel="noopener noreferrer" aria-label="پشتیبانی در تلگرام" title="پشتیبانی تلگرام">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.94 24C5.34 24 0 18.63 0 12S5.34 0 11.94 0C18.6 0 24 5.37 24 12s-5.4 12-12.06 12zM6.35 11.7c-.6.24-1.2.48-1.23.87-.03.3.36.42.87.6.09.03.18.06.3.09.51.15 1.2.33 1.56.33.33.01.69-.12 1.11-.4 2.73-1.85 4.14-2.78 4.23-2.8.06-.01.15-.03.21.03.06.06.06.17.04.2-.04.14-1.13 1.14-1.72 1.68-.19.17-.32.29-.35.32-.06.07-.13.13-.2.19-.47.45-.82.79.02 1.34.42.28.75.5 1.08.73.36.24.71.48 1.17.79.12.08.23.16.34.24.42.3.79.57 1.25.53.27-.03.55-.28.69-1.03.33-1.77.99-5.63 1.14-7.21a1.8 1.8 0 00-.02-.4.42.42 0 00-.14-.27.65.65 0 00-.38-.11c-.33.01-.85.19-3.31 1.21-.86.36-2.57 1.09-5.14 2.21-.42.16-.64.32-.66.47z"/></svg>
            <span class="sr-only">پشتیبانی تلگرام</span>
          </a>
        </div>
      </div>
      <div class="foot-links">
        <h4>راهنما</h4>
        <a href="/samples">سمپل ۵ میل</a>
        <a href="/why-us">چرا عطر یزد؟</a>
        <a href="/terms">قوانین و مقررات</a>
        <a href="/privacy">حریم خصوصی</a>
        <a href="/track">پیگیری سفارش</a>
        <a href="/contact">تماس با ما</a>
      </div>
      <div class="foot-facts">
        <h4>ارسال و مرجوعی</h4>
        <div class="fact"><b>ارسال:</b> ۱۰۰٬۰۰۰ تومان سراسر کشور</div>
        <div class="fact"><b>رایگان:</b> بالای ۲٬۰۰۰٬۰۰۰ تومان</div>
        <div class="fact"><b>تحویل:</b> ۳ تا ۷ روز کاری</div>
        <div class="fact"><b>مرجوعی:</b> تا ۷۲ ساعت پس از تحویل</div>
      </div>
      <div class="foot-essence">
        <h4>اسانس</h4>
        <a href="/essences">ژیوودان · فیرمنیش</a>
        <a href="/essences">ایبرکم · لوزی</a>
        <p>هویت و کیفیت اسانس هر رایحه مستقلاً تأیید نشده است.</p>
      </div>
    </div>

    <div class="footer-strip">
      <div id="footContact" class="foot-contact"></div>
      <div id="enamadSeal" class="foot-seal"></div>
    </div>

    <div class="footer-bottom">
      <span>© <span data-footer-year>${footerYear()}</span> تمامی حقوق متعلق به فروشگاه «عطر یزد | Yazd Perfume» است.</span>
      <span class="foot-legal-links"><a href="/terms">قوانین</a> · <a href="/privacy">حریم خصوصی</a></span>
    </div>
  </footer>`;
}

function genderLabel(g) {
  return g === 'MEN' ? 'مردانه' : g === 'WOMEN' ? 'زنانه' : g === 'UNISEX' ? 'یونیسکس' : '';
}

function fullName(p) {
  return p.brand_fa ? `${p.brand_fa} — ${p.name_fa}` : p.name_fa;
}

function isGenericProductImage(url) {
  return /\/(?:generic-neutral-[1-7]|studio-dark-[1-8])(?:-sm)?\.(?:jpg|webp)$/i.test(url || '');
}
function cardImage(url) {
  return (/\/fam-[a-z0-9-]+\.jpg$/.test(url || '') || isGenericProductImage(url))
    ? url.replace(/\.jpg$/, '-sm.jpg')
    : url;
}

function variantSellable(p, v) {
  return !!v && ['IN_STOCK', 'MADE_TO_ORDER'].includes(p.supply_mode) && v.price_toman > 0 &&
    (v.stock > 0 || p.supply_mode === 'MADE_TO_ORDER');
}
function productSupply(p) {
  const mode = p.supply_mode || 'UNAVAILABLE';
  const unknown = p.availability_unknown === true;
  const eligible = ['IN_STOCK', 'MADE_TO_ORDER'].includes(mode);

  const derived = (p.variants || []).some(v =>
    eligible && v.price_toman > 0 && Number(v.stock) > 0);
  const knownInStock = p.in_stock === true || p.in_stock === 1;
  const inStock = eligible && (knownInStock || (p.in_stock == null && derived));
  const madeToOrder = !unknown && !inStock && mode === 'MADE_TO_ORDER' && Number(p.min_price) > 0;
  const out = !unknown && !inStock && !madeToOrder;
  return {
    unknown, inStock, madeToOrder, out,
    state: unknown ? 'UNKNOWN' : inStock ? 'IN_STOCK' : madeToOrder ? 'MADE_TO_ORDER' : 'UNAVAILABLE',
    label: unknown || inStock ? '' : (madeToOrder ? 'به سفارش' : 'ناموجود'),
    cta: unknown ? 'مشاهده جزئیات' : inStock ? 'مشاهده و خرید'
       : madeToOrder ? 'به سفارش ساخته می‌شود' : 'خبرم کن وقتی رسید',
    foot: out ? 'خبرم کن' : 'مشاهده',
    aria: unknown || inStock ? 'مشاهده جزئیات'
        : madeToOrder ? 'به سفارش ساخته می‌شود' : 'فعلاً موجود نیست، اطلاع از موجود شدن',
    classes: `product-card${out ? ' is-out' : ''}${madeToOrder ? ' is-mto' : ''}`
  };
}

function productCard(p) {
  const notes = (p.notes?.top || []).slice(0, 3).join('، ');
  const img = cardImage(p.image_url);
  const illustrative = isGenericProductImage(p.image_url);

  const pct = p.campaign_percent || 0;
  const off = pct > 0 ? Math.floor(p.min_price * pct / 100) : 0;
  const priceBlock = p.availability_unknown
    ? `<span class="price">مشاهده قیمت روز</span>`
    : Number(p.min_price) <= 0 || !Number.isFinite(Number(p.min_price))
    ? `<span class="price">قیمت در دسترس نیست</span>`
    : off > 0 ? `<span class="price">
         <s class="price-old">${money(p.min_price)}</s>
         از ${money(p.min_price - off)} <small>تومان</small>
       </span>`
    : `<span class="price">از ${money(p.min_price)} <small>تومان</small></span>`;

  const supply = productSupply(p);
  const { inStock, madeToOrder, out, unknown } = supply;

  return `
  <a class="${supply.classes} fade-up"
     href="/perfume/${encodeURIComponent(p.slug)}"
     aria-label="${esc(fullName(p))} — ${supply.aria}">
    <div class="img-wrap">
      <img src="${esc(img)}" alt="${illustrative ? 'تصویر نمادین' : 'تصویر'} ${esc(fullName(p))}" loading="lazy" width="300" height="300">
      ${illustrative ? '<span class="card-illustrative">تصویر نمادین</span>' : ''}
      ${genderLabel(p.gender) ? `<span class="card-badge">${genderLabel(p.gender)}</span>` : ''}
      ${supply.label ? `<span class="card-out${madeToOrder ? ' mto' : ''}">${supply.label}</span>` : ''}
      ${off > 0 && inStock ? `<span class="card-off"><bdi>${esc(toFa(pct))}٪</bdi> تخفیف</span>` : ''}
      <div class="card-peek">${supply.cta}</div>
    </div>
    <div class="body">
      <div class="card-title">${esc(fullName(p))} <span class="card-tag">«دست‌ساز»</span></div>
      <div class="card-sub">${esc(p.name_en)}</div>
      ${notes ? `<div class="card-notes">نُت‌های آغازین: ${esc(notes)}</div>` : ''}
      <div class="card-price-row">
        ${priceBlock}
        ${out
          ? '<span class="card-go-notify">خبرم کن ←</span>'
          : '<span class="card-go">مشاهده ←</span>'}
      </div>
    </div>
  </a>`;
}

const YazdRecent = {
  KEY: 'yazd_recent',
  MAX: 12,
  TTL_DAYS: 30,

  _read() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      const cutoff = Date.now() - this.TTL_DAYS * 86400000;
      return raw.filter(x => x && x.slug && (x.at || 0) > cutoff);
    } catch { return []; }
  },

  push(p) {
    if (!p || !p.slug) return;
    try {
      const list = this._read().filter(x => x.slug !== p.slug);
      list.unshift({
        slug: p.slug, id: p.id,
        name_fa: p.name_fa, name_en: p.name_en,
        brand_fa: p.brand_fa, gender: p.gender,
        image_url: p.image_url, min_price: p.min_price,
        at: Date.now()
      });
      localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX)));
    } catch {

    }
  },

  list(excludeSlug) {
    return this._read().filter(x => x.slug !== excludeSlug);
  },

  clear() {
    try { localStorage.removeItem(this.KEY); } catch {}
  },

  render(sel, opt = {}) {
    const box = document.querySelector(sel);
    if (!box) return 0;

    const min = opt.min || 2;
    const items = this.list(opt.exclude).slice(0, opt.limit || 4);
    if (items.length < min) return 0;

    const title = opt.title || 'اخیراً دیدید';
    box.innerHTML =
      `<div class="recent-head">
         <h2>${esc(title)}</h2>
         <button type="button" class="recent-clear">پاک کردن</button>
       </div>
       <div class="product-grid">
         ${items.map(p => productCard({ ...p, notes: { top: [] }, availability_unknown: true })).join('')}
       </div>`;

    box.querySelector('.recent-clear').onclick = () => {
      this.clear();
      box.innerHTML = '';
      box.style.display = 'none';
    };

    box.style.display = '';
    return items.length;
  }
};

const YazdTaste = {
  KEY: 'yazd_taste',
  TTL_DAYS: 120,

  get() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (!raw || !raw.answers) return null;
      if (Date.now() - (raw.at || 0) > this.TTL_DAYS * 86400000) return null;
      return raw;
    } catch { return null; }
  },

  save(answers) {
    try {
      localStorage.setItem(this.KEY,
        JSON.stringify({ answers, at: Date.now() }));
    } catch {  }
  },

  clear() { try { localStorage.removeItem(this.KEY); } catch {} },

  async render(sel) {
    const box = document.querySelector(sel);
    if (!box) return 0;

    const local = this.get();
    const body = local ? { answers: local.answers } : {};

    if (!local && !(await YazdAuth.check()).authenticated) return 0;

    let d;
    try {
      const r = await fetch('/api/taste/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...YazdAuth.headers() },
        body: JSON.stringify(body)
      });
      if (!r.ok) return 0;
      d = await r.json();
    } catch { return 0; }

    if (!d.items || d.items.length < 3) return 0;

    const chips = (d.summary || []).map(s =>
      `<span class="taste-chip">${esc(s)}</span>`).join('');

    box.innerHTML = `
      <div class="taste-head">
        <div>
          <h2>پیشنهاد برای شما</h2>
          ${chips ? `<div class="taste-chips">${chips}</div>` : ''}
        </div>
        <div class="taste-actions">
          <a class="taste-link" href="/quiz">تغییر سلیقه</a>
          <button type="button" class="taste-clear">فراموش کن</button>
        </div>
      </div>
      ${d.budget_relaxed
        ? `<p class="taste-note">در محدوده بودجه‌ای که انتخاب کردید گزینه
             کافی نبود، پس بازه را بازتر گرفتیم.</p>`
        : ''}
      <div class="product-grid">
        ${d.items.map(p => productCard({ ...p, notes: { top: p.notes_top || [] } })).join('')}
      </div>`;

    box.querySelector('.taste-clear').onclick = async () => {
      this.clear();

      if ((await YazdAuth.check()).authenticated) {
        try {
          await fetch('/api/taste/profile', {
            method: 'DELETE', headers: YazdAuth.headers()
          });
        } catch {}
      }
      box.innerHTML = '';
      box.style.display = 'none';
    };

    box.style.display = '';
    return d.items.length;
  }
};

try { localStorage.removeItem('yazd_customer_token'); localStorage.removeItem('yazd_customer_mobile'); } catch {}
const YazdAuth = {
  headers() { return {}; },
  async check() {
    try {
      const r = await fetch('/api/auth/me');
      if (!r.ok) return { authenticated: false };
      return await r.json();
    } catch { return { authenticated: false }; }
  }
};

function skeletonGrid(n = 8) {
  return Array.from({ length: n }, () => `
    <div class="sk-card">
      <div class="sk-img skeleton"></div>
      <div class="sk-body">
        <div class="sk-line skeleton" style="width:75%"></div>
        <div class="sk-line skeleton" style="width:52%"></div>
        <div class="sk-line skeleton" style="width:88%;margin-top:14px"></div>
      </div>
    </div>`).join('');
}

function initReveal(root = document) {
  const items = root.querySelectorAll('.reveal:not(.visible)');
  if (!items.length) return;

  if (!('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: .12, rootMargin: '0px 0px -60px 0px' });
  items.forEach(el => io.observe(el));
}

function initHeaderShadow() {
  const h = document.querySelector('.glass-header');
  if (!h) return;
  let ticking = false;
  const update = () => {
    h.classList.toggle('scrolled', window.scrollY > 12);
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
}

function initProgress() {
  if (!document.querySelector('[data-progress]')) return;
  const bar = document.createElement('div');
  bar.className = 'page-progress';
  document.body.appendChild(bar);
  let ticking = false;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = max > 0 ? (window.scrollY / max * 100) + '%' : '0';
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
}

async function loadNotice() {
  const bar = document.getElementById('announceBar');
  if (!bar) return;

  let closed = {};
  try { closed = JSON.parse(localStorage.getItem('yazd_notice_closed') || '{}'); } catch {}

  try {
    const d = await fetch('/api/notice').then(r => r.json());
    const n = d.notice;
    if (!n) return;
    const dayKey=()=>{
      const parts=new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',
        {timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(footerNow()));
      const p=Object.fromEntries(parts.filter(x=>['year','month','day'].includes(x.type)).map(x=>[x.type,x.value]));
      return `${p.year}-${p.month}-${p.day}`;
    };
    if (closed[n.id] === dayKey()) return;

    bar.className = 'announce notice-' + (n.tone || 'gold');
    bar.innerHTML =
      `<span class="n-txt">${esc(n.text)}</span>` +
      (n.link ? ` <a class="n-link" href="${esc(n.link)}">${esc(n.link_label || 'مشاهده')}</a>` : '') +
      `<button class="n-x" type="button" aria-label="بستن اعلان">✕</button>`;

    bar.querySelector('.n-x').onclick = () => {
      closed[n.id] = dayKey();
      try { localStorage.setItem('yazd_notice_closed', JSON.stringify(closed)); } catch {}

      bar.className = 'announce';
      bar.textContent = '✨ «رایحه، نامرئی‌ترین و ماندگارترین اثر حضور شماست.»';
    };
  } catch {}
}

async function loadFooterContact() {
  const box = document.getElementById('footContact');

  if (!box) { renderEnamad(null, null); return; }
  try {
    const started=performance.now();
    const response=await fetch('/api/contact-info',{cache:'no-store'});
    const serverTime=Date.parse(response.headers.get('date') || '');
    if(Number.isFinite(serverTime) && serverTime>=Date.UTC(2000,0,1) && serverTime<=Date.UTC(2300,0,1)){
      const ended=performance.now();footerClock={ms:serverTime+Math.max(0,Math.min(ended-started,60000))/2,at:ended};updateFooterYear();
    }
    const d=await response.json();
    const rows = [];
    if (d.phone) {

      const digits = String(d.phone).replace(/\D/g, '');
      const isMobile = /^09\d{9}$/.test(digits);
      rows.push(`<div>تماس: <a href="tel:${esc(d.phone)}"><bdi dir="ltr">${toFa(esc(d.phone))}</bdi></a></div>`);
      if (d.phone_whatsapp && isMobile) {
        rows.push(`<div><a href="https://wa.me/98${digits.slice(1)}"
          target="_blank" rel="noopener" class="wa-link">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A10.4 10.4 0 0 0 3.2 16.1L2 22l6.1-1.6a10.4 10.4 0 0 0 12.4-16.9Z"/><path d="M8.5 8c.3-.7.6-.7.9-.7h.7c.2 0 .5 0 .8.6l1 2.3c.1.3 0 .5-.1.7l-.5.6c-.2.2-.3.4-.1.7a7.5 7.5 0 0 0 3.6 3.1c.3.1.5 0 .7-.2l.6-.7c.2-.2.4-.2.7-.1l2.2 1.1c.3.2.5.3.6.5v.9c-.2.6-1 1.3-1.6 1.4-1.4.2-2.6-.2-5.6-1.9a12 12 0 0 1-4.2-4.6c-.6-1.2-.6-2.4.1-3.4Z"/></svg>
          پیام در واتس‌اپ</a></div>`);
      }
    }
    if (d.address) rows.push(`<div>${esc(d.address)}</div>`);
    if (d.postal_code) rows.push(`<div>کد پستی: <bdi>${toFa(esc(d.postal_code))}</bdi></div>`);
    box.innerHTML = rows.join('');

    renderEnamad(d.enamad_id, d.enamad_code);
  } catch {

    renderEnamad(null, null);
  }
}

function renderEnamad(id, code) {
  const box = document.getElementById('enamadSeal');
  if (!box) return;

  const okId   = /^\d{1,10}$/.test(String(id || ''));
  const okCode = /^[A-Za-z0-9]{8,64}$/.test(String(code || ''));

  box.innerHTML = `
    <div class="enamad-badge">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#C59B27" aria-hidden="true"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
      نماد اعتماد الکترونیکی (آزمایشی)
    </div>`;

  if (!okId || !okCode) return;

  const q = `id=${encodeURIComponent(id)}&Code=${encodeURIComponent(code)}`;

  const img = new Image(96, 96);
  img.alt = 'نماد اعتماد الکترونیک — عطر یزد';
  img.width = 96;
  img.height = 96;
  img.decoding = 'async';
  img.referrerPolicy = 'origin';

  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    img.src = '';
  }, 8000);

  img.onload = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);

    const a = document.createElement('a');
    a.className = 'enamad-seal';
    a.href = `https://trustseal.enamad.ir/?${q}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.referrerPolicy = 'origin';
    a.setAttribute('aria-label',
      'مشاهده پرونده نماد اعتماد الکترونیک عطر یزد در سایت اینماد');
    a.appendChild(img);
    box.replaceChildren(a);
  };

  img.onerror = () => { settled = true; clearTimeout(timer); };

  img.src = `https://trustseal.enamad.ir/logo.aspx?${q}`;
}

function whenIdle(fn, timeout = 2000) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 200);
}

const YazdPWA = {
  DISMISS_KEY: 'yazd_pwa_dismissed',
  DISMISS_DAYS: 30,
  _prompt: null,

  register() {
    if (!('serviceWorker' in navigator)) return;

    if (location.protocol !== 'https:' && location.hostname !== 'localhost'
        && location.hostname !== '127.0.0.1') return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {

        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              nw.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(() => {  });
  },

  _dismissed() {
    try {
      const t = parseInt(localStorage.getItem(this.DISMISS_KEY) || '0');
      return t && (Date.now() - t) < this.DISMISS_DAYS * 86400000;
    } catch { return false; }
  },

  initInstall() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this._prompt = e;
      if (this._dismissed()) return;
      this._showButton();
    });

    window.addEventListener('appinstalled', () => {
      this._prompt = null;
      const b = document.getElementById('pwaInstall');
      if (b) b.remove();
    });
  },

  _showButton() {
    if (document.getElementById('pwaInstall')) return;
    const btn = document.createElement('div');
    btn.id = 'pwaInstall';
    btn.className = 'pwa-install';
    btn.innerHTML = `
      <div class="pwa-txt">
        <b>عطر یزد را نصب کنید</b>
        <span>دسترسی سریع‌تر، بدون باز کردن مرورگر</span>
      </div>
      <button type="button" class="pwa-yes">نصب</button>
      <button type="button" class="pwa-no" aria-label="بعداً">✕</button>`;
    document.body.appendChild(btn);
    requestAnimationFrame(() => btn.classList.add('on'));

    btn.querySelector('.pwa-yes').onclick = async () => {
      if (!this._prompt) return;
      this._prompt.prompt();
      try { await this._prompt.userChoice; } catch {}
      this._prompt = null;
      btn.remove();
    };
    btn.querySelector('.pwa-no').onclick = () => {
      try { localStorage.setItem(this.DISMISS_KEY, String(Date.now())); } catch {}
      btn.classList.remove('on');
      setTimeout(() => btn.remove(), 300);
    };
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  initHeaderShadow();
  initReveal();
  initProgress();
  updateFooterYear();setInterval(updateFooterYear,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateFooterYear()});
  whenIdle(loadNotice);
  whenIdle(loadFooterContact);

  YazdPWA.initInstall();
  window.addEventListener('load', () => whenIdle(() => YazdPWA.register(), 3000));

  YazdCart.updateBadge();

  YazdStats.paint();

  whenIdle(async () => {
    const me = await YazdAuth.check();
    if (me.authenticated) {
      document.querySelectorAll('[data-account-dot]').forEach(d => d.style.display = 'block');
      document.querySelectorAll('[data-account-btn]').forEach(b =>
        b.setAttribute('title', 'حساب کاربری — ' + me.mobile));
    }
  });
});
