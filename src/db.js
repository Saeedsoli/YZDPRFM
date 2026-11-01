/**
 * عطر یزد | Yazd Perfume — لایه دیتابیس واقعی (SQLite)
 * ---------------------------------------------------
 * قابل انتقال مستقیم به Liara بدون تغییر.
 * مسیر دیتابیس از متغیر محیطی DB_PATH خوانده می‌شود تا روی Liara
 * بتوان آن را به یک Disk پایدار وصل کرد.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
/* بالای فایل تعریف می‌شود چون `createReviewInvite` از آن استفاده
   می‌کند و آن تابع بالاتر از بخش نشست‌هاست. `const` هویست نمی‌شود،
   پس ترتیب تعریف اهمیت دارد. */
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');

// روی Liara: DB_PATH=/app/data/yazd.db  (Disk پایدار)
// محلی: data/yazd.db
const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'yazd.db');
// A pre-existing nonempty SQLite file must never be treated as a new store.
const DB_WAS_EXISTING = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0;

/**
 * پوشه داده‌های اولیه — عمداً بیرون از `data/`.
 *
 * روی Liara یک Disk پایدار روی `/app/data` سوار می‌شود. هر چیزی که
 * هنگام build داخل آن پوشه کپی شده باشد، پس از mount شدن دیسک
 * **دیده نمی‌شود** — دیسکِ خالی روی آن می‌نشیند.
 *
 * وقتی فایل seed داخل `data/` بود، نخستین استقرار با «فایل seed
 * یافت نشد» بالا می‌آمد و فروشگاه با صفر محصول و صفر مقاله شروع
 * می‌کرد. پس داده اولیه در `seed/` می‌ماند که هرگز mount نمی‌شود،
 * و `data/` فقط جای چیزهایی است که باید بین استقرارها بمانند.
 */
const SEED_DIR = process.env.SEED_DIR || path.join(ROOT_DIR, 'seed');

// اطمینان از وجود پوشه
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// تنظیمات پایداری و کارایی
db.pragma('journal_mode = WAL');   // تحمل نوشتن همزمان
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ═══════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════
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

  // ستون‌های جدید سفارش (افزودن امن روی دیتابیس موجود)
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

  /* ── ستون‌های تازه سفارش ──
     نام و نام خانوادگی جدا ذخیره می‌شوند تا بتوان مؤدبانه خطاب
     کرد («سلام آقای محمدی») و روی برچسب پستی مرتب چاپ شود.
     `customer_name` برای سازگاری با سفارش‌های قدیمی می‌ماند. */
  addCol('first_name', 'TEXT');
  addCol('last_name',  'TEXT');
  addCol('email',      'TEXT');

  /* ── بسته‌بندی کادویی ──
     سرویس اختیاری تسویه. مبلغ **در خود سفارش** ذخیره می‌شود، نه
     فقط یک پرچم بله/خیر.

     چرا مبلغ و نه فقط پرچم: اگر روزی نرخ کادو عوض شود، فاکتور
     سفارش‌های قدیمی باید همان مبلغی را نشان دهد که مشتری واقعاً
     پرداخته. ذخیره پرچم تنها یعنی فاکتور دیروز با نرخ امروز
     بازسازی می‌شود — همان اشتباهی که قیمت کالا هرگز نمی‌کند
     (order_items قیمت لحظه خرید را نگه می‌دارد).

     پیش‌فرض صفر است نه NULL: سفارش‌های پیشین کادو نداشتند و
     «صفر» اینجا واقعیت است، نه «نامشخص». */
  addCol('gift_wrap_fee', 'INTEGER NOT NULL DEFAULT 0');

  /* ── پروفایل بویایی مشتری ──
     پاسخ‌های کوییز به‌صورت JSON ذخیره می‌شوند تا صفحه اصلی بتواند
     «پیشنهاد برای شما» بسازد. پیش از این، کوییز یک اسباب‌بازی
     یک‌بارمصرف بود: کاربر شش سؤال جواب می‌داد و دفعه بعد سایت
     هیچ‌چیز از او به یاد نداشت.

     چرا JSON و نه ستون جدا برای هر معیار: معیارها ممکن است عوض
     شوند (سؤال تازه اضافه شود) و هر بار مهاجرت جدول برای داده‌ای
     که فقط خوانده و بازنویسی می‌شود، هزینه بی‌دلیل است.

     `taste_updated_at` برای نمایش «بر اساس کوییز فلان تاریخ» و
     تشخیص پروفایل کهنه است. */
  const custCols = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  const addCustCol = (name, ddl) => {
    if (!custCols.includes(name)) db.exec(`ALTER TABLE customers ADD COLUMN ${name} ${ddl}`);
  };
  addCustCol('taste_profile',    'TEXT');
  addCustCol('taste_updated_at', 'TEXT');

  /* ── ستون‌های تازه کارکنان ──
     کد ملی نام کاربری کارمند است: یکتا، به‌یادماندنی، و برخلاف
     نام مستعار قابل جعل نیست. */
  const scols = db.prepare('PRAGMA table_info(staff)').all().map(c => c.name);
  const addStaffCol = (name, ddl) => {
    if (!scols.includes(name)) db.exec(`ALTER TABLE staff ADD COLUMN ${name} ${ddl}`);
  };
  addStaffCol('national_id', 'TEXT');
  addStaffCol('first_name',  'TEXT');
  addStaffCol('last_name',   'TEXT');

  // ستون یکپارچه جستجو — به‌جای LIKE روی ۸ ستون
  const pcols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
  if (!pcols.includes('search_blob')) {
    db.exec('ALTER TABLE products ADD COLUMN search_blob TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_search ON products(search_blob)');
  }

  /* ── شناسنامه عطر: عطار و سال عرضه ──
     دیتاست مرجع برای هر عطر نام عطرساز و سال عرضه دارد.

     چرا ارزش نمایش دارند:
       این دو، ادعای «کار تخصصی» را از حرف به مدرک تبدیل می‌کنند.
       مشتری که می‌بیند «عطار: François Demachy · عرضه: ۲۰۱۵»
       می‌فهمد فروشنده می‌داند از چه حرف می‌زند. برای فروشگاهی که
       بازآفرینی دست‌ساز می‌فروشد و نمی‌خواهد ادعای اورجینال کند،
       همین دقت فنی مهم‌ترین سرمایه اعتماد است.

     چرا release_year عدد صحیح است:
       سال عرضه در منبع با کاما آمده («1,959») ولی ذاتاً عدد است.
       ذخیره به‌صورت INTEGER اجازه مرتب‌سازی و بازه‌گیری می‌دهد —
       مثلاً «کلاسیک‌های پیش از ۱۹۸۰». اگر متن بماند، «1959» و
       «959» در مرتب‌سازی جابه‌جا می‌شوند. */
  if (!pcols.includes('perfumer')) {
    db.exec('ALTER TABLE products ADD COLUMN perfumer TEXT');
  }
  if (!pcols.includes('release_year')) {
    db.exec('ALTER TABLE products ADD COLUMN release_year INTEGER');
  }

  /* ── یادداشت عطرساز ──
     تنها محتوایی در کل سایت که نه رقیب می‌تواند کپی کند نه از
     دیتاست می‌آید: حرف کسی که واقعاً این رایحه را ساخته.

     چرا اهمیت دارد: در معیارهای کیفیت گوگل حرف اول Experience
     است — تجربه دست‌اول. صفحه محصولی که فقط نُت و قیمت دارد،
     از هزار صفحه مشابه قابل تشخیص نیست. یک پاراگراف از زبان
     عطرساز، همان صفحه را یکتا می‌کند.

     دو ستون جدا، نه یکی:
       maker_note      متن — تجربه ساخت یا استفاده
       maker_note_by   امضا — «عطرساز عطر یزد» یا نام شخص

     امضا جداست چون بعضی یادداشت‌ها تجربه شخصی مدیر است نه
     عطرساز، و نسبت دادن غلط بدتر از نداشتن امضاست. */
  if (!pcols.includes('maker_note')) {
    db.exec('ALTER TABLE products ADD COLUMN maker_note TEXT');
  }
  if (!pcols.includes('maker_note_by')) {
    db.exec('ALTER TABLE products ADD COLUMN maker_note_by TEXT');
  }
  // Existing notes may have been generated as drafts; never publish them as
  // first-hand experience until a human explicitly reviews and approves them.
  if (!pcols.includes('maker_note_approved')) {
    db.exec('ALTER TABLE products ADD COLUMN maker_note_approved INTEGER NOT NULL DEFAULT 0');
  }

  /* ── وضعیت تأمین: سه‌حالته، نه دوحالته ──
     پیش‌تر فقط «موجود / ناموجود» داشتیم و این واقعیت کار دست‌ساز
     را بد نشان می‌داد: عطری که همین حالا در قفسه نیست ولی
     می‌توانیم بسازیم، با عطری که اصلاً نمی‌توانیم تهیه کنیم یکسان
     دیده می‌شد — هر دو «ناموجود» و بن‌بست.

       IN_STOCK      از انبار، ارسال فوری
       MADE_TO_ORDER به سفارش ساخته می‌شود (چند روز کار)
       UNAVAILABLE   فعلاً نمی‌توانیم — فقط «خبرم کن»

     ── چرا پیش‌فرض UNAVAILABLE است (تصمیم مالک، شهریور ۱۴۰۵) ──
     نسخه نخست پیش‌فرض را MADE_TO_ORDER گذاشت با این استدلال که
     کاتالوگ از عطرهای شناسنامه‌دار پر شده است. در عمل غلط بود:
     یعنی سایت ادعا می‌کرد هر ۲٬۱۱۱ عنوان ساختنی است، در حالی که
     مالک می‌گوید حدود ۷۰۰ تا واقعاً ساختنی‌اند.

     پیش‌فرض باید **محتاطانه** باشد نه خوش‌بینانه. ادعای نداشته
     کردن، هم به مشتری بدقولی است هم به گوگل سیگنال «هزاران صفحه
     بی‌پشتوانه» می‌دهد. حالا هر عنوان تا وقتی مالک صریحاً
     تأییدش نکرده، «فعلاً نمی‌توانیم» است.

     جهت خطا هم اهمیت دارد: اگر عطری ساختنی باشد و UNAVAILABLE
     بماند، فقط یک فروش از دست می‌رود. اگر ساختنی نباشد و
     MADE_TO_ORDER بماند، مشتری پول می‌دهد و ما نمی‌توانیم
     تحویل دهیم — که خیلی گران‌تر است.

     🔴 این ستون **جای stock را نمی‌گیرد**. موجودی عددی همچنان
     مرجع «ارسال فوری» است؛ این ستون فقط می‌گوید وقتی موجودی صفر
     شد، مشتری چه پیامی ببیند. */
  if (!pcols.includes('supply_mode')) {
    db.exec(
      "ALTER TABLE products ADD COLUMN supply_mode TEXT NOT NULL DEFAULT 'UNAVAILABLE'");
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_supply ON products(supply_mode)');
  }

  /* ── مهاجرت یک‌باره: هر آنچه هرگز دستی تأیید نشده → UNAVAILABLE ──
     دیتابیس‌هایی که پیش از تغییر پیش‌فرض ساخته شده‌اند، ۲٬۱۱۱
     عنوان MADE_TO_ORDER دارند. تغییر DEFAULT روی ستون موجود
     اثری ندارد — فقط ردیف‌های تازه را می‌گیرد.

     چرا با کلید تنظیمات محافظت می‌شود: بدون آن، هر بار سرور
     بالا می‌آید محصولاتی را که مالک دستی روی MADE_TO_ORDER
     گذاشته دوباره صفر می‌کند. یعنی کار مالک را پاک می‌کند —
     دقیقاً همان رفتاری که یک بار در make_favicon.py دیدیم و
     مانیفست PWA را بازنویسی می‌کرد. */
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

  /* ── قیمت دلاری پایه ──
     فروشگاه فرمولی برای قیمت‌گذاری دارد که به نرخ دلار وابسته
     است. هدف نهایی: با تغییر نرخ ارز، قیمت تومانی همه محصولات
     خودکار به‌روز شود.

     این ستون **گام اول** است — فقط نگهداری عدد. فرمول و محاسبه
     خودکار بعداً روی همین می‌نشیند.

     ── چرا REAL و نه INTEGER ──
     قیمت تومان عدد صحیح است چون ریال اعشار ندارد. ولی قیمت
     دلاری اسانس معمولاً اعشاری است (۱۲.۵ دلار برای ۱۰ گرم).
     گرد کردنش در این مرحله یعنی خطای انباشته در فرمول نهایی.

     ── چرا NULL مجاز است ──
     امروز هیچ محصولی قیمت دلاری ندارد. اگر پیش‌فرض صفر بگذاریم،
     بعداً نمی‌شود فهمید «صفر یعنی رایگان» یا «هنوز وارد نشده».
     NULL صریح می‌گوید «نامشخص». */
  const vcols = db.prepare('PRAGMA table_info(variants)').all().map(c => c.name);
  if (!vcols.includes('price_usd')) {
    db.exec('ALTER TABLE variants ADD COLUMN price_usd REAL');
  }

  const tcols = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
  if (!tcols.includes('reply')) db.exec('ALTER TABLE tickets ADD COLUMN reply TEXT');
  if (!tcols.includes('mobile')) db.exec('ALTER TABLE tickets ADD COLUMN mobile TEXT');

  /* ── کوپن پیشرفته ──
     نسخه اول فقط درصد/مبلغ/ارسال داشت و روی کل سبد اعمال می‌شد.
     خواسته مالک (مرداد ۱۴۰۵): تخفیف روی دسته خاص، محصول خاص،
     برند، نوع محصول، بازه تاریخ، و کد اختصاصی مشتری.

     با ALTER اضافه می‌شوند نه بازسازی جدول، چون دیتابیس زنده
     است و کوپن‌های موجود نباید از دست بروند. */
  const ccols = db.prepare('PRAGMA table_info(coupons)').all().map(c => c.name);
  const addCoupon = (name, ddl) => {
    if (!ccols.includes(name)) db.exec(`ALTER TABLE coupons ADD COLUMN ${name} ${ddl}`);
  };
  addCoupon('starts_at',      'TEXT');     // پیش از این تاریخ کار نمی‌کند
  addCoupon('scope_families', 'TEXT');     // family_slug جدا با کاما
  addCoupon('scope_brands',   'TEXT');     // brand_fa جدا با کاما
  addCoupon('scope_types',    'TEXT');     // EDP,SAMPLE,HAIR_MIST,BODY_SPLASH
  addCoupon('scope_products', 'TEXT');     // product_id جدا با کاما
  addCoupon('scope_gender',   'TEXT');     // MEN | WOMEN | UNISEX
  addCoupon('max_subtotal',   'INTEGER');  // سقف خرید (برای تخفیف خرد)
  addCoupon('first_order_only', 'INTEGER NOT NULL DEFAULT 0');
  addCoupon('assigned_mobile',  'TEXT');   // کد اختصاصی یک مشتری

  /* ── تفکیک تخفیف روی سفارش ──
     `discount_amount` مجموع جشنواره و کوپن است تا جمع فاکتور با
     مبلغ پرداختی بخواند. ولی فاکتور با یک عدد سرجمع، تخفیف
     جشنواره را زیر نام کد تخفیف چاپ می‌کرد — یعنی سندی که رقم
     درست ولی شرح غلط داشت. این ستون سهم جشنواره را جدا نگه
     می‌دارد تا فاکتور دو سطر صادق داشته باشد.

     سفارش‌های قدیمی NULL می‌گیرند و فاکتورشان مثل قبل رفتار
     می‌کند — بازنویسی تاریخ در دفتر مالی درست نیست. */
  const ocols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!ocols.includes('campaign_discount')) {
    db.exec('ALTER TABLE orders ADD COLUMN campaign_discount INTEGER');
  }
  if (!ocols.includes('campaign_note')) {
    db.exec('ALTER TABLE orders ADD COLUMN campaign_note TEXT');
  }

  /* ── یادداشت مشتری هنگام تسویه ──
     خواسته مالک (مرداد ۱۴۰۵): «قسمت افزودن توضیحات برای مشتری
     هنگام تسویه‌حساب ممکن باشد. برای مثال برای درخواست فاکتور
     رسمی و غیره. به جای افزودن دکمه‌های اضافی این راه بهتریه.»

     منطق درستی هم دارد: هر خواسته‌ای که به دکمه تبدیل شود، فرم
     تسویه را شلوغ‌تر می‌کند و نرخ رها کردن سبد را بالا می‌برد.
     یک فیلد متن آزاد همه حالت‌ها را می‌پوشاند — از «فاکتور رسمی
     می‌خواهم» تا «لطفاً کادوپیچ کنید» یا «زنگ نزنید، فقط پیام».

     جدا از `admin_note` است: آن یادداشت داخلی کارکنان است و
     مشتری نمی‌بیندش. این یکی حرفِ خود مشتری است. */
  if (!ocols.includes('customer_note')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_note TEXT');
  }

  /* ── جشنواره: تخفیف خودکار بدون کد ──
     مشتری کاری نمی‌کند؛ قیمت خط‌خورده روی کارت محصول دیده
     می‌شود. دامنه‌اش مثل کوپن است تا منطق یکی بماند. */
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

  /* منشأ نظر — تفکیک «خرید آنلاین» از «مشتری حضوری».

     چرا ستون جدا و نه استفاده از همان `verified`: هر دو گروه
     مشتری واقعی‌اند و نشان تأیید می‌گیرند، ولی سند پشتشان فرق
     دارد. اگر روزی کسی بپرسد «این نظر از کجا آمده؟» باید بتوانیم
     دقیق جواب بدهیم، نه اینکه همه را یک کاسه کرده باشیم. */
  const rcols = db.prepare('PRAGMA table_info(reviews)').all().map(c => c.name);
  if (!rcols.includes('source')) {
    // ONLINE = خرید آنلاین · INVITED = دعوت مشتری حضوری
    db.exec("ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'ONLINE'");
  }
}

