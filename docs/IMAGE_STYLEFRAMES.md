# راهنمای سبک بصری و بنرهای عکاسی (Image Styleframes & Prompt Specifications)
**پروژه:** فروشگاه آنلاین عطر یزد | Yazd Perfume  
**سبک بصری:** مینیمال لوکس، عکاسی استودیویی با نورپردازی گرم کهربایی و تضاد با بافت‌های طبیعی (سنگ، ماسه گرم، شیشه شفاف و چوب).

---

## ۱. استانداردهای عکاسی و کاور محصولات (Image Guidelines)

1. **کاور اصلی محصولات (Primary Product Cover):**
   - پس‌زمینه خنک/کرم یکدست خنثی با سایه ملایم شیشه عطر روی سطح.
   - شیشه عطر با درپوش طلایی/مشکی لوکس در مرکز تصویر.
   - ابعاد استاندارد: `1000x1000px` (مربع ۱:۱) | فرمت خروجی: `AVIF` / `WebP` (کمتر از ۴۰ کیلوبایت).
2. **تصاویر ثانویه گالری PDP (Secondary Gallery Images):**
   - تصویر شیشه سمپل ۳ میل در کنار شیشه اصلی جهت قیاس مقیاس.
   - تصویر مواد اولیه تشکیل‌دهنده (نُت‌های اصلی).
   - تصویر بسته‌بندی هاردباکس ارسالی با فوم عایق.

---

## ۲. بنرهای اصلی و پرامپت‌های تولید تصویر (Generative Prompts)

> **به‌روزرسانی مرداد ۱۴۰۵ — پاک‌سازی ورک‌اسپیس:**
> از شش بنر تولیدشده در دور اول، **پنج تای‌شان هرگز به هیچ صفحه‌ای
> وصل نشدند** و ۱٫۶ مگابایت جا اشغال می‌کردند. فایل‌هایشان حذف شد
> ولی پرامپت‌ها اینجا می‌مانند تا اگر روزی صفحه‌ای لازمشان داشت،
> با همان زبان بصری دوباره ساخته شوند.
>
> فایل‌های حذف‌شده در تاریخچه گیت هستند و با دستور زیر برمی‌گردند:
> ```bash
> git checkout 3aa54f0 -- public/images/hero_banner.jpg
> ```

### بنرهای فعال

| فایل | کجا استفاده می‌شود |
|---|---|
| `/videos/hero-craft.webm` و `/videos/hero-craft.mp4` + `/images/hero-video-poster.webp` | ویدیوی کارگاه در هیرو؛ پوستر برای fallback/لود اولیه |
| `images/ingredients_banner.{jpg,webp}` | کاور پیش‌فرض مقاله‌های بدون تصویر (`src/routes/articles.js`) |

### پرامپت‌ها — برای بازتولید در آینده

| عنوان بنر | وضعیت فایل | پرامپت هوش مصنوعی (AI Prompt) |
|---|---|---|
| **Hero Banner (صفحه اصلی)** | ❌ آرشیوی — هیرو اکنون ویدیوی کارگاه با پوستر fallback است | `Ultra-luxurious minimalist hero banner for high-end perfume brand Yazd Perfume. A clear glass artisan perfume bottle with custom gold metallic cap resting on warm sand textured surface. Soft warm amber rim lighting, dark velvet obsidian background, artistic editorial lighting, high resolution, 8k, photorealistic, cinematic depth of field. No text on image.` |
| **مجموعه سمپل‌ها و دکانت‌ها** | ❌ حذف شد — صفحه `/samples` بنر ندارد | `Luxury minimalist display of three 3ml glass sample decant vials with gold spray nozzles, lined up neatly on dark slate stone. Elegant soft backlighting, subtle perfume droplets, high end perfume photography, 8k resolution, cinematic atmosphere. No text on image.` |
| **عطر مو (Hair Mist)** | ❌ حذف شد — دسته‌بندی صفحه اختصاصی ندارد | `Minimalist luxury hair mist perfume bottle surrounded by floating water droplets and delicate white jasmine flower petals. Clean nude background, warm ambient lighting, high fashion commercial product photography, sharp focus, 8k. No text on image.` |
| **بادی اسپلش (Body Splash)** | ❌ حذف شد — دسته‌بندی صفحه اختصاصی ندارد | `Fresh luxury body splash perfume bottle with dynamic water spray splash, fresh bergamot slices and citrus in background. Clean bright minimalist aesthetic, golden hour sunlight reflections, ultra detailed, 8k. No text on image.` |
| **نُت‌ها و ترکیبات بویایی** | ✅ **فعال** — کاور پیش‌فرض مقاله | `Artistic arrangement of raw perfume ingredients: sandalwood block, natural vanilla beans, fresh bergamot, rose petals on textured stone pedestal. Dark moody minimalist lighting, luxury perfume notes visual, editorial photorealistic 8k. No text on image.` |
| **هنر بازآفرینی دست‌ساز** | ❌ حذف شد — صفحه `/why-us` متن‌محور است | `Artisan perfumer carefully pouring pure amber perfume essence into a clear luxury glass bottle using glass dropper. Warm candlelight amber glow, dark velvet workshop background, hands of master craftsman, elegant cinematic depth of field, 8k. No text on image.` |

> **درسی که از این پاک‌سازی گرفته شد:** تصویر را وقتی بسازید که
> صفحه‌اش آماده است، نه پیش از آن. شش بنر پیشاپیش تولید شد و
> پنج‌تایشان هرگز جایی پیدا نکردند — چون صفحه‌های `/samples` و
> `/why-us` در عمل متن‌محور طراحی شدند و دسته‌بندی «عطر مو» و
> «بادی اسپلش» فقط نوع واریانت‌اند، نه صفحه مستقل.

---

## ۳. دستورالعمل بهینه‌سازی فنی تصاویر بنرها
- **Hero Banners:** ابعاد `1920x800px` (دسکتاپ) / `800x1000px` (موبایل) | فشرده‌سازی با الگوریتم AVIF/WebP | لود با `priority={true}`.
- **Category Banners:** ابعاد `800x500px` | لود با `loading="lazy"`.
