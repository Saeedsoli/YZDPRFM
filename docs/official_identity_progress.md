# پیشرفت تطبیق هویت محصول مرجع

این سند وضعیت **۴۲ قیمت مرجعی** را نشان می‌دهد که پیش‌تر فقط با تطبیق نوشتاری وارد دیتابیس محلی شده بودند. عدد ۴۲ تعداد ردیف‌های کل فایل نیست و به معنای تکمیل بررسی کل فهرست نیست.

## آنچه بررسی شد

برای ۳۷ مورد، صفحه رسمی محصول مرجع پیدا و نشانی آن در `seed/official_identity_evidence_v1.json` ثبت شد. این به معنای تأیید وجود و نام **محصول اصلی** است؛ به‌تنهایی ثابت نمی‌کند اسانس تأمین‌کننده همان نسخه، همان کیفیت یا اورجینال است. هیچ قیمتی، موجودی یا وضعیت سفارش‌پذیری در این مرحله تغییر نکرد.

نمونه منابع:
- Creed Aventus: https://www.creedfragrance.com/p/aventus/12870029/
- Le Labo Santal 33: https://www.lelabofragrances.com/santal-33-147.html
- Tom Ford Oud Wood Eau de Parfum: https://www.tomfordbeauty.com/products/oud-wood-eau-de-parfum
- Orto Parisi Megamare: https://ortoparisi.com/products/megamare

وضعیت `official_original_found_supplier_essence_unverified` دقیقاً این محدودیت را ثبت می‌کند. جدول `official_identity_evidence` فقط شاهد هویت مرجع است؛ جدول `supplier_price_evidence` سابقه انتساب قیمت مرجع را نگه می‌دارد. اطلاعات این دو جدول مستقل‌اند و نباید به‌عنوان تأیید اصالت اسانس استفاده شوند.

برای نصب تازه، ۳۷ قیمت مرجع در `seed/official_reference_prices_v2.json` با منبع و کنترل ویرایش‌های قبلی بازسازی می‌شوند؛ پنج مورد حل‌نشده وارد این دسته نیستند. برای دیتابیس محلی موجود، فقط ۳۷ سابقه منبع به قیمت‌های قبلاً واردشده اضافه شد، بدون بازمحاسبه قیمت یا تغییر موجودی. اجرای این دسته را می‌توان در محیط نگهداری با `REFERENCE_PRICE_V2_AUTOMIGRATE=0` موقتاً متوقف کرد.

## پنج موردی که هنوز قطعی نشده‌اند

- **Kokorico** از Jean Paul Gaultier: در جستجوی این نوبت صفحه رسمی محصول قابل تأیید پیدا نشد. این به معنی عدم وجود محصول نیست.
- **Hindu Grass** از Nasomatto: صفحه رسمی محصول در جستجوی این نوبت پیدا نشد؛ نتیجه‌ای درباره توقف تولید گرفته نمی‌شود.
- **Akaster** از Parfums de Marly: صفحه رسمی محصول در جستجوی این نوبت پیدا نشد؛ نتیجه‌ای درباره توقف تولید گرفته نمی‌شود.
- **Invictus Intense**: خانواده Invictus چند نسخه متفاوت دارد و ارجاع رسمی فعلی به `Intense Parfum` به‌تنهایی تأیید نمی‌کند ردیف فهرست همان نسخه قبلی است. انتساب نسخه حدسی ممنوع است.
- **Supreme Bouquet**: صفحه رسمی فعلی `Gold – Le Vestiaire des Parfums` از عبارت «Gold Supreme Bouquet» استفاده می‌کند، اما این به‌تنهایی برابری قطعی نسخه فایل با نسخه قدیمی را ثابت نمی‌کند.

این موارد صرفاً در فهرست بررسی باقی می‌مانند. هیچ‌یک به‌دلیل نبود نتیجه جستجو حذف یا غیرفعال نشده‌اند؛ در دیتابیس محلی وضعیت همه محصولات از پیش غیرقابل سفارش بود.

## حفظ تغییر مدیر و ایمنی

`src/official-identities.js` فقط وقتی مدرک را درج می‌کند که شناسه، نامک، برند و نام لاتین محصول دقیقاً با داده اولیه بخوانند. برای رکورد موجود هیچ رونویسی انجام نمی‌شود. دامنه منبع برای هر برند محدود است. مهاجرت نه فیلدهای محصول را تغییر می‌دهد نه قیمت، و در دیتابیس تازه نیز تکرارپذیر است.

## شش تناظر نام دیگر

در ادامه، نام شش عطر مرجع دیگر با صفحات رسمی بررسی و قیمت مرجع از فایل کاربر، با انتخاب بالاترین قیمت مثبت همان نام منبع، به‌صورت **موقت و غیرفعال** ثبت شد:

| نام مرجع | ورودی فایل قیمت | صفحه رسمی |
|---|---|---|
| Creed Original Vetiver | Original Vetiver | https://www.creedfragrance.com/p/original-vetiver/12870044/ |
| Dior Homme Intense | HOMME INTENSE | https://www.dior.com/en_int/beauty/products/dior-homme-intense-Y0479201.html |
| Dior Sauvage Elixir | SAUVAGE ELIXIER | https://www.dior.com/en_cz/beauty/products/sauvage-elixir-Y0996460.html |
| Xerjoff Naxos | XJ 1861 NAXOS | https://www.xerjoff.com/products/naxos-eau-de-parfum |
| Tom Ford Lost Cherry | Lost Cherry | https://www.tomfordbeauty.com/products/lost-cherry-eau-de-parfum-set |
| YSL Tuxedo | Tuxedo | https://www.yslbeautyus.com/fragrance/le-vestiaire-des-parfums/the-signature-collection/tuxedo---le-vestiaire-des-parfums/809YSL.html |

این تطبیق‌ها بر پایه نام و منابع اصلی‌اند؛ کیفیت یا هویت واقعی اسانس فهرست همچنان مستقل تأیید نشده و وضعیت سفارش تغییر نکرده است. فیلد جنسیت فهرست مبنای تعیین شناسنامه محصول نبوده است. برای نگهداری قابل تکرار از `seed/official_identity_evidence_v2.json` و `seed/official_reference_prices_v3.json` استفاده می‌شود؛ شرایط مهاجرت، ویرایش مدیر و محصولات فعال را دست‌نخورده نگه می‌دارد.

## شش تناظر بعدی

در این مرحله نام عطرهای مرجع زیر در صفحه رسمی برند بررسی و بالاترین قیمت مثبتِ ردیف متناظر فایل کاربر به‌صورت موقت ثبت شد؛ هیچ‌کدام خودکار قابل سفارش نشده‌اند:

| نام مرجع | متن فایل قیمت | صفحه رسمی |
|---|---|---|
| Jean Paul Gaultier Le Male Elixir | Le Male Elixier | https://www.jeanpaulgaultier.com/nl/nl/p/assortiment-le-male/le-male-elixir-parfum-000000000065188980 |
| Kilian Angels' Share | Angels' Share | https://www.bykilian.com/product/19797/82905/perfume/angels-share/the-liquors |
| Tom Ford Vanilla Sex | VANILA SEX | https://www.tomfordbeauty.com/products/vanilla-sex-eau-de-parfum |
| Parfums de Marly Percival | Percival | https://us.parfums-de-marly.com/products/percival |
| Parfums de Marly Sedley | Sedley | https://us.parfums-de-marly.com/products/sedley |
| Xerjoff Torino24 | TORINO 24 | https://www.xerjoff.com/en-us/products/torino24-eau-de-parfum-15ml |

Torino24 پیش‌تر در کاتالوگ نبود و به‌صورت محصول مرجع دست‌ساز به داده اولیه اضافه شد. چون صفحات رسمی بررسی‌شده درباره هرم نت آن همخوان نبودند، نت‌ها حدسی پر نشدند. برای همه موارد، تناظر نامِ محصول اصلی هویت یا نسخه واقعی اسانس تأمین‌کننده را مستقل تأیید نمی‌کند. داده‌های ورود در `seed/official_reference_prices_v4.json` و منابع در `seed/official_identity_evidence_v3.json` نگهداری می‌شوند.

## هشت تناظر دیگر؛ بولگاری، اسنتریک و لنکوم

در این نوبت هشت نام عطر مرجع در صفحات رسمی بررسی شد: **Le Gemme Ambero، Falkar، Onekh، Molecule 01، Molecule 02، Molecule 04، Miracle و Trésor Midnight Rose**. قیمت مرجع هر یک از ردیف متناظر فایل کاربر انتخاب شده است؛ این تناظر، تأیید مستقل هویت یا کیفیت اسانس واقعی نیست. هیچ وضعیت سفارشی فعال نشده است.

- منابع رسمی در `seed/official_identity_evidence_v4.json`.
- قیمت‌های مرجع موقت و پیش‌شرط‌های محافظت از ویرایش مدیر در `seed/official_reference_prices_v5.json`.
- نت‌ها یا نت‌های کلیدی بدون دسته‌بندی در `seed/official_note_corrections_v8.json`.
- صفحات رسمی Molecule 01/02/04 به‌ترتیب یک مولکول بویایی را بیان می‌کنند؛ هرم سه‌مرحله‌ای مصنوعی برای آن‌ها ثبت نشده است. نبود هرم به معنی بی‌بو بودن عطر نیست.
- در صفحه رسمی Miracle، جایگاه یاس در متن و فهرست تفکیکی یکسان نیست. برای پرهیز از حدس، جایگاه اختلافی یاس در هرم ثبت نشده است.