// ═══════════════════════════════════════════
// پاکسازی نام انگلیسی از «(Inspired by ...)»
// ═══════════════════════════════════════════
function cleanNameEn(nameEn, brandEn, subtitleEn) {
  if (subtitleEn && !/inspired/i.test(subtitleEn)) return subtitleEn;
  let n = String(nameEn || '').replace(/\s*\(Inspired by[^)]*\)\s*/gi, '').trim();
  if (brandEn && !n.toUpperCase().startsWith(brandEn.toUpperCase())) {
    n = `${brandEn.toUpperCase()} - ${n}`;
  }
  return n;
}

/**
 * پاکسازی نام فارسی:
 *  - حذف پیشوند «عطر دست‌ساز»
 *  - حذف تکرار نام برند در ابتدای عنوان (نام برند جداگانه نمایش داده می‌شود)
 */
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

// تخصیص تصویر بر اساس خانواده بویایی
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

// تصویر اختصاصی برای خانه‌های عطر شاخص
const BRAND_IMAGES = {
  "Penhaligon's": '/images/products/brand-penhaligons.jpg',
  'Amouage':      '/images/products/brand-amouage.jpg',
  'Tom Ford':     '/images/products/brand-tomford.jpg',
  'Creed':        '/images/products/brand-creed.jpg'
};

function imageForFamily(slug) {
  return FAMILY_IMAGES[slug] || DEFAULT_IMAGE;
}

/* ═══════════════════════════════════════════
   تصاویر واریانت‌دار — «خانواده بویایی × جنسیت»
   ═══════════════════════════════════════════
   با تعداد کم تصویر، صدها عطر هم‌خانواده یک عکس مشترک می‌گیرند و
   کاتالوگ شبیه چند کارت تکراری می‌شود.

   حالا هر ترکیب چند واریانت دارد و محصولات با هش شناسه بینشان
   پخش می‌شوند. هش یعنی تخصیص **پایدار** است: هر محصول همیشه همان
   تصویر را می‌گیرد، پس کش مرورگر و ایندکس گوگل نمی‌شکند.

   شمار واریانت‌ها اینجا ثبت می‌شود و باید با فایل‌های موجود در
   public/images/products/ بخواند. اگر فایلی هنوز ساخته نشده،
   VARIANT_COUNTS به‌روز نمی‌شود تا تصویر شکسته سرو نشود. */
/* ── چرا این جدول از روی دیسک ساخته می‌شود، نه دستی ──
   نسخه پیشین فهرست ثابتی بود که باید با هر تصویر تازه دستی
   به‌روز می‌شد. این دقیقاً همان الگوی خطاست که چند بار در این
   پروژه دیدیم: دو منبع حقیقت که با هم واگرا می‌شوند.

   خطرش دوطرفه بود:
     • تصویر ساخته می‌شد ولی در جدول ثبت نمی‌شد → فایل بی‌استفاده
     • عدد بالاتر از تعداد واقعی می‌ماند → تصویر ۴۰۴

   حالا پوشه یک بار در زمان راه‌اندازی خوانده می‌شود و شمارش از
   خود فایل‌ها می‌آید. افزودن تصویر تازه یعنی فقط گذاشتن فایل با
   نام درست: fam-{خانواده}-{m|w|u}-{شماره}.jpg

   شمارش «تا نخستین شکاف» است نه «تعداد کل»: اگر فایل‌های ۱ و ۲
   و ۴ باشند، عدد ۲ می‌شود. چون تخصیص با باقی‌مانده هش انجام
   می‌شود، وجود شکاف یعنی بعضی محصولات به فایل ناموجود اشاره
   کنند. */
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

/** هش پایدار و ارزان — همان الگوی FNV-1a */
function stableHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const GENDER_TAG = { MEN: 'm', WOMEN: 'w', UNISEX: 'u' };

