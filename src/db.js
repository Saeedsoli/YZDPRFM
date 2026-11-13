const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const crypto = require('crypto');
const stockReservations = require('./order-stock-reservations');
const essenceInventory = require('./essence-inventory');
const shopTime = require('./shop-time');
const { referenceAccords } = require('./reference-accord-display');

const ROOT_DIR = path.resolve(__dirname, '..');

const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'yazd.db');

const DB_WAS_EXISTING = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0;

require('./production-admin-guard').assertProductionAdmin({Database,dbPath:DB_PATH,existing:DB_WAS_EXISTING});

const SEED_DIR = process.env.SEED_DIR || path.join(ROOT_DIR, 'seed');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('busy_timeout = 30000');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id                    TEXT PRIMARY KEY,
      slug                  TEXT NOT NULL UNIQUE,
      name_fa               TEXT NOT NULL,
      name_en               TEXT NOT NULL,
      title_fa_display      TEXT,
      subtitle_en_display   TEXT,
      brand_fa              TEXT,
      brand_en              TEXT,
      gender                TEXT,
      concentration         TEXT,
      family_fa             TEXT,
      family_en             TEXT,
      family_slug           TEXT,
      temperature           TEXT,
      taste                 TEXT,
      notes_top             TEXT,
      notes_middle          TEXT,
      notes_base            TEXT,
      accords               TEXT,
      season                TEXT,
      occasion              TEXT,
      longevity             TEXT,
      sillage               TEXT,
      country               TEXT,
      market_segment        TEXT,
      perfumer              TEXT,
      release_year          INTEGER,
      transparency_notice   TEXT,
      image_url             TEXT,
      created_at            TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_slug   ON products(slug);
    CREATE INDEX IF NOT EXISTS idx_products_family ON products(family_slug);
    CREATE INDEX IF NOT EXISTS idx_products_gender ON products(gender);
    CREATE INDEX IF NOT EXISTS idx_products_brand  ON products(brand_fa);

    CREATE TABLE IF NOT EXISTS variants (
      sku          TEXT PRIMARY KEY,
      product_id   TEXT NOT NULL,
      type         TEXT NOT NULL,
      type_label   TEXT,
      volume_ml    INTEGER,
      price_toman  INTEGER NOT NULL,
      stock        INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);

    CREATE TABLE IF NOT EXISTS orders (
      order_id        TEXT PRIMARY KEY,
      created_at      TEXT NOT NULL,
      customer_name   TEXT NOT NULL,
      mobile          TEXT NOT NULL,
      province        TEXT,
      city            TEXT,
      address         TEXT,
      postal_code     TEXT,
      subtotal        INTEGER NOT NULL,
      shipping_fee    INTEGER NOT NULL,
      total_paid      INTEGER NOT NULL,
      payment_gateway TEXT,
      payment_ref     TEXT,
      status          TEXT NOT NULL DEFAULT 'PENDING'
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     TEXT NOT NULL,
      sku          TEXT NOT NULL,
      product_name TEXT NOT NULL,
      unit_price   INTEGER NOT NULL,
      quantity     INTEGER NOT NULL,
      line_total   INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS tickets (
      ticket_id      TEXT PRIMARY KEY,
      order_id       TEXT,
      product_name   TEXT,
      volume_ml      INTEGER,
      used_under_2ml INTEGER,
      reason         TEXT,
      description    TEXT,
      status         TEXT DEFAULT 'NEW_PENDING',
      created_at     TEXT NOT NULL,
      sla_deadline   TEXT
    );

    CREATE TABLE IF NOT EXISTS articles (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      slug            TEXT NOT NULL,
      category        TEXT,
      category_label  TEXT,
      read_time       TEXT,
      cover_image     TEXT,
      excerpt         TEXT,
      content         TEXT,
      sources         TEXT,
      created_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- کدهای تخفیف
    CREATE TABLE IF NOT EXISTS coupons (
      code          TEXT PRIMARY KEY,
      type          TEXT NOT NULL,          -- PERCENT | FIXED | FREE_SHIPPING
      value         INTEGER NOT NULL DEFAULT 0,
      min_subtotal  INTEGER NOT NULL DEFAULT 0,
      max_discount  INTEGER,                -- سقف تخفیف درصدی
      usage_limit   INTEGER,                -- حداکثر دفعات کل (NULL = نامحدود)
      used_count    INTEGER NOT NULL DEFAULT 0,
      per_user_once INTEGER NOT NULL DEFAULT 1,
      expires_at    TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      description   TEXT,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- مصرف کوپن به تفکیک کاربر
    CREATE TABLE IF NOT EXISTS coupon_usage (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      code     TEXT NOT NULL,
      mobile   TEXT NOT NULL,
      order_id TEXT NOT NULL,
      used_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_usage_code   ON coupon_usage(code);
    CREATE INDEX IF NOT EXISTS idx_usage_mobile ON coupon_usage(mobile);

    -- تاریخچه وضعیت سفارش
    CREATE TABLE IF NOT EXISTS order_status_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   TEXT NOT NULL,
      status     TEXT NOT NULL,
      note       TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_log_order ON order_status_log(order_id);

    -- نشست‌های پایدار (ادمین و مشتری)
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,          -- ADMIN | CUSTOMER
      subject    TEXT,                   -- شماره موبایل برای مشتری
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

    -- ═══ کارکنان و نقش‌ها ═══
    -- نقش = مجموعه‌ای از مجوزها. مدیر کل می‌تواند نقش بسازد و
    -- مجوزهایش را تعیین کند.
    CREATE TABLE IF NOT EXISTS roles (
      key         TEXT PRIMARY KEY,          -- شناسه لاتین: support, warehouse
      name        TEXT NOT NULL,             -- نام فارسی برای نمایش
      description TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',-- آرایه JSON از کلیدهای مجوز
      builtin     INTEGER NOT NULL DEFAULT 0,-- نقش پیش‌فرض؛ حذف نمی‌شود
      locked      INTEGER NOT NULL DEFAULT 0,-- مجوزهایش قابل تغییر نیست (مدیر کل)
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT NOT NULL UNIQUE,     -- نام کاربری لاتین
      display_name TEXT NOT NULL,            -- نام فارسی
      mobile       TEXT,
      role_key     TEXT NOT NULL REFERENCES roles(key),
      pass_hash    TEXT NOT NULL,            -- scrypt
      pass_salt    TEXT NOT NULL,
      must_change  INTEGER NOT NULL DEFAULT 1, -- رمز اولیه باید عوض شود
      active       INTEGER NOT NULL DEFAULT 1,
      last_login   TEXT,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role_key);

    -- سابقه کارهای کارکنان — «همه‌چیز، حتی مشاهده»
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id   INTEGER,
      username   TEXT,                       -- نگه داشته می‌شود حتی اگر حساب حذف شود
      role_key   TEXT,
      action     TEXT NOT NULL,              -- کلید مجوز یا نام عمل
      method     TEXT,
      path       TEXT,
      target     TEXT,                       -- شناسه چیزی که تغییر کرد
      detail     TEXT,                       -- JSON
      ip         TEXT,
      allowed    INTEGER NOT NULL DEFAULT 1, -- ۰ = تلاش رد شده
      at         TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
    CREATE INDEX IF NOT EXISTS idx_audit_staff ON audit_log(staff_id);

    -- کدهای یکبار مصرف در انتظار تأیید
    -- پیش‌تر در حافظه بودند؛ با هر ری‌استارت Liara کد کاربری که
    -- همین الان پیامک گرفته بود باطل می‌شد.
    CREATE TABLE IF NOT EXISTS otp_codes (
      mobile     TEXT PRIMARY KEY,
      code       TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      last_sent  INTEGER NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_otp_exp ON otp_codes(expires_at);

    -- محدودیت نرخ درخواست
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket     TEXT PRIMARY KEY,       -- مثلا: login:1.2.3.4
      count      INTEGER NOT NULL DEFAULT 0,
      window_end INTEGER NOT NULL,
      blocked_until INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_rate_window ON rate_limits(window_end);

    -- لاگ رویدادها و خطاها
    CREATE TABLE IF NOT EXISTS app_logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      level     TEXT NOT NULL,           -- ERROR | WARN | INFO
      scope     TEXT,
      message   TEXT NOT NULL,
      meta      TEXT,
      logged_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_logs_time  ON app_logs(logged_at);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON app_logs(level);

    -- علاقه‌مندی‌های مشتری
    CREATE TABLE IF NOT EXISTS wishlist (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      mobile     TEXT NOT NULL,
      product_id TEXT NOT NULL,
      added_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(mobile, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wish_mobile ON wishlist(mobile);

    -- نظرات و امتیاز
    CREATE TABLE IF NOT EXISTS reviews (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id   TEXT NOT NULL,
      mobile       TEXT NOT NULL,
      display_name TEXT,
      rating       INTEGER NOT NULL,
      title        TEXT,
      body         TEXT,
      longevity    INTEGER,              -- امتیاز ماندگاری ۱ تا ۵
      sillage      INTEGER,              -- امتیاز پخش بو ۱ تا ۵
      verified     INTEGER NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
      admin_reply  TEXT,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, mobile)
    );
    CREATE INDEX IF NOT EXISTS idx_rev_product ON reviews(product_id, status);
    CREATE INDEX IF NOT EXISTS idx_rev_status  ON reviews(status);

    -- اطلاع‌رسانی موجود شدن کالا
    CREATE TABLE IF NOT EXISTS stock_alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sku        TEXT NOT NULL,
      mobile     TEXT NOT NULL,
      notified   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sku, mobile)
    );
    CREATE INDEX IF NOT EXISTS idx_alert_sku ON stock_alerts(sku, notified);

    /* ── حساب کاربری مشتری ──
       پیش‌تر ورود فقط با کد یکبارمصرف بود و هیچ حسابی ذخیره
       نمی‌شد. حالا مشتری می‌تواند رمز داشته باشد و نشانی‌اش
       برای سفارش بعدی بماند.

       نام کاربری = شماره موبایل. جدا نگه داشتنش لازم نیست چون
       شماره یکتاست و مشتری همان را به یاد می‌آورد.

       خرید مهمان همچنان ممکن است؛ این جدول اجباری نیست. */
    CREATE TABLE IF NOT EXISTS customers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      mobile      TEXT NOT NULL UNIQUE,     -- همان نام کاربری
      first_name  TEXT NOT NULL,            -- نام یا نام مستعار
      last_name   TEXT,                     -- اختیاری
      email       TEXT,
      pass_hash   TEXT,                     -- NULL = هنوز رمز نساخته
      pass_salt   TEXT,
      -- نشانی پیش‌فرض برای پرکردن خودکار فرم تسویه
      province    TEXT,
      city        TEXT,
      address     TEXT,
      postal_code TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      last_login  TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_cust_mobile ON customers(mobile);

    /* ── رویدادهای تحلیلی ──
       تحلیل داخلی، بدون ابزار بیرونی و بدون کوکی ردیابی.

       آگاهانه چیزی که ذخیره نمی‌شود: IP، شماره موبایل، نام،
       شناسه کاربر. ستون visitor یک هش روزانه است که فردا عوض
       می‌شود، پس نمی‌توان کسی را در طول زمان دنبال کرد — فقط
       برای شمردن «چند نفر جدا» در یک روز به کار می‌رود.

       این جدول منبع «پرفروش‌ترین» و «محبوب‌ترین» سایت است. */
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,            -- view | search | add_cart | purchase …
      target     TEXT,                     -- شناسه محصول، عبارت جستجو، …
      meta       TEXT,                     -- JSON کوتاه
      visitor    TEXT,                     -- هش روزانه، نه شناسه پایدار
      at         TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ev_kind   ON events(kind, at);
    CREATE INDEX IF NOT EXISTS idx_ev_target ON events(kind, target, at);
    CREATE INDEX IF NOT EXISTS idx_ev_at     ON events(at);

    /* آمار از پیش محاسبه‌شده برای صفحات عمومی.
       صفحه اصلی نباید هر بار روی جدول رویدادها GROUP BY بزند. */
    CREATE TABLE IF NOT EXISTS trending (
      slot       TEXT PRIMARY KEY,         -- bestsellers | most_wanted | trending
      payload    TEXT NOT NULL,            -- JSON آماده تحویل
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  const addCol = (name, ddl) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${ddl}`);
  };
  addCol('discount_code',   'TEXT');
  addCol('discount_amount', 'INTEGER NOT NULL DEFAULT 0');
  addCol('tracking_code',   'TEXT');
  addCol('carrier',         'TEXT');
  addCol('admin_note',      'TEXT');
  addCol('updated_at',      'TEXT');

  addCol('first_name', 'TEXT');
  addCol('last_name',  'TEXT');
  addCol('email',      'TEXT');

  addCol('gift_wrap_fee', 'INTEGER NOT NULL DEFAULT 0');

  const custCols = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  const addCustCol = (name, ddl) => {
    if (!custCols.includes(name)) db.exec(`ALTER TABLE customers ADD COLUMN ${name} ${ddl}`);
  };
  addCustCol('taste_profile',    'TEXT');
  addCustCol('taste_updated_at', 'TEXT');

  const scols = db.prepare('PRAGMA table_info(staff)').all().map(c => c.name);
  const addStaffCol = (name, ddl) => {
    if (!scols.includes(name)) db.exec(`ALTER TABLE staff ADD COLUMN ${name} ${ddl}`);
  };
  addStaffCol('national_id', 'TEXT');
  addStaffCol('first_name',  'TEXT');
  addStaffCol('last_name',   'TEXT');

  const pcols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
  if (!pcols.includes('search_blob')) {
    db.exec('ALTER TABLE products ADD COLUMN search_blob TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_search ON products(search_blob)');
  }

  if (!pcols.includes('perfumer')) {
    db.exec('ALTER TABLE products ADD COLUMN perfumer TEXT');
  }
  if (!pcols.includes('release_year')) {
    db.exec('ALTER TABLE products ADD COLUMN release_year INTEGER');
  }

  if (!pcols.includes('maker_note')) {
    db.exec('ALTER TABLE products ADD COLUMN maker_note TEXT');
  }
  if (!pcols.includes('maker_note_by')) {
    db.exec('ALTER TABLE products ADD COLUMN maker_note_by TEXT');
  }

  if (!pcols.includes('maker_note_approved')) {
    db.exec('ALTER TABLE products ADD COLUMN maker_note_approved INTEGER NOT NULL DEFAULT 0');
  }

  if (!pcols.includes('supply_mode')) {
    db.exec(
      "ALTER TABLE products ADD COLUMN supply_mode TEXT NOT NULL DEFAULT 'UNAVAILABLE'");
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_supply ON products(supply_mode)');
  }

  {
    const KEY = 'supply_mode_default_migrated';
    const done = db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
    if (!done) {
      const n = db.prepare(
        "UPDATE products SET supply_mode='UNAVAILABLE' WHERE supply_mode='MADE_TO_ORDER'"
      ).run().changes;
      db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(KEY, new Date().toISOString());
      if (n) console.log(`[DB] وضعیت تأمین ${n} محصول به «فعلاً نمی‌توانیم» تغییر کرد — تأیید دستی لازم است.`);
    }
  }

  const vcols = db.prepare('PRAGMA table_info(variants)').all().map(c => c.name);
  if (!vcols.includes('price_usd')) {
    db.exec('ALTER TABLE variants ADD COLUMN price_usd REAL');
  }

  const tcols = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
  if (!tcols.includes('reply')) db.exec('ALTER TABLE tickets ADD COLUMN reply TEXT');
  if (!tcols.includes('mobile')) db.exec('ALTER TABLE tickets ADD COLUMN mobile TEXT');

  const ccols = db.prepare('PRAGMA table_info(coupons)').all().map(c => c.name);
  const addCoupon = (name, ddl) => {
    if (!ccols.includes(name)) db.exec(`ALTER TABLE coupons ADD COLUMN ${name} ${ddl}`);
  };
  addCoupon('starts_at',      'TEXT');
  addCoupon('scope_families', 'TEXT');
  addCoupon('scope_brands',   'TEXT');
  addCoupon('scope_types',    'TEXT');
  addCoupon('scope_products', 'TEXT');
  addCoupon('scope_gender',   'TEXT');
  addCoupon('max_subtotal',   'INTEGER');
  addCoupon('first_order_only', 'INTEGER NOT NULL DEFAULT 0');
  addCoupon('assigned_mobile',  'TEXT');

  const ocols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!ocols.includes('campaign_discount')) {
    db.exec('ALTER TABLE orders ADD COLUMN campaign_discount INTEGER');
  }
  if (!ocols.includes('campaign_note')) {
    db.exec('ALTER TABLE orders ADD COLUMN campaign_note TEXT');
  }

  if (!ocols.includes('customer_note')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_note TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT NOT NULL,
      percent        INTEGER NOT NULL,       -- ۱ تا ۹۰
      max_discount   INTEGER,
      scope_families TEXT,
      scope_brands   TEXT,
      scope_types    TEXT,
      scope_products TEXT,
      scope_gender   TEXT,
      starts_at      TEXT,
      ends_at        TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(active);

    -- نوار اعلان بالای صفحه (تک‌پیامی، بدون چرخش)
    CREATE TABLE IF NOT EXISTS notices (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      text       TEXT NOT NULL,
      link       TEXT,
      link_label TEXT,
      tone       TEXT NOT NULL DEFAULT 'gold',  -- gold | dark | success | alert
      starts_at  TEXT,
      ends_at    TEXT,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notices_active ON notices(active);

    /* ── دعوت‌نامه نظر برای مشتریان فروش حضوری ──

       چرا لازم شد: ثبت نظر به «خرید آنلاین» گره خورده بود
       (تابع hasPurchased روی جدول orders). مشتریانی که سال‌ها حضوری
       خرید کرده‌اند هیچ سفارش آنلاینی ندارند، پس در عمل از نظر
       دادن محروم بودند — یعنی ارزشمندترین سرمایه فروشگاه (سابقه
       واقعی) روی سایت نامرئی می‌ماند.

       راه‌حل: مدیر شماره مشتری و محصول را وارد می‌کند، سامانه یک
       کد یکتا می‌سازد. مشتری با آن لینک نظر **خودش** را می‌نویسد.
       متن هرگز به دست فروشگاه نوشته نمی‌شود — تفاوت این با «ادمین
       از طرف مشتری بنویسد» تفاوت شهادت و شایعه است.

       ستون token تصادفی و یک‌بارمصرف است؛ used_at پر که شد دیگر
       کار نمی‌کند. expires_at جلوی لینک‌های رهاشده را می‌گیرد. */
    CREATE TABLE IF NOT EXISTS review_invites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      token       TEXT NOT NULL UNIQUE,
      product_id  TEXT NOT NULL,
      mobile      TEXT NOT NULL,
      note        TEXT,                    -- یادداشت داخلی مدیر
      created_by  TEXT,                    -- نام کارمند سازنده
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at  TEXT NOT NULL,
      used_at     TEXT,
      review_id   INTEGER                  -- نظری که با این دعوت ثبت شد
    );
    CREATE INDEX IF NOT EXISTS idx_invite_token  ON review_invites(token);
    CREATE INDEX IF NOT EXISTS idx_invite_mobile ON review_invites(mobile);
  `);

  const rcols = db.prepare('PRAGMA table_info(reviews)').all().map(c => c.name);
  if (!rcols.includes('source')) {

    db.exec("ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'ONLINE'");
  }
}

function cleanNameEn(nameEn, brandEn, subtitleEn) {
  if (subtitleEn && !/inspired/i.test(subtitleEn)) return subtitleEn;
  let n = String(nameEn || '').replace(/\s*\(Inspired by[^)]*\)\s*/gi, '').trim();
  if (brandEn && !n.toUpperCase().startsWith(brandEn.toUpperCase())) {
    n = `${brandEn.toUpperCase()} - ${n}`;
  }
  return n;
}

function cleanNameFa(nameFa, brandFa) {
  let n = String(nameFa || '').replace(/^عطر دست‌ساز\s*/, '').trim();
  if (brandFa) {
    const pre = brandFa + ' - ';
    if (n.startsWith(pre)) n = n.slice(pre.length).trim();
    const pre2 = brandFa + ' — ';
    if (n.startsWith(pre2)) n = n.slice(pre2.length).trim();
  }
  return n;
}

const FAMILY_IMAGES = {
  'floral':            '/images/products/family-floral.jpg',
  'ambery-oriental':   '/images/products/family-ambery-oriental.jpg',
  'woody':             '/images/products/family-woody.jpg',
  'aromatic-fresh':    '/images/products/family-aromatic-fresh.jpg',
  'citrus':            '/images/products/family-citrus.jpg',
  'fruity-gourmand':   '/images/products/family-fruity-gourmand.jpg',
  'leather':           '/images/products/family-leather.jpg',
  'chypre':            '/images/products/family-chypre.jpg'
};
const DEFAULT_IMAGE = '/images/products/family-woody.jpg';

const BRAND_IMAGES = {
  "Penhaligon's": '/images/products/brand-penhaligons.jpg',
  'Amouage':      '/images/products/brand-amouage.jpg',
  'Tom Ford':     '/images/products/brand-tomford.jpg',
  'Creed':        '/images/products/brand-creed.jpg'
};

function imageForFamily(slug) {
  return FAMILY_IMAGES[slug] || DEFAULT_IMAGE;
}

const VARIANT_COUNTS = (() => {
  const dir = path.join(__dirname, '..', 'public', 'images', 'products');
  const out = {};
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }

  const TAG2GENDER = { m: 'MEN', w: 'WOMEN', u: 'UNISEX' };
  const seen = new Map();
  for (const n of names) {
    const m = /^fam-(.+)-([mwu])-(\d+)\.jpg$/.exec(n);
    if (!m) continue;
    const key = `${m[1]}|${TAG2GENDER[m[2]]}`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(Number(m[3]));
  }
  for (const [key, nums] of seen) {
    let i = 1;
    while (nums.has(i)) i++;
    if (i > 1) out[key] = i - 1;
  }
  return out;
})();

function stableHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const GENDER_TAG = { MEN: 'm', WOMEN: 'w', UNISEX: 'u' };

const GENDER_FALLBACK = {
  MEN:    ['MEN', 'UNISEX', 'WOMEN'],
  WOMEN:  ['WOMEN', 'UNISEX', 'MEN'],
  UNISEX: ['UNISEX', 'MEN', 'WOMEN']
};

function variantImageFor(productId, familySlug, gender) {
  if (!productId || !familySlug) return null;

  for (const g of (GENDER_FALLBACK[gender] || GENDER_FALLBACK.UNISEX)) {
    const count = VARIANT_COUNTS[`${familySlug}|${g}`];
    if (!count) continue;

    const idx = stableHash(String(productId) + '|' + g) % count;
    return `/images/products/fam-${familySlug}-${GENDER_TAG[g]}-${idx + 1}.jpg`;
  }
  return null;
}

const genericImageModule = require('./generic-product-images');
const genericImageManifest = genericImageModule.loadAssignments(path.join(SEED_DIR, 'generic_image_assignments_v1.json'));
function imageForProduct(brandEn, familySlug, productId, gender) {
  return variantImageFor(productId, familySlug, gender)
      || BRAND_IMAGES[brandEn]
      || FAMILY_IMAGES[familySlug]
      || genericImageModule.genericFor(productId, genericImageManifest)
      || DEFAULT_IMAGE;
}

function insertProducts(products) {

  const insP = db.prepare(`
    INSERT INTO products (
      id, slug, name_fa, name_en, title_fa_display, subtitle_en_display,
      brand_fa, brand_en, gender, concentration,
      family_fa, family_en, family_slug, temperature, taste,
      notes_top, notes_middle, notes_base, accords,
      season, occasion, longevity, sillage, country, market_segment,
      perfumer, release_year, transparency_notice, image_url
    ) VALUES (
      @id, @slug, @name_fa, @name_en, @title_fa_display, @subtitle_en_display,
      @brand_fa, @brand_en, @gender, @concentration,
      @family_fa, @family_en, @family_slug, @temperature, @taste,
      @notes_top, @notes_middle, @notes_base, @accords,
      @season, @occasion, @longevity, @sillage, @country, @market_segment,
      @perfumer, @release_year, @transparency_notice, @image_url
    )
  `);

  const insV = db.prepare(`
    INSERT INTO variants (sku, product_id, type, type_label, volume_ml, price_toman, stock, price_usd)
    VALUES (@sku, @product_id, @type, @type_label, @volume_ml, @price_toman, @stock, @price_usd)
  `);

  const tx = db.transaction((rows) => {
    for (const p of rows) {
      const notes = p.notes || {};
      const cleanEn = cleanNameEn(p.name_en, p.inspired_brand_en, p.subtitle_en_display);

      insP.run({
        id: p.id,
        slug: p.slug,
        name_fa: cleanNameFa(p.title_fa_base || p.full_display_fa || p.name_fa,
                             p.inspired_brand_fa),
        name_en: cleanEn,
        title_fa_display: p.title_fa_display || null,
        subtitle_en_display: cleanEn,
        brand_fa: p.inspired_brand_fa || null,
        brand_en: p.inspired_brand_en || null,
        gender: p.gender || null,
        concentration: p.concentration || null,
        family_fa: p.family_fa || null,
        family_en: p.family_en || null,
        family_slug: p.family_slug || null,
        temperature: p.character_temperature || null,
        taste: p.character_taste || null,
        notes_top: JSON.stringify(notes.top || []),
        notes_middle: JSON.stringify(notes.middle || []),
        notes_base: JSON.stringify(notes.base || []),
        accords: JSON.stringify(p.accords || []),
        season: p.season || null,
        occasion: p.occasion || null,
        longevity: p.longevity_descriptive || null,
        sillage: p.sillage_descriptive || null,
        country: p.country || null,
        market_segment: p.market_segment || null,
        perfumer: p.perfumer || null,
        release_year: Number.isInteger(p.release_year) ? p.release_year : null,
        transparency_notice: p.transclaimer_notice || null,
        image_url: imageForProduct(p.inspired_brand_en, p.family_slug,
                                   p.id, p.gender)
      });

      const pnum = String(p.id).replace(/\D/g, '') || '0';
      for (const v of (p.variants || [])) {
        const parts = String(v.sku || '').split('-');
        const tail = parts.slice(-2).join('-');
        const uniqueSku = `YZD-${pnum}-${tail}`;
        insV.run({
          sku: uniqueSku,
          product_id: p.id,
          type: v.type,
          type_label: v.type_label_fa || null,
          volume_ml: v.volume_ml || null,
          price_toman: v.price_toman || 0,
          stock: v.stock == null ? 0 : v.stock,

          price_usd: typeof v.price_usd === 'number' ? v.price_usd : null
        });
      }
    }
  });

  tx(products);

  const pc = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const vc = db.prepare('SELECT COUNT(*) AS c FROM variants').get().c;
  return { p: pc, v: vc };
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (count > 0) {
    console.log(`[DB] SQLite آماده — ${count} محصول موجود.`);
    return;
  }

  const seedFile = path.join(SEED_DIR, 'perfumes_catalogue_seed.json');
  if (!fs.existsSync(seedFile)) {
    console.warn('[DB] فایل seed یافت نشد؛ دیتابیس خالی ماند.');
    return;
  }

  console.log('[DB] در حال انتقال داده به SQLite ...');
  const products = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  const { p: pc, v: vc } = insertProducts(products);
  console.log(`[DB] ✅ انتقال کامل شد — ${pc} محصول، ${vc} متغیر.`);

  const artFile = path.join(SEED_DIR, 'articles_db.json');
  if (fs.existsSync(artFile)) {
    const arts = JSON.parse(fs.readFileSync(artFile, 'utf-8'));
    const insA = db.prepare(`
      INSERT OR IGNORE INTO articles
        (id, title, slug, category, category_label, read_time, cover_image, excerpt, content, created_at)
      VALUES (@id, @title, @slug, @category, @category_label, @read_time, @cover_image, @excerpt, @content, @created_at)
    `);
    db.transaction(rows => rows.forEach(a => insA.run({
      id: a.id, title: a.title, slug: a.slug || '',
      category: a.category || '', category_label: a.category_label || '',
      read_time: a.read_time || '', cover_image: a.cover_image || '',
      excerpt: a.excerpt || '', content: a.content || '',
      created_at: a.created_at || new Date().toISOString()
    })))(arts);
    console.log(`[DB] ✅ ${arts.length} مقاله منتقل شد.`);
  }
}

function parseProduct(row, options = {}) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name_fa: row.name_fa,
    name_en: row.name_en,
    title_fa_display: row.title_fa_display,
    subtitle_en_display: row.subtitle_en_display,
    brand_fa: row.brand_fa,
    brand_en: row.brand_en,
    gender: row.gender,
    concentration: row.concentration,

    family_fa: !options.includeDrafts && row.id === 'YZD-PROD-1245' && row.family_fa === 'چوبی مخملی تک‌مولکولی' ? 'چوبی' : row.family_fa,
    family_en: row.family_en,
    family_slug: row.family_slug,
    temperature: row.temperature,

    taste: options.includeDrafts ? (row.taste || null) : null,
    notes: {
      top: JSON.parse(row.notes_top || '[]'),
      middle: JSON.parse(row.notes_middle || '[]'),
      base: JSON.parse(row.notes_base || '[]')
    },
    accords: JSON.parse(row.accords || '[]'),
    reference_accords: referenceAccords(row),
    season: row.season,
    occasion: row.occasion,

    longevity: options.includeDrafts ? (row.longevity || null) : null,
    sillage: options.includeDrafts ? (row.sillage || null) : null,
    country: row.country,
    market_segment: row.market_segment,

    perfumer: cleanPerfumer(row.perfumer, row.brand_en, row.brand_fa),
    release_year: row.release_year,

    supply_mode: row.supply_mode || 'UNAVAILABLE',
    transparency_notice: row.transparency_notice,

    maker_note: (options.includeDrafts || row.maker_note_approved === 1) ? (row.maker_note || null) : null,
    maker_note_by: (options.includeDrafts || row.maker_note_approved === 1) ? (row.maker_note_by || null) : null,
    maker_note_approved: options.includeDrafts ? row.maker_note_approved === 1 : undefined,
    image_url: row.image_url
  };
}

