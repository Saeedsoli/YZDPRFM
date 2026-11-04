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
| `media.js` | **رسانه مقالات** — آپلود امن تصویر، جاسازی ویدیوی آپارات |
| `seo.js` | متادیتا و داده ساختاریافته سمت سرور |
| `article-render.js` | تبدیل متن مقاله به HTML — منبع مشترک سرور و مرورگر |
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
| `test_shipping_gift.js` | ۲۷ نرخ ارسال یکسان، آستانه رایگان، بسته‌بندی کادویی |
| `test_brand_logo.js` | ۲۹ هویت لوگو — دارایی‌ها، نسبت ابعاد، تضاد رنگ، کش |
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
| `test_article_media.js` | ۵۹ رسانه مقالات — امضای فایل، پیمایش مسیر، آپارات |
| `test_audit_blackbox_fixes.js` | ۳۵ رفع ممیزی جعبه‌سیاه — نشت داده، محدودیت نرخ، سئو |
| `test_stock_visibility.js` | ۴۳ نمایش موجودی — مرتب‌سازی، فیلتر، نشان کارت |
| `test_stock_ui_browser.py` | ۲۲ رابط موجودی در مرورگر — دیده‌شدن واقعی برچسب |
| `test_price_usd.js` | ۳۸ قیمت دلاری پایه — NULL/صفر، اعشار، مرز دسترسی |
| `test_price_usd_browser.py` | ۸ فیلد قیمت دلاری در پنل — ذخیره واقعی |
| `test_exports_browser.py` | ۱۲ دانلود خروجی از پنل — کلیک واقعی، BOM، بازه |
| `make_preview.py` | 🎯 **پیش‌نمای کامل ۴۰ نما** — موبایل و دسکتاپ، پنل، فاکتور · خروجی در پوشه `preview/` (در گیت نیست) |
| `make_samples.js` | ساخت نمونه خروجی‌ها در `docs/samples/` |
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
| `test_backup_stream_safety.js` | پشتیبان هم‌زمان، بازیابی آزمایشی و پاک‌سازی پس از قطع یا خطا |
| `test_journal_lcp.js` | ۳۸ بررسی — رندر سمت سرور مجله و نگهبان‌های LCP |
| `test_invoice_legal.js` | ۴۰ بررسی — تفکیک فاکتور عادی و رسمی، الزام اینماد |
| `test_customer_note.js` | ۳۶ بررسی — یادداشت مشتری، برچسب پستی، تماس واقعی |
| `test_sms_provider.js` | ۶۸ بررسی — لایه پیامک با سرور جعلی، بدون نشت کلید |
| `test_audit_findings.js` | ۲۵ بررسی — یافته‌های ممیزی: نشت هش، محدودیت نرخ |
| `test_seo_ai_safety.js` | ۲۴ بررسی — محافظ‌های سیاست «محتوای انبوه» گوگل |
| `audit_seo_ai_risk.js` | ممیزی ریسک محتوای انبوه — رتبه‌بندی A/B/C صفحه‌ها |
| `seed_maker_notes.js` | تولید پیش‌نویس یادداشت عطرساز از دانش مواد اولیه |
| `test_ssr_pages.py` | ۱۳ بررسی — رندر سمت سرور مقاله و برندها + سنجش CLS |
| `make_rescue_bundle.sh` | بستهٔ نجات ۲.۵MB — هستهٔ غیرقابل بازتولید |
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
| `import_dataset.py` | 🎯 **ساخت seed از دیتاست مرجع** — شش اعتبارسنجی، نگاشت خانواده، ضرایب قیمت · `--verify` |
| `replace_catalog.js` | 🎯 **بازنویسی کاتالوگ روی دیتابیس زنده** — داده تراکنشی حفظ می‌شود · `--dry-run` `--yes` |
| `make_brand_assets.py` | 🎯 **از `source/brand/logo.png` همه مشتقات برند را می‌سازد** — نشان/نوشتار/لاک‌آپ، برداری‌سازی SVG، نسخه روشن و تیره |
| `emboss_logo.py` | حکاکی نشان روی بطری (از `logo-mark.png`) |
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
| `restore_backup.js` | فهرست پشتیبان و بازیابی تأییدشده فقط در فایل جدید · `--to-new` |
| `reset_for_launch.js` | گزارش فقط‌خواندنی؛ حذف گروهی غیرفعال |
| `optimize_fonts.py` | زیرمجموعه‌سازی فونت |
| `make_favicon.py` | ساخت favicon و آیکن‌های نصب از لوگو |
| `apply_stock_and_volume.js` | صفر کردن موجودی + حجم ۱۵۰ml · `--dry-run` |
| `bench_checkout.js` | بنچمارک مسیر خرید — فقط محیط توسعه |
| `bench_pageload.py` | بنچمارک تجربه کاربر با مرورگر واقعی |
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
| `ARTICLE_MEDIA.md` | **رسانه مقالات** — تصویر، ویدیو، سه لایه محافظ آپلود |
| `PRICING_USD.md` | **قیمت‌گذاری دلاری** — گام اول، پرسش‌های باز فرمول |
| `samples/README.md` | **نمونه خروجی‌ها** — فاکتور، برچسب، CSV با توضیح هرکدام |
| `NODE_VERSION.md` | **نسخه Node** — ارتقا به ۲۲ LTS، نگهبان هم‌راستایی |
| `SERVER_MODULARIZATION.md` | **تفکیک server.js** — الگو، ترتیب، دو باگ کشف‌شده |
| `AUDIT_INDEPENDENT.md` | **ممیزی مستقل** — نشت هش رمز، محدودیت نرخ، خطای بلعیده‌شده |
| `AUDIT_2026-08-02.md` | **ممیزی مرداد ۱۴۰۵** — قیمت کهنه در کش، پیام دروغ، ۵ یافته |
| `AUDIT_DOCS_2026-08-05.md` | **ممیزی مستندات** — ۸ یافته، دو باگ کد، ابزار تازه |
| `AUDIT_BLACKBOX_2026-08-06.md` | **ممیزی جعبه‌سیاه** — بازدید بیرونی، ۲۴ پیشنهاد |

