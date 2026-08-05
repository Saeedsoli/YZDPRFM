# فهرست فایل‌های پروژه

نقشه کامل ورک‌اسپیس — برای اینکه پیدا کردن فایل‌ها لابه‌لای
پیام‌ها لازم نباشد.

> **این سند زنده است** و باید همیشه وضعیت امروز را نشان دهد.
> `node scripts/audit_docs.js` بررسی می‌کند هیچ فایلی از قلم نیفتاده
> باشد و هیچ نامی به فایل حذف‌شده اشاره نکند.

---

## اجرای سریع

```bash
npm install                    # پس از هر بازیابی محیط
node src/server.js             # اجرای سرور روی :3000
bash scripts/smoke_test.sh     # ۹۲ آزمون خودکار
```

---

## کد سرور — `src/`

| فایل | کار |
|---|---|
| `server.js` | سرور اصلی، ۸۰+ مسیر API |
| `db.js` | لایه SQLite، جدول‌ها، seed، نقش‌ها، تصاویر |
| `analytics.js` | تحلیل داخلی، قیف خرید، ویترین خودکار و فصلی |
| `taste.js` | **پروفایل بویایی** — امتیازدهی کوییز و پیشنهاد شخصی |
| `permissions.js` | ۳۴ مجوز، ۵ نقش پیش‌فرض |
| `payment.js` | درگاه پرداخت (سندباکس / زرین‌پال) |
| `otp.js` | کد یکبارمصرف ورود مشتری |
| `sms.js` | **لایه پیامک** — مستقل از ارائه‌دهنده (پیامیتو و هر سامانه دیگر) |
| `routes/articles.js` | مسیرهای مجله (جداشده از server.js) |
| `routes/tickets.js` | مسیرهای تیکت مرجوعی |
| `routes/rbac.js` | نقش‌ها، کارکنان، دسترسی |
| `routes/admin-catalog.js` | **گام ۱** — قیمت، موجودی، لاگ، نگهداشت، ایندکس |
| `routes/admin-orders.js` | **گام ۲** — فهرست، وضعیت، تاریخچه، فاکتور، CSV |
| `routes/admin-marketing.js` | **گام ۳** — کوپن، جشنواره، نوار اعلان |
| `routes/admin-system.js` | **گام ۴** — پشتیبان، سابقه، آمادگی، گزارش، تحلیل |
| `routes/admin-reviews.js` | **گام ۵** — تأیید نظر، پاسخ، دعوت‌نامه حضوری |
| `routes/auth.js` | **گام ۶** — ثبت‌نام، ورود، بازیابی رمز، کد یکبارمصرف |
| `routes/catalog.js` | **گام ۷** — محصولات، جستجو، ویترین، نُت، کوییز، سلیقه |
| `routes/engagement.js` | **گام ۸** — رویداد، علاقه‌مندی، نظر، دعوت، هشدار، پیگیری |
| `notify.js` | قالب پیام‌های سفارش · ارسال را به `sms.js` می‌سپارد |
| `alerts.js` | **اطلاع‌رسانی داخلی** — خبر سفارش و تیکت به کارکنان |
| `seo.js` | متادیتا و داده ساختاریافته سمت سرور |
| `reports.js` | گزارش‌های فروش |
| `essences.js` | داده خانه‌های اسانس |

---

## صفحات — `public/`

۲۷ صفحه HTML. مهم‌ترین‌ها:

| فایل | صفحه |
|---|---|
| `index.html` | خانه + کاتالوگ + ویترین خودکار |
| `product.html` | صفحه محصول |
| `cart.html` · `checkout.html` | سبد و تسویه |
| `admin.html` | پنل مدیریت (همه تب‌ها) |
| `account.html` · `wishlist.html` · `track.html` | حساب مشتری |
| `journal.html` · `article.html` | مجله |
| `quiz.html` | کوییز پیشنهاد رایحه |
| `brands.html` · `essences.html` | برندها و اسانس‌ها |
| `why-us.html` | **چرا عطر یزد؟** — ایمنی مواد، تخصص، مقایسه با بازار |
| `samples.html` | **سمپل ۳ میل** — فیلتر خانواده و جنسیت، راهنمای امتحان |
| `contact.html` | تماس و مرجوعی |
| `login.html` | ورود · ثبت‌نام · بازیابی رمز |
| `terms.html` · `privacy.html` | قوانین و حریم خصوصی |
| `invoice.html` · `label.html` | فاکتور و برچسب پستی |
| `payment-result.html` · `payment-sandbox.html` | نتیجه پرداخت و درگاه آزمایشی |
| `check.html` | تشخیص اصالت |
| `review-invite.html` | **دعوت‌نامه نظر** — مشتری فروش حضوری، لینک یکتا |
| `404.html` | صفحه یافت‌نشد |
| `offline.html` | صفحه آفلاین — سرویس‌ورکر وقتی شبکه نیست نشان می‌دهد |