function cleanPerfumer(perfumer, brandEn, brandFa) {
  const p = String(perfumer || '').trim();
  if (!p) return null;
  const norm = s => String(s || '').toLowerCase().replace(/['’\s.-]/g, '');
  const np = norm(p);
  if (!np) return null;
  if (np === norm(brandEn) || np === norm(brandFa)) return null;
  return p;
}

function attachVariants(product, options = {}) {
  if (!product) return null;

  const visibility = options.includeHidden ? '' : `AND ${require('./variant-visibility').publicVariantSql('v')}`;
  product.variants = db.prepare(
    `SELECT sku, type, type_label, volume_ml, price_toman, stock
     FROM variants v WHERE product_id = ? ${visibility} ORDER BY
     CASE type WHEN 'SAMPLE' THEN 0 WHEN 'EDP' THEN 1 ELSE 2 END, volume_ml`
  ).all(product.id);
  const prices = product.variants.map(v => v.price_toman).filter(Boolean);
  product.min_price = prices.length ? Math.min(...prices) : 0;

  try {
    const essence = essenceInventory.snapshot(db, product.id);
    if (essence.tracked) {
      product.essence = {
        ml_on_hand: essence.ml_on_hand,
        percent_override: essence.percent_override,
        use_count: essence.use_count,
        use_essence: essence.use_essence,
        max_units: product.variants.reduce((acc, v) => {
          const cap = essenceInventory.sellableCapacity(db, product.id, v.type, v.volume_ml);
          if (cap) acc[v.sku] = cap.total;
          return acc;
        }, {})
      };
    }
  } catch {  }
  return product;
}

function seedCoupons() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM coupons').get().c;
  if (c > 0) return;

  const ins = db.prepare(`
    INSERT INTO coupons (code, type, value, min_subtotal, max_discount,
                         usage_limit, per_user_once, expires_at, active, description)
    VALUES (@code, @type, @value, @min_subtotal, @max_discount,
            @usage_limit, @per_user_once, @expires_at, 1, @description)
  `);

  const year = new Date().getFullYear() + 1;
  const rows = [
    { code: 'WELCOME10', type: 'PERCENT', value: 10, min_subtotal: 500000,
      max_discount: 500000, usage_limit: null, per_user_once: 1,
      expires_at: `${year}-12-31`, description: 'خوش‌آمدگویی — ۱۰٪ تخفیف اولین خرید' },
    { code: 'SAMPLE20', type: 'PERCENT', value: 20, min_subtotal: 300000,
      max_discount: 300000, usage_limit: 200, per_user_once: 1,

      expires_at: `${year}-06-30`, description: 'تخفیف ویژه سمپل‌ها' },
    { code: 'FREESHIP', type: 'FREE_SHIPPING', value: 0, min_subtotal: 1500000,
      max_discount: null, usage_limit: null, per_user_once: 0,
      expires_at: null, description: 'ارسال رایگان بالای ۱٬۵۰۰٬۰۰۰ تومان' },
    { code: 'YAZD200', type: 'FIXED', value: 200000, min_subtotal: 2000000,
      max_discount: null, usage_limit: 100, per_user_once: 1,
      expires_at: null, description: '۲۰۰ هزار تومان تخفیف نقدی' }
  ];
  db.transaction(() => rows.forEach(r => ins.run(r)))();
  console.log(`[DB] ✅ ${rows.length} کد تخفیف نمونه ایجاد شد.`);
}

function parseScope(csv) {
  if (!csv) return null;
  const list = String(csv).split(',')
    .map(x => x.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

function itemInScope(item, rule) {
  const fam    = parseScope(rule.scope_families);
  const brand  = parseScope(rule.scope_brands);
  const type   = parseScope(rule.scope_types);
  const prod   = parseScope(rule.scope_products);
  const gender = parseScope(rule.scope_gender);

  if (fam    && !fam.includes(item._family)) return false;
  if (brand  && !brand.includes(item._brand)) return false;
  if (type   && !type.includes(item._type)) return false;
  if (prod   && !prod.includes(item._product_id)) return false;
  if (gender && !gender.includes(item._gender)) return false;
  return true;
}

function hasScope(rule) {
  return !!(rule.scope_families || rule.scope_brands || rule.scope_types
         || rule.scope_products || rule.scope_gender);
}

function scopedSubtotal(items, rule) {
  if (!Array.isArray(items) || !items.length) return null;

  const eff = (i) => Math.max(0, i.line_total - (i._campaign_off || 0));
  if (!hasScope(rule)) return items.reduce((s, i) => s + eff(i), 0);
  return items
    .filter(i => itemInScope(i, rule))
    .reduce((s, i) => s + eff(i), 0);
}

function validateCoupon(code, subtotal, shippingFee, mobile, items = null, verifiedMobile = null) {
  if (!code) return { ok: false, error: 'کد تخفیف وارد نشده است.' };
  const c = db.prepare('SELECT * FROM coupons WHERE UPPER(code)=UPPER(?)').get(String(code).trim());

  if (!c)            return { ok: false, error: 'کد تخفیف نامعتبر است.' };
  if (!c.active)     return { ok: false, error: 'این کد تخفیف غیرفعال شده است.' };

  const today=shopTime.dateKey();
  if(c.starts_at && !shopTime.validDateKey(c.starts_at))return {ok:false,error:'تاریخ این کد معتبر نیست.'};
  if(c.expires_at && !shopTime.validDateKey(c.expires_at))return {ok:false,error:'تاریخ این کد معتبر نیست.'};
  if(c.starts_at && today<c.starts_at)return {ok:false,error:'این کد هنوز فعال نشده است.'};
  if(c.expires_at && today>c.expires_at)return {ok:false,error:'مهلت استفاده از این کد به پایان رسیده است.'};
  if (c.usage_limit != null && c.used_count >= c.usage_limit)
    return { ok: false, error: 'ظرفیت استفاده از این کد تکمیل شده است.' };

  if (subtotal < c.min_subtotal)
    return { ok: false,
      error: `این کد برای خرید بالای ${c.min_subtotal.toLocaleString('en-US')} تومان است.` };

  if (c.max_subtotal && subtotal > c.max_subtotal)
    return { ok: false,
      error: `این کد فقط برای خرید تا ${c.max_subtotal.toLocaleString('en-US')} تومان است.` };

  if (c.assigned_mobile) {
    if (!verifiedMobile || verifiedMobile !== mobile)
      return { ok: false, error: 'برای استفاده از این کد شماره موبایل خود را تأیید کنید.' };
    if (String(c.assigned_mobile).trim() !== verifiedMobile)
      return { ok: false, error: 'این کد برای حساب شما صادر نشده است.' };
  }

  if (c.per_user_once && mobile) {
    const used = db.prepare(
      'SELECT COUNT(*) AS n FROM coupon_usage WHERE UPPER(code)=UPPER(?) AND mobile=?'
    ).get(c.code, mobile).n;
    if (used > 0) return { ok: false, error: 'شما قبلاً از این کد استفاده کرده‌اید.' };
  }

  if (c.first_order_only) {
    if (!verifiedMobile || verifiedMobile !== mobile)
      return { ok: false, error: 'برای استفاده از این کد شماره موبایل خود را تأیید کنید.' };
    const prev = db.prepare(`
      SELECT COUNT(*) n FROM orders
      WHERE mobile = ? AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')
    `).get(mobile).n;
    if (prev > 0) return { ok: false, error: 'این کد فقط برای اولین خرید است.' };
  }

  const scoped = hasScope(c);
  let base = subtotal;

  if (scoped) {
    if (!items) {
      return { ok: false, error: 'برای بررسی این کد، سبد خرید لازم است.' };
    }
    base = scopedSubtotal(items, c);
    if (!base) {
      return { ok: false,
        error: c.description
          ? `این کد فقط برای ${c.description} است و سبد شما شامل آن نیست.`
          : 'این کد برای کالاهای داخل سبد شما معتبر نیست.' };
    }
  }

  let discount = 0, freeShipping = false;
  if (c.type === 'PERCENT') {
    discount = Math.floor(base * c.value / 100);
    if (c.max_discount) discount = Math.min(discount, c.max_discount);
  } else if (c.type === 'FIXED') {

    discount = Math.min(c.value, base);
  } else if (c.type === 'FREE_SHIPPING') {
    freeShipping = true;
    discount = shippingFee || 0;
  }

  return {
    ok: true, coupon: c, discount, free_shipping: freeShipping,
    scoped_amount: scoped ? base : null
  };
}

const CAMPAIGN_TTL_MS = 5000;
let _campCache = null, _campAt = 0, _campDay = '';

function bustCampaignCache() { _campCache = null; }

function activeCampaigns() {
  const t = Date.now();
  const now = shopTime.dateKey(t);

  if (_campCache && t - _campAt < CAMPAIGN_TTL_MS && _campDay === now) {
    return _campCache;
  }
  _campCache = db.prepare(`
    SELECT * FROM campaigns
    WHERE active = 1
      AND (starts_at IS NULL OR starts_at <= @now)
      AND (ends_at   IS NULL OR ends_at   >= @now)
    ORDER BY percent DESC
  `).all({ now });
  _campAt = t;
  _campDay = now;
  return _campCache;
}

function campaignForItem(item, campaigns) {
  let best = null;
  for (const c of campaigns) {
    if (!itemInScope(item, c)) continue;
    let amount = Math.floor(item.line_total * c.percent / 100);
    if (c.max_discount) amount = Math.min(amount, c.max_discount);
    if (!best || amount > best.amount) {
      best = { percent: c.percent, title: c.title, amount, id: c.id };
    }
  }
  return best;
}

function campaignDiscount(items) {
  const camps = activeCampaigns();
  if (!camps.length || !items || !items.length) return { total: 0, lines: [] };

  const lines = [];
  let total = 0;
  for (const it of items) {
    const hit = campaignForItem(it, camps);

    it._campaign_off = hit ? hit.amount : 0;
    if (hit && hit.amount > 0) {
      total += hit.amount;
      lines.push({ sku: it.sku, title: hit.title, percent: hit.percent, amount: hit.amount });
    }
  }
  return { total, lines };
}

function campaignPercentFor(product, camps) {
  const fake = {
    _family: product.family_slug,
    _brand: product.brand_fa,
    _type: null,
    _product_id: product.id,
    _gender: product.gender
  };
  let best = 0;
  for (const c of camps) {

    if (c.scope_types) continue;
    if (!itemInScope(fake, c)) continue;
    if (c.percent > best) best = c.percent;
  }
  return best;
}

function variantCampaignPercent(product, variant, camps) {
  const fake = {
    _family: product.family_slug,
    _brand: product.brand_fa,
    _type: variant.type,
    _product_id: product.id,
    _gender: product.gender
  };
  let best = 0;
  for (const c of camps) {
    if (!itemInScope(fake, c)) continue;

    let amount = Math.floor(variant.price_toman * c.percent / 100);
    if (c.max_discount) amount = Math.min(amount, c.max_discount);

    const eff = variant.price_toman > 0
      ? Math.floor(amount / variant.price_toman * 100) : 0;
    if (eff > best) best = eff;
  }
  return best;
}

function attachCampaign(product, camps) {
  if (!product) return product;
  const list = camps || activeCampaigns();
  product.campaign_percent = list.length ? campaignPercentFor(product, list) : 0;
  if (product.variants) {
    let cheapestOld = 0, cheapestNew = 0;
    for (const v of product.variants) {
      const pct = list.length ? variantCampaignPercent(product, v, list) : 0;
      v.campaign_percent = pct;
      v.old_price = pct > 0 ? v.price_toman : null;
      v.final_price = pct > 0
        ? v.price_toman - Math.floor(v.price_toman * pct / 100)
        : v.price_toman;
      if (!cheapestNew || v.final_price < cheapestNew) {
        cheapestNew = v.final_price;
        cheapestOld = v.price_toman;
      }
    }

    product.min_price_final = cheapestNew || product.min_price;
    product.min_price_before = cheapestOld || product.min_price;
  }
  return product;
}

function recordCouponUse(code, mobile, orderId) {
  const upper = String(code).toUpperCase();

  return db.transaction(() => {

    const dup = db.prepare(
      'SELECT 1 FROM coupon_usage WHERE UPPER(code)=? AND order_id=?'
    ).get(upper, orderId);
    if (dup) return { ok: true, reason: 'قبلاً ثبت شده' };

    const c = db.prepare('SELECT * FROM coupons WHERE UPPER(code)=?').get(upper);
    if (!c) return { ok: false, reason: 'کد یافت نشد' };

    if (c.per_user_once && mobile) {
      const used = db.prepare(
        'SELECT 1 FROM coupon_usage WHERE UPPER(code)=? AND mobile=?'
      ).get(upper, mobile);
      if (used) return { ok: false, reason: 'این کاربر قبلاً استفاده کرده' };
    }

    const res = c.usage_limit == null
      ? db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE UPPER(code)=?')
          .run(upper)
      : db.prepare(
          'UPDATE coupons SET used_count = used_count + 1 ' +
          'WHERE UPPER(code)=? AND used_count < ?'
        ).run(upper, c.usage_limit);

    if (!res.changes) return { ok: false, reason: 'ظرفیت کد تکمیل شده' };

    db.prepare('INSERT INTO coupon_usage (code, mobile, order_id) VALUES (?,?,?)')
      .run(upper, mobile, orderId);
    return { ok: true };
  })();
}

function releaseCouponUse(orderId) {
  if (!orderId) return false;
  return db.transaction(() => {
    const row = db.prepare(
      'SELECT code FROM coupon_usage WHERE order_id=?'
    ).get(orderId);
    if (!row) return false;

    db.prepare(
      'UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE UPPER(code)=UPPER(?)'
    ).run(row.code);
    db.prepare('DELETE FROM coupon_usage WHERE order_id=?').run(orderId);
    return true;
  })();
}

const SHOP_DEFAULTS = {
  shop_name:      'عطر یزد',
  shop_name_en:   'Yazd Perfume',
  legal_name:     '',
  economic_code:  '',
  national_id:    '',
  register_no:    '',
  phone:          '',
  address:        '',
  postal_code:    '',

  sender_person:  '',

  phone_whatsapp: '1',
  invoice_note:   'این فاکتور جهت اطلاع مشتری صادر شده است.',

  enamad_id:      '',
  enamad_code:    ''
};

function seedShopSettings() {
  const file = path.join(__dirname, '..', 'seed', 'shop_settings.json');
  if (!fs.existsSync(file)) return;

  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (e) {
    console.warn('[DB] ⚠ seed/shop_settings.json خوانده نشد:', e.message);
    return;
  }

  const ins = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO NOTHING');
  let n = 0;
  db.transaction(() => {
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('_')) continue;
      if (!(k in SHOP_DEFAULTS)) continue;
      const val = String(v ?? '').trim();
      if (!val) continue;
      n += ins.run(k, val).changes;
    }
  })();
  if (n) console.log(`[DB] ✅ ${n} تنظیم فروشگاه از seed بارگذاری شد.`);
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { ...SHOP_DEFAULTS, ...saved };
}

const SETTING_PATTERNS = {
  enamad_id:   /^\d{1,10}$/,
  enamad_code: /^[A-Za-z0-9]{8,64}$/
};

function isValidSetting(key, value) {
  const re = SETTING_PATTERNS[key];
  if (!re) return true;
  const v = String(value ?? '').trim();
  return v === '' || re.test(v);
}

function saveSettings(obj) {
  const up = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const rejected = [];
  db.transaction(() => {
    Object.entries(obj).forEach(([k, v]) => {
      if (!(k in SHOP_DEFAULTS)) return;
      const val = String(v ?? '').trim();
      if (!isValidSetting(k, val)) { rejected.push(k); return; }
      up.run(k, val);
    });
  })();
  const out = getSettings();

  if (rejected.length) Object.defineProperty(out, '_rejected',
    { value: rejected, enumerable: false });
  return out;
}

function nextInvoiceNo() {
  const cur = db.prepare("SELECT value FROM settings WHERE key='invoice_seq'").get();
  const n = (cur ? parseInt(cur.value) : 0) + 1;
  db.prepare(`INSERT INTO settings (key,value) VALUES ('invoice_seq',?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(n));
  return n;
}

function logStatus(orderId, status, note) {
  db.prepare('INSERT INTO order_status_log (order_id, status, note) VALUES (?,?,?)')
    .run(orderId, status, note || null);
}

function normalizeFa(s) {
  return String(s || '')
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, 'ا')
    .replace(/\u0649|\u064A/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/\u0629/g, 'ه')
    .replace(/[\u200c\u200f\u200e]/g, ' ')
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const GENDER_WORDS = {
  MEN:    'مردانه اقایانه مردونه men homme pour homme',
  WOMEN:  'زنانه بانوان خانم زنونه women femme pour femme',
  UNISEX: 'اسپرت مشترک یونیسکس دونفره zwei unisex'
};

const UNIVERSAL_WORDS = 'عطر ادکلن اسانس رایحه بو خوشبو parfum perfume fragrance';

const BRAND_ALIASES = {
  'Amouage':              'آمواژ',
  'Jean Paul Gaultier':   'ژان پل گالتیه',
  'Nishane':              'نیشانه',
  'Atelier Cologne':      'آتلیه کلن',
  'Thameen London':       'ثمین لندن',
  'Ermenegildo Zegna':    'ارمنجیلدو زنیا',
  'Escentric Molecules':  'اسکنتریک مولکولز',
  'Juliette Has A Gun':   'جولیت هز ا گان',
  'Robert Piguet':        'ربرت پیگه',
  'Matiere Premiere':     'ماتیره پرمیر',
  'Marc-Antoine Barrois': 'مارک آنتوان باروا',
  'Fueguia 1833':         'فوگوییا',
  'Bond No. 9':           'باند نامبر ناین',
  'Viktor & Rolf':        'ویکتور اند رولف',
  'Van Cleef & Arpels':   'ون کلیف اند آرپلز',
  'Goldfield & Banks':    'گلدفیلد اند بنکس',
  'The Merchant of Venice': 'د مرچنت آو ونیز',
  'Etat Libre d\'Orange':  'اتات لیبر دورنج',
  'Initio Parfums Prives': 'اینیشیو',
  'Stéphane Humbert Lucas 777': 'استفان هامبرت لوکاس'
};

function buildSearchIndex(force = false, ids = null) {
  if (ids !== null && (!Array.isArray(ids) || ids.some(x => typeof x !== 'string'))) throw Error('Invalid search index scope');
  if (ids && !ids.length) return 0;
  const pending = db.prepare(
    'SELECT COUNT(*) c FROM products WHERE search_blob IS NULL').get().c;
  if (!pending && !force) return 0;

  const rows = db.prepare(`SELECT id, name_fa, name_en, brand_fa, brand_en,
    family_fa, family_en, notes_top, notes_middle, notes_base, accords,
    season, occasion, concentration, gender, temperature, taste,
    longevity, sillage, country, market_segment, perfumer, release_year
    FROM products ${ids ? 'WHERE id IN (' + ids.map(() => '?').join(',') + ')' : ''}`).all(...(ids || []));

  const upd = db.prepare('UPDATE products SET search_blob=? WHERE id=?');
  const flat = j => { try { return JSON.parse(j || '[]').join(' '); } catch { return ''; } };

  db.transaction(() => {
    for (const r of rows) {
      const blob = [
        r.name_fa, r.name_en, r.brand_fa, r.brand_en,
        r.family_fa, r.family_en, r.season, r.occasion, r.concentration,
        r.temperature, r.taste, r.longevity, r.sillage,
        r.country, r.market_segment,

        r.perfumer || '',
        r.release_year ? String(r.release_year) : '',
        GENDER_WORDS[r.gender] || '',
        BRAND_ALIASES[r.brand_en] || '',
        r.id === 'YZD-PROD-1707' ? 'کریستال نوآر' : '',
        r.id === 'YZD-PROD-0543' ? 'مموار ممویر' : '',
        r.id === 'YZD-PROD-0553' ? 'هانر عانر آنر' : '',
        r.id === 'SUP-CK-900001' ? 'ایترنتی' : '',
        r.id === 'YZD-PROD-1801' ? 'سبز ورسوز ورسوس' : '',
        flat(r.notes_top), flat(r.notes_middle), flat(r.notes_base), flat(r.accords),
        UNIVERSAL_WORDS
      ].filter(Boolean).join(' ');
      upd.run(normalizeFa(blob), r.id);
    }
  })();

  appLog('INFO', 'search', `ایندکس جستجو ساخته شد — ${rows.length} محصول`);
  return rows.length;
}

function initNotesIndex() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_notes (
      product_id TEXT NOT NULL,
      note       TEXT NOT NULL,          -- نام نمایشی، همان‌طور که در داده آمده
      note_key   TEXT NOT NULL,          -- یکسان‌سازی‌شده، برای تطبیق
      position   TEXT NOT NULL,          -- top | middle | base | accord
      PRIMARY KEY (product_id, note_key, position)
    );
    CREATE INDEX IF NOT EXISTS idx_pnotes_key  ON product_notes(note_key);
    CREATE INDEX IF NOT EXISTS idx_pnotes_prod ON product_notes(product_id);
  `);
}

function buildNotesIndex(force = false) {
  initNotesIndex();

  const have = db.prepare('SELECT COUNT(*) c FROM product_notes').get().c;
  if (have > 0 && !force) return 0;

  const rows = db.prepare(
    'SELECT id, notes_top, notes_middle, notes_base, accords FROM products'
  ).all();

  const ins = db.prepare(
    `INSERT OR IGNORE INTO product_notes (product_id, note, note_key, position)
     VALUES (?,?,?,?)`
  );
  const parse = j => { try { const a = JSON.parse(j || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

  db.transaction(() => {
    db.prepare('DELETE FROM product_notes').run();
    for (const r of rows) {
      const groups = [
        ['top',    parse(r.notes_top)],
        ['middle', parse(r.notes_middle)],
        ['base',   parse(r.notes_base)],
        ['accord', parse(r.accords)]
      ];
      for (const [pos, list] of groups) {
        for (const raw of list) {
          const name = String(raw || '').trim();
          if (!name || name.length > 60) continue;
          ins.run(r.id, name, normalizeFa(name), pos);
        }
      }
    }
  })();

  const n = db.prepare('SELECT COUNT(*) c FROM product_notes').get().c;
  appLog('INFO', 'search', `ایندکس نُت ساخته شد — ${n} ردیف`);
  return n;
}

function refreshProductNotes(ids) {
  if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string')) throw Error('Invalid note index scope');
  if (!ids.length) return 0;
  initNotesIndex();
  const get=db.prepare('SELECT id,notes_top,notes_middle,notes_base,accords FROM products WHERE id=?');
  const del=db.prepare('DELETE FROM product_notes WHERE product_id=?');
  const ins=db.prepare('INSERT OR IGNORE INTO product_notes(product_id,note,note_key,position) VALUES(?,?,?,?)');
  return db.transaction(()=>{let changed=0;
    for(const id of ids){const row=get.get(id);if(!row)throw Error('Note index product missing');
      const groups=[['top',row.notes_top],['middle',row.notes_middle],['base',row.notes_base],['accord',row.accords]];
      const parsed=groups.map(([pos,v])=>{const list=JSON.parse(v||'[]');if(!Array.isArray(list))throw Error('Invalid notes');return [pos,list];});
      del.run(id);
      for(const [pos,notes] of parsed)for(const raw of notes){const note=String(raw||'').trim();if(note&&note.length<=60)ins.run(id,note,normalizeFa(note),pos);}
      changed++;
    }return changed;
  })();
}

function listNotes({ position = null, minCount = 8, limit = 200 } = {}) {
  const where = position ? 'WHERE position = @position' : '';
  return db.prepare(`
    SELECT note_key, MIN(note) AS note, COUNT(DISTINCT product_id) AS count
    FROM product_notes ${where}
    GROUP BY note_key
    HAVING count >= @minCount
    ORDER BY count DESC, note
    LIMIT @limit
  `).all({ position, minCount, limit });
}

function reviewSummary(productId) {
  const r = db.prepare(`
    SELECT COUNT(*) count, AVG(rating) avg,
           AVG(longevity) longevity, AVG(sillage) sillage
    FROM reviews WHERE product_id=? AND status='APPROVED'
  `).get(productId);
  if (!r.count) return { count: 0, avg: 0, longevity: 0, sillage: 0, breakdown: {} };

  const bd = {};
  db.prepare(`SELECT rating, COUNT(*) n FROM reviews
              WHERE product_id=? AND status='APPROVED' GROUP BY rating`)
    .all(productId).forEach(x => bd[x.rating] = x.n);

  return {
    count: r.count,
    avg: Math.round(r.avg * 10) / 10,
    longevity: r.longevity ? Math.round(r.longevity * 10) / 10 : 0,
    sillage: r.sillage ? Math.round(r.sillage * 10) / 10 : 0,
    breakdown: bd
  };
}

const INVITE_TTL_DAYS = 30;

function createReviewInvite(productId, mobile, note, createdBy) {
  const token = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400e3).toISOString();

  const r = db.prepare(`
    INSERT INTO review_invites (token, product_id, mobile, note, created_by, expires_at)
    VALUES (?,?,?,?,?,?)
  `).run(token, productId, mobile, note || null, createdBy || null, expires);

  return { id: r.lastInsertRowid, token, expires_at: expires };
}

function readReviewInvite(token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
    return { ok: false, error: 'لینک دعوت معتبر نیست.' };
  }
  const inv = db.prepare('SELECT * FROM review_invites WHERE token=?').get(token);
  if (!inv) return { ok: false, error: 'این لینک دعوت یافت نشد.' };

  if (inv.used_at) {
    return { ok: false, error: 'نظر شما با این دعوت‌نامه قبلاً ثبت شده است. سپاسگزاریم.', used: true };
  }
  if (new Date(inv.expires_at) < new Date()) {
    return { ok: false, error: 'مهلت این دعوت‌نامه به پایان رسیده است.' };
  }
  return { ok: true, invite: inv };
}

function consumeReviewInvite(token, reviewId) {
  const r = db.prepare(`
    UPDATE review_invites SET used_at = CURRENT_TIMESTAMP, review_id = ?
    WHERE token = ? AND used_at IS NULL
  `).run(reviewId, token);
  return r.changes > 0;
}

function hasPurchased(mobile, productId) {
  return !!db.prepare(`
    SELECT 1 FROM order_items i
    JOIN orders   o ON o.order_id = i.order_id
    JOIN order_variant_history v ON v.sku = i.sku
    WHERE o.mobile=? AND v.product_id=?
      AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED') LIMIT 1
  `).get(mobile, productId);
}

const perms = require('./permissions');

function hashPassword(plain, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(plain), s, 64).toString('hex');
  return { hash: h, salt: s };
}

function verifyPassword(plain, hash, salt) {
  if (!hash || !salt) return false;
  const cand = crypto.scryptSync(String(plain), salt, 64);
  const real = Buffer.from(hash, 'hex');
  if (cand.length !== real.length) return false;
  return crypto.timingSafeEqual(cand, real);
}

function seedRoles() {
  const has = db.prepare('SELECT COUNT(*) n FROM roles').get().n;

  if (!has) {
    const ins = db.prepare(`
      INSERT INTO roles (key, name, description, permissions, builtin, locked)
      VALUES (?,?,?,?,?,?)
    `);
    for (const r of perms.DEFAULT_ROLES) {
      ins.run(r.key, r.name, r.description || '',
              JSON.stringify(r.permissions), 1, r.locked ? 1 : 0);
    }
    appLog('INFO', 'staff', `${perms.DEFAULT_ROLES.length} نقش پیش‌فرض ساخته شد`);
    return;
  }

  const owner = db.prepare("SELECT permissions FROM roles WHERE key='owner'").get();
  if (!owner) return;

  let current = [];
  try { current = JSON.parse(owner.permissions) || []; } catch {}

  const missing = perms.ALL_KEYS.filter(k => !current.includes(k));
  if (missing.length) {
    db.prepare("UPDATE roles SET permissions=?, updated_at=? WHERE key='owner'")
      .run(JSON.stringify(perms.ALL_KEYS), new Date().toISOString());
    appLog('INFO', 'staff',
           `${missing.length} مجوز تازه به مدیر کل داده شد`, { keys: missing });
  }
}

function seedOwner() {
  const n = db.prepare("SELECT COUNT(*) n FROM staff WHERE role_key='owner'").get().n;
  if (n) return;

  const username = process.env.ADMIN_USERNAME || 'owner';
  const password = process.env.ADMIN_PASSWORD || 'yazd1404';
  const { hash, salt } = hashPassword(password);

  db.prepare(`
    INSERT INTO staff (username, display_name, role_key, pass_hash, pass_salt,
                       must_change, active, created_by)
    VALUES (?,?,?,?,?,?,1,'system')
  `).run(username, 'مدیر کل', 'owner', hash, salt,
         password === 'yazd1404' ? 1 : 0);

  appLog('INFO', 'staff', 'حساب مدیر کل ساخته شد', { username });
}

function getRole(key) {
  const r = db.prepare('SELECT * FROM roles WHERE key=?').get(key);
  if (!r) return null;
  let list = [];
  try { list = JSON.parse(r.permissions) || []; } catch {}
  return { ...r, permissions: list, builtin: !!r.builtin, locked: !!r.locked };
}

function listRoles() {
  return db.prepare('SELECT * FROM roles ORDER BY builtin DESC, name').all().map(r => {
    let list = [];
    try { list = JSON.parse(r.permissions) || []; } catch {}
    const staffCount = db.prepare('SELECT COUNT(*) n FROM staff WHERE role_key=?')
      .get(r.key).n;
    return { ...r, permissions: list, builtin: !!r.builtin,
             locked: !!r.locked, staff_count: staffCount };
  });
}

function getStaff(id) {
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(id);
  if (!s) return null;
  const role = getRole(s.role_key);
  return {
    ...s,
    active: !!s.active,
    must_change: !!s.must_change,
    role_name: role ? role.name : s.role_key,
    permissions: role ? role.permissions : []
  };
}

function getCustomer(mobile) {
  return db.prepare('SELECT * FROM customers WHERE mobile=?')
    .get(String(mobile || '').trim()) || null;
}

function getCustomerById(id) {
  return db.prepare('SELECT * FROM customers WHERE id=?').get(id) || null;
}

function createCustomer({ mobile, first_name, last_name, email, password }) {
  const { hash, salt } = hashPassword(password);
  const info = db.prepare(`
    INSERT INTO customers (mobile, first_name, last_name, email, pass_hash, pass_salt)
    VALUES (?,?,?,?,?,?)
  `).run(String(mobile).trim(), first_name, last_name || null,
         email || null, hash, salt);
  return getCustomerById(info.lastInsertRowid);
}

function setCustomerPassword(id, password) {
  const { hash, salt } = hashPassword(password);
  db.prepare('UPDATE customers SET pass_hash=?, pass_salt=? WHERE id=?')
    .run(hash, salt, id);
}

function saveCustomerAddress(mobile, a) {
  const c = getCustomer(mobile);
  if (!c) return;
  db.prepare(`
    UPDATE customers SET province=?, city=?, address=?, postal_code=?
    WHERE id=?
  `).run(a.province || null, a.city || null, a.address || null,
         a.postal_code || null, c.id);
}

function publicStaff(s) {
  if (!s) return null;
  return {
    id: s.id,
    username: s.username,
    display_name: s.display_name,
    first_name: s.first_name,
    last_name: s.last_name,
    national_id: s.national_id,
    mobile: s.mobile,
    role_key: s.role_key,
    role_name: s.role_name,
    permissions: s.permissions || [],
    active: !!s.active,
    must_change: !!s.must_change,
    last_login: s.last_login,
    created_at: s.created_at,
    created_by: s.created_by
  };
}

function publicCustomer(c) {
  if (!c) return null;
  return {
    id: c.id, mobile: c.mobile,
    first_name: c.first_name, last_name: c.last_name,
    email: c.email,
    province: c.province, city: c.city,
    address: c.address, postal_code: c.postal_code,
    has_password: !!c.pass_hash,
    created_at: c.created_at
  };
}

function getStaffByUsername(username) {
  const s = db.prepare('SELECT * FROM staff WHERE username=?')
    .get(String(username || '').trim().toLowerCase());
  return s ? getStaff(s.id) : null;
}

function listStaff() {
  return db.prepare('SELECT * FROM staff ORDER BY id').all().map(s => {
    const role = getRole(s.role_key);
    return {
      id: s.id, username: s.username, display_name: s.display_name,
      first_name: s.first_name, last_name: s.last_name,
      national_id: s.national_id,
      mobile: s.mobile, role_key: s.role_key,
      role_name: role ? role.name : s.role_key,
      active: !!s.active, must_change: !!s.must_change,
      last_login: s.last_login, created_at: s.created_at
    };
  });
}

function audit(entry) {
  try {
    db.prepare(`
      INSERT INTO audit_log (staff_id, username, role_key, action, method,
                             path, target, detail, ip, allowed)
      VALUES (@staff_id, @username, @role_key, @action, @method,
              @path, @target, @detail, @ip, @allowed)
    `).run({
      staff_id: entry.staff_id ?? null,
      username: entry.username ?? null,
      role_key: entry.role_key ?? null,
      action:   String(entry.action || '—').slice(0, 80),
      method:   entry.method ?? null,
      path:     (entry.path || '').slice(0, 200),
      target:   entry.target ? String(entry.target).slice(0, 120) : null,
      detail:   entry.detail ? JSON.stringify(entry.detail).slice(0, 1000) : null,
      ip:       entry.ip ?? null,
      allowed:  entry.allowed === false ? 0 : 1
    });
  } catch {  }
}

function purgeAudit(days) {
  const keep = parseInt(days || process.env.AUDIT_KEEP_DAYS) || 90;
  const cutoff = new Date(Date.now() - keep * 86400e3).toISOString();
  const r = db.prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff);
  return r.changes;
}

