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
| `restore_backup.js` | بازیابی پشتیبان · `--list` |
| `reset_for_launch.js` | **پاک‌سازی داده آزمونی پیش از افتتاح** · `--dry-run` / `--yes` |
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
- `scripts/test_secondary_reference_v11.js`
- `scripts/test_secondary_reference_v12.js`
- `scripts/test_secondary_reference_v13.js`
- `scripts/test_secondary_reference_v14.js`
- `scripts/test_official_notes_v32.js`
