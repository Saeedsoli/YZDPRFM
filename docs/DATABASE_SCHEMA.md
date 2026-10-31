# شمای دیتابیس — عطر یزد

SQLite با حالت WAL · جدول‌ها، ایندکس‌ها و مهاجرت‌های نسخه‌بندی‌شده

مسیر: `data/yazd.db` (روی لیارا: `/app/data/yazd.db`)

> **این سند زنده است.** هر تغییری در جدول‌ها باید همین‌جا بازتاب یابد.
> `node scripts/audit_docs_truth.js` عددها را خودکار می‌سنجد.

---

## نمودار ارتباط

```
products ──1:N──▶ variants ──┐
   │                          │
   │                          ├──▶ order_items ──N:1──▶ orders
   │                          │                            │
   │                          └──▶ stock_alerts            ├──▶ order_status_log
   │                                                       │
   ├──▶ product_notes                                      └──▶ coupon_usage ──▶ coupons
   ├──▶ reviews ◀──── review_invites
   └──▶ wishlist

customers ──1:1──▶ taste_profile (ستون، نه جدول)
roles ──1:N──▶ staff ──1:N──▶ audit_log

مستقل: articles · sessions · rate_limits · app_logs · settings ·
        tickets · otp_codes · events · trending · campaigns · notices
```

---

## کاتالوگ

### `products` — محصولات

| ستون | نوع | توضیح |
|---|---|---|
| `id` | TEXT PK | `YZD-PROD-0029` |
| `slug` | TEXT UNIQUE | `creed-aventus` |
| `name_fa` | TEXT | «اونتوس» — بدون نام برند |
| `name_en` | TEXT | `CREED - Aventus` |
| `brand_fa` `brand_en` | TEXT | نام خانه عطر |
| `gender` | TEXT | `MEN` `WOMEN` `UNISEX` |
| `concentration` | TEXT | `EDP` `EDT` … |
| `family_fa` `family_en` `family_slug` | TEXT | خانواده بویایی |
| `temperature` `taste` | TEXT | طبع و مزه |
| `notes_top` `notes_middle` `notes_base` | TEXT | آرایه JSON |
| `accords` | TEXT | آرایه JSON |
| `season` `occasion` | TEXT | فصل و مناسبت |
| `longevity` `sillage` | TEXT | ماندگاری و پخش |
| `country` `market_segment` | TEXT | — |
| `transparency_notice` | TEXT | متن شفافیت |
| `image_url` | TEXT | مسیر تصویر |
| `search_blob` | TEXT | **ستون جستجو** |
| `supply_mode` | TEXT | `UNAVAILABLE`، `IN_STOCK` یا `MADE_TO_ORDER` |
| `essence_usd_per_kg` | TEXT / NULL | قیمت مبنای اسانس به دلار بر کیلوگرم؛ NULL یعنی ثبت‌نشده |
| `maker_note` / `maker_note_by` | TEXT / NULL | متن و امضای یادداشت سازنده |
| `maker_note_approved` | INTEGER | فقط مقدار ۱ اجازه نمایش عمومی یادداشت را می‌دهد |

**ایندکس:** `slug` `family_slug` `gender` `brand_fa` `search_blob`

`search_blob` همه فیلدهای قابل‌جستجو را یکجا و یکسان‌سازی‌شده
نگه می‌دارد — اعراب حذف، ی/ک عربی تبدیل. جستجو به‌جای هشت `LIKE`
روی یک ستون ایندکس‌شده اجرا می‌شود.

نُت‌ها به‌صورت آرایه‌های JSON در محصول نگهداری می‌شوند؛ برای فیلتر و
جستجوی جداگانه، جدول `product_notes` نیز از آن‌ها شاخص‌سازی می‌شود.

### `variants` — واریانت‌های فعال و قدیمیِ مخفی

| ستون | نوع | توضیح |
|---|---|---|
| `sku` | TEXT PK | `YZD-0029-EDP-050` |
| `product_id` | TEXT FK | → `products.id` |
| `type` | TEXT | `SAMPLE` `EDP` `HAIR_MIST` `BODY_SPLASH` |
| `type_label` | TEXT | برچسب فارسی |
| `volume_ml` | INTEGER | حجم |
| `price_toman` | INTEGER | **منبع یکتای قیمت** |
| `stock` | INTEGER | موجودی |
| `price_usd` | REAL / NULL | داده قدیمی هر واریانت؛ مبنای قیمت‌گذاری جدید نیست |

**فرمول SKU:** `YZD-{شماره محصول}-{نوع}-{حجم}`