function createSession(kind, subject, ttlMs) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, kind, subject, expires_at) VALUES (?,?,?,?)')
    .run(token, kind, subject || null, Date.now() + ttlMs);
  return token;
}

function readSession(token, kind) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=? AND kind=?').get(token, kind);
  if (!s) return null;
  if (Date.now() > s.expires_at) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  return s;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
}

const rateLimitTransaction = db.transaction((key, limit, windowMs, blockMs) => {
  const now = Date.now();
  const row = db.prepare('SELECT * FROM rate_limits WHERE bucket=?').get(key);

  if (row?.blocked_until && now < row.blocked_until) {
    return { ok: false, retry_after: Math.ceil((row.blocked_until - now) / 1000), blocked: true };
  }

  if (!row || now > row.window_end) {
    db.prepare(`INSERT INTO rate_limits (bucket, count, window_end, blocked_until)
                VALUES (?,1,?,NULL)
                ON CONFLICT(bucket) DO UPDATE SET count=1, window_end=excluded.window_end,
                                                  blocked_until=NULL`)
      .run(key, now + windowMs);
    return { ok: true, remaining: limit - 1 };
  }

  if (row.count >= limit) {
    const until = blockMs ? now + blockMs : row.window_end;
    db.prepare('UPDATE rate_limits SET blocked_until=? WHERE bucket=?').run(until, key);
    return { ok: false, retry_after: Math.ceil((until - now) / 1000), blocked: !!blockMs };
  }

  db.prepare('UPDATE rate_limits SET count=count+1 WHERE bucket=?').run(key);
  return { ok: true, remaining: limit - row.count - 1 };
});
function rateLimit(key, limit, windowMs, blockMs = 0) {
  return rateLimitTransaction.immediate(key, limit, windowMs, blockMs);
}

