/**
 * عطر یزد | Yazd Perfume — منطق مشترک فرانت‌اند
 * سبد خرید ماندگار با localStorage
 */

/**
 * نشانی شبکه‌های اجتماعی — تنها منبع حقیقت.
 * اگر آیدی عوض شد، فقط اینجا تغییر کند.
 */
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

/**
 * ثبت رویداد تحلیلی.
 *
 * «آتش کن و فراموش کن» — هیچ‌وقت منتظر پاسخ نمی‌مانیم و خطا را
 * بی‌صدا می‌بلعیم. تحلیل هرگز نباید خرید مشتری را کند یا خراب کند.
 * سرور هم شماره موبایل و IP را ذخیره نمی‌کند.
 */
function track(kind, target, meta) {
  try {
    const body = JSON.stringify({ kind, target, meta });
    // sendBeacon حتی هنگام ترک صفحه هم می‌رسد
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
  } catch { /* تحلیل هرگز به کاربر آسیب نمی‌زند */ }
}

/**
 * خنثی‌سازی متن پیش از تزریق در HTML.
 *
 * هرجا داده‌ای که کاربر نوشته (نظر، نام نمایشی، تیکت، پاسخ ادمین)
 * با innerHTML چاپ می‌شود، باید از این عبور کند. بدون آن، یک نظر
 * حاوی <script> روی مرورگر همه بازدیدکنندگان اجرا می‌شود — از جمله
 * مدیر در پنل، جایی که توکن ادمین در دسترس است.
 *
 * برای مقادیری که داخل ویژگی HTML می‌نشینند هم امن است، چون
 * نقل‌قول‌ها را هم تبدیل می‌کند.
 */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** نسخه‌ای که خطوط جدید را هم به <br> تبدیل می‌کند (متن چندخطی) */
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

  add(sku, name, price, image, qty = 1) {
    const items = this.get();
    const found = items.find(i => i.sku === sku);
    if (found) found.quantity += qty;
    else items.push({ sku, name, price, image, quantity: qty });
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

/* ── آمار زنده فروشگاه ──
   هر عنصری با `data-stat="key"` خودکار از /api/stats پر می‌شود.

   🔴 چرا این الگو:
   پیش‌تر شمار محصول و برند در ده جای مختلف سخت‌کد بود و با هر
   تغییر کاتالوگ یکی جا می‌ماند و عدد کهنه ماه‌ها روی سایت
   ماند در حالی که کاتالوگ عوض شده بود.

   حالا اضافه شدن یک عطر یعنی همه صفحات خودکار به‌روز می‌شوند.
   مقدار اولیه در HTML «—» است نه عدد، تا اگر API کند بود عدد
   غلط دیده نشود.

   کش در sessionStorage: در یک نشست مرور، ده صفحه یعنی ده
   درخواست تکراری برای عددی که تغییر نمی‌کند. */
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

  /** پر کردن همه [data-stat] در صفحه */
  async paint(root = document) {
    const nodes = root.querySelectorAll('[data-stat]');
    if (!nodes.length) return;
    const d = await this.load();
    if (!d) return;
    nodes.forEach(el => {
      const v = d[el.dataset.stat];
      if (v == null) return;
      /* پیشوند اختیاری: data-stat-prefix="بیش از " */
      el.textContent = (el.dataset.statPrefix || '') + toFa(v);
    });
  }
};

/* ── ابزارها ── */
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