### سامانه‌ها

| سند | موضوع |
|---|---|
| `ROLES_AND_PERMISSIONS.md` | نقش‌ها، مجوزها، امنیت کارکنان |
| `ANALYTICS_AND_SHOWCASE.md` | تحلیل داخلی، ویترین، شبکه اجتماعی |
| `PRODUCT_IMAGERY.md` | سامانه تصاویر و حکاکی لوگو |
| `DATASET_IMPORT.md` | 🎯 واردسازی کاتالوگ — منبع، اعتبارسنجی، قیمت‌گذاری، نگاشت خانواده |
| `BRAND_ASSETS.md` | 🎯 لوگو و آیکن‌ها — تعویض، نسخه‌های رنگی، دام‌ها |
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
| `source/brand/` | لوگوی مرجع + ۶ مشتق (نشان/نوشتار/لاک‌آپ × PNG/SVG) | ❌ خیر |
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


## فایل‌های تکمیلی قیمت‌گذاری، ایمنی و آزمون

این فهرست مسیر فایل‌ها را ثبت می‌کند؛ وجود آزمون به معنی اجرای موفق آن نیست.

### اسکریپت‌ها

- `scripts/apply_supplier_prices.js`
- `scripts/build_exact_supplier_prices.py`
- `scripts/prepare_supplier_matches.py`
- `scripts/retire_sample3.js`
- `scripts/test_availability_consistency.py`
- `scripts/test_availability_rules.js`
- `scripts/test_generic_product_images.js`
- `scripts/test_generic_product_images_browser.py`
- `scripts/test_approved_mto.py`
- `scripts/test_active_official_notes_v1.js`
- `scripts/test_active_official_notes_v2.js`
- `scripts/test_active_official_notes_v3.js`
- `scripts/test_essence_pricing.js`
- `scripts/test_essence_pricing_store.js`
- `scripts/test_exchange_rate_api.py`
- `scripts/test_exchange_rate_ui.py`
- `scripts/test_hidden_hair_mist.py`
- `scripts/test_louis_vuitton_supplement.js`
- `scripts/test_maker_draft_generation.js`
- `scripts/test_maker_note_review.py`
- `scripts/test_maker_note_ui.py`
- `scripts/test_official_gender_migration.js`
- `scripts/test_official_gender_v1.js`
- `scripts/test_official_gender_v2.js`
- `scripts/test_official_notes.js`
- `scripts/test_official_notes_v2.js`
- `scripts/test_official_notes_v3.js`
- `scripts/test_official_notes_v4.js`
- `scripts/test_official_notes_v5.js`
- `scripts/test_official_notes_v6.js`
- `scripts/test_official_notes_v7.js`
- `scripts/test_product_essence_api.py`
- `scripts/test_product_essence_rollback.js`
- `scripts/test_product_essence_ui.py`
- `scripts/test_retire_sample3.js`
- `scripts/test_sample_page.py`
- `scripts/test_source_gender.py`
- `scripts/test_stock_fixture_isolation.js`
- `scripts/test_supplier_price_import.js`
- `scripts/test_unavailable_cart.py`
- `scripts/test_variant_visibility.py`
- `scripts/test_verified_supplement.js`
- `scripts/test_wishlist_availability.py`

### ماژول‌های سرور

- `src/availability.js`
- `src/generic-product-images.js`
- `src/active-official-notes.js`
- `src/approved-made-to-order.js`
- `src/essence-pricing-store.js`
- `src/essence-pricing.js`
- `src/import-supplier-prices.js`
- `src/official-gender.js`
- `src/official-notes.js`
- `src/product-essence-pricing.js`
- `src/retire-sample3-cli.js`
- `src/variant-history.js`
- `src/variant-visibility.js`

### ورود قیمت مرجع لویی ویتون

- `scripts/test_lv_reference_prices.js`
- `src/lv-reference-prices.js`

### ورود مرجع قیمت با محافظ ویرایش مدیر

- `scripts/test_reference_price_import.js`
- `src/reference-price-import.js`

### مستندسازی هویت رایحه مرجع

- `scripts/test_official_identity_evidence.js`
- `src/official-identities.js`

### بازسازی قیمت‌های مرجع منبع‌دار

- `scripts/test_reference_prices_v2.js`

### شش تناظر منبع‌دار جدید

- `scripts/test_reference_prices_v3.js`

### پشتیبان افزایشی و شش تناظر مرجع

- `scripts/sqlite_delta_backup.py`
- `scripts/test_sqlite_delta_backup.py`
- `scripts/test_reference_prices_v4.js`

### هشت تناظر و نت‌های بدون هرم تأییدشده

- `scripts/test_reference_prices_v5.js`
- `scripts/test_official_notes_v8.js`
- `scripts/test_unclassified_notes.py`

### اوتلندز و ایمنی ممیزی

- `scripts/test_outlands_reference.js`
- `scripts/test_audit_docs_readonly.js`

### پنج قیمت مرجع و نت رسمی جدید

- `scripts/test_reference_prices_v7.js`
- `scripts/test_official_notes_v9.js`

### سه قیمت مرجع و اصلاح نت‌های کلیدی

- `scripts/test_reference_prices_v8.js`
- `scripts/test_official_notes_v10.js`

### بررسی اکستریت باکارات رژ

- `scripts/test_baccarat_extrait_reference.js`

### ایزوله‌سازی آزمون دود

- `scripts/test_smoke_isolation.py`
- `scripts/test_node22_integration.sh`

### کنترل رمز واقعی مدیر در آمادگی

- `scripts/test_readiness_password_state.js`

### کرید و آرمانی — دو قیمت مرجع

- `scripts/test_creed_armani_reference.js`

### شش قیمت مرجع و نت رسمی

- `scripts/test_reference_prices_v11.js`
- `scripts/test_official_notes_v13.js`

### پنج قیمت و نت کازاموراتی