/**
 * تصویر واریانت‌دار «خانواده × جنسیت».
 *
 * ── بازگشت به جنسیت دیگرِ همان خانواده ──
 * توزیع خانواده×جنسیت در کاتالوگ یکنواخت نیست. چند ترکیب پرجمعیت
 * تصویر اختصاصی ندارند:
 *
 *     ambery-oriental|WOMEN   ۲۰۱ محصول   (پیش‌تر تصویر نداشت)
 *     citrus|MEN               ۴۶ محصول
 *     chypre|WOMEN             ۴۱ محصول
 *     leather|MEN              ۳۹ محصول
 *
 * روی هم ۳۹۰ محصول — ۱۸٫۵٪ کاتالوگ — به تصویر تکیِ بی‌جنسیت
 * `family-*.jpg` می‌افتادند. نتیجه: ۱۷۴ محصول با یک عکس یکسان،
 * دقیقاً همان مشکلی که تصاویر واریانت‌دار برای حلش ساخته شده بود.
 *
 * دو راه بود:
 *   ۱) تولید ~۵۰ تصویر تازه برای ترکیب‌های نو
 *   ۲) اجازه دادن به اشتراک تصاویر **درون همان خانواده بویایی**
 *
 * راه دوم انتخاب شد. دلیلش زیبایی‌شناسی نیست، دقت است: تصاویر بر
 * پایه **نُت‌های خانواده** ساخته شده‌اند (چوبی با تراشه سدر و سنگ،
 * گلی با گل و ابریشم) و بطری‌ها بی‌نام و خنثی‌اند. یک بطری شیشه‌ای
 * روی بستر چوب سدر، برای عطر چوبی زنانه هم درست است. تفکیک
 * جنسیت در این تصاویر ترجیح است، نه ضرورت.
 *
 * ترتیب بازگشت: جنسیت خودش ← یونیسکس ← هر جنسیت دیگرِ همان
 * خانواده. هش روی `productId` می‌ماند پس تخصیص **پایدار** است و
 * کش مرورگر و ایندکس گوگل نمی‌شکند.
 */
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
    /* هش با جنسیتِ مقصد ترکیب می‌شود تا دو محصول هم‌خانواده که به
       یک مجموعه تصویر می‌رسند، الگوی پخش متفاوتی بگیرند. بدون
       این، محصولات زنانه و مردانهٔ یک خانواده روی همان اندیس‌ها
       می‌افتادند و تنوع ظاهری کم می‌شد. */
    const idx = stableHash(String(productId) + '|' + g) % count;
    return `/images/products/fam-${familySlug}-${GENDER_TAG[g]}-${idx + 1}.jpg`;
  }
  return null;
}

/**
 * تصویر محصول.
 *
 * ترتیب اولویت:
 *   ۱) واریانت اختصاصی «خانواده × جنسیت» — متنوع‌ترین
 *   ۲) تصویر برند شاخص
 *   ۳) تصویر خانواده بویایی
 *
 * @param {string} brandEn     نام لاتین برند
 * @param {string} familySlug  شناسه خانواده بویایی
 * @param {string} [productId] برای تخصیص پایدار واریانت
 * @param {string} [gender]    MEN | WOMEN | UNISEX
 */
const genericImageModule = require('./generic-product-images');
const genericImageManifest = genericImageModule.loadAssignments(path.join(SEED_DIR, 'generic_image_assignments_v1.json'));
function imageForProduct(brandEn, familySlug, productId, gender) {
  return variantImageFor(productId, familySlug, gender)
      || BRAND_IMAGES[brandEn]
      || FAMILY_IMAGES[familySlug]
      || genericImageModule.genericFor(productId, genericImageManifest)
      || DEFAULT_IMAGE;
}

// ═══════════════════════════════════════════
// SEED — انتقال از JSON به SQLite (فقط بار اول)
// ═══════════════════════════════════════════
/**
 * درج فهرست محصولات در دیتابیس.
 *
 * چرا از `seedIfEmpty` جداست:
 *   گاهی همین منطق باید روی جدولی که خالی نیست دوباره اجرا شود —
 *   مثلاً وقتی کاتالوگ از منبع به‌روزشده بازنویسی می‌شود.
 *   `scripts/replace_catalog.js` این تابع را صدا می‌زند.
 *
 *   جایگزینش کپی کردن ~۸۰ خط منطق درج در اسکریپت بود — یعنی دو
 *   نسخه که با هم واگرا می‌شوند. هر ستون تازه‌ای که بعداً اضافه
 *   شود باید در دو جا ویرایش شود و یکی حتماً جا می‌ماند.
 *
 * @returns {{p:number, v:number}} شمار محصول و واریانت درج‌شده
 */
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

      // SKU یکتا: شناسه عددی محصول تصادم برندهای هم‌ریشه را حذف می‌کند
      // (مثال: Carolina / Caron / Cartier همگی به CAR نگاشت می‌شدند)
      const pnum = String(p.id).replace(/\D/g, '') || '0';
      for (const v of (p.variants || [])) {
        const parts = String(v.sku || '').split('-');
        const tail = parts.slice(-2).join('-');            // مثلا EDP-050
        const uniqueSku = `YZD-${pnum}-${tail}`;
        insV.run({
          sku: uniqueSku,
          product_id: p.id,
          type: v.type,
          type_label: v.type_label_fa || null,
          volume_ml: v.volume_ml || null,
          price_toman: v.price_toman || 0,
          stock: v.stock == null ? 0 : v.stock,
          /* قیمت دلاری هر گرم اسانس — از منبع داده می‌آید.
             این **بهای اسانس اورجینال** است، نه قیمت فروش. قیمت
             فروش (price_toman) با ضرایب دست‌ساز محاسبه می‌شود.
             این عدد فقط برای فرمول خودکار آینده نگه داشته می‌شود
             و هرگز به مشتری نشان داده نمی‌شود — attachVariants()
             آن را از پاسخ عمومی حذف می‌کند. */
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

// ═══════════════════════════════════════════
// SEED — انتقال از JSON به SQLite (فقط بار اول)
// ═══════════════════════════════════════════
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

  // انتقال مقالات
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

// ═══════════════════════════════════════════
// توابع کمکی — تبدیل ردیف به شیء API
// ═══════════════════════════════════════════
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
    family_fa: row.family_fa,
    family_en: row.family_en,
    family_slug: row.family_slug,
    temperature: row.temperature,
    taste: row.taste,
    notes: {
      top: JSON.parse(row.notes_top || '[]'),
      middle: JSON.parse(row.notes_middle || '[]'),
      base: JSON.parse(row.notes_base || '[]')
    },
    accords: JSON.parse(row.accords || '[]'),
    season: row.season,
    occasion: row.occasion,
    longevity: row.longevity,
    sillage: row.sillage,
    country: row.country,
    market_segment: row.market_segment,
    /* شناسنامه فنی — عطار و سال عرضه.
       این دو از منبع ۲٬۱۱۱ عطر اصیل می‌آیند و در صفحه محصول
       نمایش داده می‌شوند. اطلاعات عمومی و افتخارآمیزند: هیچ
       رازی نیستند و به تخصص فروشگاه اعتبار می‌دهند. */
    perfumer: cleanPerfumer(row.perfumer, row.brand_en, row.brand_fa),
    release_year: row.release_year,
    /* وضعیت تأمین — تعیین می‌کند وقتی موجودی صفر است چه پیامی
       نشان داده شود: «به سفارش ساخته می‌شود» یا «فعلاً نداریم».
       پیش‌فرض محتاطانه است: تا مالک تأیید نکرده، ادعای ساخت
       نمی‌کنیم. */
    supply_mode: row.supply_mode || 'UNAVAILABLE',
    transparency_notice: row.transparency_notice,
    /* یادداشت عطرساز — تجربه دست‌اول، تنها محتوای غیرقابل کپی. */
    maker_note: (options.includeDrafts || row.maker_note_approved === 1) ? (row.maker_note || null) : null,
    maker_note_by: (options.includeDrafts || row.maker_note_approved === 1) ? (row.maker_note_by || null) : null,
    maker_note_approved: options.includeDrafts ? row.maker_note_approved === 1 : undefined,
    image_url: row.image_url
  };
}

/**
 * نام عطرساز را فقط وقتی برمی‌گرداند که واقعاً نام یک شخص باشد.
 *
 * ── چرا لازم شد (ممیزی سئو، شهریور ۱۴۰۵) ──
 * در ۳۸۲ محصول از ۲٬۱۱۱، مقدار ستون `perfumer` دقیقاً برابر نام
 * برند بود: «Roja Dove» برای عطرهای روژا داو، «Lattafa» برای
 * لطافه، «Armaf» برای آرماف.
 *
 * برای چند مورد اتفاقاً درست است (روژا داو واقعاً عطرساز
 * عطرهای خودش است)، ولی در بیشتر موارد صرفاً نامِ برند در
 * ستون عطرساز کپی شده — یعنی داده‌ای که «شناسنامه رایحه اصلی»
 * صدایش می‌کنیم، راستی‌آزمایی‌نشده است.
 *
 * خطرش دوگانه است و از آنچه به نظر می‌رسد بزرگ‌تر: اگر بازدیدکننده‌ای
 * یک مورد را راستی‌آزمایی کند و غلط ببیند، اعتمادش به **کل
 * سایت** می‌شکند — نه فقط آن یک صفحه. برای فروشگاهی که کل
 * هویتش بر شفافیت بنا شده، این گران‌ترین نوع خطاست.
 *
 * تصمیم مالک: حذف شود. سطر «عطرساز» در جعبه شناسنامه برای این
 * موارد اصلاً نمایش داده نمی‌شود — نه «نامشخص»، نه جای خالی.
 *
 * ── چرا در لایه خواندن و نه با UPDATE روی دیتابیس ──
 * داده خام دست‌نخورده می‌ماند. اگر روزی منبع بهتری آمد یا مالک
 * خواست موردی را تأیید کند، اصل داده هنوز هست. پاک کردنِ
 * برگشت‌ناپذیر برای چیزی که فقط «مشکوک» است، زیاده‌روی است.
 */
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
  // Retired variants remain for history/admin, but never appear in public catalog.
  const visibility = options.includeHidden ? '' : `AND ${require('./variant-visibility').publicVariantSql('v')}`;
  product.variants = db.prepare(
    `SELECT sku, type, type_label, volume_ml, price_toman, stock
     FROM variants v WHERE product_id = ? ${visibility} ORDER BY
     CASE type WHEN 'SAMPLE' THEN 0 WHEN 'EDP' THEN 1 ELSE 2 END, volume_ml`
  ).all(product.id);
  const prices = product.variants.map(v => v.price_toman).filter(Boolean);
  product.min_price = prices.length ? Math.min(...prices) : 0;
  return product;
}

/** کوپن‌های نمونه — فقط اگر جدول خالی باشد */
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
      /* ۳۱ خرداد نداریم — ژوئن ۳۰ روز دارد. جاوااسکریپت تاریخ
         نامعتبر را بی‌صدا به ۱ ژوئیه تفسیر می‌کرد، پس کوپن یک
         روز بیشتر از آنچه فکر می‌کردیم زنده می‌ماند. */
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

/* ═══════════════════════════════════════════
   دامنه تخفیف — کوپن و جشنواره از یک منطق استفاده می‌کنند
   ═══════════════════════════════════════════ */