/* ── هدر مشترک ── */
function renderHeader(active = '') {
  /* لوگو به‌شکل SVG برداری — ۱٫۶KB و در هر تراکم پیکسلی تیز.
     نسخه light چون هدر پس‌زمینه ابسیدین دارد.
     نسبت ابعاد واقعی نشان ۵۴۵×۱۵۶۵ = ۰٫۳۴۸۲ است؛ width/height
     باید همین را بدهد وگرنه مرورگر جای اشتباه رزرو می‌کند و صفحه
     در لحظه بارگذاری می‌پرد (CLS). پیش از این ۴۴×۴۴ نوشته شده بود
     یعنی مربع — که هیچ ربطی به نشان کشیده ندارد.
     ۱۵×۴۳ = ۰٫۳۴۸۸ → ۰٫۱۷٪ خطا. (۱۵×۴۲ خطای ۲٫۵٪ می‌داد.) */
  const logo = '/images/brand-mark-light.svg';
  /* نوار بالای صفحه با جمله برند شروع می‌شود؛ اگر اعلان فعالی
     باشد، loadNotice() جایگزینش می‌کند. یک نوار، نه دو تا —
     فضای بالای صفحه گران‌ترین بخش سایت است. */
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

/* ── فوتر مشترک ── */
function renderFooter() {
  return `
  <footer role="contentinfo">
    <div class="footer-grid">
      <div>
        <h4>عطر یزد</h4>
        <p>بازآفرینی دست‌ساز روایح ماندگار جهان با عصاره غلیظ اولیه و فرمولاسیون اختصاصی.
           بیش از دوازده سال تجربه فروش حضوری.</p>
      </div>
      <div>
        <h4>راهنما</h4>
        <a href="/samples">سمپل ۵ میل</a>
        <a href="/why-us">چرا عطر یزد؟</a>
        <a href="/terms">قوانین و مقررات</a>
        <a href="/privacy">حریم خصوصی</a>
        <a href="/contact">تماس با ما</a>
        <a href="/track">پیگیری سفارش</a>
      </div>
      <div>
        <h4>ما را دنبال کنید</h4>
        <div class="social-row">
          <a class="social-btn" href="${SOCIAL.instagram.url}" target="_blank"
             rel="noopener noreferrer" aria-label="اینستاگرام عطر یزد">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.13 1.38C1.35 2.68.93 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.13.67.66 1.34 1.08 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.3 1.46-.72 2.13-1.38.66-.67 1.08-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91-.3-.79-.72-1.46-1.38-2.13C21.32 1.35 20.65.93 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 100 12.32A6.16 6.16 0 0012 5.84zm0 10.16a4 4 0 110-8 4 4 0 010 8zm7.85-10.4a1.44 1.44 0 11-2.88 0 1.44 1.44 0 012.88 0z"/></svg>
            <span>${SOCIAL.instagram.handle}</span>
          </a>
          <a class="social-btn" href="${SOCIAL.telegram.url}" target="_blank"
             rel="noopener noreferrer" aria-label="پشتیبانی در تلگرام">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.94 24C5.34 24 0 18.63 0 12S5.34 0 11.94 0C18.6 0 24 5.37 24 12s-5.4 12-12.06 12zM6.35 11.7c-.6.24-1.2.48-1.23.87-.03.3.36.42.87.6.09.03.18.06.3.09.51.15 1.2.33 1.56.33.33.01.69-.12 1.11-.4 2.73-1.85 4.14-2.78 4.23-2.8.06-.01.15-.03.21.03.06.06.06.17.04.2-.04.14-1.13 1.14-1.72 1.68-.19.17-.32.29-.35.32-.06.07-.13.13-.2.19-.47.45-.82.79.02 1.34.42.28.75.5 1.08.73.36.24.71.48 1.17.79.12.08.23.16.34.24.42.3.79.57 1.25.53.27-.03.55-.28.69-1.03.33-1.77.99-5.63 1.14-7.21a1.8 1.8 0 00-.02-.4.42.42 0 00-.14-.27.65.65 0 00-.38-.11c-.33.01-.85.19-3.31 1.21-.86.36-2.57 1.09-5.14 2.21-.42.16-.64.32-.66.47z"/></svg>
            <span>پشتیبانی تلگرام</span>
          </a>
        </div>
        <p style="margin-top:10px;font-size:.78rem">
          تازه‌ترین رایحه‌ها و آموزش‌ها را آنجا منتشر می‌کنیم.
        </p>
      </div>
      <div>
        <h4>ارسال و مرجوعی</h4>
        <p>پست و تیپاکس سراسری: ۱۰۰٬۰۰۰ تومان</p>
        <p>ارسال رایگان بالای ۲٬۰۰۰٬۰۰۰ تومان</p>
        <p>زمان تحویل: ۳ تا ۷ روز کاری</p>
      </div>
      <div>
        <h4>اسانس</h4>
        <p style="line-height:2">اسانس محصولات از خانه‌های معتبر جهانی
        <strong style="color:var(--gold)">ژیوودان</strong>،
        <strong style="color:var(--gold)">فیرمنیش</strong>،
        <strong style="color:var(--gold)">ایبرکم</strong> و
        <strong style="color:var(--gold)">لوزی</strong> تأمین می‌شود.</p>
        <a href="/essences" style="color:var(--gold);font-weight:700">بیشتر بدانید ←</a>
      </div>
      <div>
        <h4>نماد اعتماد</h4>
        <!-- نشان اعتماد الکترونیک — با جاوااسکریپت پر می‌شود.
             جعبه ارتفاع رزروشده دارد تا جایگزینی پرش نسازد. -->
        <div id="enamadSeal"></div>
        <!-- ── نشانی و تلفن در فوتر ──
             اینماد درج نشانی پستی، کد پستی و شماره تماس را روی
             سایت **الزامی** کرده است. صفحه «تماس با ما» به‌تنهایی
             کافی نیست چون در همه صفحات دیده نمی‌شود.
             محتوا با جاوااسکریپت از /api/contact-info پر می‌شود تا
             تغییر در پنل بلافاصله همه‌جا اعمال شود. -->
        <div id="footContact" class="foot-contact"></div>
      </div>
    </div>
    <div class="footer-bottom">
      © ۱۴۰۵ تمامی حقوق متعلق به فروشگاه آنلاین «عطر یزد | Yazd Perfume» است.
    </div>
  </footer>`;
}

/* ── کارت محصول ── */
function genderLabel(g) {
  return g === 'MEN' ? 'مردانه' : g === 'WOMEN' ? 'زنانه' : g === 'UNISEX' ? 'یونیسکس' : '';
}

function fullName(p) {
  return p.brand_fa ? `${p.brand_fa} — ${p.name_fa}` : p.name_fa;
}

/**
 * نشانی نسخه کوچک تصویر برای کارت فهرست.
 *
 * کارت حدود ۳۰۰ پیکسل نمایش داده می‌شود؛ فرستادن فایل ۱۲۵۴ پیکسلی
 * برای آن روی موبایل صدها کیلوبایت هدر رفتن است. نسخه `-sm` همان
 * تصویر در ۴۲۰ پیکسل است (حدود ۱۰ کیلوبایت به‌جای ۱۴۰).
 *
 * فقط برای تصاویر واریانت‌دار `fam-…` ساخته شده؛ برای بقیه همان
 * فایل اصلی برمی‌گردد.
 */
function cardImage(url) {
  return /\/fam-[a-z0-9-]+\.jpg$/.test(url || '')
    ? url.replace(/\.jpg$/, '-sm.jpg')
    : url;
}

function productCard(p) {
  const notes = (p.notes?.top || []).slice(0, 3).join('، ');
  const img = cardImage(p.image_url);

  /* ── قیمت جشنواره ──
     `campaign_percent` را سرور می‌دهد (۰ یعنی جشنواره‌ای شامل این
     محصول نیست). محاسبه سمت مرورگر انجام نمی‌شود چون قیمت نهایی
     باید همان چیزی باشد که سبد خرید می‌گوید؛ فرمول تکراری در دو
     جا یعنی دیر یا زود دو عدد متفاوت.

     `min_price` قیمت پیش از تخفیف است — همان عددی که سرور روی آن
     درصد را حساب می‌کند، پس اختلاف گرد کردن پیش نمی‌آید. */
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

  /* ── نشان ناموجودی (ممیزی جعبه‌سیاه مرداد ۱۴۰۵) ──
     پیش‌تر کارت هیچ نشانه‌ای از ناموجود بودن نداشت: «مشاهده و
     خرید» می‌نوشت و قیمت نشان می‌داد. کاربر کلیک می‌کرد، به صفحه
     محصول می‌رفت، و آنجا دکمه خاکستری می‌دید. با ۰٫۰۵٪ موجودی
     این چند بار تکرار می‌شد تا برود.

     `in_stock` از قبل در پاسخ API بود — فقط استفاده نمی‌شد.

     سه نشانه همزمان: برچسب، تصویر کم‌رنگ، و دعوت به «خبرم کن»
     به‌جای «مشاهده». صادقانه‌تر و کم‌هزینه‌تر از ناامیدی بعدی. */
  /* ── سه حالت تأمین، نه دو حالت ──
     «ناموجود» برای کار دست‌ساز پیام غلطی بود: عطری که همین حالا
     در قفسه نیست ولی می‌سازیمش، با عطری که اصلاً نمی‌توانیم تهیه
     کنیم یکسان دیده می‌شد — هر دو بن‌بست.

       موجود        → ارسال از انبار
       به سفارش     → چند روز کار، ولی حتماً می‌رسد
       فعلاً نداریم → فقط «خبرم کن»

     این تفاوت مهم است چون بیشتر کاتالوگ عمداً بدون موجودی انبار
     است: عنوان‌ها برای سفارش و دیده‌شدن در جستجو می‌مانند. */
  const mode = p.supply_mode || 'UNAVAILABLE';
  const inStock = (p.in_stock === true || p.in_stock === 1) && ['IN_STOCK','MADE_TO_ORDER'].includes(mode);
  const unknownState = p.availability_unknown === true;
  const madeToOrder = !unknownState && !inStock && mode === 'MADE_TO_ORDER' && Number(p.min_price) > 0;
  const out = !unknownState && !inStock && !madeToOrder;

  const stateLabel = unknownState || inStock ? '' : (madeToOrder ? 'به سفارش' : 'فعلاً نداریم');
  const peekText = unknownState ? 'مشاهده جزئیات' : inStock ? 'مشاهده و خرید'
                 : madeToOrder ? 'به سفارش ساخته می‌شود'
                 : 'خبرم کن وقتی رسید';
  const aria = unknownState || inStock ? 'مشاهده جزئیات'
             : madeToOrder ? 'به سفارش ساخته می‌شود'
             : 'فعلاً موجود نیست، اطلاع از موجود شدن';

  return `
  <a class="product-card fade-up${out ? ' is-out' : ''}${madeToOrder ? ' is-mto' : ''}"
     href="/perfume/${p.slug}"
     aria-label="${fullName(p)} — ${aria}">
    <div class="img-wrap">
      <img src="${img}" alt="تصویر ${fullName(p)}" loading="lazy" width="300" height="300">
      ${genderLabel(p.gender) ? `<span class="card-badge">${genderLabel(p.gender)}</span>` : ''}
      ${stateLabel ? `<span class="card-out${madeToOrder ? ' mto' : ''}">${stateLabel}</span>` : ''}
      ${off > 0 && inStock ? `<span class="card-off"><bdi>${toFa(pct)}٪</bdi> تخفیف</span>` : ''}
      <div class="card-peek">${peekText}</div>
    </div>
    <div class="body">
      <div class="card-title">${fullName(p)} <span class="card-tag">«دست‌ساز»</span></div>
      <div class="card-sub">${p.name_en}</div>
      ${notes ? `<div class="card-notes">نُت‌های آغازین: ${notes}</div>` : ''}
      <div class="card-price-row">
        ${priceBlock}
        ${out
          ? '<span class="card-go-notify">خبرم کن ←</span>'
          : '<span class="card-go">مشاهده ←</span>'}
      </div>
    </div>
  </a>`;
}

/* ═══════════════════════════════════════════
   «اخیراً دیدید» — تاریخچه محلی بازدید
   ═══════════════════════════════════════════
   چرا این روش و نه توصیه‌گر جمعی («کسانی که این را دیدند، آن را
   هم دیدند»):

   توصیه‌گر جمعی به حجم داده نیاز دارد. با ترافیک یک فروشگاه تازه،
   خروجی‌اش نویز است نه پیشنهاد — دو نفر که تصادفاً یک صفحه را
   دیده‌اند، الگو نیستند. تاریخچه خودِ کاربر از همان بازدید دوم
   درست کار می‌کند.

   چرا localStorage و نه سرور:
     • با مهمان (بدون ثبت‌نام) هم کار می‌کند — اکثریت بازدیدکنندگان
     • هیچ داده رفتاری روی سرور ذخیره نمی‌شود، هم‌راستا با موضع
       حریم خصوصی پروژه (جدول events عمداً بدون شناسه پایدار است)
     • صفر بار روی سرور

   محدودیت صادقانه: بین دستگاه‌ها همگام نمی‌شود. برای این کاربرد
   معامله درستی است. */
const YazdRecent = {
  KEY: 'yazd_recent',
  MAX: 12,                    // بیش از این، حافظه بی‌فایده اشغال می‌شود
  TTL_DAYS: 30,               // تاریخچه کهنه پیشنهاد نیست، خاطره است

  _read() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      const cutoff = Date.now() - this.TTL_DAYS * 86400000;
      return raw.filter(x => x && x.slug && (x.at || 0) > cutoff);
    } catch { return []; }
  },

  /**
   * ثبت بازدید. فقط داده لازم برای ساخت کارت ذخیره می‌شود، نه کل
   * محصول — وگرنه سهمیه localStorage با ۱۲ محصول پر می‌شود.
   */
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
      /* سهمیه پر یا حالت ناشناس — بی‌صدا رد می‌شود.
         تاریخچه بازدید هرگز نباید صفحه محصول را بشکند. */
    }
  },

  /** فهرست، با امکان کنار گذاشتن محصول جاری */
  list(excludeSlug) {
    return this._read().filter(x => x.slug !== excludeSlug);
  },

  clear() {
    try { localStorage.removeItem(this.KEY); } catch {}
  },

  /**
   * رندر در یک ظرف.
   *
   * قاعده‌ای که رعایت می‌شود: اگر چیزی برای نشان دادن نیست، بخش
   * **اصلاً ساخته نمی‌شود**. بخش خالی با عنوان، بدتر از نبودن بخش
   * است — هم فضا می‌گیرد و هم می‌گوید «اینجا باید چیزی می‌بود».
   *
   * @param {string} sel      شناسه ظرف
   * @param {object} [opt]    { exclude, min, title }
   */
  render(sel, opt = {}) {
    const box = document.querySelector(sel);
    if (!box) return 0;

    const min = opt.min || 2;      // یک کارت تنها، ردیف به‌نظر نمی‌رسد
    const items = this.list(opt.exclude).slice(0, opt.limit || 4);
    if (items.length < min) return 0;

    const title = opt.title || 'اخیراً دیدید';
    box.innerHTML =
      `<div class="recent-head">
         <h2>${title}</h2>
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

/* ═══════════════════════════════════════════
   پروفایل بویایی
   ═══════════════════════════════════════════
   پاسخ‌های کوییز محلی نگه داشته می‌شوند تا صفحه اصلی بتواند
   «پیشنهاد برای شما» بسازد — حتی برای مهمانی که ثبت‌نام نکرده.

   برای کاربر واردشده، سرور هم نسخه‌ای در جدول customers دارد.
   دو لایه عمدی است: قابلیتی که فقط برای کاربر واردشده کار کند،
   با نرخ ثبت‌نام واقعی، عملاً برای هیچ‌کس کار نمی‌کند. */
const YazdTaste = {
  KEY: 'yazd_taste',
  TTL_DAYS: 120,        // سلیقه بویایی آهسته عوض می‌شود، ولی ابدی نیست

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
    } catch { /* سهمیه پر یا حالت ناشناس — بی‌صدا */ }
  },

  clear() { try { localStorage.removeItem(this.KEY); } catch {} },

  /**
   * رندر «پیشنهاد برای شما».
   *
   * مثل «اخیراً دیدید»: اگر چیزی برای نشان دادن نیست، بخش اصلاً
   * ساخته نمی‌شود — نه عنوانِ خالی، نه فضای رزروشده، نه CLS.
   *
   * خلاصه پروفایل نمایش داده می‌شود تا کاربر بداند سایت بر چه
   * اساسی پیشنهاد می‌دهد. «پیشنهاد اختصاصی» بدون توضیح، مبهم و
   * کمی نگران‌کننده است؛ با توضیح، شفاف و قابل کنترل.
   */
  async render(sel) {
    const box = document.querySelector(sel);
    if (!box) return 0;

    const local = this.get();
    const body = local ? { answers: local.answers } : {};

    // مهمان بدون پروفایل محلی: درخواست بی‌فایده به سرور نزنیم
    if (!local && !YazdAuth.token()) return 0;

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
      // برای کاربر واردشده، نسخه سرور هم پاک شود
      if (YazdAuth.token()) {
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

/* ── وضعیت ورود مشتری ── */
const YazdAuth = {
  token() { return localStorage.getItem('yazd_customer_token'); },
  mobile() { return localStorage.getItem('yazd_customer_mobile'); },
  headers() { const t = this.token(); return t ? { 'X-Customer-Token': t } : {}; },
  async check() {
    const t = this.token();
    if (!t) return { authenticated: false };
    try {
      const r = await fetch('/api/auth/me', { headers: this.headers() });
      const d = await r.json();
      if (!d.authenticated) {
        localStorage.removeItem('yazd_customer_token');
        localStorage.removeItem('yazd_customer_mobile');
      }
      return d;
    } catch { return { authenticated: false }; }
  }
};

/* ── اسکلت بارگذاری — به‌جای اسپینر خالی ── */
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

/* ── آشکارسازی هنگام اسکرول ── */
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

/* ── سایه هدر پس از اسکرول ── */
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

/* ── نوار پیشرفت خواندن ── */
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

/* ── نوار اعلان ──
   تک‌پیامی و بدون چرخش، جایگزین جمله ثابت برند.

   چرا اسلایدر نساختیم: پژوهش‌های متعدد (Notre Dame، Nielsen،
   Conversionista) نشان می‌دهند فقط ~۱٪ کاربران روی اسلایدر
   کلیک می‌کنند و ۸۴٪ همان کلیک روی اسلاید اول است. تصویر ثابت
   در آزمون A/B چهل درصد کلیک گرفت در برابر دو درصد اسلایدر.
   به‌علاوه چرخش خودکار CLS را خراب می‌کند — که اینجا ۰٫۰۰۴ است
   و نگه داشتنش ارزش دارد.

   پیام روی همان نوار موجود می‌نشیند تا ارتفاع صفحه عوض نشود
   (صفر جابه‌جایی چیدمان). */
async function loadNotice() {
  const bar = document.getElementById('announceBar');
  if (!bar) return;

  // بستنِ کاربر تا پایان همان روز به یاد می‌ماند
  let closed = {};
  try { closed = JSON.parse(localStorage.getItem('yazd_notice_closed') || '{}'); } catch {}

  try {
    const d = await fetch('/api/notice').then(r => r.json());
    const n = d.notice;
    if (!n) return;
    if (closed[n.id] === new Date().toISOString().slice(0, 10)) return;

    bar.className = 'announce notice-' + (n.tone || 'gold');
    bar.innerHTML =
      `<span class="n-txt">${esc(n.text)}</span>` +
      (n.link ? ` <a class="n-link" href="${esc(n.link)}">${esc(n.link_label || 'مشاهده')}</a>` : '') +
      `<button class="n-x" type="button" aria-label="بستن اعلان">✕</button>`;

    bar.querySelector('.n-x').onclick = () => {
      closed[n.id] = new Date().toISOString().slice(0, 10);
      try { localStorage.setItem('yazd_notice_closed', JSON.stringify(closed)); } catch {}
      // به جمله برند برمی‌گردد، نه اینکه نوار حذف شود —
      // حذف کامل باعث پرش چیدمان می‌شد
      bar.className = 'announce';
      bar.textContent = '✨ «رایحه، نامرئی‌ترین و ماندگارترین اثر حضور شماست.»';
    };
  } catch {}
}

/**
 * کارهای غیرضروری را تا پس از رنگ‌آمیزی اصلی عقب می‌اندازد.
 *
 * چرا لازم شد: ردیابی ۳G نشان داد `/api/notice` و `/api/auth/me`
 * روی مسیر بحرانی می‌نشستند و با تصویر LCP بر سر پهنای باند
 * رقابت می‌کردند — `/api/notice` تنها ۱٬۸۰۰ میلی‌ثانیه گرفت.
 *
 * هیچ‌کدام برای دیدن محتوای صفحه لازم نیستند: نوار اعلان روی
 * نوار موجود می‌نشیند (بدون تغییر ارتفاع) و نقطه حساب کاربری
 * فقط یک نشانگر است.
 *
 * `requestIdleCallback` وقتی مرورگر بیکار شد اجرا می‌کند؛ سقف
 * دو ثانیه گذاشته شده تا روی دستگاه همیشه‌مشغول هم بالاخره
 * اجرا شود. سافاری آن را ندارد، پس `setTimeout` جایگزین است.
 */
/**
 * نشانی و تلفن فوتر — الزام اینماد.
 *
 * چرا با جاوااسکریپت و نه در خودِ HTML: فوتر در `app.js` ساخته
 * می‌شود و یک نسخه دارد؛ اگر مقدار را ثابت بنویسیم، تغییرش در
 * پنل بی‌اثر می‌ماند. عقب انداختن هم بی‌خطر است چون فوتر پایین
 * صفحه است و روی LCP اثر ندارد.
 */
async function loadFooterContact() {
  const box = document.getElementById('footContact');
  /* نشان اینماد جعبه جدا دارد و نباید به نشانی و تلفن گره بخورد.
     پیش‌تر اینجا `if (!box) return` بود؛ در صفحه‌ای که فوتر تماس
     نداشت، نشان هم بی‌صدا غایب می‌شد. */
  if (!box) { renderEnamad(null, null); return; }
  try {
    const d = await fetch('/api/contact-info').then(r => r.json());
    const rows = [];
    if (d.phone) {
      /* شماره موبایل با واتس‌اپ: دو راه ارتباط از یک شماره.
         لینک wa.me فقط برای شماره‌های ۰۹… ساخته می‌شود و صفر
         ابتدایی با کد کشور ۹۸ جایگزین می‌گردد — وگرنه واتس‌اپ
         شماره را نمی‌شناسد. */
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
    /* شبکه قطع یا API خطا داد. جعبه نشان نباید خالی بماند —
       جانشین داخلی می‌نشیند تا فوتر ناقص به نظر نرسد. */
    renderEnamad(null, null);
  }
}

/**
 * نشان اعتماد الکترونیک.
 *
 * ── چرا اینجا و نه در HTML ثابت ──
 * شناسه از پنل می‌آید. اگر ثابت بنویسیم، کارت «بررسی آمادگی» که
 * خالی بودن کد را هشدار می‌دهد برای همیشه دروغ می‌گوید.
 *
 * ── چهار اصلاح نسبت به کدی که اینماد می‌دهد ──
 *   ۱) `rel="noopener"` — بدون آن صفحه مقصد از راه `window.opener`
 *      به این صفحه دسترسی می‌گیرد.
 *   ۲) `alt` گویا به‌جای `alt=''` — صفحه‌خوان باید بگوید این چیست.
 *   ۳) `width`/`height` ثابت — تصویر که برسد فوتر نمی‌پرد.
 *   ۴) ویژگی `code='…'` حذف شد — HTML معتبر نیست و کاری نمی‌کند
 *      مگر اینکه اسکریپت خودِ اینماد بار شود، که ما نمی‌کنیم.
 *
 * ── محافظ ورودی ──
 * هر دو مقدار پیش از رفتن داخل نشانی با الگو سنجیده می‌شوند. سرور
 * هم همین کار را می‌کند (`isValidSetting`)، ولی این لایه دوم است:
 * اگر روزی پاسخ API از جای دیگری بیاید، نشانی تصویر نباید بتواند
 * از کنترل خارج شود.
 *
 * @param {string} id   شناسه عددی پرونده
 * @param {string} code کد امنیتی
 */
function renderEnamad(id, code) {
  const box = document.getElementById('enamadSeal');
  if (!box) return;

  const okId   = /^\d{1,10}$/.test(String(id || ''));
  const okCode = /^[A-Za-z0-9]{8,64}$/.test(String(code || ''));

  /* جانشین **همیشه اول** می‌نشیند — چه کد ثبت نشده باشد، چه
     ثبت شده ولی تصویر هنوز نرسیده. این ترتیب عمدی است: در هر
     لحظه چیزی روی صفحه هست و جعبه هرگز خالی نمی‌ماند.
     سایت ادعای دروغ نمی‌کند — تا نشان واقعی نیامده، «آزمایشی». */
  box.innerHTML = `
    <div class="enamad-badge">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#C59B27" aria-hidden="true"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
      نماد اعتماد الکترونیکی (آزمایشی)
    </div>`;

  if (!okId || !okCode) return;

  const q = `id=${encodeURIComponent(id)}&Code=${encodeURIComponent(code)}`;

  /* ── چرا تصویر پیش از افزودن به صفحه ساخته می‌شود ──
     نسخه اول این تابع `<img loading="lazy">` را مستقیم در
     `innerHTML` می‌گذاشت و `onerror` را بعد وصل می‌کرد. آزمون
     مرورگر نشان داد این کار **دو ایراد** دارد:

       ۱) فوتر پایین صفحه است، پس `lazy` تصویر را تا اسکرول
          کاربر اصلاً بار نمی‌کند. بازدیدکننده‌ای که تا پایین
          نرود، نشان را هرگز نمی‌بیند — یعنی همان چیزی که برای
          اعتمادسازی گذاشته‌ایم، دیده نمی‌شود.

       ۲) چون بار نمی‌شد، `onerror` هم هرگز اجرا نمی‌شد و
          جانشین در حالت قطعی سرور اینماد نمی‌آمد.

     حالا تصویر در حافظه ساخته می‌شود، `onload`/`onerror` پیش از
     تعیین `src` وصل می‌شوند، و فقط **پس از موفقیت** به صفحه
     می‌رود. تا آن لحظه جانشین سر جایش است، پس کاربر هیچ‌وقت
     جعبه خالی یا تصویر شکسته نمی‌بیند. */
  const img = new Image(96, 96);
  img.alt = 'نماد اعتماد الکترونیک — عطر یزد';
  img.width = 96;
  img.height = 96;
  img.decoding = 'async';
  img.referrerPolicy = 'origin';

  /* ── مهلت ۸ ثانیه ──
     اگر سرور اینماد کند باشد یا اصلاً پاسخ ندهد، درخواست تصویر
     باز می‌ماند و رویداد `load` صفحه هرگز کامل نمی‌شود. نشانه‌اش
     چرخ «در حال بارگذاری» در تب مرورگر است — کاربر فکر می‌کند
     سایت خراب است، در حالی که فقط یک تصویر تزئینی نیامده.

     این را آزمون مرورگر در محیطی که به سرور اینماد دسترسی نداشت
     نشان داد: `networkidle` هرگز فرا نمی‌رسید.

     پس از مهلت، درخواست رها می‌شود و جانشین سر جایش می‌ماند. */
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    img.src = '';          // درخواست معلق را رها می‌کند
  }, 8000);

  img.onload = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    /* زمینه سفید عمدی: نشان اینماد پس‌زمینه روشن دارد و روی
       فوتر تیره این سایت محو می‌شود. */
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

  /* سرور اینماد در دسترس نیست یا کد نامعتبر است. جانشین که از
     پیش نشسته دست‌نخورده می‌ماند — تصویر شکسته بدتر از نبودنش. */
  img.onerror = () => { settled = true; clearTimeout(timer); };

  img.src = `https://trustseal.enamad.ir/logo.aspx?${q}`;
}

