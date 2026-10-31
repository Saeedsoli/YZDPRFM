# بازبینی بخشی از نت‌ها در منابع رسمی

این سند، بررسی هویت اسانس تأمین‌کننده یا انتساب قطعی قیمت فهرست نیست. تنها نت‌هایی را ثبت می‌کند که در متن صفحه رسمی محصول اصلی توضیح داده شده‌اند؛ حذف یک نت از فهرست زیر به معنی اثبات نبودن آن در فرمول نیست. زمان بررسی: ۲۰۲۶-۱۰-۳۱.

| محصول | منبع رسمی | آنچه بررسی شد |
|---|---|---|
| Creed Green Irish Tweed | https://www.creedfragrance.com/p/green-irish-tweed/12870035/ | آغاز با ترنج، لیمو و نعناع فلفلی؛ میانه با شمعدانی و اسطوخودوس؛ پایه با خزه بلوط و نت‌های چوبی. |
| Creed Silver Mountain Water | https://www.creedfragrance.com/p/silver-mountain-water/12870049/ | آغاز با ترنج و انگور فرنگی سیاه؛ میانه با چای و آکورد ازونیک؛ پایه با چوب صندل و مشک. |
| Creed Viking | https://www.creedfragrance.com/p/viking/12870053/ | نت‌های آغازین شامل ترنج، لیمو، فلفل صورتی و سیاه و نعناع فلفلی؛ پایه شامل سدر و وتیور هائیتی. صفحه مورد بررسی نت میانی را صریحاً تفکیک نکرده، پس برای آن ردیفی ادعا نشده است. |
| Parfums de Marly Greenley | https://us.parfums-de-marly.com/products/greenley | آغاز با ترنج، نارنگی و سیب سبز؛ میانه پتی‌گرن؛ پایه آمبروکس، چوب عنبری و سدر. |

## نحوه اعمال

`seed/official_note_corrections_v1.json` مقدار اولیه هر محصول، مقدار مستند و نشانی منبع را نگه می‌دارد. مهاجرت `src/official-notes.js` تنها زمانی هر سه بخش نت را جایگزین می‌کند که هر سه هنوز دقیقاً برابر نسخه اولیه باشند؛ مقادیر ویرایش‌شده نادیده گرفته می‌شوند. پس از هر تغییر، شاخص جستجوی نت‌ها بازسازی می‌شود. هیچ قیمت، سفارش یا وضعیت تأمینی در این فرآیند تغییر نمی‌کند.

در دیتابیس محلی این نوبت، هر چهار مورد اعمال و هیچ موردی رد نشد. داده و محتوای سایر فیلدها مانند عطرساز، یادداشت عطرساز و ادعاهای ماندگاری با این بررسی تأیید نشده‌اند.

## نوبت دوم — عطرهای پارفومز د مارلی

در این نوبت هرم‌های رایحه زیر از صفحات رسمی برند بررسی شد؛ مانند نوبت اول، تأیید نام محصول اصلی به معنی تأیید هویت اسانس تأمین‌کننده نیست و قیمت یا وضعیت سفارش تغییر نکرده است.

| محصول | منبع رسمی |
|---|---|
| Herod | https://us.parfums-de-marly.com/products/herod |
| Pegasus | https://us.parfums-de-marly.com/products/pegasus |
| Haltane | https://us.parfums-de-marly.com/products/haltane |
| Valaya | https://us.parfums-de-marly.com/products/valaya |
| Godolphin | https://us.parfums-de-marly.com/products/godolphin |
| Kalan | https://us.parfums-de-marly.com/products/kalan |

اطلاعات در `seed/official_note_corrections_v2.json` با نسخه اولیه برای مقایسه و حفظ ویرایش مدیر آمده است. شش اصلاح در دیتابیس محلی اعمال شد؛ اگر فیلدهای نت در دیتابیس دیگر با نسخه اولیه تفاوت داشته باشند، آن محصول به‌جای بازنویسی نادیده گرفته می‌شود.

## نوبت سوم — منابع رسمی و مورد افشانش‌نشده