/** «a,b,c» → ['a','b','c'] · خالی و فاصله اضافه حذف می‌شود */
function parseScope(csv) {
  if (!csv) return null;                       // null یعنی «بدون محدودیت»
  const list = String(csv).split(',')
    .map(x => x.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

/**
 * آیا این قلم سبد در دامنه تخفیف هست؟
 *
 * منطق: هر دامنه‌ای که تعریف نشده باشد (null) یعنی «مهم نیست».
 * دامنه‌های تعریف‌شده باید **همه** برقرار باشند (AND).
 * مثال: خانواده=چوبی و نوع=EDP یعنی فقط ادوپرفیوم‌های چوبی.
 *
 * سازگاری با گذشته: کوپنی که هیچ دامنه‌ای ندارد، روی همه اقلام
 * صدق می‌کند — یعنی دقیقاً مثل رفتار قبلی.
 */
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

/** آیا این کوپن/جشنواره اصلاً دامنه محدود دارد؟ */
function hasScope(rule) {
  return !!(rule.scope_families || rule.scope_brands || rule.scope_types
         || rule.scope_products || rule.scope_gender);
}

/**
 * جمع مبلغ اقلامی که در دامنه‌اند.
 * اگر دامنه‌ای تعریف نشده، کل سبد برمی‌گردد.
 */
function scopedSubtotal(items, rule) {
  if (!Array.isArray(items) || !items.length) return null;
  /* مبلغ مؤثر هر قلم = قیمت منهای تخفیف جشنواره‌ای که روی همان
     قلم نشسته. اگر این کسر نشود، کوپن روی قیمت کامل حساب می‌شود
     و مجموع دو تخفیف از آنچه باید بیشتر می‌گردد.
     `_campaign_off` را campaignDiscount() روی اقلام می‌گذارد. */
  const eff = (i) => Math.max(0, i.line_total - (i._campaign_off || 0));
  if (!hasScope(rule)) return items.reduce((s, i) => s + eff(i), 0);
  return items
    .filter(i => itemInScope(i, rule))
    .reduce((s, i) => s + eff(i), 0);
}

/**
 * اعتبارسنجی کوپن
 *
 * @param {string} code
 * @param {number} subtotal   جمع کل سبد (برای شرط حداقل/حداکثر خرید)
 * @param {number} shippingFee
 * @param {string|null} mobile
 * @param {Array|null} items  اقلام سبد — برای دامنه‌سنجی. اگر
 *        فرستاده نشود، کوپن‌های دامنه‌دار رد می‌شوند تا تخفیفی
 *        که نباید داده نشود.
 * @returns {{ok:boolean, error?:string, coupon?:object, discount?:number,
 *            free_shipping?:boolean, scoped_amount?:number}}
 */
function validateCoupon(code, subtotal, shippingFee, mobile, items = null) {
  if (!code) return { ok: false, error: 'کد تخفیف وارد نشده است.' };
  const c = db.prepare('SELECT * FROM coupons WHERE UPPER(code)=UPPER(?)').get(String(code).trim());

  if (!c)            return { ok: false, error: 'کد تخفیف نامعتبر است.' };
  if (!c.active)     return { ok: false, error: 'این کد تخفیف غیرفعال شده است.' };

  // شروع اعتبار — کد جشنواره‌ای که هنوز وقتش نرسیده
  if (c.starts_at) {
    const st = new Date(c.starts_at + 'T00:00:00');
    if (!isNaN(st) && Date.now() < st.getTime())
      return { ok: false, error: 'این کد هنوز فعال نشده است.' };
  }

  if (c.expires_at) {
    const exp = new Date(c.expires_at + 'T23:59:59');
    if (!isNaN(exp) && Date.now() > exp.getTime())
      return { ok: false, error: 'مهلت استفاده از این کد به پایان رسیده است.' };
  }
  if (c.usage_limit != null && c.used_count >= c.usage_limit)
    return { ok: false, error: 'ظرفیت استفاده از این کد تکمیل شده است.' };

  if (subtotal < c.min_subtotal)
    return { ok: false,
      error: `این کد برای خرید بالای ${c.min_subtotal.toLocaleString('en-US')} تومان است.` };

  // سقف خرید — برای کدهایی که فقط روی سبد کوچک معنا دارند
  if (c.max_subtotal && subtotal > c.max_subtotal)
    return { ok: false,
      error: `این کد فقط برای خرید تا ${c.max_subtotal.toLocaleString('en-US')} تومان است.` };

  /* کد اختصاصی یک مشتری.
     اگر مشتری هنوز وارد نشده، رد می‌شود — وگرنه هر کسی که کد را
     حدس بزند می‌تواند استفاده کند. */
  if (c.assigned_mobile) {
    if (!mobile) return { ok: false, error: 'برای استفاده از این کد وارد حساب خود شوید.' };
    if (String(c.assigned_mobile).trim() !== String(mobile).trim())
      return { ok: false, error: 'این کد برای حساب شما صادر نشده است.' };
  }

  if (c.per_user_once && mobile) {
    const used = db.prepare(
      'SELECT COUNT(*) AS n FROM coupon_usage WHERE UPPER(code)=UPPER(?) AND mobile=?'
    ).get(c.code, mobile).n;
    if (used > 0) return { ok: false, error: 'شما قبلاً از این کد استفاده کرده‌اید.' };
  }

  // فقط اولین خرید — سفارش قبلیِ پرداخت‌شده مانع است
  if (c.first_order_only) {
    if (!mobile) return { ok: false, error: 'برای استفاده از این کد وارد حساب خود شوید.' };
    const prev = db.prepare(`
      SELECT COUNT(*) n FROM orders
      WHERE mobile = ? AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')
    `).get(mobile).n;
    if (prev > 0) return { ok: false, error: 'این کد فقط برای اولین خرید است.' };
  }

  /* ── دامنه ──
     اگر کوپن دامنه دارد ولی اقلام سبد در دسترس نیست، رد می‌شود.
     دادن تخفیفِ دامنه‌دار روی کل سبد، ضرر مستقیم مالی است. */
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
    // مبلغ ثابت هم نباید از مبلغ اقلام مشمول بیشتر شود
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

/* ═══════════════════════════════════════════
   جشنواره — تخفیف خودکار بدون کد
   ═══════════════════════════════════════════ */

/** جشنواره‌های فعال و در بازه تاریخ */
/* ── کش کوتاه‌مدت جشنواره‌ها ──
   `/api/products` پربازدیدترین مسیر سایت است و حالا برای نمایش
   قیمت خط‌خورده به فهرست جشنواره‌ها نیاز دارد. جدول کوچک است ولی
   زیر بار همزمان، همان کوئری هزاران بار در ثانیه تکرار می‌شود.

   ۵ ثانیه کش انتخاب شد نه بیشتر: مدیر که جشنواره را روشن می‌کند
   باید تقریباً بی‌درنگ اثرش را ببیند، وگرنه گمان می‌کند کار
   نمی‌کند و دوباره می‌سازد. `bustCampaignCache()` هنگام هر تغییر
   صدا زده می‌شود، پس پنل مدیریت اصلاً تأخیر نمی‌بیند؛ کش فقط
   برای بازدیدکننده است.

   محاسبه سبد و ثبت سفارش هم از همین می‌خوانند — پنج ثانیه اختلاف
   بین «جشنواره تمام شد» و «سبد فهمید» بی‌خطر است چون سرور موقع
   ثبت سفارش دوباره حساب می‌کند و بدترین حالت، تخفیفِ پنج ثانیه
   دیرتر به نفع مشتری است. */
const CAMPAIGN_TTL_MS = 5000;
let _campCache = null, _campAt = 0, _campDay = '';

function bustCampaignCache() { _campCache = null; }

function activeCampaigns() {
  const now = new Date().toISOString().slice(0, 10);
  const t = Date.now();
  // تغییر روز هم کش را باطل می‌کند، وگرنه جشنواره‌ای که دیشب
  // تمام شده تا پنج ثانیه بعدِ نیمه‌شب زنده می‌ماند
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

/**
 * تخفیف جشنواره روی یک قلم.
 *
 * اگر چند جشنواره شامل یک کالا شوند، **بهترین** یکی اعمال
 * می‌شود نه جمعشان — وگرنه دو جشنواره ۳۰٪ می‌شود ۶۰٪ و ضرر
 * ناخواسته می‌دهد.
 *
 * @returns {{percent:number, title:string, amount:number}|null}
 */
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

/**
 * تخفیف جشنواره روی کل سبد.
 * @returns {{total:number, lines:Array}}
 */
function campaignDiscount(items) {
  const camps = activeCampaigns();
  if (!camps.length || !items || !items.length) return { total: 0, lines: [] };

  const lines = [];
  let total = 0;
  for (const it of items) {
    const hit = campaignForItem(it, camps);
    /* مقدار تخفیف روی خودِ قلم ثبت می‌شود تا محاسبه بعدیِ کوپن
       بداند این کالا قبلاً تخفیف خورده. بدون این، کوپن روی قیمت
       کامل حساب می‌شد — با آزمون کشف شد. */
    it._campaign_off = hit ? hit.amount : 0;
    if (hit && hit.amount > 0) {
      total += hit.amount;
      lines.push({ sku: it.sku, title: hit.title, percent: hit.percent, amount: hit.amount });
    }
  }
  return { total, lines };
}

/**
 * درصد جشنواره برای یک محصول — برای نمایش قیمت خط‌خورده روی کارت.
 * سبک است چون فقط روی فیلدهای خود محصول کار می‌کند.
 */
function campaignPercentFor(product, camps) {
  const fake = {
    _family: product.family_slug,
    _brand: product.brand_fa,
    _type: null,                      // کارت محصول نوع مشخصی ندارد
    _product_id: product.id,
    _gender: product.gender
  };
  let best = 0;
  for (const c of camps) {
    // جشنواره‌ای که فقط روی یک نوع واریانت است، روی کارت نشان
    // داده نمی‌شود چون ممکن است همه واریانت‌ها را نگیرد
    if (c.scope_types) continue;
    if (!itemInScope(fake, c)) continue;
    if (c.percent > best) best = c.percent;
  }
  return best;
}

/**
 * درصد جشنواره برای یک واریانت مشخص.
 *
 * فرق با `campaignPercentFor`: آنجا نوع واریانت معلوم نیست (کارت
 * فهرست یک قیمت «از …» نشان می‌دهد)، پس جشنواره‌های نوع‌محور نادیده
 * گرفته می‌شوند. اینجا در صفحه محصول، نوع دقیقاً معلوم است — پس
 * جشنواره «۲۰٪ روی همه سمپل‌ها» هم درست اعمال می‌شود.
 *
 * چرا مهم است: بدون این، مشتری روی صفحه محصول قیمت کامل می‌دید و
 * تخفیف فقط در سبد ظاهر می‌شد. تخفیفی که دیده نشود، خرید نمی‌سازد.
 */
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
    /* سقف تخفیف جشنواره روی درصدِ نمایشی اثر می‌گذارد: اگر
       max_discount کمتر از درصد خام باشد، نمایش ۳۰٪ دروغ است.
       درصد مؤثر همان چیزی است که در سبد اعمال می‌شود. */
    let amount = Math.floor(variant.price_toman * c.percent / 100);
    if (c.max_discount) amount = Math.min(amount, c.max_discount);
    /* 🔴 گرد کردن باید **به پایین** باشد، نه نزدیک‌ترین.
       ─────────────────────────────────────────────────
       درصد نمایشی بعداً در attachCampaign دوباره روی قیمت اعمال
       می‌شود تا final_price ساخته شود. اگر اینجا به بالا گرد شود،
       تخفیف واقعی از سقف جشنواره رد می‌شود:

           قیمت ۵۷۰٬۰۰۰ · سقف ۲۰٬۰۰۰
           درصد خام: 20000/570000 = ۳٫۵۱٪
           با round → ۴٪ → تخفیف ۲۲٬۸۰۰  ← ۲٬۸۰۰ بیشتر از سقف!
           با floor → ۳٪ → تخفیف ۱۷٬۱۰۰  ← داخل سقف ✓

       سقفی که رعایت نشود یعنی ضرر مالی در هر فروش جشنواره‌ای —
       فروشگاه بیش از چیزی که اعلام کرده تخفیف می‌دهد.

       نتیجه: درصد نمایشی ممکن است کمی کمتر از حداکثر ممکن باشد،
       ولی هرگز بیشتر از چیزی که واقعاً می‌دهیم نیست. کم‌فروشی در
       تبلیغ بهتر از بیش‌وعده است. */
    const eff = variant.price_toman > 0
      ? Math.floor(amount / variant.price_toman * 100) : 0;
    if (eff > best) best = eff;
  }
  return best;
}

/**
 * افزودن اطلاعات جشنواره به محصول و همه واریانت‌هایش.
 * روی محصولی که `attachVariants` خورده صدا زده می‌شود.
 */
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
    /* `min_price` همچنان قیمت پیش از تخفیف است تا مرتب‌سازی و
       فیلترها عوض نشوند؛ قیمت نهایی جدا می‌آید. */
    product.min_price_final = cheapestNew || product.min_price;
    product.min_price_before = cheapestOld || product.min_price;
  }
  return product;
}