نسخه اول سه حرف اول برند را می‌گرفت، پس Carolina و Caron و
Cartier همه `CAR` می‌شدند — ۱٬۲۶۷ تصادم. قید `UNIQUE` این را
هنگام مهاجرت آشکار کرد.

### `variant_archive` و نمای `order_variant_history`

واریانت‌های ۳ میل مرتبط با سفارش یا موجودی تاریخی از جدول فروش خارج و در
`variant_archive` بایگانی می‌شوند. نمای `order_variant_history` شناسه‌های فعال و
بایگانی‌شده را برای گزارش‌های تاریخی یکپارچه می‌کند. این نما قابل سفارش نیست.

---

## سفارش

### `orders`

| ستون | نوع | توضیح |
|---|---|---|
| `order_id` | TEXT PK | `YZD-MS0F...` (base36 از زمان) |
| `created_at` `updated_at` | TEXT | ISO 8601 |
| `customer_name` `mobile` | TEXT NOT NULL | — |
| `province` `city` `address` `postal_code` | TEXT | نشانی |
| `subtotal` `shipping_fee` `total_paid` | INTEGER | مبالغ |
| `discount_code` `discount_amount` | — | تخفیف |
| `payment_gateway` `payment_ref` | TEXT | درگاه |
| `status` | TEXT | چرخه وضعیت |
| `tracking_code` `carrier` | TEXT | رهگیری |
| `admin_note` | TEXT | یادداشت داخلی |

**چرخه وضعیت:**
```
PENDING ──▶ PAID ──▶ PROCESSING ──▶ SHIPPED ──▶ DELIVERED
   │          │           │             │            │
   │          └───────────┴─────────────┘            │
   ▼                      ▼                          ▼
EXPIRED               CANCELLED                  RETURNED
```

`EXPIRED` خودکار است: سفارش پرداخت‌نشده پس از ۳۰ دقیقه.
`CANCELLED` `RETURNED` `EXPIRED` موجودی را برمی‌گردانند.

### `order_items`

قیمت **لحظه خرید** ذخیره می‌شود (`unit_price`). تغییر بعدی
قیمت محصول، فاکتور قدیمی را دستکاری نمی‌کند.

### `order_status_log`

هر تغییر وضعیت با یادداشت و زمان.

---

## تخفیف

### `coupons` — ۴ نمونه

| ستون | توضیح |
|---|---|
| `code` PK | حروف بزرگ |
| `type` | `PERCENT` `FIXED` `FREE_SHIPPING` |
| `value` | درصد یا مبلغ |
| `min_subtotal` | حداقل خرید |
| `max_discount` | سقف تخفیف درصدی |
| `usage_limit` `used_count` | ظرفیت |
| `per_user_once` | یک‌بار برای هر شماره |
| `expires_at` `active` | — |

### `coupon_usage`

ثبت مصرف به تفکیک شماره — پایه قانون «یک‌بار برای هر مشتری».

---

## مشتری

### `reviews`

| ستون | توضیح |
|---|---|
| `product_id` `mobile` | UNIQUE ترکیبی — یک نظر برای هر محصول |
| `rating` | ۱ تا ۵ |
| `longevity` `sillage` | امتیاز جداگانه |
| `verified` | خرید تأییدشده |
| `status` | `PENDING` `APPROVED` `REJECTED` |
| `admin_reply` | پاسخ فروشگاه |

فقط `APPROVED` عمومی است.

### `wishlist` · `stock_alerts`

هر دو `UNIQUE` ترکیبی دارند تا ثبت تکراری ممکن نباشد.
`stock_alerts.notified` جلوی پیامک دوباره را می‌گیرد.

### `tickets`

مرجوعی با `volume_ml`، `used_under_2ml` و `sla_deadline` (۲۴ ساعت).

### `customers` — حساب کاربری

نام کاربری **شماره موبایل** است. رمز با `pass_hash` و `pass_salt`
ذخیره می‌شود — هرگز متن ساده.

| ستون | نقش |
|---|---|
| `mobile` | یکتا — همان نام کاربری |
| `first_name` `last_name` | نام؛ فقط اولی الزامی است |
| `pass_hash` `pass_salt` | رمز؛ در پاسخ API هرگز برنمی‌گردند |
| `province` `city` `address` `postal_code` | نشانی پیش‌فرض تسویه |
| `taste_profile` | پاسخ‌های کوییز به صورت JSON |
| `taste_updated_at` | آخرین به‌روزرسانی سلیقه |

> رکورد مشتری **فقط هنگام نیاز واقعی** ساخته می‌شود. خواندن یا حذف
> پروفایل بویایی ردیف تازه نمی‌سازد — یافته ۴ ممیزی مرداد.