function resetRateLimit(key) {
  db.prepare('DELETE FROM rate_limits WHERE bucket=?').run(key);
}

function appLog(level, scope, message, meta) {
  try {
    db.prepare('INSERT INTO app_logs (level, scope, message, meta) VALUES (?,?,?,?)')
      .run(level, scope || null, String(message).slice(0, 1000),
           meta ? JSON.stringify(meta).slice(0, 2000) : null);
  } catch {  }
  if (level === 'ERROR') console.error(`[${scope || '-'}] ${message}`);
}

const PENDING_TTL_MIN = parseInt(process.env.PENDING_ORDER_TTL_MIN) || 30;

function releaseStaleOrders() {
  const cutoff = new Date(Date.now() - PENDING_TTL_MIN * 60 * 1000).toISOString();
  const stale = db.prepare("SELECT order_id FROM orders WHERE status='PENDING' AND created_at < ?").all(cutoff);
  if (!stale.length) return { count:0, skus:[], review_count:0 };
  const upd = db.prepare("UPDATE orders SET status='EXPIRED',updated_at=? WHERE order_id=? AND status='PENDING'");
  const log = db.prepare('INSERT INTO order_status_log (order_id,status,note) VALUES (?,?,?)');
  const freed=new Set();let count=0,review_count=0;
  const current=db.prepare('SELECT status,payment_gateway FROM orders WHERE order_id=?');
  db.transaction(()=>{
    for(const o of stale){

      const row=current.get(o.order_id);
      if(row?.status!=='PENDING')continue;

      if(['ZARINPAL','ZARINPAL_SANDBOX'].includes(String(row.payment_gateway||'').toUpperCase())){review_count++;continue;}

      if(!stockReservations.inspect(db,o.order_id).ok){review_count++;continue;}
      if(!upd.run(new Date().toISOString(),o.order_id).changes)continue;
      const released=stockReservations.release(db,o.order_id);
      if(!released.ok)throw Error('Reservation changed during expiry');
      released.skus.forEach(sku=>freed.add(sku));
      releaseCouponUse(o.order_id);
      log.run(o.order_id,'EXPIRED',`پرداخت نشد — رزرو انبار پس از ${PENDING_TTL_MIN} دقیقه آزاد شد`);
      count++;
    }
  }).immediate();
  if(count||review_count)appLog('INFO','cleanup',`${count} سفارش منقضی؛ ${review_count} سفارش نیازمند بررسی رزرو`);
  return {count,skus:[...freed],review_count};
}