**دارایی‌ها:**

- `public/assets/app.js` — منطق مشترک، سبد، تحلیل، فوتر
- `public/assets/theme.css` — سیستم بصری کامل
- `public/assets/code128.js` — بارکد واقعی
- `public/fonts/*.woff2` — وزیرمتن، ۵ وزن زیرمجموعه‌شده
- `public/images/products/` — **۳۱ تصویر محصول** (هر کدام ۴ فایل:
  JPG، WebP، و نسخه‌های کوچک ۴۲۰px برای کارت فهرست)
- `public/favicon.ico` · `favicon-16.png` · `favicon-32.png` —
  آیکن تب مرورگر (نقش برند روی زمینه ابسیدین)
- `public/apple-touch-icon.png` · `icon-192.png` · `icon-512.png` —
  آیکن نصب روی iOS و اندروید
- `public/site.webmanifest` — فراداده «افزودن به صفحه اصلی»

---

## اسکریپت‌ها — `scripts/`

### آزمون‌ها

| فایل | بررسی |
|---|---|
| `smoke_test.sh` | **۱۰۰ بررسی — همه را اجرا می‌کند** |
| `test_images.js` | ۱۳ تصاویر محصول |
| `test_dynamics.js` | ۲۸ ویترین فصلی و «اخیراً دیدید» |
| `test_taste.js` | ۵۵ پروفایل بویایی — پاک‌سازی ورودی، ذخیره، API |
| `test_notes_filter.js` | ۳۴ فیلتر نُت بویایی — ایندکس، بن‌بست، تزریق |
| `test_access_card.js` | ۳۵ کارت دسترسی کارمند و بازسازی ایندکس |
| `test_admin_catalog.js` | ۲۸ گام ۱ تفکیک — اجرای واقعی هر شش مسیر |
| `test_admin_orders.js` | ۳۳ گام ۲ — اثر مالی، داده شخصی، مرز دسترسی |
| `test_admin_marketing.js` | ۳۳ گام ۳ — اعتبارسنجی تخفیف و باطل‌سازی کش |
| `test_catalog.js` | ۱۰۳ گام ۷ — پرترافیک‌ترین ماژول: فیلتر، مرتب‌سازی، جستجوی شل |
| `test_engagement.js` | ۹۲ گام ۸ — مرز داده شخصی، توکن یک‌بارمصرف، سه محدودیت نرخ |
| `test_enamad.js` | ۵۷ نشان اعتماد — اعتبارسنجی، CSP، سه لایه محافظ |
| `test_sms_panel.js` | ۲۶ تفسیر پاسخ سرویس پیامک — ۲۰ کد خطا، تله HTTP 200 |
| `test_alerts.js` | ۳۹ اطلاع‌رسانی داخلی — مجوز، ساعت آرام، ضد سیل |
| `test_enamad_browser.py` | ۲۲ نشان در مرورگر واقعی — DOM، CLS، حالت قطعی |
| `test_pwa.js` | ۵۳ پیکربندی PWA — manifest، آیکن، هدر سرویس‌ورکر |
| `test_brand_names.js` | ۱۱ نگارش فارسی برندها |
| `test_notifications.js` | ۱۶ اعلان‌های پنل |
| `test_profile.js` | ۲۱ پروفایل و کارنامه کارمند |
| `test_content.js` | ۱۹ محتوای مجله و کوییز |
| `test_accounts.js` | ۳۳ حساب مشتری و کارمند |
| `test_no_extra_charges.js` | ۱۴ بررسی — هیچ مالیات/کارمزدی نباید برگردد |
| `test_order_id_race.js` | ۱۲ بررسی — یکتایی شماره سفارش زیر بار همزمان |
| `test_stock_and_suggest.js` | ۲۲ بررسی — موجودی صفر، حجم ۱۵۰، پیشنهاد جستجو |
| `test_new_pages.js` | ۳۰ بررسی — صفحات «چرا ما؟» و «سمپل» |
| `test_promotions.js` | ۲۸ بررسی — کوپن دامنه‌دار، جشنواره، نوار اعلان |
| `test_campaign_display.js` | ۵۵ بررسی — نمایش جشنواره: کارت، صفحه محصول، سبد، تسویه، فاکتور |
| `test_review_invites.js` | ۵۴ بررسی — دعوت‌نامه نظر مشتریان حضوری، امنیت توکن |
| `test_readiness.js` | ۳۷ بررسی — آمادگی افتتاح و نشت نکردن کلید |
| `test_journal_lcp.js` | ۳۸ بررسی — رندر سمت سرور مجله و نگهبان‌های LCP |
| `test_invoice_legal.js` | ۴۰ بررسی — تفکیک فاکتور عادی و رسمی، الزام اینماد |
| `test_customer_note.js` | ۳۶ بررسی — یادداشت مشتری، برچسب پستی، تماس واقعی |
| `test_sms_provider.js` | ۶۸ بررسی — لایه پیامک با سرور جعلی، بدون نشت کلید |
| `test_audit_findings.js` | ۲۵ بررسی — یافته‌های ممیزی: نشت هش، محدودیت نرخ |
| `lib/test_stock.js` | کمک‌کننده — موجودی موقت برای آزمون‌ها |
| `test_node_platform_deploy.js` | ۲۶ بررسی — استقرار روی «پلتفرم Node» لیارا |
| `audit_links.js` | خزش هر لینک در هر صفحه (۱۲۶ لینک داخلی) |
| `audit_docs.js` | آیا فایلی که سند نام برده وجود دارد |
| `audit_docs_truth.js` | آیا **عددی** که سند ادعا کرده درست است |
| `check_node_version.js` | نگهبان هم‌راستایی نسخه Node در ۴ جا |
| `test_analytics.js` | ۲۲ تحلیل و ویترین |
| `test_browser.py` | ۱۹ مرورگر واقعی (Chromium) |
| `test_rbac.js` | ۳۴ مرزهای نقش‌ها |
| `test_rbac_escalation.js` | ۲۱ ضد ارتقای دسترسی |
| `test_search.js` | ۱۸ کیفیت جستجو |
| `test_cold_deploy.js` | ۱۴ استقرار از صفر (دیسک Liara) |
| `test_concurrency.js` | فروش همزمان آخرین موجودی |
| `test_payment_race.js` · `test_callback_race.js` | تکرار پرداخت |
| `test_otp_persistence.js` | پایداری کد ورود |
| `test_stock_alerts.js` | اطلاع موجود شدن |
| `test_coupon_limits.js` | سقف کد تخفیف |
| `test_xss.js` | تزریق اسکریپت |
| `audit_permissions.js` | پوشش مجوزها |