/**
 * ثبت مصرف کد تخفیف — با رعایت سقف.
 *
 * چرا شرط لازم است؟
 *   validateCoupon هنگام **ثبت سفارش** سقف را می‌سنجد، ولی شمارنده
 *   هنگام **پرداخت** بالا می‌رود. بین این دو فاصله هست: ده نفر
 *   می‌توانند هم‌زمان سفارش بدهند و همه از بررسی رد شوند چون
 *   شمارنده هنوز صفر است.
 *
 *   شرط `used_count < usage_limit` داخل خود UPDATE، اتمی است و
 *   تضمین می‌کند شمارنده هرگز از سقف بالاتر نرود.
 *
 * @returns {{ok: boolean, reason?: string}}
 */
function recordCouponUse(code, mobile, orderId) {
  const upper = String(code).toUpperCase();

  return db.transaction(() => {
    // اگر پیش‌تر برای همین سفارش ثبت شده، دوباره نشمار
    const dup = db.prepare(
      'SELECT 1 FROM coupon_usage WHERE UPPER(code)=? AND order_id=?'
    ).get(upper, orderId);
    if (dup) return { ok: true, reason: 'قبلاً ثبت شده' };

    const c = db.prepare('SELECT * FROM coupons WHERE UPPER(code)=?').get(upper);
    if (!c) return { ok: false, reason: 'کد یافت نشد' };

    // «یک‌بار برای هر کاربر» — بررسی دوباره در لحظه ثبت
    if (c.per_user_once && mobile) {
      const used = db.prepare(
        'SELECT 1 FROM coupon_usage WHERE UPPER(code)=? AND mobile=?'
      ).get(upper, mobile);
      if (used) return { ok: false, reason: 'این کاربر قبلاً استفاده کرده' };
    }

    // افزایش اتمی با رعایت سقف
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

/**
 * آزادسازی رزرو کد تخفیف.
 *
 * ظرفیت هنگام ثبت سفارش رزرو می‌شود. اگر سفارش پرداخت نشود (لغو،
 * انقضا، پرداخت ناموفق) باید ظرفیت برگردد، وگرنه کوپن با سفارش‌های
 * رهاشده هدر می‌رود.
 */
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

/** تنظیمات فروشگاه — برای فاکتور و برچسب پستی */
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
  /* نام تحویل‌گیرنده روی برچسب پستی.
     پست نام شخص می‌خواهد نه نام فروشگاه؛ اگر مرسوله برگشت بخورد
     باید معلوم باشد به دست چه کسی برسد. */
  sender_person:  '',
  /* آیا شماره تماس واتس‌اپ دارد؟ فروشگاهی که تلفن ثابت ندارد،
     موبایلش تنها راه ارتباط است و مشتری باید بداند می‌تواند
     پیام بدهد — نه فقط زنگ بزند. */
  phone_whatsapp: '1',
  invoice_note:   'این فاکتور جهت اطلاع مشتری صادر شده است.',
  /* ── نماد اعتماد الکترونیک ──
     کد رسمی اینماد **دو بخش** دارد و هر دو در نشانی تصویر و لینک
     تکرار می‌شوند:

       https://trustseal.enamad.ir/logo.aspx?id=580961&Code=ZWbX…

     `enamad_id`   شناسه عددی پرونده  (id)
     `enamad_code` کد امنیتی ۳۲ نویسه (Code)

     چرا جدا و نه یک رشته: فوتر باید هر دو را جداگانه در نشانی
     بگذارد. نگه داشتن کل URL در یک فیلد یعنی مدیر می‌تواند هر
     نشانی دلخواهی وارد کند — و آن نشانی مستقیم داخل `src` تصویر
     می‌نشیند. با دو فیلد جدا و اعتبارسنجی الگو، تنها چیزی که از
     پنل می‌آید یک عدد و یک رشته hex است. */
  enamad_id:      '',
  enamad_code:    ''
};

/**
 * تنظیمات واقعی فروشگاه را در دیتابیس تازه می‌نشاند.
 *
 * ── چرا لازم شد (شهریور ۱۴۰۵) ──
 * شماره تماس، نشانی، کد پستی و کد اینماد فقط در جدول
 * `settings` زندگی می‌کردند. `data/yazd.db` در `.gitignore`
 * است — درست هم هست، چون داده زنده مشتری دارد — پس این
 * مقادیر هیچ پشتیبانی نداشتند.
 *
 * وقتی ورک‌اسپیس به سقف حجم خورد و دیتابیس حذف شد، همه‌شان
 * رفتند و پنج آزمون قرمز شد: فاکتور بی‌نشانی، برچسب پستی
 * بی‌فرستنده، فوتر بی‌اینماد.
 *
 * درس: هر داده‌ای که «فقط مالک دارد» و بازتولیدشدنی نیست،
 * باید جایی خارج از دیتابیس هم باشد.
 *
 * ⚠ فقط مقادیر **خالی** پر می‌شوند. اگر مدیر از پنل چیزی را
 * تغییر داده باشد، دست نمی‌خورد — وگرنه هر بار راه‌اندازی،
 * کار او را پاک می‌کردیم.
 */
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
      if (k.startsWith('_')) continue;          // کلیدهای توضیحی
      if (!(k in SHOP_DEFAULTS)) continue;      // فهرست سفید
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

/* ── اعتبارسنجی مقادیری که به HTML راه پیدا می‌کنند ──
   بیشتر تنظیمات فقط متن نمایشی‌اند و پیش از رندر با `esc()` پاک
   می‌شوند. ولی دو فیلد اینماد سرنوشت متفاوتی دارند: مستقیم داخل
   نشانی `src` تصویر و `href` لینک می‌نشینند.

   مقداری مثل `580961" onerror="…` از فیلتر متن رد می‌شود ولی
   نشانی را می‌شکند. پس اینجا فهرست سفید الگو داریم — هر چیزی که
   دقیقاً با الگو نخواند، **کنار گذاشته می‌شود** نه اینکه پاک شود.
   نیم‌بند ذخیره کردن یعنی نشان خراب روی سایت. */
const SETTING_PATTERNS = {
  enamad_id:   /^\d{1,10}$/,          // شناسه پرونده — فقط رقم
  enamad_code: /^[A-Za-z0-9]{8,64}$/  // کد امنیتی — فقط حرف و رقم
};

/**
 * آیا این مقدار برای این کلید پذیرفتنی است؟
 * رشته خالی همیشه پذیرفته می‌شود — یعنی «پاک کن».
 */
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
  /* مدیر باید بداند کدام فیلد ذخیره نشد. سکوت یعنی او فکر کند
     نشان ثبت شده و روزها بعد بفهمد نشده. */
  if (rejected.length) Object.defineProperty(out, '_rejected',
    { value: rejected, enumerable: false });
  return out;
}

/** شماره ترتیبی فاکتور — یکتا و پیوسته */
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

/**
 * ساخت ستون جستجو — همه فیلدهای قابل‌جستجو در یک رشته
 * جستجو به‌جای LIKE روی ۸ ستون، روی یک ستون ایندکس‌شده انجام می‌شود
 */
/**
 * یکسان‌سازی متن فارسی برای جستجو
 * کاربر «کرید» می‌نویسد ولی دیتابیس «کرِید» دارد — اعراب حذف می‌شود.
 * همچنین ی/ک عربی، نیم‌فاصله و ارقام فارسی یکدست می‌شوند.
 */
function normalizeFa(s) {
  return String(s || '')
    .replace(/[\u064B-\u0652\u0670]/g, '')        // فتحه، کسره، ضمه، تشدید، سکون
    .replace(/[\u0623\u0625\u0622]/g, 'ا')        // أ إ آ
    .replace(/\u0649|\u064A/g, 'ی')               // ى ي عربی
    .replace(/\u0643/g, 'ک')                      // ك عربی
    .replace(/\u0629/g, 'ه')                      // ة
    .replace(/[\u200c\u200f\u200e]/g, ' ')        // نیم‌فاصله
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * واژه‌های کمکی که در داده خام نیستند ولی مشتری با آن‌ها جستجو می‌کند.
 *
 * جنسیت در دیتابیس `MEN`/`WOMEN`/`UNISEX` است، پس جستجوی «مردانه»
 * هیچ نتیجه‌ای نمی‌داد. همچنین کلمه «عطر» — طبیعی‌ترین کلمه در یک
 * عطرفروشی — در هیچ ستونی نبود و صفر نتیجه می‌گرفت.
 */
const GENDER_WORDS = {
  MEN:    'مردانه اقایانه مردونه men homme pour homme',
  WOMEN:  'زنانه بانوان خانم زنونه women femme pour femme',
  UNISEX: 'اسپرت مشترک یونیسکس دونفره zwei unisex'
};

/** واژه‌هایی که به هر محصول اضافه می‌شوند تا جستجوی عمومی خالی نماند */
const UNIVERSAL_WORDS = 'عطر ادکلن اسانس رایحه بو خوشبو parfum perfume fragrance';

/**
 * املای قدیمی برندها — مترادف جستجو.
 *
 * وقتی نگارش فارسی یک برند اصلاح می‌شود، مشتری‌ای که املای قبلی را
 * می‌شناسد نباید دست خالی برگردد. این نام‌ها به ایندکس اضافه
 * می‌شوند ولی هیچ‌جا نمایش داده نمی‌شوند.
 *
 * کلید = نام لاتین برند (پایدار)، مقدار = املای قدیمی.
 */
const BRAND_ALIASES = {
  'Amouage':              'آمواژ',
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

function buildSearchIndex(force = false) {
  const pending = db.prepare(
    'SELECT COUNT(*) c FROM products WHERE search_blob IS NULL').get().c;
  if (!pending && !force) return 0;

  const rows = db.prepare(`SELECT id, name_fa, name_en, brand_fa, brand_en,
    family_fa, family_en, notes_top, notes_middle, notes_base, accords,
    season, occasion, concentration, gender, temperature, taste,
    longevity, sillage, country, market_segment, perfumer, release_year
    FROM products`).all();

  const upd = db.prepare('UPDATE products SET search_blob=? WHERE id=?');
  const flat = j => { try { return JSON.parse(j || '[]').join(' '); } catch { return ''; } };

  db.transaction(() => {
    for (const r of rows) {
      const blob = [
        r.name_fa, r.name_en, r.brand_fa, r.brand_en,
        r.family_fa, r.family_en, r.season, r.occasion, r.concentration,
        r.temperature, r.taste, r.longevity, r.sillage,
        r.country, r.market_segment,
        /* عطار و سال عرضه — از منبع ۲٬۱۱۱ عطر اصیل.
           جستجوی «دماشی» یا «۱۹۹۹» باید نتیجه بدهد؛ کاربر حرفه‌ای
           عطر را با نام سازنده‌اش می‌شناسد. سال هم به رشته تبدیل
           می‌شود چون blob متنی است. */
        r.perfumer || '',
        r.release_year ? String(r.release_year) : '',
        GENDER_WORDS[r.gender] || '',
        BRAND_ALIASES[r.brand_en] || '',
        flat(r.notes_top), flat(r.notes_middle), flat(r.notes_base), flat(r.accords),
        UNIVERSAL_WORDS
      ].filter(Boolean).join(' ');
      upd.run(normalizeFa(blob), r.id);
    }
  })();

  appLog('INFO', 'search', `ایندکس جستجو ساخته شد — ${rows.length} محصول`);
  return rows.length;
}

/* ═══════════════════════════════════════════
   ایندکس نُت‌های بویایی
   ═══════════════════════════════════════════
   مسئله: نُت‌ها در ستون‌های JSON (`notes_top` و…) ذخیره شده‌اند و
   فقط از راه `search_blob` قابل جستجوی متنی‌اند. یعنی «عود» هم
   محصولی را می‌آورد که نُت عود دارد، هم محصولی که واژه عود در
   توضیحش آمده — و فیلتر دقیق «فقط عطرهایی با نُت عود» ممکن نیست.

   ۱۸۱ نُت متمایز و ۸۱ آکورد در دیتابیس هست که هیچ‌جا قابل کاوش
   نیست. مشتری عطر با نُت جستجو می‌کند («چیزی با وانیل می‌خواهم»)،
   پس این بزرگ‌ترین داده استفاده‌نشده پروژه بود.

   چرا جدول جدا و نه LIKE روی JSON:
     • `LIKE '%عود%'` روی JSON، «عود هندی» را هم می‌گیرد — که
       گاهی درست است و گاهی نه، ولی هرگز قابل پیش‌بینی نیست
     • با جدول نرمال، شمارش دقیق («۱۲۷ عطر با نُت عود») ممکن است
     • ایندکس روی ستون note سریع‌تر از پویش هزاران رشته JSON است

   `position` نگه داشته می‌شود چون نُت آغازین با نُت پایه فرق
   دارد: کسی که «وانیل» می‌خواهد، معمولاً وانیلِ پایه را می‌خواهد. */
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

/**
 * ساخت ایندکس نُت‌ها از ستون‌های JSON.
 *
 * فقط وقتی جدول خالی است یا `force` داده شود اجرا می‌شود — مثل
 * `buildSearchIndex`. روی کاتالوگ فعلی حدود ۲۲ هزار ردیف می‌سازد.
 */
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

/**
 * فهرست نُت‌ها با شمار محصول.
 *
 * `minCount` جلوی شلوغی را می‌گیرد: نُتی که فقط یک عطر دارد،
 * در فهرست فیلتر بیشتر مزاحم است تا مفید.
 */
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

/** میانگین امتیاز یک محصول (فقط نظرات تأییدشده) */
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

/* ═══════════════════════════════════════════
   دعوت‌نامه نظر — مشتریان فروش حضوری
   ═══════════════════════════════════════════ */

/** مدت اعتبار دعوت‌نامه: ۳۰ روز */
const INVITE_TTL_DAYS = 30;

/**
 * ساخت دعوت‌نامه یکتا.
 *
 * چرا `randomBytes` و نه شمارنده یا تاریخ: لینک دعوت عملاً یک
 * کلید دسترسی است. اگر قابل حدس باشد، هر کسی می‌تواند به‌جای
 * مشتری نظر بنویسد و نشان «تأییدشده» بگیرد — یعنی همان چیزی که
 * قرار بود اعتبار بسازد، تبدیل به ابزار جعل می‌شود.
 *
 * ۱۶ بایت = ۳۲ نویسه hex. حدس زدنش عملاً ناممکن است.
 */
function createReviewInvite(productId, mobile, note, createdBy) {
  const token = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400e3).toISOString();

  const r = db.prepare(`
    INSERT INTO review_invites (token, product_id, mobile, note, created_by, expires_at)
    VALUES (?,?,?,?,?,?)
  `).run(token, productId, mobile, note || null, createdBy || null, expires);

  return { id: r.lastInsertRowid, token, expires_at: expires };
}

/**
 * خواندن دعوت‌نامه معتبر.
 * @returns {{ok:true, invite:object} | {ok:false, error:string}}
 */
function readReviewInvite(token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
    return { ok: false, error: 'لینک دعوت معتبر نیست.' };
  }
  const inv = db.prepare('SELECT * FROM review_invites WHERE token=?').get(token);
  if (!inv) return { ok: false, error: 'این لینک دعوت یافت نشد.' };

  /* ترتیب پیام‌ها مهم است: «قبلاً استفاده شده» اطمینان‌بخش‌تر از
     «منقضی شده» است. مشتری که نظرش را ثبت کرده و دوباره روی لینک
     می‌زند، نباید فکر کند کارش انجام نشده. */
  if (inv.used_at) {
    return { ok: false, error: 'نظر شما با این دعوت‌نامه قبلاً ثبت شده است. سپاسگزاریم.', used: true };
  }
  if (new Date(inv.expires_at) < new Date()) {
    return { ok: false, error: 'مهلت این دعوت‌نامه به پایان رسیده است.' };
  }
  return { ok: true, invite: inv };
}

/**
 * مصرف دعوت‌نامه — اتمی.
 *
 * شرط `used_at IS NULL` داخل خود UPDATE است، نه یک بررسی جدا.
 * بدون آن، دو درخواست همزمان با یک لینک هر دو رد می‌شدند از
 * بررسی و دو نظر ثبت می‌کردند. همان درسی که در کوپن گرفتیم.
 */
function consumeReviewInvite(token, reviewId) {
  const r = db.prepare(`
    UPDATE review_invites SET used_at = CURRENT_TIMESTAMP, review_id = ?
    WHERE token = ? AND used_at IS NULL
  `).run(reviewId, token);
  return r.changes > 0;
}

/** آیا این شماره محصول را خریده؟ (برای نشان «خرید تأییدشده») */
function hasPurchased(mobile, productId) {
  return !!db.prepare(`
    SELECT 1 FROM order_items i
    JOIN orders   o ON o.order_id = i.order_id
    JOIN order_variant_history v ON v.sku = i.sku
    WHERE o.mobile=? AND v.product_id=?
      AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED') LIMIT 1
  `).get(mobile, productId);
}

/* ═══════════════════════════════════════════
   نشست پایدار — در ری‌استارت از بین نمی‌رود
   ═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   کارکنان، نقش‌ها و مجوزها
   ═══════════════════════════════════════════ */
const perms = require('./permissions');

/**
 * هش رمز با scrypt.
 *
 * چرا scrypt و نه SHA؟ SHA برای رمز ساخته نشده — آنقدر سریع است
 * که حمله فرهنگ‌لغت روی GPU میلیون‌ها حدس در ثانیه می‌زند. scrypt
 * عمداً کند و حافظه‌بر است. در Node داخلی است و وابستگی نمی‌خواهد.
 */
function hashPassword(plain, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(plain), s, 64).toString('hex');
  return { hash: h, salt: s };
}