function purgeExpired() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM rate_limits WHERE window_end < ? AND (blocked_until IS NULL OR blocked_until < ?)')
    .run(now, now);
  db.prepare(`DELETE FROM app_logs WHERE logged_at < datetime('now','-30 days')`).run();
}

const BACKUP_DIR   = path.join(path.dirname(DB_PATH), 'backups');
const {createAutomaticBackup,positiveInt}=require('./automatic-backup');
const BACKUP_KEEP  = positiveInt(process.env.BACKUP_KEEP,7);

const BACKUP_HOURS = positiveInt(process.env.BACKUP_INTERVAL_HOURS,24,596);

function runBackup() {
  try {
    const result=createAutomaticBackup({db,dbPath:DB_PATH,dir:BACKUP_DIR,keep:BACKUP_KEEP});
    if(!result.created)return null;
    appLog('INFO','backup','پشتیبان خودکار تأیید و ثبت شد',
      {file:path.basename(result.file),size:fs.statSync(result.file).size});
    return result.file;
  } catch (e) {
    appLog('ERROR', 'backup', 'پشتیبان‌گیری ناموفق: ' + e.message);
    return null;
  }
}

let onStockFreed = null;
function setStockFreedHandler(fn) { onStockFreed = fn; }

function startMaintenance() {
  const run = () => {
    const res = releaseStaleOrders();
    purgeExpired();
    if (onStockFreed && res && res.skus && res.skus.length) {
      try { onStockFreed(res.skus); }
      catch (e) { appLog('ERROR', 'stock-alert', e.message); }
    }
  };

  run();
  setInterval(() => {
    try { run(); }
    catch (e) { appLog('ERROR', 'maintenance', e.message); }
  }, 5 * 60 * 1000).unref();

  setInterval(() => { try { otpPurgeExpired(); } catch {} },
              5 * 60 * 1000).unref();

  if (process.env.BACKUP_DISABLED !== '1') {
    setTimeout(runBackup, 30 * 1000).unref();
    setInterval(runBackup, BACKUP_HOURS * 3600 * 1000).unref();
  }
}