### `review_invites` — دعوت‌نامه مشتری حضوری

فروشگاه دوازده سال فروش حضوری دارد؛ این جدول تنها راهی است که آن
مشتری‌ها بتوانند نظر ثبت کنند بدون سفارش آنلاین.

| ستون | نقش |
|---|---|
| `token` | ۳۲ نویسه hex از `crypto.randomBytes(16)` |
| `product_id` `mobile` | محصول و مشتری دعوت‌شده |
| `expires_at` | مهلت ۳۰ روزه |
| `used_at` | **یک‌بارمصرف** — پس از ثبت نظر پر می‌شود |
| `review_id` | ردِ اینکه آن نظر از کجا آمده |

دو قاعده: توکن باید حدس‌ناپذیر باشد (وگرنه هر کسی نظر «تأییدشده»
می‌سازد) و دعوت استفاده‌شده **حذف نمی‌شود** (وگرنه ردش گم می‌شود).

---

## کاوش و سلیقه

### `product_notes` — ۲۲٬۳۷۲ ردیف

نُت‌های بویایی هر محصول. کلید اصلی ترکیبی است:
`(product_id, note_key, position)`.

| ستون | نقش |
|---|---|
| `note` | متن نمایشی — «وانیل» |
| `note_key` | صورت یکسان‌شده برای جستجو |
| `position` | `top` · `middle` · `base` · `accord` |

چرا جدول جدا و نه ستون متنی: فیلتر «چیزی با وانیل **و** عود» با
`EXISTS` جداگانه برای هر نُت انجام می‌شود. با ستون متنی فقط
جستجوی مبهم ممکن بود.

### `trending` — ۴ ردیف

ویترین خودکار صفحه اصلی. هر ردیف یک بخش است و `payload` فهرست
آماده را به صورت JSON نگه می‌دارد.

| `slot` | بخش |
|---|---|
| `bestsellers` | پرفروش‌ترین |
| `most_wanted` | محبوب‌ترین |
| `trending` | پربازدیدترین هفته |
| `seasonal` | ویترین فصلی |

هر ساعت تازه می‌شود، پس صفحه اصلی هیچ محاسبه سنگینی ندارد.

### `events` — ۱۷٬۴۲۲ ردیف

رویدادهای رفتاری: بازدید، جستجو، افزودن به سبد، کوییز.
مبنای جدول `trending`. پس از ۱۸۰ روز خودکار پاک می‌شود.

---

## بازاریابی

### `campaigns` — جشنواره تخفیف

| ستون | نقش |
|---|---|
| `percent` `max_discount` | درصد و سقف تومانی |
| `scope_families` `scope_brands` `scope_types` `scope_products` `scope_gender` | دامنه شمول؛ خالی یعنی همه |
| `starts_at` `ends_at` `active` | بازه و کلید روشن/خاموش |

با کش ۵ ثانیه‌ای خوانده می‌شود؛ `bustCampaignCache()` پس از هر
ویرایش بی‌درنگ باطلش می‌کند.

### `notices` — نوار اعلان

تک‌پیامی و بدون چرخش. `tone` ظاهر را تعیین می‌کند و
`starts_at`/`ends_at` باعث می‌شوند پیام منقضی خودبه‌خود محو شود.

---

## کارکنان و دسترسی

### `roles` — ۵ نقش

| ستون | نقش |
|---|---|
| `key` | شناسه — `owner` · `manager` … |
| `permissions` | فهرست مجوز به صورت JSON (۳۴ مجوز) |
| `builtin` `locked` | نقش‌های پایه حذف نمی‌شوند |

### `staff` — کارمندان

| ستون | نقش |
|---|---|
| `username` | یکتا |
| `display_name` | نامی که در پنل دیده می‌شود |
| `role_key` | ارجاع به `roles` |
| `pass_hash` `pass_salt` | رمز |
| `must_change` | ورود اول رمز را اجباری عوض می‌کند |
| `national_id` | برای کارت دسترسی |

### `audit_log` — ۱۲٬۸۸۰ ردیف

هر کار مدیریتی ثبت می‌شود — **حتی تلاش‌های ناموفق** (`allowed=0`).

| ستون | نقش |
|---|---|
| `action` | نام کار — `orders.status` |
| `target` `detail` | چه چیزی و چه تغییری |
| `allowed` | ۰ یعنی دسترسی رد شد |
| `ip` `at` | نشانی و زمان |

پس از ۹۰ روز خودکار پاک می‌شود (`purgeAudit()`).

---

## زیرساخت

### `sessions`

