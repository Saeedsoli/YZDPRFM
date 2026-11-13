# ثبت سایت در گوگل و موتورهای هوش مصنوعی

**تاریخ: ۲۲ آبان ۱۴۰۵**

این سند دو بخش دارد: آنچه **در کد آماده شد** و آنچه **فقط خودت می‌توانی انجام بدهی** (چون به حساب گوگل، دامنه و DNS نیاز دارد).

---

## بخش یک — آماده‌شده در کد

| مورد | نشانی | وضعیت |
|---|---|---|
| robots.txt با مجوز صریح خزنده‌های AI | `/robots.txt` | ✅ |
| نقشه سایت فهرست‌دار | `/sitemap.xml` | ✅ |
| نقشه صفحه‌ها (۱۱) | `/sitemap-pages.xml` | ✅ |
| نقشه محصول‌های قابل سفارش (۲۶۵) | `/sitemap-products.xml` | ✅ |
| نقشه مقاله‌ها (۵) | `/sitemap-articles.xml` | ✅ |
| راهنمای مدل‌های زبانی | `/llms.txt` | ✅ |
| فید RSS مجله | `/feed.xml` | ✅ |
| داده ساختاریافته OnlineStore با مرز ادعا | صفحه اصلی | ✅ |
| کلید IndexNow (اعلام سریع تغییرها) | `/<key>.txt` | ✅ |

**خزنده‌هایی که صریحاً مجاز شدند:** GPTBot، OAI-SearchBot، ChatGPT-User، ClaudeBot، Claude-User، anthropic-ai، PerplexityBot، Perplexity-User، Google-Extended، Applebot-Extended، CCBot، meta-externalagent، Bytespider.

**مسیرهای بسته برای همه:** `/admin`، `/api/`، `/account`، `/cart`، `/checkout`، `/wishlist`، `/login`، `/invoice`، `/label`، `/payment/`، `/offline`، `/review/`.

**مرز ادعا در llms.txt و schema:** محصولات «بازآفرینی دست‌ساز» و «اورجینال نیستند»، «هویت اسانس تأیید نشده»، حلال اتانول آرایشی. این‌ها عمداً در فایل ماشین‌خوان آمده‌اند تا مدل زبانی از خودش ادعای اصالت نسازد.

---

## بخش دو — کارهایی که باید خودت انجام بدهی

### ۱) Google Search Console

1. به [search.google.com/search-console](https://search.google.com/search-console) برو و با حساب گوگل وارد شو.
2. **Add property ← Domain** را بزن و دامنه را بدون `https://` وارد کن (`yazdperfume.ir`).
3. یک رکورد **TXT** در DNS دامنه اضافه کن (مقدارش را گوگل می‌دهد).
4. پس از تأیید، در بخش **Sitemaps** نشانی `https://yazdperfume.ir/sitemap.xml` را ثبت کن.
5. در **URL Inspection** نشانی صفحه اصلی را بگذار و **Request indexing** بزن.

> اگر به DNS دسترسی نداری، گزینه **URL prefix** را انتخاب کن؛ با گذاشتن یک فایل در ریشه سایت تأیید می‌شود. فایل تأیید را در `public/` بگذار و به ما بگو تا در بسته استقرار باشد.

### ۲) Bing Webmaster Tools

1. [bing.com/webmasters](https://www.bing.com/webmasters) — گزینه «Import from Google Search Console» سریع‌ترین راه است.
2. نشانی نقشه سایت را ثبت کن. Bing به IndexNow وصل است، پس اعلام‌های ما را سریع می‌گیرد.
3. بعد از استقرار اجرا کن:
   ```bash
   node scripts/submit_indexnow.js https://yazdperfume.ir
   ```
   این اسکریپت اول مطمئن می‌شود فایل کلید واقعاً در دسترس است، بعد همه نشانی‌های نقشه سایت را اعلام می‌کند.

### ۳) ابزارهای هوش مصنوعی

- **OpenAI (ChatGPT Search):** ثبت جداگانه‌ای ندارد؛ اگر `GPTBot` و `OAI-SearchBot` در robots مجاز باشند و سایت ایندکس شود، خودشان می‌آیند. در [platform.openai.com](https://platform.openai.com/docs/bots) می‌توانی خزنده‌ها را ببینی.
- **Anthropic (Claude):** مشابه؛ `ClaudeBot` مجاز شده است. مستندات: [support.anthropic.com](https://support.anthropic.com).
- **Perplexity:** `PerplexityBot` مجاز شده؛ فرم اختصاصی ندارد.
- **Google AI Overviews:** از همان ایندکس گوگل استفاده می‌کند. یعنی کار Search Console کافی است.

**نکته مهم:** «حضور در پاسخ هوش مصنوعی» تضمین‌شدنی نیست. کاری که می‌کنیم درست است (مجوز، محتوای ساختاریافته، حقیقت روشن)، ولی نتیجه به عوامل بیرونی بستگی دارد و باید **شش تا دوازده هفته** اندازه‌گیری شود، نه فردا.

### ۴) بعد از استقرار، این‌ها را چک کن

```bash
# همه باید ۲۰۰ بدهند
curl -sI https://yazdperfume.ir/robots.txt
curl -sI https://yazdperfume.ir/sitemap.xml
curl -sI https://yazdperfume.ir/llms.txt
curl -sI https://yazdperfume.ir/feed.xml

# نقشه در مرورگر باید XML معتبر نشان بدهد
# https://yazdperfume.ir/sitemap.xml
```

اگر `SITE_URL` روی سرور تنظیم نشده باشد، نقشه‌ها دامنه پیش‌فرض را می‌سازند و گوگل آن‌ها را رد می‌کند. **قبل از ثبت در Search Console، `SITE_URL` را در تنظیمات لیارا برابر دامنه واقعی بگذار.**

### ۵) چیزهایی که هنوز کم است

- **دامنه واقعی و HTTPS:** تا این آماده نشود، ثبت در هر ابزاری بی‌معنی است.
- **محتوای تازه:** مجله پنج مقاله دارد. برای رشد پایدار در جست‌وجو، هفته‌ای یک مقاله تازه لازم است.
- **دریافت بک‌لینک:** بدون لینک از سایت‌های دیگر، رشد سخت است. دایرکتوری‌های ایرانی و معرفی در شبکه‌های اجتماعی کم‌هزینه‌ترین شروع‌اند.