function otpGet(mobile) {
  const r = db.prepare('SELECT * FROM otp_codes WHERE mobile=?').get(mobile);
  if (!r) return null;
  return {
    code: r.code,
    expires: r.expires_at,
    lastSent: r.last_sent,
    attempts: r.attempts
  };
}

function otpSave(mobile, rec) {
  db.prepare(`
    INSERT INTO otp_codes (mobile, code, expires_at, last_sent, attempts)
    VALUES (@mobile, @code, @expires, @lastSent, @attempts)
    ON CONFLICT(mobile) DO UPDATE SET
      code=@code, expires_at=@expires, last_sent=@lastSent, attempts=@attempts
  `).run({ mobile, ...rec });
}

function otpBumpAttempts(mobile) {
  db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE mobile=?').run(mobile);
}

function otpDelete(mobile) {
  db.prepare('DELETE FROM otp_codes WHERE mobile=?').run(mobile);
}

function otpPurgeExpired() {
  const r = db.prepare('DELETE FROM otp_codes WHERE expires_at < ?').run(Date.now());
  return r.changes;
}

db.transaction(() => {
initSchema();

const isFreshInstallation = !DB_WAS_EXISTING && db.prepare('SELECT COUNT(*) AS c FROM products').get().c === 0;

if (isFreshInstallation) stockReservations.install(db);
if (isFreshInstallation) require('./customer-phone-verification').install(db);

if (isFreshInstallation) require('./return-store').install(db);

if (isFreshInstallation) require('./order-idempotency').install(db);
if (isFreshInstallation) require('./checkout-attempt').install(db);
if (isFreshInstallation) require('./order-reconciliation').install(db);

require('./variant-history').ensureVariantHistory(db);

require('./essence-pricing-store').migratePricing(db);
seedRoles();
seedOwner();
seedIfEmpty();

function seedVerifiedSupplement(filename) {
  const file = path.join(SEED_DIR, filename);
  if (!fs.existsSync(file)) return;
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exists = db.prepare('SELECT id, slug FROM products WHERE id = ? OR slug = ?');
  let inserted = 0;
  for (const row of rows) {
    const existing = exists.get(row.id, row.slug);
    if (existing) {
      if (existing.id !== row.id || existing.slug !== row.slug)
        console.warn(`[DB] supplement collision; skipped: ${row.id}`);
      continue;
    }
    insertProducts([row]);
    inserted++;
  }
  return inserted;
}
const supplementInserted = (seedVerifiedSupplement('supplier_verified_supplement.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v1.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v2.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v3.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v4.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v19.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v5.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v20.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v6.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v21.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v7.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v8.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v22.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v9.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v23.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v24.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v10.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v11.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v25.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v12.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v26.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v13.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v27.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v14.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v15.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v16.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v17.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v18.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v28.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v19.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v20.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v21.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v29.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v30.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v31.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v22.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v32.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v23.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v33.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v34.json') || 0) +
  (seedVerifiedSupplement('official_supplement_v35.json') || 0) +
  (seedVerifiedSupplement('secondary_supplement_v24.json') || 0);

require('./joop-name-correction').apply(db);
require('./popular-persian-names').apply(db);
require('./amouage-common-names').apply(db);
require('./hugo-versus-name').apply(db);

essenceInventory.install(db);

genericImageModule.applyGenericImages(db, genericImageManifest, path.join(ROOT_DIR, 'public', 'images', 'products'));
genericImageModule.applyGenericRebalance(db);

require('./decision-identity-correction').applyDecisionIdentityCorrection(db, path.join(SEED_DIR, 'decision_identity_correction_v1.json'));

for (const file of ['official_identity_evidence_v1.json','official_identity_evidence_v2.json','official_identity_evidence_v3.json','official_identity_evidence_v4.json','official_identity_evidence_v5.json','official_identity_evidence_v6.json','official_identity_evidence_v7.json','official_identity_evidence_v8.json','official_identity_evidence_v9.json','official_identity_evidence_v10.json','official_identity_evidence_v11.json','official_identity_evidence_v12.json','official_identity_evidence_v13.json','official_identity_evidence_v14.json','official_identity_evidence_v15.json','official_identity_evidence_v16.json','official_identity_evidence_v17.json','official_identity_evidence_v18.json','official_identity_evidence_v19.json','official_identity_evidence_v20.json','official_identity_evidence_v21.json','official_identity_evidence_v22.json','official_identity_evidence_v23.json','official_identity_evidence_v24.json','official_identity_evidence_v25.json','official_identity_evidence_v26.json','official_identity_evidence_v27.json','official_identity_evidence_v28.json','official_identity_evidence_v29.json','official_identity_evidence_v30.json','official_identity_evidence_v31.json','official_identity_evidence_v32.json','official_identity_evidence_v33.json','official_identity_evidence_v34.json','official_identity_evidence_v35.json','official_identity_evidence_v36.json','official_identity_evidence_v37.json','official_identity_evidence_v38.json','official_identity_evidence_v39.json','official_identity_evidence_v40.json','official_identity_evidence_v41.json','official_identity_evidence_v42.json','official_identity_evidence_v43.json','official_identity_evidence_v44.json','official_identity_evidence_v45.json','official_identity_evidence_v46.json','official_identity_evidence_v47.json','official_identity_evidence_v48.json','official_identity_evidence_v49.json','official_identity_evidence_v50.json','official_identity_evidence_v51.json','official_identity_evidence_v52.json','official_identity_evidence_v53.json'])
  require('./official-identities').seedOfficialIdentities(db, path.join(SEED_DIR, file));

require('./lv-reference-prices').applyLvReferencePrices(db, path.join(SEED_DIR, 'lv_reference_prices_v1.json'));

require('./reference-price-import').applyReferencePrices(db, path.join(SEED_DIR, 'official_reference_prices_v1.json'));

if (process.env.REFERENCE_PRICE_V2_AUTOMIGRATE !== '0')
  require('./reference-price-import').applyReferencePrices(db, path.join(SEED_DIR, 'official_reference_prices_v2.json'));

for (const file of ['official_reference_prices_v3.json','official_reference_prices_v4.json','official_reference_prices_v5.json','official_reference_prices_v6.json','official_reference_prices_v7.json','official_reference_prices_v8.json','official_reference_prices_v9.json','official_reference_prices_v10.json','official_reference_prices_v11.json','official_reference_prices_v12.json','official_reference_prices_v13.json','official_reference_prices_v14.json','official_reference_prices_v15.json','official_reference_prices_v16.json','official_reference_prices_v17.json','official_reference_prices_v18.json','official_reference_prices_v19.json','official_reference_prices_v20.json','official_reference_prices_v21.json','official_reference_prices_v22.json','official_reference_prices_v23.json','official_reference_prices_v24.json','official_reference_prices_v25.json','official_reference_prices_v26.json','official_reference_prices_v27.json','official_reference_prices_v28.json','official_reference_prices_v29.json','official_reference_prices_v30.json','official_reference_prices_v31.json','official_reference_prices_v32.json','official_reference_prices_v33.json','official_reference_prices_v34.json','official_reference_prices_v35.json','official_reference_prices_v36.json','official_reference_prices_v37.json','official_reference_prices_v38.json','official_reference_prices_v39.json','official_reference_prices_v40.json','official_reference_prices_v41.json','official_reference_prices_v42.json','official_reference_prices_v43.json','official_reference_prices_v44.json','official_reference_prices_v45.json','official_reference_prices_v48.json','official_reference_prices_v49.json','official_reference_prices_v50.json','official_reference_prices_v51.json','official_reference_prices_v52.json','official_reference_prices_v53.json','official_reference_prices_v54.json','official_reference_prices_v55.json','official_reference_prices_v56.json','official_reference_prices_v57.json'])
  require('./reference-price-import').applyReferencePrices(db, path.join(SEED_DIR, file));

const weekendCorrection = require('./weekend-owner-correction').apply(db, path.join(SEED_DIR, 'retracted_weekend_man_reference_v1.json'));
if (weekendCorrection.ok) require('./reference-price-import').applyReferencePrices(db, path.join(SEED_DIR, 'official_reference_prices_v47.json'));
else console.warn('[DB] Weekend correction requires manual review; new price deferred');

for (const file of ['secondary_reference_prices_v1.json','secondary_reference_prices_v2.json','secondary_reference_prices_v3.json','secondary_reference_prices_v4.json','secondary_reference_prices_v5.json','secondary_reference_prices_v6.json','secondary_reference_prices_v7.json','secondary_reference_prices_v8.json','secondary_reference_prices_v9.json','secondary_reference_prices_v10.json','secondary_reference_prices_v11.json','secondary_reference_prices_v12.json','secondary_reference_prices_v13.json','secondary_reference_prices_v14.json','secondary_reference_prices_v15.json','secondary_reference_prices_v16.json','secondary_reference_prices_v17.json','secondary_reference_prices_v18.json','secondary_reference_prices_v19.json','secondary_reference_prices_v20.json','secondary_reference_prices_v21.json','secondary_reference_prices_v22.json','secondary_reference_prices_v23.json','secondary_reference_prices_v24.json','secondary_reference_prices_v25.json','secondary_reference_prices_v26.json','secondary_reference_prices_v27.json'])
  require('./secondary-reference-import').applySecondaryReferences(db, path.join(SEED_DIR, file));

function correctSupplementGenderFromOfficial() {
  const key = 'supplement_gender_official_v1';
  db.transaction(() => {
    if (db.prepare('SELECT value FROM settings WHERE key=?').get(key)) return;
    const fix = db.prepare("UPDATE products SET gender=?, search_blob=NULL WHERE id=? AND gender=? AND supply_mode='UNAVAILABLE'");
    for (const [id, oldGender, officialGender] of [
      ['SUP-ATKINSONS-OUD-SAVE-THE-KING','MEN',null],
      ['SUP-LV-900001','UNISEX',null],
      ['SUP-LV-900002','MEN','UNISEX'],
      ['SUP-LV-900005','UNISEX',null],
      ['SUP-LV-900006','MEN',null]
    ]) fix.run(officialGender,id,oldGender);
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(key,new Date().toISOString());
  })();
}
correctSupplementGenderFromOfficial();
for (const file of ['official_gender_corrections_v1.json', 'official_gender_corrections_v2.json'])
  require('./official-gender').applyOfficialGender(db, path.join(SEED_DIR, file));
const officialNoteManifests = ['official_note_corrections_v1.json', 'official_note_corrections_v2.json', 'official_note_corrections_v3.json', 'official_note_corrections_v4.json', 'official_note_corrections_v5.json', 'official_note_corrections_v6.json', 'official_note_corrections_v7.json', 'official_note_corrections_v8.json', 'official_note_corrections_v9.json', 'official_note_corrections_v10.json', 'official_note_corrections_v11.json', 'official_note_corrections_v12.json', 'official_note_corrections_v13.json', 'official_note_corrections_v14.json', 'official_note_corrections_v15.json', 'official_note_corrections_v16.json','official_note_corrections_v17.json','official_note_corrections_v18.json','official_note_corrections_v19.json','official_note_corrections_v20.json','official_note_corrections_v21.json','official_note_corrections_v22.json','official_note_corrections_v23.json','official_note_corrections_v24.json','official_note_corrections_v25.json','official_note_corrections_v26.json','official_note_corrections_v27.json','official_note_corrections_v28.json','official_note_corrections_v29.json','official_note_corrections_v30.json','official_note_corrections_v31.json','official_note_corrections_v32.json','official_note_corrections_v33.json','official_note_corrections_v34.json','official_note_corrections_v35.json','official_note_corrections_v36.json','official_note_corrections_v37.json','official_note_corrections_v38.json','official_note_corrections_v39.json','official_note_corrections_v40.json'];
const officialNotesResults = officialNoteManifests.map(file =>
  require('./official-notes').applyOfficialNotes(db, path.join(SEED_DIR, file)));
const secondaryNotesResults = ['secondary_note_corrections_v1.json','secondary_note_corrections_v2.json','secondary_note_corrections_v3.json','secondary_note_corrections_v4.json','secondary_note_corrections_v5.json','secondary_note_corrections_v6.json'].map(file =>
  require('./secondary-notes').applySecondaryNotes(db, path.join(SEED_DIR, file)));
seedCoupons();

seedShopSettings();

let legacyReferenceResult = null;
if (isFreshInstallation && process.env.APPROVED_MTO_AUTOSTART !== '0') {
  if (process.env.LEGACY_REFERENCES_AUTOSTART !== '0') legacyReferenceResult = require('./legacy-reference-approval').applyLegacyReferenceApproval(db, path.join(SEED_DIR, 'secondary_reference_prices_v28.json'));
  const approved = require('./approved-made-to-order');
  const result = approved.applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v1.json'));
  approved.correctApprovedNotices(db, path.join(SEED_DIR, 'approved_made_to_order_v1.json'));
  if (result.skipped.length) console.warn('[DB] approved made-to-order items skipped:', result.skipped.length);
  if (process.env.APPROVED_MTO_V2_AUTOSTART !== '0') {
    const v2 = require('./approved-made-to-order-v2').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v2.json'));
    if (v2.skipped.length) console.warn('[DB] seven approved made-to-order items skipped:', v2.skipped.length);
  }
  if (process.env.APPROVED_MTO_V3_AUTOSTART !== '0') {
    const v3 = require('./approved-made-to-order-v3').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v3.json'));
    if (v3.skipped.length) console.warn('[DB] four approved made-to-order items skipped:', v3.skipped.length);
  }
  if (process.env.APPROVED_MTO_V4_AUTOSTART !== '0') {
    const v4 = require('./approved-made-to-order-v4').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v4.json'));
    if (v4.skipped.length) console.warn('[DB] three approved made-to-order items skipped:', v4.skipped.length);
  }
  if (process.env.APPROVED_MTO_V5_AUTOSTART !== '0') {
    const v5 = require('./approved-made-to-order-v5').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v5.json'));
    if (v5.skipped.length) console.warn('[DB] three Amouage approvals skipped:', v5.skipped.length);
  }
  if (process.env.APPROVED_MTO_V6_AUTOSTART !== '0' && weekendCorrection.ok) {
    const v6 = require('./approved-made-to-order-v6').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v6.json'));
    if (v6.skipped.length) console.warn('[DB] three additional approvals skipped:', v6.skipped.length);
  }
  if (process.env.APPROVED_MTO_V7_AUTOSTART !== '0') {
    const v7 = require('./approved-made-to-order-v7').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v7.json'));
    if (v7.skipped.length) console.warn('[DB] Her approval skipped:', v7.skipped.length);
  }
  if (process.env.APPROVED_MTO_V8_AUTOSTART !== '0') {
    const v8 = require('./approved-made-to-order-v8').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v8.json'));
    if (v8.skipped.length) console.warn('[DB] Eternity approval skipped:', v8.skipped.length);
  }
  if (process.env.APPROVED_MTO_V9_AUTOSTART !== '0') {
    const v9 = require('./approved-made-to-order-v9').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v9.json'));
    if (v9.skipped.length) console.warn('[DB] Euphoria Men approval skipped:', v9.skipped.length);
  }
  if (process.env.APPROVED_MTO_V10_AUTOSTART !== '0') {
    const v10 = require('./approved-made-to-order-v10').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v10.json'));
    if (v10.skipped.length) console.warn('[DB] Euphoria Women approval skipped:', v10.skipped.length);
  }
  if (process.env.APPROVED_MTO_V11_AUTOSTART !== '0') {
    const v11 = require('./approved-made-to-order-v11').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v11.json'));
    if (v11.skipped.length) console.warn('[DB] default batch approvals skipped:', v11.skipped.length);
  }
  if (process.env.APPROVED_MTO_V12_AUTOSTART !== '0') {
    const v12 = require('./approved-made-to-order-v12').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v12.json'));
    if (v12.skipped.length) console.warn('[DB] Parfum default approvals skipped:', v12.skipped.length);
  }
  if (process.env.APPROVED_MTO_V13_AUTOSTART !== '0') {
    const v13 = require('./approved-made-to-order-v13').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v13.json'));
    if (v13.skipped.length) console.warn('[DB] owner default six approvals skipped:', v13.skipped.length);
  }
  if (process.env.APPROVED_MTO_V14_AUTOSTART !== '0') {
    const v14 = require('./approved-made-to-order-v14').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v14.json'));
    if (v14.skipped.length) console.warn('[DB] owner default three approvals skipped:', v14.skipped.length);
  }
  if (process.env.APPROVED_MTO_V15_AUTOSTART !== '0') {
    const v15 = require('./approved-made-to-order-v15').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v15.json'));
    if (v15.skipped.length) console.warn('[DB] owner default two approvals skipped:', v15.skipped.length);
  }
  if (process.env.APPROVED_MTO_V16_AUTOSTART !== '0') {
    const v16 = require('./approved-made-to-order-v16').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v16.json'));
    if (v16.skipped.length) console.warn('[DB] Coco approval skipped:', v16.skipped.length);
  }
  if (process.env.OWNER_REFERENCE_V3_AUTOSTART !== '0') {
    require('./owner-reference-import-v3').applyOwnerReferences(db, path.join(SEED_DIR, 'owner_reference_selection_v3.json'));
  }
  if (process.env.GENERIC_SCENTS_V2_AUTOSTART !== '0') {
    require('./generic-scent-import-v2').applyGenericScents(db, path.join(SEED_DIR, 'generic_scent_owner_approved_v2.json'));
  }
  if (process.env.OWNER_REFERENCE_V2_AUTOSTART !== '0') {
    require('./owner-reference-import-v2').applyOwnerReferences(db, path.join(SEED_DIR, 'owner_reference_selection_v2.json'));
  }
  if (process.env.OWNER_REFERENCE_AUTOSTART !== '0') {
    require('./owner-reference-import').applyOwnerReferences(db, path.join(SEED_DIR, 'owner_reference_selection_v1.json'));
  }
  if (process.env.GENERIC_SCENTS_AUTOSTART !== '0') {
    require('./generic-scent-import').applyGenericScents(db, path.join(SEED_DIR, 'generic_scent_owner_approved_v1.json'));
  }
  if (process.env.APPROVED_MTO_V17_AUTOSTART !== '0') {
    const v17 = require('./approved-made-to-order-v17').applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v17.json'));
    if (v17.skipped.length) console.warn('[DB] EDT fallback approvals skipped:', v17.skipped.length);
  }
}

const activeNotesResults = ['active_official_note_corrections_v1.json','active_official_note_corrections_v2.json','active_official_note_corrections_v3.json'].map(file =>
  require('./active-official-notes').applyActiveOfficialNotes(db, path.join(SEED_DIR, file)));
const unverifiedAccordResult = isFreshInstallation && process.env.APPROVED_MTO_AUTOSTART !== '0' && process.env.UNVERIFIED_ACCORD_CLEANUP_AUTOSTART !== '0'
  ? require('./unverified-seed-accords-cleanup').applyUnverifiedSeedAccordsCleanup(db, path.join(SEED_DIR,'unverified_seed_accords_cleanup_v1.json')) : null;

const activeSecondaryNotes = isFreshInstallation && process.env.APPROVED_MTO_AUTOSTART !== '0' && process.env.ACTIVE_SECONDARY_NOTES_AUTOSTART !== '0'
  ? ['active_secondary_note_additions_v1.json','active_secondary_note_additions_v2.json','active_secondary_note_additions_v3.json','active_secondary_note_additions_v4.json','active_secondary_note_additions_v5.json','active_official_note_overlap_v1.json'].map(file=>require('./active-secondary-notes').apply(db,path.join(SEED_DIR,file))) : [];
require('./brand-name-normalization').apply(db);
buildSearchIndex();

buildNotesIndex(activeSecondaryNotes.some(r=>r.updated_ids?.length > 0) || unverifiedAccordResult?.updated > 0 || legacyReferenceResult?.activated > 0 || activeNotesResults.some(r => r.updated > 0) || supplementInserted > 0 || secondaryNotesResults.some(r => r.updated > 0) || officialNotesResults.some(r => r.updated > 0));
}).immediate();
db.pragma('busy_timeout = 5000');