### تصاویر

| فایل | کار |
|---|---|
| `gen_product_images.py` | نقشه تصاویر · `--plan` `--todo` `--check` |
| `build_product_images.py` | **خط لوله کامل** — خام → برش → بایگانی → حکاکی → خروجی · `--dry` |
| `process_product_images.py` | بهینه‌سازی به JPG/WebP + نسخه کوچک |
| `emboss_logo.py` | حکاکی لوگو روی بطری |
| `apply_logo_all.py` | اعمال لوگو روی همه تصاویر |
| `reassign_images.js` | اتصال تصاویر به محصولات · `--dry` |

### نگارش فارسی

| فایل | کار |
|---|---|
| `fix_brand_names.js` | اصلاح نگارش برند در دیتابیس · `--dry` |
| `fix_duplicate_brand_in_name.js` | حذف تکرار برند از نام · `--dry` |
| `fix_seed_brand_names.py` | همگام‌سازی `seed/` · `--dry` |

### محتوا

| فایل | کار |
|---|---|
| `expand_articles.js` | تعمیق محتوای مقالات · `--dry` |

### ابزار

| فایل | کار |
|---|---|
| `restore_backup.js` | بازیابی پشتیبان · `--list` |
| `reset_for_launch.js` | **پاک‌سازی داده آزمونی پیش از افتتاح** · `--dry-run` / `--yes` |
| `optimize_fonts.py` | زیرمجموعه‌سازی فونت |
| `import_dataset.py` | ورود داده اولیه |
| `convert_uploaded_md_dataset.py` | تبدیل دیتاست خام Markdown به JSON |
| `make_favicon.py` | ساخت favicon و آیکن‌های نصب از لوگو |
| `apply_stock_and_volume.js` | صفر کردن موجودی + حجم ۱۵۰ml · `--dry-run` |
| `bench_checkout.js` | بنچمارک مسیر خرید — فقط محیط توسعه |
| `bench_pageload.py` | بنچمارک تجربه کاربر با مرورگر واقعی |
| `add_favicon_links.py` | درج پیوند آیکن در هر ۲۳ صفحه |
| `capture_all.py` | عکس‌برداری از همه صفحات · خروجی در `shots/` |
| `capture_new.py` | عکس‌برداری از صفحات تازه · بخش‌بخش و خوانا |
| `capture_campaign.py` | عکس جشنواره در فهرست/محصول/سبد + سنجش سرریز افقی |
| `shot_cards.py` | عکس نزدیک کارت محصول و جعبه خرید — بازبینی چشمی |
| `shot_dynamics.py` | سناریوی مرورگر: ویترین فصلی و تاریخچه بازدید |
| `shot_taste.py` | سناریوی مرورگر: کوییز تا «پیشنهاد برای شما» |
| `walkthrough.py` | سفر کامل کاربر در ۲۲ مرحله — بازبینی چشمی · `--desktop` |
| `record_hero.py` | ضبط ویدیوی انیمیشن هیرو · `--desktop` |
| `lib/extract_deps.js` | استخراج وابستگی با تحلیل نحوی — ابزار تفکیک |
| `test_pwa_browser.py` | رفتار واقعی سرویس‌ورکر — آفلاین و عدم کش API |
| `make_pwa_icons.py` | ساخت آیکن maskable با ناحیه امن درست |
| `shot_invite.py` | عکس صفحه دعوت‌نامه — عادی، خطا، پس از ثبت |
| `trace_lcp.py` | ردیابی LCP و زنجیره درخواست روی ۳G کند |