- `scripts/test_reference_prices_v12.js`
- `scripts/test_official_notes_v14.js`

### پنج مرجع و چهار محصول تکمیلی

- `scripts/test_five_added_reference.js`

### هفت تناظر و دو محصول گوچی

- `scripts/test_reference_prices_v14.js`
- `scripts/test_official_notes_v16.js`

### شش محصول مرجع تکمیلی

- `scripts/test_six_supplement_v15.js`

### شش محصول تکمیلی دیگر

- `scripts/test_six_supplement_v16.js`

### دو محصول تکمیلی و موارد مبهم

- `scripts/test_two_supplement_v17.js`

### ممیزی پوشش فهرست تأمین‌کننده

- `scripts/supplier_coverage.py`
- `scripts/test_supplier_coverage.py`
- `scripts/audit_reference_notes.py` — ممیزی فقط‌خواندنی تطابق نت‌ها با اسناد؛ نتیجه اثبات هویت اسانس نیست.
- `scripts/test_audit_reference_notes.py` — آزمون مجزای ممیزی نت و حفظ دیتابیس.
- `reports/supplier_coverage_20261031.csv`
- `reports/supplier_coverage_20261031.json`
- `docs/supplier_coverage_snapshot.md`

### آکوا کیس و گزارش پوشش جدید

- `scripts/test_aqua_kiss_reference.js`
- `reports/supplier_coverage_20261101.csv`
- `reports/supplier_coverage_20261101.json`
- `docs/supplier_coverage_snapshot_20261101.md`

### مراجع مستقل با اجازه مالک

- `src/secondary-reference-import.js`
- `src/secondary-notes.js`
- `seed/secondary_supplement_v1.json`
- `seed/secondary_reference_prices_v1.json`
- `seed/secondary_note_corrections_v1.json`
- `scripts/test_secondary_reference_batch.js`

### دسته دوم منابع مستقل

- `seed/secondary_supplement_v2.json`
- `seed/secondary_reference_prices_v2.json`
- `seed/secondary_note_corrections_v2.json`
- `scripts/test_secondary_reference_v2.js`

### دسته سوم منابع مستقل

- `seed/secondary_reference_prices_v3.json`
- `seed/secondary_supplement_v3.json`
- `scripts/test_secondary_reference_v3.js`
- `docs/supplier_research_batch_20261101.md`


### دسته چهارم منابع مستقل

- `seed/secondary_reference_prices_v4.json`
- `seed/secondary_supplement_v4.json`
- `scripts/test_secondary_reference_v4.js`


### دسته تازه منابع رسمی و مستقل

- `seed/official_supplement_v19.json`
- `seed/official_reference_prices_v19.json`
- `seed/official_identity_evidence_v18.json`
- `seed/secondary_supplement_v5.json`
- `seed/secondary_reference_prices_v5.json`
- `scripts/test_official_reference_v19.js`
- `scripts/test_secondary_reference_v5.js`


### دسته بعدی منابع رسمی و مستقل

- `seed/official_supplement_v20.json`
- `seed/official_reference_prices_v20.json`
- `seed/official_identity_evidence_v19.json`
- `seed/secondary_supplement_v6.json`
- `seed/secondary_reference_prices_v6.json`
- `scripts/test_official_reference_v20.js`
- `scripts/test_secondary_reference_v6.js`


### چهار تناظر جدید رسمی

- `seed/official_supplement_v21.json`
- `seed/official_reference_prices_v21.json`
- `seed/official_identity_evidence_v20.json`
- `scripts/test_official_reference_v21.js`


### دو اصلاح شناسنامه رسمی محافظت‌شده

- `seed/official_reference_prices_v22.json`
- `seed/official_identity_evidence_v21.json`
- `seed/official_note_corrections_v17.json`
- `scripts/test_official_reference_v22.js`


### پنج تطبیق رسمی و مستقل

- `seed/official_reference_prices_v23.json`
- `seed/official_identity_evidence_v22.json`
- `seed/official_note_corrections_v18.json`
- `seed/secondary_reference_prices_v7.json`
- `seed/secondary_supplement_v7.json`
- `scripts/test_official_reference_v23.js`
- `scripts/test_secondary_reference_v7.js`


### پنج تناظر مستقل دیگر

- `seed/secondary_reference_prices_v8.json`
- `seed/secondary_supplement_v8.json`
- `scripts/test_secondary_reference_v8.js`


### دو تناظر دانهیل

- `seed/official_identity_evidence_v23.json`
- `seed/official_reference_prices_v24.json`
- `seed/official_note_corrections_v19.json`
- `seed/secondary_reference_prices_v9.json`
- `seed/secondary_note_corrections_v3.json`
- `scripts/test_dunhill_reference_batch.js`


### سه تناظر رسمی دیگر

- `seed/official_supplement_v22.json`
- `seed/official_identity_evidence_v24.json`
- `seed/official_reference_prices_v25.json`
- `seed/official_note_corrections_v20.json`
- `scripts/test_official_reference_v25.js`


### دو تناظر رسمی تازه

- `seed/official_identity_evidence_v25.json`
- `seed/official_reference_prices_v26.json`
- `seed/official_note_corrections_v21.json`
- `scripts/test_official_reference_v26.js`


### اصلاح دسیژن و تناظر مستقل

- `src/decision-identity-correction.js`
- `seed/decision_identity_correction_v1.json`
- `seed/official_identity_evidence_v26.json`
- `seed/official_reference_prices_v27.json`
- `seed/official_note_corrections_v22.json`
- `seed/secondary_reference_prices_v10.json`
- `seed/secondary_supplement_v9.json`
- `scripts/test_decision_original_batch.js`


### شش شناسنامه رسمی بدون انتساب قیمت

- `seed/official_identity_evidence_v27.json`
- `seed/official_note_corrections_v23.json`
- `scripts/test_official_notes_v23.js`


### شش شناسنامه رسمی دیگر بدون انتساب قیمت