startMaintenance();

let _statsCache = null, _statsAt = 0;
const STATS_TTL = 60_000;

function storeStats(force = false) {
  const now = Date.now();
  if (!force && _statsCache && now - _statsAt < STATS_TTL) return _statsCache;

  const one = sql => { try { return db.prepare(sql).get().c; } catch { return 0; } };

  const stats = {
    products:     one('SELECT COUNT(*) c FROM products'),
    brands:       one('SELECT COUNT(DISTINCT brand_en) c FROM products'),
    variants:     one('SELECT COUNT(*) c FROM variants'),

    in_stock:     one(`SELECT COUNT(DISTINCT product_id) c FROM variants WHERE stock > 0`),
    made_to_order: one(`SELECT COUNT(*) c FROM products
                        WHERE supply_mode = 'MADE_TO_ORDER'`),
    orderable:    one(`SELECT COUNT(*) c FROM products p
                       WHERE p.supply_mode != 'UNAVAILABLE'`),

    perfumers:    one(`SELECT COUNT(DISTINCT perfumer) c FROM products
                       WHERE perfumer IS NOT NULL AND perfumer != ''`),
    notes:        one('SELECT COUNT(DISTINCT note_key) c FROM product_notes'),
    countries:    one(`SELECT COUNT(DISTINCT country) c FROM products
                       WHERE country IS NOT NULL AND country != ''`),
    families:     one('SELECT COUNT(DISTINCT family_slug) c FROM products'),
    articles:     one('SELECT COUNT(*) c FROM articles')
  };

  const yr = (() => {
    try {
      return db.prepare(`SELECT MIN(release_year) a, MAX(release_year) b
                         FROM products WHERE release_year IS NOT NULL`).get();
    } catch { return {}; }
  })();
  stats.year_from = yr.a || null;
  stats.year_to   = yr.b || null;
  stats.centuries = (yr.a && yr.b) ? Math.round((yr.b - yr.a) / 100) : null;

  _statsCache = stats;
  _statsAt = now;
  return stats;
}