---

## مستندات — `docs/`

### راهنمای عملیاتی

| سند | موضوع |
|---|---|
| `STATUS_CHECKLIST.md` | **وضعیت کامل پروژه — از اینجا شروع کنید** |
| `GO_LIVE.md` | چک‌لیست افتتاح |
| `ENAMAD.md` | **نماد اعتماد** — ثبت، سه لایه محافظ، CSP، آنچه از عهده مالک است |
| `DEPLOY_LIARA.md` | استقرار روی Liara گام‌به‌گام |
| `BACKUP_AND_RECOVERY.md` | پشتیبان و بازیابی |
| `DEEP_AUDIT_2026-07.md` | بررسی عمیق: چه داریم، چه کم داریم |
| `AUDIT_2026-07-28.md` | **ممیزی جامع پیش از افتتاح** — ۱۰ یافته، ریسک‌های پذیرفته‌شده |
| `BENCHMARK_2026-07-28.md` | **بنچمارک کارایی** — توان سرور، تجربه کاربر، ۳ مشکل |
| `COMPETITIVE_ANALYSIS.md` | **تحلیل رقابتی** — مقایسه با بازار، SWOT مستند |
| `CAMPAIGN_DISPLAY.md` | **نمایش جشنواره** — ۵ باگ (یکی: تخفیف پرداختی را بالا می‌برد) |
| `REVIEW_INVITES.md` | **دعوت‌نامه نظر** — مشتریان فروش حضوری، امنیت توکن |
| `SECRETS_HANDLING.md` | **مدیریت کلیدها** — چه چیزی را کجا نفرستید، بررسی آمادگی |
| `JOURNAL_LCP.md` | **بهبود LCP مجله** — ۵٫۲۲ به ۲٫۸۱ ثانیه، رندر سمت سرور |
| `CHECKOUT_NOTE_AND_LABEL.md` | **یادداشت مشتری، برچسب پستی، تماس واقعی** |
| `SMS_PAYAMITO.md` | **سامانه پیامک پیامیتو** — لایه مستقل از ارائه‌دهنده |
| `SMS_PAYAMITO_SPEC.md` | **قرارداد فنی پیامک** — نشانی، پارامترها، ۲۰ کد خطا |
| `INTERNAL_ALERTS.md` | **خبر به کارکنان** — شش رویداد، ساعت آرام، ضد سیل |
| `NODE_VERSION.md` | **نسخه Node** — ارتقا به ۲۲ LTS، نگهبان هم‌راستایی |
| `SERVER_MODULARIZATION.md` | **تفکیک server.js** — الگو، ترتیب، دو باگ کشف‌شده |
| `AUDIT_INDEPENDENT.md` | **ممیزی مستقل** — نشت هش رمز، محدودیت نرخ، خطای بلعیده‌شده |
| `AUDIT_2026-08-02.md` | **ممیزی مرداد ۱۴۰۵** — قیمت کهنه در کش، پیام دروغ، ۵ یافته |
| `AUDIT_DOCS_2026-08-05.md` | **ممیزی مستندات** — ۸ یافته، دو باگ کد، ابزار تازه |

### سامانه‌ها