- `seed/official_identity_evidence_v28.json`
- `seed/official_note_corrections_v24.json`
- `scripts/test_official_notes_v24.js`


### شش شناسنامه رسمی نسخه‌های دیگر

- `seed/official_identity_evidence_v29.json`
- `seed/official_note_corrections_v25.json`
- `scripts/test_official_notes_v25.js`


### هشت شناسنامه رسمی آمواج

- `seed/official_identity_evidence_v30.json`
- `seed/official_note_corrections_v26.json`
- `scripts/test_official_notes_v26.js`


### هشت شناسنامه رسمی دیور، هرمس و کارتیر

- `seed/official_identity_evidence_v31.json`
- `seed/official_note_corrections_v27.json`
- `scripts/test_official_notes_v27.js`


### هشت شناسنامه رسمی جدید

- `seed/official_identity_evidence_v32.json`
- `seed/official_note_corrections_v28.json`
- `scripts/test_official_notes_v28.js`


### هشت شناسنامه رسمی و محافظ غلظت

- `seed/official_identity_evidence_v33.json`
- `seed/official_note_corrections_v29.json`
- `scripts/test_official_notes_v29.js`


### هشت شناسنامه رسمی رابان

- `seed/official_identity_evidence_v34.json`
- `seed/official_note_corrections_v30.json`
- `scripts/test_official_notes_v30.js`


### دو قیمت موقت و شش شناسنامه رسمی

- `seed/official_supplement_v23.json`
- `seed/official_identity_evidence_v35.json`
- `seed/official_reference_prices_v28.json`
- `seed/official_note_corrections_v31.json`
- `scripts/test_official_reference_v28.js`
- `scripts/test_official_notes_v31.js`


### دو قیمت موقت و شش شناسنامه دیگر

- `seed/official_supplement_v24.json`
- `seed/official_identity_evidence_v36.json`
- `seed/official_reference_prices_v29.json`
- `seed/official_note_corrections_v32.json`
- `seed/secondary_supplement_v10.json`
- `seed/secondary_reference_prices_v11.json`
- `scripts/test_official_reference_v29.js`
- `scripts/test_official_reference_v30.js`
- `scripts/test_official_reference_v31.js`
- `scripts/test_official_reference_v32.js`
- `scripts/test_official_reference_v33.js`
- `scripts/test_secondary_reference_v11.js`
- `scripts/test_secondary_reference_v12.js`
- `scripts/test_secondary_reference_v13.js`
- `scripts/test_secondary_reference_v14.js`
- `scripts/test_secondary_reference_v15.js`
- `scripts/test_secondary_reference_v16.js`
- `scripts/test_official_notes_v32.js`
- `scripts/test_official_notes_v33.js`
- `scripts/test_official_notes_v34.js`
- `scripts/test_official_notes_v35.js`

- `scripts/test_official_reference_v34.js` — بررسی قیمت با تأیید نسخه توسط مالک و حفظ وضعیت غیرفعال.

- `scripts/test_official_reference_v35.js` — بررسی قیمت گریس چارنل با تأیید نسخه و حفظ وضعیت غیرفعال.

- `scripts/test_official_reference_v36.js` — بررسی انتساب موقت بلو شنل و حفظ وضعیت غیرفعال.

- `scripts/test_official_reference_v37.js` — قیمت جوبیلیشن ۴۰ طبق انتخاب مالک در ردیف متناقض.

- `scripts/test_official_reference_v38.js` — قیمت و نت دلینا طبق انتخاب مالک در ردیف متناقض.

- `scripts/test_secondary_reference_v17.js` — قیمت و مرجع مستقل جوپ سبز طبق انتخاب مالک.

- `scripts/test_secondary_reference_v18.js` — قیمت و مرجع مستقل جوپ قرمز طبق انتخاب مالک.

- `src/approved-made-to-order-v2.js` — فعال‌سازی محافظت‌شده هفت محصول تأییدشده.

- `scripts/test_approved_mto_v2.py` — هفت تأیید تازه، خرید و محافظ تغییرات مدیر.

- `src/joop-name-correction.js` — اصلاح محافظت‌شده تکرار نام برند جوپ.

- `scripts/test_joop_name_correction.js` — محافظ نام و تغییرات مدیر.

- `scripts/test_secondary_reference_v19.js` — قیمت و مرجع مستقل اسکالیپچر هوم طبق انتخاب مالک.

- `scripts/test_official_reference_v39.js` — قیمت لو بو پارادایز گاردن با انتخاب مالک.

- `scripts/test_secondary_reference_v20.js` — قیمت کریستال نویر ادوپرفیوم و منبع مستقل.

- `scripts/test_official_reference_v40.js` — قیمت اروس پور فم ادوپرفیوم با انتخاب مالک.

- `src/approved-made-to-order-v3.js` — فعال‌سازی محافظت‌شده چهار محصول تأییدشده.
- `src/popular-persian-names.js` — اصلاح محافظت‌شده نگارش‌های رایج فارسی.

- `scripts/test_approved_mto_v3.py` — چهار تأیید جدید، سقف خرید و املای جستجو.
- `scripts/test_popular_persian_names.js` — محافظ تغییرات مدیر در اصلاح نام‌ها.

- `scripts/test_official_reference_v41.js` — قیمت گانیمد ادوپرفیوم با انتخاب مالک.

- `scripts/test_secondary_reference_v21.js` — قیمت بلک ایکس اس ال اکسس مردانه با انتخاب مالک و منبع مستقل.

- `scripts/test_secondary_reference_v22.js` — قیمت تی رز ادوپرفیوم با انتخاب مالک و منبع مستقل.

- `src/approved-made-to-order-v4.js` — فعال‌سازی محافظت‌شده سه محصول تأییدشده.
- `scripts/test_approved_mto_v4.py` — مصوبه سه محصول، سقف خرید و محافظ ویرایش مدیر.

- `scripts/test_official_reference_v42.js` — قیمت آمواج اپیک مردانه با انتخاب مالک.