function bustStatsCache() { _statsCache = null; }

module.exports = {
  db, parseProduct, attachVariants, DB_PATH,
  storeStats, bustStatsCache,
  imageForFamily, imageForProduct, variantImageFor,
  validateCoupon, recordCouponUse, releaseCouponUse, logStatus,

  activeCampaigns, campaignDiscount, campaignPercentFor, itemInScope, parseScope,
  variantCampaignPercent, attachCampaign, bustCampaignCache,
  createSession, readSession, destroySession,
  rateLimit, resetRateLimit,
  appLog, releaseStaleOrders, setStockFreedHandler, PENDING_TTL_MIN,
  runBackup, BACKUP_DIR,
  reviewSummary, hasPurchased,
  createReviewInvite, readReviewInvite, consumeReviewInvite, INVITE_TTL_DAYS,
  getSettings, saveSettings, isValidSetting, nextInvoiceNo,
  buildSearchIndex, buildNotesIndex, refreshProductNotes, listNotes, normalizeFa,
  insertProducts,
  otpGet, otpSave, otpBumpAttempts, otpDelete, otpPurgeExpired,
  hashPassword, verifyPassword,
  getCustomer, getCustomerById, createCustomer,
  setCustomerPassword, saveCustomerAddress, publicCustomer, publicStaff,
  seedRoles, seedOwner, getRole, listRoles,
  getStaff, getStaffByUsername, listStaff,
  audit, purgeAudit
};