| محصول | مرجع رسمی | اقدام |
|---|---|---|
| Byredo De Los Santos | https://www.byredo.com/us_en/de-los-santos-50ml | هرم نت درج‌شده در صفحه رسمی ثبت شد. |
| Byredo Rouge Chaotique | https://www.byredo.com/us_en/p/rouge-chaotique-night-veils-perfume-extract-70ml | هرم رسمی نسخه perfume extract ثبت شد. |
| Xerjoff Alexandria II | https://www.xerjoff.com/en-us/products/alexandria-ll-parfum | هرم رسمی نسخه parfum ثبت شد؛ تطبیق با اسانس تأمین‌کننده همچنان نیازمند بررسی است. |
| Montblanc Legend Spirit | https://www.montblanc.com/en-cl/montblanc-legend-spirit-eau-de-toilette-50-ml-MB115366VG.html | هرم رسمی eau de toilette ثبت شد. |
| Orto Parisi Megamare | https://ortoparisi.com/pages/faq | برند می‌گوید سازنده نت‌های عطرهایش را افشا نمی‌کند؛ سه فهرست قبلیِ نت از نمایش حذف شدند، نه اینکه عطر فاقد نت دانسته شود. |

هویت نسخه اسانس و قیمت تأمین‌کننده با این بازبینی تأیید نشده و هیچ قیمت یا وضعیتی تغییر نکرده است. داده فیلدهای دیگر مانند طبع، ماندگاری، سال عرضه و یادداشت عطرساز نیز صرفاً به دلیل این بررسی تأیید نمی‌شوند.

### پیش‌نویس‌های یادداشت عطرساز

در بررسی کد مشخص شد متن‌های اولیه با اسکریپت تولید شده بودند اما به صورت تجربه دست‌اول در صفحه عمومی نمایش می‌یافتند. چون از منشأ واقعی هر یادداشت در دیتابیس موجود نمی‌توان مطمئن شد، از جمله متن‌هایی که ممکن است بعداً دستی ویرایش شده باشند، همه یادداشت‌های موجود تا تأیید دستی به‌صورت پیش‌نویس باقی می‌مانند. خود متن‌ها حذف نشده‌اند. مدیر می‌تواند پس از بررسی صحت تجربه، در پنل یادداشت را ذخیره و صریحاً تأیید کند؛ فقط یادداشت تأییدشده در API عمومی و HTML قابل‌نمایش است. تولید مجدد پیش‌نویس نیز تأیید قبلی آن را برمی‌دارد.

## نوبت چهارم — Galloway، Babycat و Bright Crystal

- Parfums de Marly Galloway: https://us.parfums-de-marly.com/products/galloway — نت‌ها و دسته‌بندی مردانه مطابق صفحه رسمی مرجع ثبت شد.
- YSL Babycat: https://www.yslbeautyus.com/fragrance/le-vestiaire-des-parfums/the-signature-collection/babycat---le-vestiaire-des-parfums/WW-50920YSL.html — نت‌های آغازین، میانی و پایه طبق صفحه رسمی ثبت شد.
- Versace Bright Crystal Eau de Toilette: https://www.versace.com/us/en/women/accessories/fragrances-body-care/bright-crystal/bright-crystal-edt-90-ml-pink/R510032-R090MLS_RNUL.html — نت‌های نسخه EDT طبق صفحه رسمی ثبت شد. انتساب قیمت فهرست به این نسخه هنوز مستقلاً تأیید نشده است.
- Parfums de Marly Herod: https://us.parfums-de-marly.com/products/herod — صفحه رسمی مورد بررسی آن را unisex معرفی می‌کند؛ دسته‌بندی قبلی مرجع در دیتابیس محلی با محافظت در برابر تغییرات مالک به‌روزرسانی شد. دسته‌بندی محصول اصلی به معنی محدودیت استفاده از بازآفرینی دست‌ساز نیست و ممکن است بین بازارهای رسمی تغییر کند.

سه اصلاح نت در `seed/official_note_corrections_v4.json` و دو اصلاح دسته‌بندی در `seed/official_gender_corrections_v1.json` ثبت شده‌اند. برای دسته‌بندی، به‌روزرسانی فقط روی محصولات `UNAVAILABLE` با مقدار قبلیِ بدون تغییر اجرا می‌شود؛ موارد متفاوت یا فعال به‌طور خودکار تغییر نمی‌کنند. هیچ قیمت یا وضعیتی در این مرحله تغییر نکرد.