- `scripts/test_official_reference_v43.js` — قیمت آمواج آنر زنانه با انتخاب مالک.

- `scripts/test_official_reference_v44.js` — قیمت آمواج ممویر مردانه با انتخاب مالک.

- `src/approved-made-to-order-v5.js` — فعال‌سازی محافظت‌شده سه رایحه آمواج.
- `scripts/test_approved_mto_v5.py` — تأیید خرید، سقف و جستجوی نام‌های رایج.
- `src/amouage-common-names.js` — اصلاح محافظت‌شده نام ممویر و آنر.

- `scripts/test_amouage_common_names.js` — محافظ نام رایج و ویرایش مدیر.

- `scripts/test_secondary_reference_v23.js` — قیمت آزارو کروم ادوپرفیوم با انتخاب مالک و منبع مستقل.

- `scripts/test_official_reference_v45.js` — قیمت باربری لندن زنانه با انتخاب مالک.

- `scripts/test_official_reference_v46.js` — قیمت باربری ویکند مردانه با انتخاب مالک.

- `scripts/test_official_reference_v47.js` — قیمت باربری ویکند زنانه پس از اصلاح مالک.
- `src/weekend-owner-correction.js` — بازپس‌گیری محافظت‌شده انتساب قبلی و حفظ سفارش‌ها.

- `src/approved-made-to-order-v6.js` — فعال‌سازی محافظت‌شده سه رایحه تأییدشده.
- `scripts/test_approved_mto_v6.py` — سقف خرید و محافظ ویرایش مدیر برای تأیید جدید.

- `scripts/test_weekend_owner_correction.js` — بازپس‌گیری امن قیمت اشتباه، حفاظت سفارش و ویرایش مدیر.

- `scripts/test_official_reference_v48.js` — قیمت باربری هر ادوپرفیوم با انتخاب مالک.

- `src/approved-made-to-order-v7.js` — فعال‌سازی محافظت‌شده باربری هر.
- `scripts/test_approved_mto_v7.py` — خرید، سقف، ویرایش مدیر و ری‌استارت.

- `scripts/test_official_reference_v49.js` — قیمت اترنیتی مردانه ادوپرفیوم با انتخاب مالک.

- `src/approved-made-to-order-v8.js` — تأیید محافظت‌شده اترنیتی ادوپرفیوم.
- `scripts/test_approved_mto_v8.py` — خرید و محافظ تأیید اترنیتی.

- `scripts/test_secondary_reference_v24.js` — قیمت ایفوریا مردانه بر مبنای ادوتویلت مرجع.

- `src/approved-made-to-order-v9.js` — تأیید محافظت‌شده ایفوریا مردانه.
- `scripts/test_approved_mto_v9.py` — خرید و محافظ تأیید ایفوریا.

- `scripts/test_official_reference_v50.js` — قیمت ایفوریا زنانه ادوپرفیوم با انتخاب مالک.

- `src/approved-made-to-order-v10.js` — تأیید محافظت‌شده ایفوریا زنانه.
- `scripts/test_approved_mto_v10.py` — خرید و محافظ تأیید ایفوریا زنانه.

- `scripts/test_default_reference_v51.js` — هفت تطبیق موقت بر مبنای پیش‌فرض مالک.

- `src/approved-made-to-order-v11.js` — تأیید محافظت‌شده هفت تطبیق پیش‌فرض.
- `scripts/test_approved_mto_v11.py` — خرید و محافظ تأیید دسته پیش‌فرض.

- `scripts/test_default_reference_v52.js` — چهار تطبیق موقت پرفیوم بر مبنای پیش‌فرض مالک.

- `src/approved-made-to-order-v12.js` — تأیید محافظت‌شده چهار تطبیق پرفیوم.
- `scripts/test_approved_mto_v12.py` — خرید و محافظ تأیید دسته پرفیوم.

- `scripts/test_default_reference_v53.js` — شش تطبیق موقت رسمی و مستقل بر مبنای پیش‌فرض مالک.

- `src/approved-made-to-order-v13.js` — تأیید محافظت‌شده شش تطبیق جدید.
- `scripts/test_approved_mto_v13.py` — خرید و محافظ تأیید دسته جدید.

- `scripts/test_generic_image_rebalance.js` — تعادل تصویر نمادین و حفاظت انتخاب مدیر.

- `scripts/test_default_reference_v54.js` — سه تطبیق موقت رسمی و مستقل بر مبنای پیش‌فرض مالک.

- `src/approved-made-to-order-v14.js` — تأیید محافظت‌شده سه تطبیق جدید.
- `scripts/test_approved_mto_v14.py` — خرید و محافظ تأیید دسته جدید.

- `scripts/test_default_reference_v55.js` — دو تطبیق موقت بر مبنای پیش‌فرض مالک.

- `src/approved-made-to-order-v15.js` — تأیید محافظت‌شده دو تطبیق جدید.
- `scripts/test_approved_mto_v15.py` — خرید و محافظ تأیید دسته جدید.

- `scripts/test_official_reference_v56.js` — قیمت کوکو شنل با انتخاب مالک در ردیف متناقض.

- `src/approved-made-to-order-v16.js` — تأیید محافظت‌شده کوکو شنل.
- `scripts/test_approved_mto_v16.py` — خرید و محافظ تأیید کوکو شنل.
- `scripts/test_generic_image_six.js` — ششمین تصویر نمادین و نمایش برچسب آن.

- `scripts/test_generic_image_six_browser.py` — آزمون مرورگر تصویر نمادین ششم در موبایل و دسکتاپ.

- `scripts/test_edt_reference_v57.js` — پنج تطبیق ادوتویلت و منابع رسمی و مستقل.
- `src/hugo-versus-name.js` — نام رایج ورسوز با محافظ ویرایش مدیر.

- `src/approved-made-to-order-v17.js` — تأیید محافظت‌شده پنج انتخاب ادوتویلت.
- `scripts/test_approved_mto_v17.py` — خرید و محافظ دسته ادوتویلت.

