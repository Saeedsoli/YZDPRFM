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

## ۲. بنرهای اصلی و ۶ پرامپت هوش مصنوعی جهت تولید تصویر (Generative Prompts)

تصاویر زیر تولیدشده و در پوشه `images/` پروژه جهت استفاده در بنرهای هیرو و دسته‌بندی‌ها قرار گرفته‌اند:

| شماره بنر | عنوان بنر | مسیر فایل در ورک‌استیس | پرامپت هوش مصنوعی (AI Prompt) |
|---|---|---|---|
| **۱** | **Hero Banner (صفحه اصلی)** | `images/hero_banner.jpg` | `Ultra-luxurious minimalist hero banner for high-end perfume brand Yazd Perfume. A clear glass artisan perfume bottle with custom gold metallic cap resting on warm sand textured surface. Soft warm amber rim lighting, dark velvet obsidian background, artistic editorial lighting, high resolution, 8k, photorealistic, cinematic depth of field. No text on image.` |
| **۲** | **مجموعه سمپل‌ها و دکانت‌ها** | `images/samples_banner.jpg` | `Luxury minimalist display of three 3ml glass sample decant vials with gold spray nozzles, lined up neatly on dark slate stone. Elegant soft backlighting, subtle perfume droplets, high end perfume photography, 8k resolution, cinematic atmosphere. No text on image.` |
| **۳** | **عطر مو (Hair Mist)** | `images/hair_mist_banner.jpg` | `Minimalist luxury hair mist perfume bottle surrounded by floating water droplets and delicate white jasmine flower petals. Clean nude background, warm ambient lighting, high fashion commercial product photography, sharp focus, 8k. No text on image.` |
| **۴** | **بادی اسپلش (Body Splash)** | `images/body_splash_banner.jpg` | `Fresh luxury body splash perfume bottle with dynamic water spray splash, fresh bergamot slices and citrus in background. Clean bright minimalist aesthetic, golden hour sunlight reflections, ultra detailed, 8k. No text on image.` |
| **۵** | **نُت‌ها و ترکیبات بویایی** | `images/ingredients_banner.jpg` | `Artistic arrangement of raw perfume ingredients: sandalwood block, natural vanilla beans, fresh bergamot, rose petals on textured stone pedestal. Dark moody minimalist lighting, luxury perfume notes visual, editorial photorealistic 8k. No text on image.` |
| **۶** | **هنر بازآفرینی دست‌ساز** | `images/craftsmanship_banner.jpg` | `Artisan perfumer carefully pouring pure amber perfume essence into a clear luxury glass bottle using glass dropper. Warm candlelight amber glow, dark velvet workshop background, hands of master craftsman, elegant cinematic depth of field, 8k. No text on image.` |

---

## ۳. دستورالعمل بهینه‌سازی فنی تصاویر بنرها
- **Hero Banners:** ابعاد `1920x800px` (دسکتاپ) / `800x1000px` (موبایل) | فشرده‌سازی با الگوریتم AVIF/WebP | لود با `priority={true}`.
- **Category Banners:** ابعاد `800x500px` | لود با `loading="lazy"`.