/** مقایسه زمان‌ثابت رمز */
function verifyPassword(plain, hash, salt) {
  if (!hash || !salt) return false;
  const cand = crypto.scryptSync(String(plain), salt, 64);
  const real = Buffer.from(hash, 'hex');
  if (cand.length !== real.length) return false;
  return crypto.timingSafeEqual(cand, real);
}

/** نقش‌های پیش‌فرض را در اولین اجرا می‌سازد */
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

  /* ── مهاجرت مجوزهای تازه ──
     نقش‌ها فقط یک بار ساخته می‌شوند، پس وقتی نسخه بعدی مجوز
     تازه‌ای اضافه می‌کند (مثلاً `reports.traffic`)، مدیر کلِ
     فروشگاهِ در حال کار آن را دریافت نمی‌کرد و بخش تازه برای
     خودش هم ۴۰۳ می‌داد.

     مدیر کل طبق تعریف همه مجوزها را دارد، پس نقش `owner` همیشه
     با فهرست کامل هم‌تراز می‌شود. بقیه نقش‌ها دست نمی‌خورند —
     ممکن است مدیر عمداً محدودشان کرده باشد. */
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

/**
 * حساب مدیر کل را از روی متغیرهای محیطی می‌سازد.
 *
 * سازگاری با گذشته: تا وقتی هیچ کارمندی تعریف نشده، رمز موجود
 * `ADMIN_PASSWORD` همچنان کار می‌کند و صاحب فروشگاه قفل بیرون
 * نمی‌ماند.
 */
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

/** نقش با مجوزهای تجزیه‌شده */
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

/** کارمند با نقش و مجوزهایش */
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

/* ═══════════════════════════════════════════
   حساب مشتری
   ═══════════════════════════════════════════ */

/** مشتری با شماره موبایل (همان نام کاربری) */
function getCustomer(mobile) {
  return db.prepare('SELECT * FROM customers WHERE mobile=?')
    .get(String(mobile || '').trim()) || null;
}

function getCustomerById(id) {
  return db.prepare('SELECT * FROM customers WHERE id=?').get(id) || null;
}

/**
 * ساخت حساب مشتری.
 * نام خانوادگی و ایمیل اختیاری‌اند — سد راه ثبت‌نام نشوند.
 */
function createCustomer({ mobile, first_name, last_name, email, password }) {
  const { hash, salt } = hashPassword(password);
  const info = db.prepare(`
    INSERT INTO customers (mobile, first_name, last_name, email, pass_hash, pass_salt)
    VALUES (?,?,?,?,?,?)
  `).run(String(mobile).trim(), first_name, last_name || null,
         email || null, hash, salt);
  return getCustomerById(info.lastInsertRowid);
}