- `scripts/test_hugo_versus_name.js` — محافظ نام انتخابی مدیر.

- `src/generic-scent-import.js` — ثبت تراکنشی رایحه‌های عمومی تأییدشده، جدا از شواهد برند.
- `scripts/apply_generic_scents.js` — اجرای صریح روی دیتابیس پشتیبان‌گرفته‌شده.
- `scripts/test_generic_scent_staging.py` — بررسی ردیف‌های قیمت و بالاترین کیفیت.
- `scripts/test_generic_scent_import.py` — آزمون سفارش، تکرار و برخورد شناسه‌ها.

- `src/owner-reference-import.js` — ثبت محافظت‌شده چهار مرجع انتخابی با شواهد مستقل.
- `scripts/apply_owner_references.js` — اجرای صریح روی دیتابیس پشتیبان‌گرفته‌شده.
- `scripts/test_owner_reference_import.py` — آزمون قیمت فایل، منبع، خرید و محافظ داده.

- `src/owner-reference-import-v2.js` — ثبت امن سه انتخاب دیگر با منبع و نام مرجع.
- `scripts/apply_owner_references_v2.js` — اجرای صریح مصوبه دوم روی دیتابیس پشتیبان‌گرفته‌شده.
- `scripts/test_owner_reference_import_v2.py` — آزمون انتخاب‌ها، قیمت، سبد و محافظ داده.

- `src/generic-scent-import-v2.js` — پنج رایحه با نام بازاری بدون برند مرجع.
- `src/owner-reference-import-v3.js` — ثبت باس باتلد انتخابی و محافظ نام بوس ۹۸.
- `scripts/apply_generic_scents_v2.js` — اجرای صریح مصوبه رایحه‌های بازاری.
- `scripts/apply_owner_references_v3.js` — اجرای صریح انتخاب باس باتلد.
- `scripts/test_generic_scent_import_v2.py` — آزمون پنج رایحه بازاری.
- `scripts/test_owner_reference_import_v3.py` — آزمون باس باتلد و حفظ قیمت بوس ۹۸.
- `scripts/test_generic_image_seven.js` — آزمون برچسب تصویر نمادین هفتم.
- `scripts/apply_pending_six.js` — اجرای اتمی هر دو مصوبه پس از پشتیبان‌گیری.
- `src/legacy-reference-approval.js` — رفع محافظت‌شده ابهام دو قیمت قدیمی با منابع مستقل.
- `scripts/apply_legacy_references.js` — اعمال صریح پس از پشتیبان و بازسازی ایندکس‌ها.
- `scripts/test_legacy_reference_approval.py` — آزمون قیمت قدیمی، سفارش، نت‌ها و محافظ ویرایش مدیر.
- `scripts/test_performance_claim_gate.py` — پنهان‌بودن ماندگاری و پخش تأییدنشده از خروجی عمومی همراه با حفظ داده پنل.
- `src/unverified-seed-accords-cleanup.js` — حذف محافظت‌شده آکوردهای تولیدی و تأییدنشده از ۳۱ محصول فعال.
- `src/reference-accord-display.js` — نمایش محافظت‌شده نت‌های تفکیک‌نشده رایحه مرجع؛ بدون ادعای مواد اسانس دست‌ساز.
- `src/active-secondary-notes.js` — افزودن محدود نت‌های مستند مستقل با محافظ هویت و تغییرات مدیر.
- `src/active-secondary-notes-cli.js` — اجرای صریح با پشتیبان تأییدشده روی دیتابیس متوقف‌شده.
- `scripts/test_active_secondary_notes.py` — آزمون نصب تازه، بازگشت و حفاظت سوابق و ویرایش‌های مدیر.
- `scripts/test_active_secondary_notes_browser.py` — آزمون مرورگر نت‌ها و چیدمان موبایل و دسکتاپ.
- `scripts/test_reference_accord_display.js` — آزمون تطابق مصوبات نمایش با اسناد و محافظت تغییر هویت یا داده.
- `scripts/test_reference_accord_display_browser.py` — آزمون مرورگر نمایش نت‌های مرجع، حفظ افشا و محافظ تزریق.
- `scripts/apply_unverified_seed_accords.js` — اجرای صریح و بازسازی محدود ایندکس پس از پشتیبان‌گیری.
- `scripts/test_unverified_seed_accords_cleanup.py` — آزمون محدوده، داده مدیر، سفارش و تکرار مهاجرت.
- `scripts/test_scent_description_gate.py` — جلوگیری از انتشار ادعاهای ترکیب و خلوص تأییدنشده و حفظ متن پنل.

- `scripts/test_destructive_tool_guards.py` — محافظ حذف و بازیابی در فایل جدید.
- `scripts/test_admin_account_rate_limit.py` — محدودیت ورود حساب مدیریت با IP متغیر، بازراه‌اندازی و حفظ استقلال حساب‌ها.
- `src/production-admin-guard.js` — جلوگیری از اجرای محیط تولید با مدیر پیش‌فرض یا حساب نامعتبر.
- `scripts/test_production_admin_guard.py` — آزمون محافظ حساب تازه و موجود، بدون افشای رمز.

- `scripts/test_staff_temporary_password.py` — آزمون رمز تصادفی، تحویل یک‌باره، حریم پیامک و خطا.
- `scripts/test_staff_temporary_password_browser.py` — آزمون مرورگر واقعی پنل برای نمایش یک‌باره رمز در موبایل و دسکتاپ.
- `scripts/test_production_safety_gates.py` — محافظ تولید، اتصال شناسه تراکنش، خطای نامشخص و حساب موجود؛ با درگاه ساختگی.
- `scripts/test_payment_sandbox_result.js` — جلوگیری از نمایش موفقیت ساختگی یا حذف سبد در خطا.
- `src/order-stock-reservations.js` — ثبت و آزادسازی دقیق موجودی واقعی برای اقلام سفارش جدید.
- `src/automatic-backup.js` — پشتیبان محلی موقت، بررسی سلامت، انتشار بدون بازنویسی و نگهداری محافظت‌شده.
- `scripts/test_automatic_backup_safety.js` — آزمون خرابی، بازیابی، نگهداری و برخورد هم‌زمان پشتیبان‌ها روی دیتابیس موقت.
- `src/order-stock-reservation-cli.js` — نصب افزایشی محافظت‌شده با پشتیبان مستقل و تأیید توقف نوشتن.
- `scripts/test_order_stock_reservations.py` — آزمون ساخت پس از سفارش، کالای انبار، لغو، انقضا و ردیف تکراری.
- `scripts/test_order_stock_cross_process.py` — آزمون همزمانی آخرین موجودی در دو فرایند Node.
- `scripts/test_order_stock_migration.py` — آزمون نصب پشتیبان‌محور روی دیتابیس قدیمی بدون تغییر سفارش‌ها.