function whenIdle(fn, timeout = 2000) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 200);
}


/* ═══════════════════════════════════════════
   PWA — سرویس‌ورکر و نصب روی صفحه اصلی
   ═══════════════════════════════════════════
   سه قاعده که این پیاده‌سازی رعایت می‌کند:

   ۱) **هیچ پاسخ API کش نمی‌شود.** این فروشگاه با پول واقعی کار
      می‌کند؛ قیمت یا موجودی کهنه یعنی سفارشی که سرور رد می‌کند و
      اعتمادی که می‌رود. کل منطقش در sw.js است.

   ۲) **ثبت پس از بارگذاری.** ثبت سرویس‌ورکر روی مسیر بحرانی
      نمی‌نشیند؛ نخستین بازدید نباید کندتر شود. FCP این سایت
      ۰٫۲۶ ثانیه است و نگه داشتنش ارزش دارد.

   ۳) **دعوت به نصب، نه پاپ‌آپ.** بنر خودکار هنگام ورود، همان
      الگویی است که در تحلیل رقابتی ردش کردیم. دکمه فقط وقتی
      ظاهر می‌شود که مرورگر بگوید نصب ممکن است، و اگر کاربر رد
      کند تا سی روز دیگر پرسیده نمی‌شود. */
const YazdPWA = {
  DISMISS_KEY: 'yazd_pwa_dismissed',
  DISMISS_DAYS: 30,
  _prompt: null,

  register() {
    if (!('serviceWorker' in navigator)) return;
    /* روی http محلی هم کار می‌کند (localhost استثناست) ولی روی
       دامنه بدون HTTPS نه — پس بی‌صدا رد می‌شویم. */
    if (location.protocol !== 'https:' && location.hostname !== 'localhost'
        && location.hostname !== '127.0.0.1') return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        /* اگر نسخه تازه‌ای آماده شد، بی‌سر و صدا فعالش می‌کنیم.
           نمایش «نسخه جدید موجود است» برای فروشگاه اضافه است؛
           کاربر فقط می‌خواهد عطر بخرد. */
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
      .catch(() => { /* ثبت نشد — سایت بدون آن کاملاً کار می‌کند */ });
  },

  /** آیا کاربر اخیراً دعوت نصب را رد کرده؟ */
  _dismissed() {
    try {
      const t = parseInt(localStorage.getItem(this.DISMISS_KEY) || '0');
      return t && (Date.now() - t) < this.DISMISS_DAYS * 86400000;
    } catch { return false; }
  },

  initInstall() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();          // بنر خودکار مرورگر را نگه می‌داریم
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
  whenIdle(loadNotice);
  whenIdle(loadFooterContact);

  /* PWA — عمداً پس از بقیه. ثبت سرویس‌ورکر نخستین بازدید را
     کندتر می‌کند اگر روی مسیر بحرانی بنشیند. */
  YazdPWA.initInstall();
  window.addEventListener('load', () => whenIdle(() => YazdPWA.register(), 3000));

  YazdCart.updateBadge();

  /* آمار زنده — بی‌درنگ، چون در هیرو دیده می‌شود و «—» ماندنش
     بد است. سبک است: یک درخواست کش‌شده در هر نشست. */
  YazdStats.paint();

  /* بررسی ورود هم به تعویق می‌افتد.
     فقط یک نقطه کوچک روی آیکن حساب را روشن می‌کند؛ هیچ محتوایی
     به آن وابسته نیست. صفحه‌هایی که واقعاً به وضعیت ورود نیاز
     دارند (حساب، علاقه‌مندی، تسویه) خودشان صدا می‌زنند. */
  whenIdle(async () => {
    const me = await YazdAuth.check();
    if (me.authenticated) {
      document.querySelectorAll('[data-account-dot]').forEach(d => d.style.display = 'block');
      document.querySelectorAll('[data-account-btn]').forEach(b =>
        b.setAttribute('title', 'حساب کاربری — ' + me.mobile));
    }
  });
});