/** به‌روزرسانی رمز — برای بازیابی یا تغییر دستی */
function setCustomerPassword(id, password) {
  const { hash, salt } = hashPassword(password);
  db.prepare('UPDATE customers SET pass_hash=?, pass_salt=? WHERE id=?')
    .run(hash, salt, id);
}

/**
 * ذخیره نشانی پیش‌فرض پس از هر سفارش موفق.
 * دفعه بعد فرم تسویه خودکار پر می‌شود.
 */
function saveCustomerAddress(mobile, a) {
  const c = getCustomer(mobile);
  if (!c) return;
  db.prepare(`
    UPDATE customers SET province=?, city=?, address=?, postal_code=?
    WHERE id=?
  `).run(a.province || null, a.city || null, a.address || null,
         a.postal_code || null, c.id);
}

/** نمای امن برای ارسال به مرورگر — بدون هش رمز */
/**
 * نسخه امن کارمند برای پاسخ API.
 *
 * ── چرا لازم شد (ممیزی مرداد ۱۴۰۵) ──
 * `getStaff()` با `{...s}` همه ستون‌ها را برمی‌گرداند، شامل
 * `pass_hash` و `pass_salt`. سه مسیر مدیریتی خروجی‌اش را مستقیم
 * در پاسخ JSON می‌گذاشتند:
 *
 *   PUT /api/admin/me/profile
 *   POST /api/admin/staff
 *   PUT /api/admin/staff/:id
 *
 * آزمون واقعی نشان داد هش scrypt و salt در پاسخ برمی‌گشتند.
 *
 * چرا `getStaff` خودش پاک نشد: مسیر ورود (`/api/admin/login`) و
 * تغییر رمز به همان فیلدها نیاز دارند. حذفشان از منبع، احراز
 * هویت را می‌شکست. پس لایه‌ای جدا برای «آنچه به بیرون می‌رود»
 * ساخته شد — همان الگوی `publicCustomer`.
 *
 * فهرست سفید است نه سیاه: ستون تازه‌ای که روزی به جدول اضافه
 * شود، خودبه‌خود بیرون نمی‌رود.
 */
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

/** ثبت در سابقه — «همه‌چیز، حتی مشاهده» */
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
  } catch { /* سابقه هرگز نباید جریان اصلی را بشکند */ }
}

/** پاکسازی سابقه قدیمی — پیش‌فرض ۹۰ روز */
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

/* ═══════════════════════════════════════════
   محدودیت نرخ درخواست
   ═══════════════════════════════════════════ */
/**
 * @param key       شناسه یکتا، مثلا "login:1.2.3.4"
 * @param limit     حداکثر تعداد در پنجره
 * @param windowMs  طول پنجره
 * @param blockMs   مدت مسدودی پس از عبور از حد
 */
function rateLimit(key, limit, windowMs, blockMs = 0) {
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
}

function resetRateLimit(key) {
  db.prepare('DELETE FROM rate_limits WHERE bucket=?').run(key);
}

/* ═══════════════════════════════════════════
   لاگ ماندگار
   ═══════════════════════════════════════════ */
function appLog(level, scope, message, meta) {
  try {
    db.prepare('INSERT INTO app_logs (level, scope, message, meta) VALUES (?,?,?,?)')
      .run(level, scope || null, String(message).slice(0, 1000),
           meta ? JSON.stringify(meta).slice(0, 2000) : null);
  } catch { /* لاگ هرگز نباید جریان اصلی را بشکند */ }
  if (level === 'ERROR') console.error(`[${scope || '-'}] ${message}`);
}

/* ═══════════════════════════════════════════
   نگهداشت دوره‌ای
   ═══════════════════════════════════════════ */
const PENDING_TTL_MIN = parseInt(process.env.PENDING_ORDER_TTL_MIN) || 30;

/** آزادسازی موجودی سفارش‌های پرداخت‌نشده */
function releaseStaleOrders() {
  const cutoff = new Date(Date.now() - PENDING_TTL_MIN * 60 * 1000).toISOString();
  const stale = db.prepare(
    `SELECT order_id FROM orders WHERE status='PENDING' AND created_at < ?`).all(cutoff);
  /* قرارداد بازگشتی همیشه یک شکل دارد: `{ count, skus }`.
     نسخه قبلی در حالت «چیزی نبود» عدد `0` برمی‌گرداند و در حالت
     عادی شیء — پس `res.count` می‌شد `undefined` و پیام پنل
     «undefined سفارش منقضی پردازش شد» نشان می‌داد.

     باگ از قبل بود؛ تفکیک ماژول فقط آشکارش کرد چون آزمون تازه
     مقدار پیام را واقعاً خواند. */
  if (!stale.length) return { count: 0, skus: [] };

  const inc = db.prepare('UPDATE variants SET stock = stock + ? WHERE sku = ?');
  const items = db.prepare('SELECT sku, quantity FROM order_items WHERE order_id=?');
  const upd = db.prepare(`UPDATE orders SET status='EXPIRED', updated_at=? WHERE order_id=?`);
  const log = db.prepare('INSERT INTO order_status_log (order_id, status, note) VALUES (?,?,?)');

  /* SKUهای آزادشده برگردانده می‌شوند تا لایه بالاتر بتواند به
     منتظران «خبرم کن وقتی موجود شد» اطلاع دهد. این ماژول خودش به
     notify دسترسی ندارد (وابستگی حلقوی می‌شد). */
  const freed = new Set();

  db.transaction(() => {
    for (const o of stale) {
      items.all(o.order_id).forEach(i => {
        inc.run(i.quantity, i.sku);
        freed.add(i.sku);
      });
      // ظرفیت کد تخفیف هم برمی‌گردد
      const cu = db.prepare('SELECT code FROM coupon_usage WHERE order_id=?').get(o.order_id);
      if (cu) {
        db.prepare('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE UPPER(code)=UPPER(?)')
          .run(cu.code);
        db.prepare('DELETE FROM coupon_usage WHERE order_id=?').run(o.order_id);
      }
      upd.run(new Date().toISOString(), o.order_id);
      log.run(o.order_id, 'EXPIRED', `پرداخت نشد — موجودی پس از ${PENDING_TTL_MIN} دقیقه آزاد شد`);
    }
  })();

  appLog('INFO', 'cleanup', `${stale.length} سفارش منقضی و موجودی آزاد شد`);
  return { count: stale.length, skus: [...freed] };
}

function purgeExpired() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM rate_limits WHERE window_end < ? AND (blocked_until IS NULL OR blocked_until < ?)')
    .run(now, now);
  db.prepare(`DELETE FROM app_logs WHERE logged_at < datetime('now','-30 days')`).run();
}

/* ═══════════════════════════════════════════
   پشتیبان‌گیری خودکار
   ═══════════════════════════════════════════ */
const BACKUP_DIR   = path.join(path.dirname(DB_PATH), 'backups');
const BACKUP_KEEP  = parseInt(process.env.BACKUP_KEEP) || 7;
const BACKUP_HOURS = parseInt(process.env.BACKUP_INTERVAL_HOURS) || 24;

function runBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 13).replace(/[:T-]/g, '');
    const file = path.join(BACKUP_DIR, `yazd-${stamp}.db`);
    if (fs.existsSync(file)) return null;          // این ساعت گرفته شده

    db.prepare('VACUUM INTO ?').run(file);          // نسخه سازگار

    // نگه‌داشتن فقط N نسخه آخر
    const all = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('yazd-') && f.endsWith('.db')).sort().reverse();
    all.slice(BACKUP_KEEP).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
    });

    appLog('INFO', 'backup', 'پشتیبان خودکار ایجاد شد',
           { file: path.basename(file), size: fs.statSync(file).size, kept: Math.min(all.length, BACKUP_KEEP) });
    return file;
  } catch (e) {
    appLog('ERROR', 'backup', 'پشتیبان‌گیری ناموفق: ' + e.message);
    return null;
  }
}

/* قلاب اطلاع‌رسانی موجودی.
   server.js آن را ثبت می‌کند؛ این ماژول نمی‌تواند مستقیم notify را
   require کند چون وابستگی حلقوی می‌شود (notify → db). */
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

  // پشتیبان اولیه پس از ۳۰ ثانیه، سپس دوره‌ای
  // کدهای منقضی هر ۵ دقیقه پاک می‌شوند تا جدول کوچک بماند
  setInterval(() => { try { otpPurgeExpired(); } catch {} },
              5 * 60 * 1000).unref();

  /* پشتیبان‌گیری خودکار.
     در تولید حیاتی است، ولی هنگام آزمون هر بار که سروری بالا
     می‌آید یک نسخه تازه می‌سازد — با ده‌ها اجرای آزمون در روز،
     پوشه پشتیبان ده‌ها مگابایت می‌شود و جای فایل‌های واقعی را
     می‌گیرد. با BACKUP_DISABLED=1 خاموش می‌شود. */
  if (process.env.BACKUP_DISABLED !== '1') {
    setTimeout(runBackup, 30 * 1000).unref();
    setInterval(runBackup, BACKUP_HOURS * 3600 * 1000).unref();
  }
}

/* ═══════════════════════════════════════════
   کدهای یکبار مصرف — پایدار در دیتابیس
   ═══════════════════════════════════════════
   نگهداری در حافظه ساده بود، ولی هر ری‌استارت (deploy، کرش، مقیاس‌دهی
   Liara) کد کاربری را که همین الان پیامک گرفته بود باطل می‌کرد.
   کاربر پیام را می‌دید و «ابتدا درخواست کد بدهید» می‌گرفت. */
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

initSchema();
// Only a genuinely empty installation may receive the owner's default approval.
const isFreshInstallation = !DB_WAS_EXISTING && db.prepare('SELECT COUNT(*) AS c FROM products').get().c === 0;
// Historical order reporting remains valid after retired SKUs leave the catalog.
require('./variant-history').ensureVariantHistory(db);
// Storage only: rates do not change prices until an explicit, atomic reprice.
require('./essence-pricing-store').migratePricing(db);
seedRoles();
seedOwner();
seedIfEmpty();
// Insert supplemental originals only when absent; preserve owner edits. The
// independent-source supplement has explicit customer-facing provenance.
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
  (seedVerifiedSupplement('secondary_supplement_v15.json') || 0);
// Only approved generic replacements; preserve all manager-selected images.
genericImageModule.applyGenericImages(db, genericImageManifest, path.join(ROOT_DIR, 'public', 'images', 'products'));
// Repair the known year/name mismatch only for unchanged unavailable seed data.
require('./decision-identity-correction').applyDecisionIdentityCorrection(db, path.join(SEED_DIR, 'decision_identity_correction_v1.json'));
// This records reference-original evidence only; it never verifies supplier essence.
for (const file of ['official_identity_evidence_v1.json','official_identity_evidence_v2.json','official_identity_evidence_v3.json','official_identity_evidence_v4.json','official_identity_evidence_v5.json','official_identity_evidence_v6.json','official_identity_evidence_v7.json','official_identity_evidence_v8.json','official_identity_evidence_v9.json','official_identity_evidence_v10.json','official_identity_evidence_v11.json','official_identity_evidence_v12.json','official_identity_evidence_v13.json','official_identity_evidence_v14.json','official_identity_evidence_v15.json','official_identity_evidence_v16.json','official_identity_evidence_v17.json','official_identity_evidence_v18.json','official_identity_evidence_v19.json','official_identity_evidence_v20.json','official_identity_evidence_v21.json','official_identity_evidence_v22.json','official_identity_evidence_v23.json','official_identity_evidence_v24.json','official_identity_evidence_v25.json','official_identity_evidence_v26.json','official_identity_evidence_v27.json','official_identity_evidence_v28.json','official_identity_evidence_v29.json','official_identity_evidence_v30.json','official_identity_evidence_v31.json','official_identity_evidence_v32.json','official_identity_evidence_v33.json','official_identity_evidence_v34.json','official_identity_evidence_v35.json','official_identity_evidence_v36.json','official_identity_evidence_v37.json','official_identity_evidence_v38.json','official_identity_evidence_v39.json','official_identity_evidence_v40.json','official_identity_evidence_v41.json','official_identity_evidence_v42.json'])
  require('./official-identities').seedOfficialIdentities(db, path.join(SEED_DIR, file));