- `scripts/test_private_order_tracking.py` — حریم پیگیری، دو شناسه، محدودیت نرخ و حفظ شناسه قدیمی.
- `scripts/test_payment_result_safety.js` — جلوگیری از موفقیت ساختگی و تزریق داده نشانی.
- `scripts/test_payment_provider_races.py` — آزمون تغییر وضعیت سفارش هنگام ایجاد یا تأیید پرداخت با درگاه شبیه‌سازی‌شده.
- `scripts/test_coupon_order_atomicity.py` — آزمون ثبت اتمی کوپن و سفارش و بازگشت در قطع ناگهانی فرایند.
- `scripts/test_coupon_phone_ownership.py` — آزمون مالکیت شماره برای کوپن اختصاصی و خرید اول، مهمان و لغو نشست هم‌زمان.
- `scripts/test_coupon_checkout_browser.py` — آزمون ارسال نشست و کوپن در فرم تسویه موبایل و دسکتاپ.
- `scripts/test_delivery_time_consistency.js` — بررسی سازگاری زمان تحویل در صفحه‌ها و پیامک شبیه‌سازی‌شده.
- `scripts/test_order_safety_browser.py` — آزمون مرورگر پیگیری و نتیجه پرداخت در موبایل و دسکتاپ.
- `src/customer-phone-verification.js` — ثبت تأیید شماره و اعتماد جداگانه به رمز مشتری بدون حدس برای سوابق قدیمی.
- `src/customer-phone-verification-cli.js` — مهاجرت افزایشی با پشتیبان مستقل و حفظ سوابق.
- `scripts/test_customer_phone_verification.py` — امنیت ثبت‌نام، نشست قدیمی، بازیابی و رقابت کد.
- `scripts/test_customer_verification_migration.py` — آزمون مهاجرت بدون فرض تأیید شماره‌های قبلی.