| ستون | توضیح |
|---|---|
| `token` PK | ۴۸ کاراکتر hex |
| `kind` | `ADMIN` یا `CUSTOMER` |
| `subject` | شماره موبایل مشتری |
| `expires_at` | زمان یونیکس |

**در دیتابیس، نه حافظه** — با ری‌استارت Liara کاربران خارج نمی‌شوند.

### `rate_limits`

پنجره لغزان با `bucket` مثل `login:1.2.3.4`.

### `app_logs`

سه سطح `ERROR` `WARN` `INFO`. نگهداشت ۳۰ روز.
خطای ورودی کاربر (کد ۴۰۰) اینجا ثبت نمی‌شود.

### `settings`

کلید-مقدار برای تنظیمات فروشگاه، `invoice_seq`، `invoice_no:{order_id}` و
`essence_usd_rate_toman` (نرخ دلار به تومان).

### `supplier_price_evidence`

سابقه ورود شش مرجع قیمت لویی ویتون: شناسه محصول، هش فایل قیمت، نشانی رسمی،
قیمت دلاری هر کیلو، کیفیت و وضعیت تطبیق. وضعیت `name_matched_supplier_identity_unverified`
یعنی هم‌نامی با محصول رسمی بررسی شده، اما هویت واقعی اسانس تأمین‌کننده تأیید نشده است.
این سابقه، تاریخچه ورود است و تغییر بعدی قیمت توسط مدیر را به‌تنهایی تأیید نمی‌کند.

### `otp_codes` — کد یکبارمصرف

| ستون | نوع | توضیح |
|---|---|---|
| `mobile` | TEXT PK | شماره نرمال‌شده (`09xxxxxxxxx`) |
| `code` | TEXT | کد ۵ رقمی |
| `expires_at` | INTEGER | زمان انقضا (میلی‌ثانیه) — ۲ دقیقه |
| `last_sent` | INTEGER | برای فاصله ۶۰ ثانیه‌ای ارسال مجدد |
| `attempts` | INTEGER | شمار تلاش نادرست؛ سقف ۵ |

ایندکس: `idx_otp_exp` روی `expires_at`

**چرا در دیتابیس و نه حافظه؟** روی لیارا راه‌اندازی دوباره عادی
است. کد درون حافظه با هر استقرار از بین می‌رفت و کاربری که همین
الان پیامک گرفته بود پیام «ابتدا درخواست کد بدهید» می‌دید.

رکوردهای منقضی هر ۵ دقیقه پاک می‌شوند، پس جدول کوچک می‌ماند.

### `articles` — ۵ مقاله

`slug` فارسی خوانا. هنگام ویرایش عنوان، slug عمداً حفظ می‌شود
تا لینک‌های ایندکس‌شده نشکنند.

---

## مهاجرت

`initSchema()` در هر اجرا اجرا می‌شود:

1. `CREATE TABLE IF NOT EXISTS` برای همه جدول‌ها
2. `PRAGMA table_info` برای بررسی ستون‌های جدید
3. `ALTER TABLE ADD COLUMN` امن
4. `CREATE INDEX IF NOT EXISTS`

افزودن ستون نیازی به اسکریپت دستی ندارد.

**بار اول:** محصولات از `perfumes_catalogue_seed.json` و داده تکمیلی منتقل،
عبارت `(Inspired by ...)` حذف، تصویر تخصیص، SKU بازسازی،
`search_blob` ساخته می‌شود. حدود ۱۵ ثانیه.

---

## تنظیمات

```js
journal_mode = WAL      // خواندن همزمان با نوشتن
foreign_keys = ON       // یکپارچگی ارجاعی
busy_timeout = 5000     // صبر ۵ ثانیه به‌جای خطا
```

---

## پشتیبان

`VACUUM INTO` هر ۲۴ ساعت در `data/backups/` — نسخه سازگار
حتی حین نوشتن. ۷ نسخه آخر نگه داشته می‌شود.

```bash
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=7
```

---

## نمونه کوئری

```sql
-- جستجو
SELECT * FROM products WHERE search_blob LIKE '%کرید%' LIMIT 24;

-- کالای رو به اتمام
SELECT v.sku, p.name_fa, v.stock
FROM variants v JOIN products p ON p.id = v.product_id
WHERE v.stock <= 10 ORDER BY v.stock;

-- فروش ۳۰ روز
SELECT date(created_at) d, COUNT(*) n, SUM(total_paid) rev
FROM orders
WHERE status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')
  AND created_at >= datetime('now','-30 days')
GROUP BY d ORDER BY d;

-- سفارش رهاشده
SELECT order_id FROM orders
WHERE status='PENDING' AND created_at < datetime('now','-30 minutes');
```