// Exact-name price associations remain explicitly unverified and unavailable;
// only untouched supplement rows receive prices and zero-stock variants.
require('./lv-reference-prices').applyLvReferencePrices(db, path.join(SEED_DIR, 'lv_reference_prices_v1.json'));
// A separate, guarded batch covers four further official-name matches; it only
// updates unchanged unavailable products and records the provisional source.
require('./reference-price-import').applyReferencePrices(db, path.join(SEED_DIR, 'official_reference_prices_v1.json'));
// Restore sourced provisional references for untouched unavailable rows only.
// Operators can defer this batch by setting REFERENCE_PRICE_V2_AUTOMIGRATE=0.
if (process.env.REFERENCE_PRICE_V2_AUTOMIGRATE !== '0')
  require('./reference-price-import').applyReferencePrices(db, path.join(SEED_DIR, 'official_reference_prices_v2.json'));
// Additional official-name matches, guarded against all owner-edited prices.
for (const file of ['official_reference_prices_v3.json','official_reference_prices_v4.json','official_reference_prices_v5.json','official_reference_prices_v6.json','official_reference_prices_v7.json','official_reference_prices_v8.json','official_reference_prices_v9.json','official_reference_prices_v10.json','official_reference_prices_v11.json','official_reference_prices_v12.json','official_reference_prices_v13.json','official_reference_prices_v14.json','official_reference_prices_v15.json','official_reference_prices_v16.json','official_reference_prices_v17.json','official_reference_prices_v18.json','official_reference_prices_v19.json','official_reference_prices_v20.json','official_reference_prices_v21.json','official_reference_prices_v22.json','official_reference_prices_v23.json','official_reference_prices_v24.json','official_reference_prices_v25.json','official_reference_prices_v26.json','official_reference_prices_v27.json','official_reference_prices_v28.json','official_reference_prices_v29.json','official_reference_prices_v30.json','official_reference_prices_v31.json','official_reference_prices_v32.json','official_reference_prices_v33.json','official_reference_prices_v34.json','official_reference_prices_v35.json','official_reference_prices_v36.json'])
  require('./reference-price-import').applyReferencePrices(db, path.join(SEED_DIR, file));
// Independent sources never enter the official evidence table.
for (const file of ['secondary_reference_prices_v1.json','secondary_reference_prices_v2.json','secondary_reference_prices_v3.json','secondary_reference_prices_v4.json','secondary_reference_prices_v5.json','secondary_reference_prices_v6.json','secondary_reference_prices_v7.json','secondary_reference_prices_v8.json','secondary_reference_prices_v9.json','secondary_reference_prices_v10.json','secondary_reference_prices_v11.json','secondary_reference_prices_v12.json','secondary_reference_prices_v13.json','secondary_reference_prices_v14.json','secondary_reference_prices_v15.json','secondary_reference_prices_v16.json'])
  require('./secondary-reference-import').applySecondaryReferences(db, path.join(SEED_DIR, file));
// Correct earlier supplier-derived gender fields only for unchanged, unavailable
// supplement rows. Never switch availability or overwrite a different value.
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
const officialNoteManifests = ['official_note_corrections_v1.json', 'official_note_corrections_v2.json', 'official_note_corrections_v3.json', 'official_note_corrections_v4.json', 'official_note_corrections_v5.json', 'official_note_corrections_v6.json', 'official_note_corrections_v7.json', 'official_note_corrections_v8.json', 'official_note_corrections_v9.json', 'official_note_corrections_v10.json', 'official_note_corrections_v11.json', 'official_note_corrections_v12.json', 'official_note_corrections_v13.json', 'official_note_corrections_v14.json', 'official_note_corrections_v15.json', 'official_note_corrections_v16.json','official_note_corrections_v17.json','official_note_corrections_v18.json','official_note_corrections_v19.json','official_note_corrections_v20.json','official_note_corrections_v21.json','official_note_corrections_v22.json','official_note_corrections_v23.json','official_note_corrections_v24.json','official_note_corrections_v25.json','official_note_corrections_v26.json','official_note_corrections_v27.json','official_note_corrections_v28.json','official_note_corrections_v29.json','official_note_corrections_v30.json','official_note_corrections_v31.json','official_note_corrections_v32.json','official_note_corrections_v33.json','official_note_corrections_v34.json','official_note_corrections_v35.json'];
const officialNotesResults = officialNoteManifests.map(file =>
  require('./official-notes').applyOfficialNotes(db, path.join(SEED_DIR, file)));
const secondaryNotesResults = ['secondary_note_corrections_v1.json','secondary_note_corrections_v2.json','secondary_note_corrections_v3.json'].map(file =>
  require('./secondary-notes').applySecondaryNotes(db, path.join(SEED_DIR, file)));
seedCoupons();
/* تنظیمات واقعی فروشگاه — پس از ساخت جدول‌ها، پیش از سرو شدن
   هر صفحه. فاکتور و برچسب پستی بدون این‌ها ناقص چاپ می‌شوند. */
seedShopSettings();
// Existing installations are never silently migrated: use the guarded approval
// operation after backup. A clean installation can safely apply the fixed scope.
if (isFreshInstallation && process.env.APPROVED_MTO_AUTOSTART !== '0') {
  const approved = require('./approved-made-to-order');
  const result = approved.applyApprovedMadeToOrder(db, path.join(SEED_DIR, 'approved_made_to_order_v1.json'));
  approved.correctApprovedNotices(db, path.join(SEED_DIR, 'approved_made_to_order_v1.json'));
  if (result.skipped.length) console.warn('[DB] approved made-to-order items skipped:', result.skipped.length);
}
// Active-product correction is guarded by original evidence, owner-approved mode,
// unchanged price and exact prior content; it never touches order data.
const activeNotesResults = ['active_official_note_corrections_v1.json','active_official_note_corrections_v2.json','active_official_note_corrections_v3.json'].map(file =>
  require('./active-official-notes').applyActiveOfficialNotes(db, path.join(SEED_DIR, file)));
buildSearchIndex();
// Rebuild note lookup after sourced notes change or new supplement products arrive.
buildNotesIndex(activeNotesResults.some(r => r.updated > 0) || supplementInserted > 0 || secondaryNotesResults.some(r => r.updated > 0) || officialNotesResults.some(r => r.updated > 0));

startMaintenance();

/* ══════════════════════════════════════════════════════════
   آمار زنده فروشگاه — منبع واحد حقیقت
   ══════════════════════════════════════════════════════════
   🔴 چرا این تابع لازم شد:
   اعداد کاتالوگ در ده جای مختلف **سخت‌کد** شده بودند: عنوان
   صفحه اصلی، توضیح متا، صفحه سمپل، جدول مقایسه، کوییز. با هر
   تغییر کاتالوگ باید ده جا دستی عوض می‌شد و همیشه یکی جا
   می‌ماند — دقیقاً همان ۹ موردی که مالک در پیش‌نما دید.

   حالا هر عددی که به کاتالوگ وابسته است **فقط از اینجا**
   می‌آید. اضافه شدن یک محصول یعنی همه صفحات خودکار به‌روز
   می‌شوند.

   کش ۶۰ ثانیه‌ای: این پرسمان‌ها روی صفحه اصلی اجرا می‌شوند و
   بدون کش هر بازدید چند GROUP BY می‌زند. یک دقیقه تأخیر در
   نمایش آمار هیچ ضرری ندارد. */
let _statsCache = null, _statsAt = 0;
const STATS_TTL = 60_000;

function storeStats(force = false) {
  const now = Date.now();
  if (!force && _statsCache && now - _statsAt < STATS_TTL) return _statsCache;

  const one = sql => { try { return db.prepare(sql).get().c; } catch { return 0; } };

  /* «قابل خرید» یعنی چیزی که مشتری همین حالا می‌تواند سفارش دهد:
     یا موجودی انبار دارد، یا به سفارش ساخته می‌شود. عطر
     UNAVAILABLE در این شمار نمی‌آید چون بن‌بست است. */
  const stats = {
    products:     one('SELECT COUNT(*) c FROM products'),
    brands:       one('SELECT COUNT(DISTINCT brand_en) c FROM products'),
    variants:     one('SELECT COUNT(*) c FROM variants'),

    in_stock:     one(`SELECT COUNT(DISTINCT product_id) c FROM variants WHERE stock > 0`),
    made_to_order: one(`SELECT COUNT(*) c FROM products
                        WHERE supply_mode = 'MADE_TO_ORDER'`),
    orderable:    one(`SELECT COUNT(*) c FROM products p
                       WHERE p.supply_mode != 'UNAVAILABLE'`),

    // ── عمق تخصصی: اعدادی که انتظار خرید نمی‌سازند ──
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

/** پس از تغییر کاتالوگ یا موجودی صدا زده شود */
function bustStatsCache() { _statsCache = null; }

module.exports = {
  db, parseProduct, attachVariants, DB_PATH,
  storeStats, bustStatsCache,
  imageForFamily, imageForProduct, variantImageFor,
  validateCoupon, recordCouponUse, releaseCouponUse, logStatus,
  // دامنه تخفیف و جشنواره
  activeCampaigns, campaignDiscount, campaignPercentFor, itemInScope, parseScope,
  variantCampaignPercent, attachCampaign, bustCampaignCache,
  createSession, readSession, destroySession,
  rateLimit, resetRateLimit,
  appLog, releaseStaleOrders, setStockFreedHandler, PENDING_TTL_MIN,
  runBackup, BACKUP_DIR,
  reviewSummary, hasPurchased,
  createReviewInvite, readReviewInvite, consumeReviewInvite, INVITE_TTL_DAYS,
  getSettings, saveSettings, isValidSetting, nextInvoiceNo,
  buildSearchIndex, buildNotesIndex, listNotes, normalizeFa,
  insertProducts,
  otpGet, otpSave, otpBumpAttempts, otpDelete, otpPurgeExpired,
  hashPassword, verifyPassword,
  getCustomer, getCustomerById, createCustomer,
  setCustomerPassword, saveCustomerAddress, publicCustomer, publicStaff,
  seedRoles, seedOwner, getRole, listRoles,
  getStaff, getStaffByUsername, listStaff,
  audit, purgeAudit
};