- `scripts/test_otp_request_race.py` — آزمون رقابت ارسال کد در دو فرایند، بازیابی خطا و توقف ناگهانی با پیامک شبیه‌سازی‌شده.
- `scripts/test_rate_limit_cross_process.py` — آزمون محدودیت نرخ اتمی در چند فرایند و دیتابیس موقت.
- `scripts/test_concurrent_db_startup.py` — آزمون راه‌اندازی هم‌زمان دیتابیس موجود و بازگشت کامل در خطای اولیه روی داده موقت.
- `scripts/test_password_recovery_abuse.py` — آزمون حریم خصوصی بازیابی و سقف مشترک پیامک با ارائه‌دهنده شبیه‌سازی‌شده.
- `scripts/test_customer_password_reset_race.py` — جلوگیری از احیای نشست با رمز قدیمی در رقابت چندفرایندی.
- `scripts/test_customer_phone_browser.py` — آزمون مرورگر ثبت‌نام، ورود پیامکی و بازیابی حساب قدیمی.
- `scripts/test_checkout_profile.py` — آزمون حریم خصوصی و انتخاب نشانی از آخرین سفارش پرداخت‌شده.
- `scripts/test_malformed_request_paths.py` — آزمون پایداری سرور در برابر نشانی‌های نامعتبر و درخواست هم‌زمان.
- `scripts/test_secret_exclusion.py` — کنترل خروج کلیدهای SSH از نسخه جاری و بسته استقرار؛ جای لغو کلید افشاشده را نمی‌گیرد.
- `src/browser-origin-guard.js` — محافظ مبدأ مرورگر برای درخواست‌های تغییردهنده API؛ جای احراز هویت را نمی‌گیرد.
- `scripts/test_browser_origin_guard.js` — آزمون سیاست مبدأ و سازگاری کلاینت‌های بدون Origin.
- `scripts/test_browser_origin_http.py` — آزمون HTTP مسیرهای حساس در محیط موقت و پیامک شبیه‌سازی‌شده.
- `scripts/test_browser_origin_csrf.py` — آزمون واقعی مرورگر برای درخواست از مبدأ دیگر در همان سایت.
- `src/client-ip.js` — تشخیص IP با فهرست صریح پروکسی‌های مورد اعتماد و زنجیره از سمت راست.
- `scripts/test_client_ip.js` — آزمون تحلیل IP و رد تنظیمات نامعتبر.
- `scripts/test_trusted_proxy_http.py` — آزمون HTTP محدودیت درخواست با هدر جعلی و پروکسی شبیه‌سازی‌شده.
- `src/image-validation.js` — بررسی ساختاری و محدودیت ابعاد تصاویر آپلودی؛ نه رمزگشایی کامل یا بدافزارسنجی.
- `scripts/test_image_upload_security.js` — آزمون ساختار، محدودیت اندازه و جلوگیری از بازنویسی فایل.
- `scripts/test_admin_cookie_session_browser.py` — آزمون نشست HttpOnly، بازخوانی پنل، فاکتور، برچسب و خروج.
- `scripts/test_admin_cookie_session.py` — آزمون نشست کوکی و سازگاری توکن API در دیتابیس موقت.
- `scripts/test_customer_cookie_session.py` — آزمون نشست مشتری، چهار مسیر ورود و سازگاری توکن API.
- `scripts/test_checkout_profile_browser.py` — آزمون تکمیل فرم و جلوگیری از بازنویسی ورودی مشتری.
- `scripts/test_login_redirect_safety.js` — جلوگیری از انتقال خارجی یا اجرای نشانی خطرناک پس از ورود.
- `scripts/test_seo_html_safety.js` — محافظت داده‌های ساختاریافته و ویژگی‌های HTML در رندر سمت سرور.
- `scripts/test_product_data_xss_browser.py` — آزمون مرورگر صفحه محصول با داده مخرب و تصویر جایگزین روی دیتابیس موقت.
- `scripts/test_cart_checkout_data_xss_browser.py` — آزمون مرورگر امنیت سبد و تسویه و عملکرد دکمه‌های سبد روی دیتابیس موقت.
- `scripts/test_catalog_cards_xss_browser.py` — آزمون داده مخرب در کارت‌های کاتالوگ، جستجو، سمپل، کوییز و علاقه‌مندی روی دیتابیس موقت.
- `src/static-path.js` — کنترل محدوده فایل‌های عمومی و مقصد پیوندهای نمادین؛ فرض می‌کند فایل‌ها هم‌زمان توسط کاربر محلی غیرمجاز تغییر نمی‌کنند.
- `scripts/test_static_path_security.py` — آزمون HTTP عبور از مسیر، پیوند بیرونی و جایگزین WebP.
- `scripts/test_admin_reports_xss_browser.py` — آزمون مرورگر برای ایمنی نمایش کوپن، گزارش و لاگ مدیریت.
- `src/csv-export.js` — تولید سلول CSV و کاهش خطر فرمول در داده متنی؛ رفتار برنامه‌های صفحه‌گسترده متفاوت است.
- `scripts/test_csv_export.js` — آزمون نقل‌قول CSV و خنثی‌سازی متن‌های شبیه فرمول.
- `scripts/test_csv_export_http.py` — آزمون دو خروجی CSV با داده آزمایشی و احراز هویت روی دیتابیس موقت.
- `scripts/test_admin_catalog_xss_browser.py` — آزمون مرورگر ایمنی نمایش و دکمه‌های محصولات، موجودی، مقالات و انتخاب محصول در پنل.
- `scripts/test_contact_ticket_xss_browser.py` — آزمون مرورگر ایمنی متن اطلاعات تماس و فهرست تیکت‌های مدیریت.
- `src/return-eligibility.js` — منطق مستقل اولیه احراز شرایط مرجوعی؛ هنوز به API یا سایت متصل نیست.
- `scripts/test_return_eligibility.js` — آزمون مرز ۷۲ ساعت و شرایط مالک، قلم، حجم و درخواست باز.
- `src/return-store.js` — پایه آزمایشی ثبت شواهد تحویل و درخواست مرجوعی؛ هنوز به راه‌اندازی یا API متصل نیست.
- `scripts/test_return_store.js` — آزمون دیتابیس موقت، برگشت تراکنش، محدودیت‌ها و رقابت ثبت مرجوعی.
- `src/return-store-cli.js` — نصب صریح و پشتیبان‌اول جداول مرجوعی روی پایگاه موجودِ آفلاین؛ بدون حدس داده‌های تاریخی.
- `scripts/test_return_store_migration.py` — آزمایش نصب مرجوعی و پشتیبان قابل بازیابی روی پایگاه‌های موقت.
- `scripts/test_return_order_snapshots.py` — آزمون ثبت اتمیک حجم خرید هنگام سفارش، قطع ناگهانی و سازگاری فروشگاه قدیمی.
- `scripts/test_return_account_read.py` — آزمون داده خواندنی شرایط مرجوعی در سفارش‌های صاحب حساب تأییدشده.
- `src/routes/account-returns.js` — مسیرهای ثبت زمان تحویل و درخواست صاحب حساب با احراز و کنترل دسترسی.
- `scripts/test_account_returns_api.py` — آزمون API مرجوعی، مالکیت، ثبت همزمان تیکت و پاسخ مدیریت.
- `scripts/test_account_returns_gate.js` — آزمون احراز هویت و بسته‌ماندن API مرجوعی هنگام فقدان ساختار دیتابیس.
- `scripts/test_account_returns_browser.py` — آزمون مرورگر فرم آزمایشی مرجوعی حساب، تعداد، وضعیت، سمپل و نمایش پاسخ.
- `scripts/test_admin_delivery_browser.py` — آزمون مرورگر فرم آزمایشی ثبت زمان واقعی تحویل و تبدیل زمان تهران.
- `scripts/test_account_returns_journey.py` — سفر آزمایشی خرید، پرداخت شبیه‌سازی‌شده، تحویل، مرجوعی و پاسخ مدیریت.
- `scripts/test_service_worker_freshness_browser.py` — آزمون واقعی به‌روزرسانی کد، آفلاین و عدم کش نشانی‌های حساس.
- `scripts/test_analytics_trusted_proxy.js` — آزمون استفاده تحلیل بازدید از پروکسی مورد اعتماد، بدون ذخیره IP خام.
- `src/script-element-csp.js` — محاسبه هش اسکریپت‌های قالب مورداعتماد برای سیاست CSP3؛ رویدادهای درون‌خطی هنوز مجازند.
- `scripts/test_script_element_csp.js` — آزمون هش قالب، نرمال‌سازی و رد سیاست نامعتبر.
- `scripts/test_script_element_csp_browser.py` — آزمون مرورگر واقعی CSP و سلامت صفحه‌های کلیدی.
- `scripts/test_checkout_async_safety_browser.py` — آزمون مرورگر CSP تسویه، پاسخ‌های خارج از ترتیب و جلوگیری از ثبت هم‌زمان سفارش.
- `src/order-idempotency.js` — پایه آزمایشی کلید تکرارناپذیری سفارش؛ هنوز به API یا صفحه تسویه متصل نیست.
- `scripts/test_order_idempotency.js` — آزمون ایزوله حفظ شناسه، تراکنش و رقابت برای کلید یکسان.