| سند | موضوع |
|---|---|
| `ROLES_AND_PERMISSIONS.md` | نقش‌ها، مجوزها، امنیت کارکنان |
| `ANALYTICS_AND_SHOWCASE.md` | تحلیل داخلی، ویترین، شبکه اجتماعی |
| `PRODUCT_IMAGERY.md` | سامانه تصاویر و حکاکی لوگو |
| `SITE_DYNAMICS.md` | ویترین فصلی و «اخیراً دیدید» — و آنچه عمداً ساخته نشد |
| `PWA.md` | سرویس‌ورکر، آفلاین، نصب — و قاعده «هیچ API کش نمی‌شود» |
| `BRAND_NAMING_FA.md` | نگارش فارسی نام برندها |
| `PAYMENT_INTEGRATION_SPEC.md` | اتصال درگاه |
| `SHIPPING_AND_DELIVERY_SPEC.md` | قواعد ارسال |
| `RETURNS_AND_TICKETING_SPEC.md` | مرجوعی و تیکت |

### مرجع فنی

`API_REFERENCE.md` · `DATABASE_SCHEMA.md` · `ARCHITECTURE.md` ·
`SECURITY_AND_PRIVACY_BASELINE.md` · `PERFORMANCE_PLAN.md` ·
`SEARCH_SPEC.md` · `SKU_AND_VARIANT_RULES.md`

### تاریخچه

| سند | موضوع |
|---|---|
| `CHANGELOG_UI_OVERHAUL.md` | **۳۲ باگ با روش راستی‌آزمایی هرکدام** |
| `GOALS_VS_DELIVERED.md` | مقایسه خواسته و تحویل |

### برند و طراحی

`BRAND_BRIEF.md` · `COPY_GUIDE.md` · `DESIGN_TOKENS.md` ·
`UI_PAGES_SPEC.md` · `ANIMATION_GUIDE.md` · `IA_TAXONOMY.md`

---

## داده

| مسیر | محتوا | در Docker؟ |
|---|---|---|
| `seed/` | کاتالوگ و مقالات اولیه | ✅ بله |
| `data/` | دیتابیس زنده و پشتیبان‌ها | ❌ خیر (دیسک Liara) |
| `source/product-images/` | نسخه بدون لوگوی تصاویر (۶۱ فایل) | ❌ خیر |
| `source/fonts/` | فونت‌های اصلی پیش از زیرمجموعه‌سازی | ❌ خیر |
| `source/brand/` | لوگوی اصلی برند | ❌ خیر |
| `source/dataset/` | دیتاست خام و CSVهای مرجع | ❌ خیر |

> ⚠️ **هرگز `COPY data ./data` به Dockerfile اضافه نکنید** — دیسک
> پایدار Liara روی آن سوار می‌شود و فایل seed را می‌پوشاند.
> `test_cold_deploy.js` این را بررسی می‌کند.

---

## پیکربندی

| فایل | کار |
|---|---|
| `package.json` | وابستگی‌ها (تنها `better-sqlite3`) |
| `Dockerfile` | تصویر تولید |
| `liara.json` | پیکربندی Liara + دیسک |
| `.gitignore` | فایل‌های بازتولیدشدنی |
| `README.md` | معرفی و راه‌اندازی |

---

## متغیرهای محیطی

```bash
# الزامی پیش از افتتاح
ADMIN_USERNAME=owner
ADMIN_PASSWORD=<رمز قوی>          # پیش‌فرض yazd1404 را عوض کنید
DB_PATH=/app/data/yazd.db
SITE_URL=https://yazdperfume.ir

# درگاه و پیامک
PAYMENT_GATEWAY=sandbox|zarinpal
ZARINPAL_MERCHANT_ID=
SMS_PROVIDER=console|payamito|kavenegar|generic
SMS_API_KEY=

# اختیاری
SHOWCASE_REFRESH_HOURS=1
ANALYTICS_KEEP_DAYS=180
AUDIT_KEEP_DAYS=90
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=7
BACKUP_DISABLED=0            # ۱ = خاموش (فقط برای آزمون)
PENDING_ORDER_TTL_MIN=30
```

---

## نکته درباره حجم ورک‌اسپیس

snapshot سقف حدود ۱۲۸ مگابایت دارد. اگر از آن بگذرد، فایل‌ها
بی‌سروصدا ذخیره نمی‌شوند.

پوشه‌های زیر عمداً در `.gitignore` هستند چون بازتولیدشدنی و حجیم‌اند:

```
shots/          عکس‌های بازبینی
.imgraw/        فایل‌های خام تصویر
data/backups/   پشتیبان خودکار
node_modules/   با npm install برمی‌گردد
```

بررسی حجم: `du -sh . && du -sh */ | sort -rh | head`
