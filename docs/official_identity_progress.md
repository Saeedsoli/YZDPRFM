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

## پنج تناظر دیگر؛ آرمانی، ژیوانشی، اینیشیو و تیزیانا ترنزی

پنج انتساب قیمت موقت بر اساس نام و بالاترین قیمت مثبت همان نام در فایل ثبت شد؛ هویت و کیفیت واقعی اسانس تأمین‌کننده مستقل تأیید نشده‌اند و هیچ‌کدام قابل سفارش نشده‌اند:

| عطر مرجع | دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| Stronger With You | 119.9 | B | https://www.giorgioarmanibeauty-usa.com/fragrances/view-all-fragrances/stronger-with-you-eau-de-toilette/A2061.html |
| Ange Ou Démon Le Secret | 220 | H | https://www.givenchybeauty.com/us/p/ange-ou-demon-le-secret-F10100004.html |
| Oud for Greatness | 352 | H | https://us.initioparfums.com/products/oud-for-greatness |
| Side Effect | 137.5 | P | https://us.initioparfums.com/products/side-effect |
| Kirkè | 355.3 | H | https://tizianaterenzi.com/en/fragrance-wheel/ |

صفحه آرمانی درباره نسخه اصلی **Eau de Toilette** است و غلظت محصول دست‌ساز را تعیین نمی‌کند. نسخه‌های Oud for Greatness NEO و Kirkè Overdose محصولات متفاوت‌اند و با ردیف‌های این دسته یکی نشده‌اند. در صفحه‌های آرمانی، اینیشیو و تیزیانا ترنزی نت‌های تأییدشده به‌صورت کلیدی و بدون هرم آمده‌اند؛ برای آن‌ها هرم سه‌مرحله‌ای حدسی حذف شده است. برای ژیوانشی تنها نت‌های طبقه‌بندی‌شده خود صفحه رسمی ثبت شده‌اند. نت‌ها مربوط به عطرهای مرجع‌اند، نه گواه فرمول اسانس تأمین‌کننده.

مدارک در `seed/official_identity_evidence_v6.json`، قیمت‌ها در `seed/official_reference_prices_v7.json` و اصلاح نت‌ها در `seed/official_note_corrections_v9.json` ثبت شده‌اند. تغییرات با محافظ ویرایش مدیر و در حالت غیرقابل سفارش اعمال می‌شوند.

## سه تناظر دیگر؛ کیلین، پنهالیگونز و موگلر

| عطر مرجع | دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| Black Phantom - Memento Mori | 256.3 | P | https://www.bykilian.com/product/19797/141058/perfume/black-phantom--memento-mori-icon-set |
| The Blazing Mister Sam | 289.3 | H | https://www.penhaligons.com/fr/en/p/the-blazing-mister-sam-eau-de-parfum-75ml--000000000065173422 |
| Womanity | 89.1 | P | https://inter.mugler.com/default/fragrance/women-s-fragrances/womanity/womanity-eau-de-parfum/M01090105.html |

این‌ها تطبیق نام مرجع و قیمت موقت‌اند، نه تأیید هویت، اصالت یا کیفیت اسانس تأمین‌کننده؛ محصولات غیرقابل سفارش باقی می‌مانند. صفحه کیلین می‌گوید ست مورد استناد حاوی همان رایحه Black Phantom است. صفحات سه برند نت‌های کلیدی را بدون هرم ارائه کرده‌اند، پس نت‌ها بدون تقسیم‌بندی اختراعی ثبت شدند. صفحه آمریکایی موگلر محصول اصلی Womanity را متوقف‌شده معرفی می‌کند، در حالی که صفحه بین‌المللی آن را معرفی می‌کند؛ نتیجه این اختلاف را به همه بازارها تعمیم نمی‌دهیم و در مورد اسانس دست‌ساز هم نتیجه نمی‌گیریم.

ردیف `PARADISE GARDEN` عمداً وارد این دسته نشد: برند دو محصول مستقل **Le Beau Paradise Garden** و **La Belle Paradise Garden** معرفی می‌کند و نام اختصاری فایل به‌تنهایی نسخه را روشن نمی‌کند. برای Tygar نیز صفحه رسمی نسخه EDP و Extrait را جداگانه نشان می‌دهد؛ ردیف بدون ذکر نسخه به‌طور قطعی به یکی از آن‌ها نسبت داده نشد.

منابع و قیمت‌ها در `seed/official_identity_evidence_v7.json`، `seed/official_reference_prices_v8.json` و نت‌های مرجع در `seed/official_note_corrections_v10.json` نگهداری می‌شوند.

## باکارات رژ ۵۴۰ اکستریت

برای `YZD-PROD-0615` نام **Baccarat Rouge 540 Extrait de Parfum** با [صفحه رسمی برند](https://www.franciskurkdjian.com/int-en/p/baccarat-rouge-540-extrait-de-parfum-RA142321.html) تطبیق داده شد. ردیف `Baccarat Rouge 540 Extrait` در فایل، با بالاترین قیمت مثبت ۲۸۷٫۱ دلار/کیلو و کیفیت H، به‌صورت موقت نسبت داده شد. املای `Francic Kurkdjian` در فایل با نام رسمی برند تفاوت دارد؛ تطبیق، هویت یا کیفیت واقعی اسانس را اثبات نمی‌کند. محصول و همه واریانت‌ها همچنان غیرفعال و موجودی صفر دارند.

صفحه رسمی فقط یاس گراندیفلوروم را صراحتاً در نت میانی جای می‌دهد؛ بادام تلخ، اتیل مالتول و آکوردهای توصیف‌شده بدون تعیین جایگاه ثبت شدند. هرم قدیمیِ تأییدنشده فقط در صورت دست‌نخورده بودن حذف می‌شود. مشخصات به عطر مرجع اصلی مربوط‌اند، نه فرمول اسانس تأمین‌کننده.

برای `Platinium`، [صفحه رسمی Chanel Platinum Égoïste](https://www.chanel.com/gb/fragrance/p/124460/platinum-egoiste-eau-de-toilette-spray/) پیدا شد، اما ردیف فایل نام کامل Égoïste را ندارد؛ فعلاً نسبت قیمت صرفاً بر اساس نام ناقص انجام نشد. این وضعیت به معنی نبود محصول یا تأیید جنسیت ذکرشده در فایل نیست.

منابع و قیمت در `seed/official_identity_evidence_v8.json` و `seed/official_reference_prices_v9.json`، و اصلاح نت‌ها در `seed/official_note_corrections_v11.json` نگهداری می‌شود.

## وایت فلاورز کرید و آکوا دی جیو پرفومو

- **White Flowers**: محصول مرجع در [صفحه رسمی کرید](https://www.creedfragrance.com/p/royales-exclusives-white-flowers/12900138/) تأیید شد و چون در کاتالوگ محلی پیدا نشد، محصول دست‌ساز `SUP-CR-900009` به داده اولیه اضافه شد. قیمت مرجع ردیف فایل ۴۲۷٫۹ دلار/کیلو، کیفیت H است. نت‌ها از [مقاله رسمی کرید](https://creedfragrance.com/journal/floral-fragrances.list) هستند؛ جنسیت از فایل تأمین‌کننده استنتاج نشده است.
- **Acqua Di Giò Profumo**: نام عطر مرجع با [صفحه رسمی آرمانی آمریکا](https://www.giorgioarmanibeauty-usa.com/discontinued/acqua-di-gio-profumo/A019.html) بررسی و قیمت مرجع ۲۲۵٫۵ دلار/کیلو، کیفیت H، به‌صورت موقت ثبت شد. صفحه رسمی آمریکا عطر اصلی را متوقف‌شده معرفی می‌کند؛ این نتیجه را به همه بازارها یا اسانس دست‌ساز تعمیم نمی‌دهیم. صفحه ترکیب را بدون هرم سه‌مرحله‌ای توصیف می‌کند، بنابراین تنها نت‌های کلیدی آن ثبت شدند.

هر دو انتساب صرفاً بر اساس نام‌اند؛ اصالت، هویت و کیفیت اسانس واقعی تأمین‌کننده مستقل تأیید نشده است. وضعیت هر دو محصول `UNAVAILABLE` است و واریانت‌های قیمت‌گذاری‌شده موجودی صفر دارند. مدارک در `seed/official_identity_evidence_v9.json`، قیمت‌ها در `seed/official_reference_prices_v10.json` و اصلاح نت آرمانی در `seed/official_note_corrections_v12.json` ثبت شده‌اند.

نام `ABSOLUE AVENTUS` در فهرست را به Aventus معمولی نسبت ندادیم؛ صفحه رسمی، Absolu Aventus را محصول متمایز معرفی می‌کند و صفحات رسمی آن توصیف‌های متفاوتی برای نسخه‌های کنونی و محدود دارند. نسخه واقعی اسانس هنوز تأیید نشده است.

## شش تناظر دیگر — دسته سریع‌تر و کنترل‌شده

در این دسته شش قیمت مرجع موقت با بالاترین قیمت مثبت ثبت شد. همه محصولات `UNAVAILABLE` و واریانت‌های قیمت‌گذاری‌شده با موجودی صفر هستند. تطبیق نام و صفحه عطر اصلی، **هویت و کیفیت واقعی اسانس تأمین‌کننده را اثبات نمی‌کند**.

| عطر مرجع | قیمت دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| Layton | 427.9 | H | https://us.parfums-de-marly.com/products/layton |
| Irish Leather | 265.1 | H | https://us.memoparis.com/products/irish-leather-eau-de-parfum-30ml |
| Explorer | 209 | H | https://www.montblanc.com/en-be/explorer-eau-de-parfum-60-ml-MB124070.html |
| Versace Pour Homme | 330 | T | https://www.versace.com/us/en/men/accessories/fragrances-body-care/pour-homme/pour-homme-edt-100-ml-blue/R720010-R100MLS_RNUL.html |
| Pour Un Homme de CARON | 224.4 | H | https://www.parfumscaron.com/en/products/pour-un-homme-vaporisateur |
| Montblanc Emblem | 269.5 | H | https://www.montblanc.com/en-us/eau-de-toilette_cod23471478575779015.html |

`Emblem` در جست‌وجوی کاتالوگ محلی پیدا نشد و به صورت محصول دست‌ساز `SUP-MB-900010` بدون حدس جنسیت ایجاد شد. `Irish Leader` املای فایل و `Irish Leather` نام رسمی است. در فایل یک ردیف با مدل `Layton`، نام فارسی «دلینا» دارد؛ این تعارض حفظ و مستند شده و قیمت انتخابی ۴۲۷٫۹ دلار از ردیف دارای نام فارسی لیتون است، نه از آن ردیف متعارض. هیچ نتیجه‌ای درباره هویت اسانس با تکیه بر این تشابه گرفته نمی‌شود.

برای Explorer دو صفحه رسمی طبقه‌بندی متفاوتی از نت‌ها دارند؛ فقط نت‌های مشترک بدون هرم ثبت شد. برای Versace Pour Homme متن و هرم رسمی درباره نت پایه کاملاً همخوان نیستند؛ بخش اختلافی حدسی در هرم قرار نگرفت. نت‌ها توصیف عطر مرجع اصلی‌اند. صفحات مورد استناد برای Versace و CARON نسخه EDT را توصیف می‌کنند و این الزاماً غلظت محصول دست‌ساز یا نسخه اسانس تأمین‌کننده نیست. منابع، قیمت‌ها و اصلاح نت در `seed/official_identity_evidence_v10.json`، `seed/official_reference_prices_v11.json` و `seed/official_note_corrections_v13.json` آمده‌اند.

## پنج تناظر کازاموراتی / زرژوف

پنج قیمت مرجع موقت دیگر ثبت شد. فهرست تأمین‌کننده این رایحه‌ها را زیر `XERJOFF` آورده و کاتالوگ محلی زیر `Casamorati` دارد؛ صفحات رسمی زرژوف این نام‌ها را در مجموعه Casamorati معرفی می‌کنند.

| عطر مرجع | دلار/کیلو | کیفیت فایل | صفحه رسمی |
|---|---:|---|---|
| Bouquet Ideale | 223.3 | H | https://www.xerjoff.com/products/bouquet-ideale-eau-de-parfum |
| Dama Bianca | 130.9 | P | https://www.xerjoff.com/en-us/products/dama-bianca-eau-de-parfum |
| Lira | 180.4 | H | https://www.xerjoff.com/en-us/products/lira-eau-de-parfum |
| Gran Ballo | 221.1 | H | https://www.xerjoff.com/en-us/products/gran-ballo-eau-de-parfum |
| Mefisto | 178.2 | H | https://www.xerjoff.com/en-us/products/mefisto-eau-de-parfum |

Mefisto با Mefisto Gentiluomo یکی نیست. در برخی صفحات قدیمی رسمی برای Bouquet Ideale، Lira و Gran Ballo توصیف‌های اضافی یا متفاوتی دیده می‌شود؛ نت‌های ثبت‌شده مطابق جدول ساختاری صفحه رسمی محصول در نشانی‌های بالا هستند و موارد اختلافی اضافه نشدند. داده‌ها توصیف عطر مرجع‌اند؛ هویت، نسخه یا کیفیت اسانس واقعی تأمین‌کننده مستقل تأیید نشده است. هیچ محصولی خودکار قابل سفارش نشده است.

مدارک و قیمت‌ها در `seed/official_identity_evidence_v11.json` و `seed/official_reference_prices_v12.json` و اصلاح نت‌ها در `seed/official_note_corrections_v14.json` نگهداری می‌شوند.

## پنج تناظر و چهار محصول تکمیلی

| عطر مرجع | قیمت دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| La vie est belle Eau de Parfum | 245.3 | H | https://www.lancome-usa.com/fragrance/fragrance-by-collection/la-vie-est-belle/la-vie-est-belle-eau-de-parfum/100606.html |
| Fleur Narcotique | 291.5 | H | https://us.ex-nihilo-paris.com/products/fleur-narcotique-eau-de-parfum |
| Blue Talisman | 286 | H | https://us.ex-nihilo-paris.com/products/blue-talisman-eau-de-parfum |
| Her Majesty The Oud | 190.3 | H | https://www.atkinsons1799.com/en_eu/custom-sample-set |
| Ari | 112.2 | B | https://arianagrandefragrances.com/products/ari-by-ariana-grande |

به‌جز La vie est belle چهار نام دیگر در جست‌وجوی کاتالوگ محلی پیدا نشدند و به صورت محصولات تکمیلی دست‌ساز، بدون فرض جنسیت از فایل، اضافه شدند. برای نام Her Majesty The Oud فقط درج نام در فهرست رسمی ست نمونه اتکینسونز تأیید شد؛ چون در این بررسی هرم نت رسمی آن پیدا نشد، نت‌ها خالی ماندند. برای دو محصول Ex Nihilo، صفحات رسمی مورد استناد نسخه EDP را معرفی می‌کنند؛ نسخه‌های Extrait نیز مستقل وجود دارند و هویت یا نسخه واقعی اسانس تأمین‌کننده از نام فایل ثابت نمی‌شود. برای La vie est belle، نت‌های کلیدی رسمی بدون انتساب حدسی به طبقات ثبت شدند.

همه قیمت‌ها موقت و فقط بر اساس تطبیق نام‌اند؛ هیچ اسانسی مستقل از نظر هویت یا کیفیت تأیید نشده است و همه محصولات غیرقابل سفارش باقی می‌مانند. مدارک در `seed/official_identity_evidence_v12.json`، قیمت‌ها در `seed/official_reference_prices_v13.json` و اصلاح نت در `seed/official_note_corrections_v15.json` است.

ردیف `Happy` از Clinique به نسخه زنانه یا مردانه خودکار نسبت داده نشد: [صفحه زنانه](https://www.clinique.com/product/1579/5188/fragrance/clinique-happy/clinique-happy-eau-de-parfum-spray) و [صفحه مردانه](https://www.clinique.com/product/1617/5190/mens/cologne/clinique-happy-for-men/clinique-happy-for-men-cologne-spray) محصولات متفاوت معرفی می‌کنند و برچسب جنسیت فایل مرجع قطعی هویت اسانس نیست.

## هفت تناظر دیگر؛ گوچی، آرمانی، لالیک، بنتلی و کلایو کریسچن

| نام عطر مرجع | دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| X Masculine | 453.2 | P | https://us.clivechristian.com/products/x-masculine |
| Bentley For Men Intense | 184.8 | R | https://bentley-fragrances.com/en/for-men-intense |
| My Way Eau de Parfum | 96.8 | H | https://www.giorgioarmanibeauty-usa.com/fragrances/womens-perfume/my-way/my-way-eau-de-parfum/A2259.html |
| Sì Eau de Parfum | 227.7 | H | https://www.giorgioarmanibeauty-usa.com/fragrances/womens-perfume/si/si-eau-de-parfum/A218.html |
| Encre Noire | 229.9 | H | https://us.lalique.com/products/encre-noire-eau-de-toilette-m13201-1-1/ |
| Gucci Rush | 94.6 | B | https://www.gucci.com/us/en/pr/beauty/fragrances/fragrances-for-women/gucci-rush-75ml-eau-de-toilette-p-012769999990099 |
| Gucci Bloom | 359.7 | H | https://www.gucci.com/us/en/pr/beauty/fragrances/fragrances-for-women/gucci-bloom-100ml-eau-de-parfum-p-488830999990099 |

دو محصول Gucci Rush و Gucci Bloom در جست‌وجوی کاتالوگ محلی موجود نبودند و با شناسه‌های `SUP-GC-900015` و `SUP-GC-900016` به عنوان بازآفرینی دست‌ساز افزوده شدند. نت‌های Bloom، My Way و Sì در منابع مورد بررسی به صورت کلیدی و بدون هرم کامل عرضه شده‌اند؛ بدون ساختن هرم ثبت شدند. نت‌ها و مشخصات به عطر مرجع اصلی مربوط‌اند، نه اثبات فرمول اسانس تأمین‌کننده.

نام‌های فایل `X FOR MEN`، `Bentley Intense` و `Encre Noir` با نام‌های رسمی جدول به صورت تطبیق موقت ثبت شدند. محصولات با نام‌های مشابه و نسخه‌های دیگر نباید با این موارد یکی تلقی شوند. صفحات معرفی‌شده برای Rush و Encre Noire نسخه EDT و برای Bloom و دو آرمانی نسخه EDP عطر اصلی را نشان می‌دهند؛ این به معنی اثبات نسخه اسانس تهیه‌شده یا غلظت محصول دست‌ساز نیست. همه محصولات `UNAVAILABLE` و واریانت‌های قیمت‌گذاری‌شده با موجودی صفرند.

مدارک در `seed/official_identity_evidence_v13.json`، قیمت‌ها در `seed/official_reference_prices_v14.json` و اصلاح نت‌ها در `seed/official_note_corrections_v16.json` است.

## شش محصول تکمیلی از فهرست قیمت

شش نام زیر پس از بررسی منابع رسمی و جست‌وجوی کاتالوگ محلی، به‌صورت محصول دست‌ساز و با قیمت مرجع موقت اضافه شدند. هیچ‌کدام قابل سفارش نیستند و موجودی واریانت‌هایشان صفر است.

| عطر مرجع | دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| Lacoste Essential | 140.8 | H | https://www.lacoste.com/se/lacoste/men/accessories/fragrance/LC011A01.html |
| Lacoste Pour Femme | 128.7 | B | https://www.lacoste.com/it/lacoste/donna/accessori/profumi/LC014A01.html |
| Lalique L’Amour | 156.2 | H | https://us.lalique.com/products/lamour-eau-de-parfum-l12202-r-1 |
| Ralph Lauren Polo Black | 251.9 | H | https://www.ralphlaurenfragrances.com/en_US/men/polo-black/polo-black-eau-de-toilette/RLFE012.html |
| Victoria’s Secret Bombshell | 174.9 | H | https://www.victoriassecret.com/us/vs/beauty-catalog/5000010457 |
| Shiseido Zen | 176 | H | https://www.shiseido.com/us/en/zen-eau-de-parfum-0768614102007.html |

`Bombshel` و ``L`amour`` در فایل با املای رسمی متفاوت‌اند. نسخه‌های دیگر مانند Bombshell Intense و Zen Essence با این محصولات یکسان فرض نشده‌اند. منابع لاکوست برای Essential جزئیات نت ابتدایی را یکسان بیان نمی‌کنند، پس آکورد کلی مرکبات ثبت شد. دو صفحه رسمی Polo Black نیز درباره برخی جزئیات و جایگاه نت‌ها تفاوت دارند؛ فقط نت‌های مشترک با جایگاه روشن ثبت شدند. برای Bombshell نت‌های کلیدی بدون هرم، و برای Zen به دلیل نبود هرم رسمی در صفحه بررسی‌شده، نت‌ها خالی نگه داشته شدند. خالی بودن به معنی بی‌بو بودن نیست.

جنسیت از فایل تأمین‌کننده استنتاج نشده است. نام و نت‌ها به عطر مرجع اصلی مربوط‌اند؛ تطبیق نوشتاری به‌تنهایی هویت، نسخه، ترکیب یا کیفیت اسانس واقعی تأمین‌کننده را تأیید نمی‌کند. مدارک و قیمت‌ها به ترتیب در `seed/official_identity_evidence_v14.json` و `seed/official_reference_prices_v15.json` ثبت شده‌اند.

## شش نام تکمیلی دیگر

| عطر مرجع | دلار/کیلو | کیفیت فایل | صفحه رسمی |
|---|---:|---|---|
| Lacoste Touch of Pink | 84.7 | I | https://www.lacoste.com/fr/lacoste/femme/accessoires/parfums/LC015A02.html |
| Viva La Juicy | 132 | I | https://juicycouture.com/products/juicy-couture-viva-la-juicy-eau-de-parfum-spray-3-4oz |
| Jaguar Classic Black | 106.7 | B | https://jaguar-fragrances.com/en/classic-black |
| Nautica Voyage | 92.4 | B | https://www.nautica.com/nautica-voyage-3.4-oz.-eau-de-toilette/99350078119.html |
| Guy Laroche Drakkar Noir | 121 | H | https://www.guylaroche.com/fragrances |
| Juliette Has A Gun Metal Chypré | 183.7 | I | https://us.juliettehasagun.com/products/metal-chypre |

این محصولات در جست‌وجوی کاتالوگ محلی پیدا نشدند و به‌صورت دست‌ساز، با موجودی صفر و وضعیت `UNAVAILABLE` اضافه شدند. برای Viva La Juicy دو ردیف با کیفیت I وجود داشت و قیمت مثبت بیشتر انتخاب شد. `METAL CHIBR` نگارش فایل است؛ تناظر آن با Metal Chypré موقت است و هویت اسانس را ثابت نمی‌کند. برای Drakkar Noir منبع رسمی نام و نوع مرجع را معرفی می‌کند ولی هرم نت منتشر نکرده است؛ نت‌ها خالی ماندند. نت‌های Metal Chypré از [صفحه رسمی مجموعه](https://us.juliettehasagun.com/pages/luxury-collection) هستند.

دو صفحه رسمی برای Nautica Voyage درباره ترتیب و جزئیات نت‌ها یکسان نیستند؛ تنها نت‌های مشترک بدون هرم ثبت شدند. برای Touch of Pink نیز بخش مشترک نت‌های صفحات رسمی انتخاب شد. این نت‌ها متعلق به محصول مرجع اصلی‌اند، نه اثبات فرمول واقعی اسانس. برای هیچ‌کدام هویت، نسخه یا کیفیت اسانس تأمین‌کننده مستقلاً تأیید نشده است. داده‌ها در `seed/official_identity_evidence_v15.json` و `seed/official_reference_prices_v16.json` هستند.

در اجرای نخست بعضی آزمون‌های این دسته، فضای موقت `/tmp` به علت انباشته‌شدن نسخه‌های بازیابی آزمایشی پر شد و راه‌اندازی دیتابیس آزمایشی شکست خورد. فایل‌های موقت ساخته‌شده برای بررسی‌های قبلی پاک شدند؛ سپس آزمون‌های قیمت، هویت، نصب تازه، پلتفرم Node، محافظ دسترسی و پشتیبان دوباره اجرا و موفق شدند. دیتابیس محلی از این مشکل موقت آسیب ندید و بررسی سلامت آن موفق بود.

## دو تناظر جدید و کنارگذاری ابهام نسخه

| عطر مرجع | دلار/کیلو | کیفیت فایل | صفحه رسمی |
|---|---:|---|---|
| Guerlain Baiser de Russie | 229.9 | H | https://www.guerlain.com/us/en-us/p/les-parisiennes-baiser-de-russie---eau-de-parfum-P017774.html |
| Victoria’s Secret Very Sexy | 107.8 | P | https://www.victoriassecret.com/us/vs/beauty-catalog/5000010459/-/a/generic-11260424-choice-2068/very-sexy-eau-de-parfum-3.4-oz-floral |

این دو نام در جست‌وجوی کاتالوگ محلی نبودند و به صورت دست‌ساز، با قیمت موقت و `UNAVAILABLE` اضافه شدند. نت‌های گرلن از هرم رسمی و نت‌های Very Sexy از فهرست کلیدی رسمی بدون دسته‌بندی حدسی ثبت شدند. این داده‌ها درباره عطر مرجع هستند، نه اثبات هویت یا کیفیت اسانس تأمین‌کننده.

سه مورد عمداً قیمت‌گذاری نشدند: ردیف `HER` باربری بین نسخه‌های EDP و EDT و دیگر نسخه‌ها مشخص نیست؛ فهرست `JOOP HOMME (Red)` را با نام فارسی «جوپ سبز» نوشته و با ردیف مجاور تعارض دارد؛ و ردیف `BLACK MUSK / The Body Shop` علاوه بر جابه‌جایی نام و برند، نسخه EDP یا EDT را مشخص نمی‌کند. جنسیت یا رنگ فایل برای رفع قطعی این تعارض‌ها کافی نیست. منابع رسمی نسخه‌های [Her EDP](https://us.burberry.com/her-eau-de-parfum-100ml-p40804591) و [Her EDT](https://us.burberry.com/her-eau-de-toilette-50ml-p40826251)، و [Black Musk EDP](https://us.thebodyshop.com/products/black-musk-eau-de-parfum) و [EDT](https://global.thebodyshop.com/en-au/fragrance/eau-de-toilette/black-musk-eau-de-toilette/p/p053023) را جدا معرفی می‌کنند.

منابع و قیمت‌ها در `seed/official_identity_evidence_v16.json` و `seed/official_reference_prices_v17.json` ثبت شده‌اند.

## آکوا کیس؛ مرجع اسپری بدن — ۱ نوامبر ۲۰۲۶

ردیف `AQUA KISS` ویکتوریا سکرت پس از بررسی [صفحه رسمی Aqua Kiss Fragrance Mist](https://www.victoriassecret.com/ca/vs/beauty-catalog/5000011041?genericId=11259203&choice=4760) با قیمت موقت ۱۰۸٫۹ دلار/کیلو و کیفیت P ثبت شد. چون این رایحه در کاتالوگ محلی پیدا نشد، محصول دست‌ساز `SUP-VS-900032` به آن افزوده شد. **مرجع برند اسپری بدن است، نه عطر اورجینال**؛ این موضوع در متن شفافیت عمومی محصول ذکر شده است. نت‌های محصول مرجع از همان صفحه‌اند؛ نسخه‌های Shimmer و Vacation جدا هستند. این تناظر نام هویت، نسخه یا کیفیت واقعی اسانس تأمین‌کننده را اثبات نمی‌کند.

محصول `UNAVAILABLE` و واریانت‌های قیمت‌گذاری‌شده آن صفرموجودی‌اند. مدارک در `seed/official_identity_evidence_v17.json` و قیمت در `seed/official_reference_prices_v18.json` ثبت شده‌اند.

## مراجع مستقل با اجازه مالک — ۱ نوامبر ۲۰۲۶

ابتدا منبع رسمی جست‌وجو شد؛ در این دسته، منابع رسمی کافی یا صفحات محصول در دسترس نبودند. با اجازه مالک، نام عطرهای مرجع زیر از فراگرانتیکا به عنوان **منبع مستقل، نه منبع رسمی برند** ثبت شد. هویت، نسخه و کیفیت واقعی اسانس تأمین‌کننده همچنان مستقل تأیید نشده است. همه محصولات غیرفعال‌اند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | منبع مستقل |
|---|---:|---|---|
| Nisean | 303.6 | H | https://www.fragrantica.com/perfume/Parfums-de-Marly/Nisean-36540.html |
| L'Eau Bleue d'Issey Pour Homme | 338.8 | H | https://www.fragrantica.com/perfume/Issey-Miyake/L-Eau-Bleue-d-Issey-Pour-Homme-724.html |
| Kokorico | 239.8 | H | https://www.fragrantica.com/perfume/Jean-Paul-Gaultier/Kokorico-12711.html |
| Hindu Grass | 474.1 | H | https://www.fragrantica.com/perfume/Nasomatto/Hindu-Grass-4294.html |
| Akaster | 331.1 | H | https://www.fragrantica.com/perfume/Parfums-de-Marly/Akaster-33513.html |
| Jamal's Palace | 467.5 | H | https://www.fragrantica.com/perfume/Memo-Paris/Jamal-s-Palace-60077.html |
| Retba | 332.2 | H | https://www.fragrantica.com/perfume/Memo-Paris/Retba-60076.html |
| He Wood Rocky Mountain Wood | 300.3 | P | https://www.fragrantica.com/perfume/DSQUARED2/He-Wood-Rocky-Mountain-Wood-5862.html |
| Le Gemme Amarena | 218.9 | P | https://www.fragrantica.com/perfume/Bvlgari/Amarena-27387.html |
| Marry Me | 172.7 | H | https://www.fragrantica.com/perfume/Lanvin/Marry-Me-9405.html |
| Eclat d’Arpège | 177.1 | H | https://www.fragrantica.com/perfume/Lanvin/Eclat-d-Arpege-988.html |
| Silver Scent | 128.7 | H | https://www.fragrantica.com/perfume/Jacques-Bogart/Silver-Scent-7794.html |

از این دوازده مورد، **۹ قیمت جدید** در دیتابیس محلی ثبت و برای **۳ قیمت قدیمی** Kokorico، Hindu Grass و Akaster فقط شاهد مستقل افزوده شد؛ قیمت‌ها، واریانت‌ها و سفارش‌های قدیمی آن سه مورد تغییر نکردند. هفت نام در کاتالوگ نبودند و دست‌ساز افزوده شدند. نت پنج محصول موجود فقط در صورت دست‌نخورده‌بودن داده قبلی و متن شفافیت اصلاح شد؛ یادداشت عمومی به صراحت منبع مستقل را اعلام می‌کند. Hindu Grass هرم نت تأییدشده ندارد و فقط نت‌های بدون طبقه‌بندی ثبت شد.

برای Retba، نت‌های رسمیِ نمایه‌شده و فراگرانتیکا با هم اختلاف دارند و صفحه رسمی بررسی‌شده به فهرست عمومی هدایت می‌شد؛ بنابراین نت‌ها خالی ماندند. برای Amarena نیز تنها نت‌های مشترک بدون هرم ثبت شدند. مبهم‌بودن نسخه Invictus Intense و Supreme Bouquet همچنان حل نشده و این دو خودکار به نسخه‌ای نسبت داده نشدند.

## شش تناظر دیگر با منبع مستقل — ۱ نوامبر ۲۰۲۶

قیمت‌ها بر مبنای بیشترین ردیف مثبت فایل و تناظر نام، موقت و غیرقابل سفارش ثبت شدند. فراگرانتیکا منبع مستقل است، نه منبع رسمی برند و نه تأیید هویت، نسخه یا کیفیت واقعی اسانس تأمین‌کننده.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | منبع مستقل |
|---|---:|---|---|
| Aqva Pour Homme | 224.4 | H | https://www.fragrantica.com/perfume/Bvlgari/Aqva-Pour-Homme-153.html |
| Opera | 240.9 | H | https://www.fragrantica.com/perfume/Sospiro-Perfumes/Opera-26282.html |
| Accento | 491.7 | T | https://www.fragrantica.com/perfume/Sospiro-Perfumes/Accento-13816.html |
| Champion | 276.1 | H | https://www.fragrantica.com/perfume/Davidoff/Champion-9109.html |
| Smoke for the Soul | 270.6 | P | https://www.fragrantica.com/perfume/By-Kilian/Smoke-for-the-Soul-25993.html |
| Halloween | 190.3 | H | https://www.fragrantica.com/perfume/Halloween/Halloween-1444.html |

چهار محصول Accento، Champion، Smoke for the Soul و Halloween که در کاتالوگ پیدا نشدند، به‌صورت دست‌ساز اضافه شدند؛ دو محصول Aqva Pour Homme و Opera از پیش در کاتالوگ بودند. نسخه‌های Accento Viola، Champion Energy و Opera Grande جدا هستند و با ردیف‌های فوق یکی نشده‌اند. درباره Halloween، نام تاریخی بر اساس منبع مستقل و نت‌ها از [صفحه رسمی فعلی برند](https://halloweenperfumes.com/en/helloween-woman/161-halloween-eau-de-toilettea.html) ثبت شده است؛ منبع در توضیح عمومی محصول روشن است. نت‌های دو محصول موجود فقط در صورت نبود ویرایش مدیر و با ذکر منبع مستقل اصلاح شدند.

مدارک در `seed/secondary_reference_prices_v2.json`، محصولات در `seed/secondary_supplement_v2.json` و نت‌های محافظت‌شده در `seed/secondary_note_corrections_v2.json` نگهداری می‌شوند.


## سه تناظر دیگر با منبع مستقل — ۱ نوامبر ۲۰۲۶

سه محصول دست‌ساز جدید، غیرفعال و با قیمت موقت نام‌محور اضافه شد. منابع زیر مستقل‌اند؛ هویت یا نسخه اسانس تأمین‌کننده تأیید نشده است.

| رایحه مرجع | دلار/کیلو | کیفیت | منبع مستقل |
|---|---:|---|---|
| Chloé Narcisse | 88 | P | https://www.fragrantica.com/perfume/Chloe/Chloe-Narcisse-344.html |
| Still Jennifer Lopez | 190.3 | H | https://www.fragrantica.com/perfume/Jennifer-Lopez/Still-868.html |
| Aquawoman Rochas | 168.3 | H | https://www.fragrantica.com/perfume/Rochas/Aquawoman-1427.html |

نت‌های مرجع از همان صفحات مستقل‌اند و منبع در توضیح عمومی ذکر شده است. جستجوی صفحات رسمی مربوط برای این سه نام نتیجه کافی نداد؛ این به معنای نبود قطعی صفحه رسمی نیست. نسخه‌های Fleur de Narcisse و Aquaman با موارد فوق یکی نشده‌اند. جزئیات دیگر موارد بررسی‌شده و تعارض‌ها در `docs/supplier_research_batch_20261101.md` است.


## چهار تناظر مستقل دیگر — ۱ نوامبر ۲۰۲۶

چهار محصول دست‌ساز و غیرقابل سفارش، با قیمت موقت و بیشترین کیفیت قیمت‌دار فایل اضافه شده‌اند. فراگرانتیکا منبع مستقل است و هویت یا کیفیت اسانس تأمین‌کننده را اثبات نمی‌کند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | منبع مستقل |
|---|---:|---|---|
| RiRi — Rihanna | 169.4 | H | https://www.fragrantica.com/perfume/Rihanna/RiRi-31629.html |
| Malizia Uomo Vetyver | 174.9 | H | https://www.fragrantica.com/perfume/Malizia/Malizia-Uomo-Vetyver-12997.html |
| Afshan — Rasasi | 92.4 | B | https://www.fragrantica.com/perfume/Rasasi/Afshan-19525.html |
| Blue For Men — Rasasi | 112.2 | H | https://www.fragrantica.com/perfume/Rasasi/Blue-For-Men-8630.html |

در منابع رسمی بررسی‌شده، [میراتو مالک برند مالیزیا](https://mirato.it/en/malizia/) را معرفی می‌کند اما مشخصات Vetyver در آن صفحه نیست؛ نت وتیور در منبع مستقل بدون هرم آمده و هرم ساختگی ایجاد نشده است. [فهرست رسمی رصاصی](https://www.rasasi.com/products) نام Afshan و Afshan Conc Perfume را نشان می‌دهد اما جزئیات کافی برای اثبات برابری نسخه‌ها ندارد. Blue For Men با Blue Lady، Blue 2 و Deep Blue یکی نشده است؛ RiRi نیز با Crush و Kiss یکی نشده است. جستجوی صفحه رسمی کافی برای این چهار مورد به نتیجه نرسید و به معنی نبود قطعی آن نیست.


## چهار تناظر دیگر — ۱ نوامبر ۲۰۲۶

این چهار قیمت بر اساس بیشترین ردیف مثبت و صرفاً تطبیق نام موقت‌اند؛ همه محصولات دست‌ساز و غیرقابل سفارش‌اند. هیچ‌کدام هویت یا کیفیت اسانس واقعی تأمین‌کننده را تأیید نمی‌کنند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | نوع منبع | صفحه مرجع |
|---|---:|---|---|---|
| Xeryus — Givenchy | 143 | H | رسمی | https://www.givenchybeauty.com/ca/en/p/xeryus-F10100073.html |
| Femme — Hugo Boss | 278.3 | H | رسمی | https://www.hugoboss.com/fr/eau-de-parfum-femme-by-boss-50%C2%A0ml/0737052041285.html |
| Tommy Jeans — Tommy Hilfiger | 122.1 | H | مستقل | https://www.fragrantica.com/perfume/Tommy-Hilfiger/Tommy-Jeans-6316.html |
| Angel Passion Star — Mugler | 75.9 | I | مستقل | https://www.fragrantica.com/perfume/Mugler/Angel-Passion-Star-31849.html |

Xeryus با Xeryus Rouge یکی نشده است؛ صفحه رسمی موجود درباره رایحه فعلی است و نسخه تاریخی اسانس را اثبات نمی‌کند. Boss Famme در فایل به‌عنوان املای نام Femme در نظر گرفته شده و نسخه‌های دیگر جدا هستند؛ صفحه رسمی هرم کامل ارائه نمی‌کند و فقط نت‌های بدون طبقه‌بندی ثبت شده‌اند. Tommy Jeans با Tommy Girl Jeans یکی نیست و منبع مستقل هرم ارائه نمی‌دهد. [مقاله مستقل فراگرانتیکا](https://www.fragrantica.com/news/Thierry-Mugler-ANGEL-Passion-Star-6986.html) Passion Star را بطری محدود Angel EDP اصلی توصیف می‌کند، اما این درباره اسانس تحویلی اثباتی نیست. منبع و محدودیت در توضیح عمومی هر محصول ثبت شده است.


## چهار تناظر دیگر — ۱ نوامبر ۲۰۲۶

این چهار قیمت موقت و نام‌محورند و محصولات همگی دست‌ساز و غیرقابل سفارش‌اند. هیچ‌یک کیفیت، نسخه یا هویت اسانس واقعی تأمین‌کننده را ثابت نمی‌کند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | نوع منبع | صفحه مرجع |
|---|---:|---|---|---|
| Absolu Aventus — Creed | 499.4 | H | رسمی | https://www.creedfragrance.com/p/absolu-aventus/16281794/ |
| Nice Feeling Black — Sapil | 86.9 | B | رسمی | https://sapil.com/products/nice_feeling_black |
| Open — Roger & Gallet | 155.1 | H | مستقل | https://www.fragrantica.com/perfume/Roger-Gallet/Open-5973.html |
| John Richmond for Men | 122.1 | B | مستقل | https://www.fragrantica.com/perfume/John-Richmond/John-Richmond-for-Men-9117.html |

Absolu Aventus از Aventus و Aventus Cologne جداست؛ نت‌های صفحه رسمی به‌صورت بدون هرم ثبت شده‌اند. Nice Black فایل به‌عنوان تطبیق نام کوتاه‌شده Nice Feeling Black در نظر گرفته شده و نت‌ها از صفحه فعلی رسمی‌اند. Open با نسخه‌های Black، White و Gold یکی نشده است. صفحه فعلی رسمی [Classic for Him](https://www.johnrichmond.com/en/products/profumo-classic-uomo) نام و نت‌هایی متفاوت با مرجع مستقل John Richmond for Men دارد؛ برابری آنها فرض نشده و نت‌های محصول از مرجع مستقل و با ذکر منبع‌اند.


## چهار تناظر دیگر با منبع رسمی — ۱ نوامبر ۲۰۲۶

چهار محصول دست‌ساز تازه با قیمت نام‌محور موقت ثبت شدند؛ همگی غیرفعال‌اند. شاهد نام عطر مرجع، هویت یا کیفیت اسانس تحویلی را اثبات نمی‌کند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| Epic Adventure — Emper | 126.5 | P | https://uae.emperperfumes.com/products/epic-adventure |
| Chifon — Emper | 123.2 | P | https://uae.emperperfumes.com/products/chifon |
| The Wedding Velvet Santal 35 — Kayali | 101.2 | H | https://us.kayali.com/products/the-wedding-velvet-santal-35 |
| Whisky Silver — Evaflor | 126.5 | R | https://www.evaflor.com/en/products/whisky-silver-coffret-parfum-homme-serviette-money-clip |

صفحات منطقه‌ای رسمی امپر برای [Epic Adventure](https://emperperfumes.com/products/epic-adventure) و [Chifon](https://emperperfumes.com/products/chifon) در برخی نت‌ها با صفحات دیگر برند اختلاف دارند؛ فقط نت‌های مشترک بدون هرم ثبت شدند. املای Chifoon و Wisky فایل اصلاح نام‌محور شده است. Santal 35 فایل به Velvet Santal 35 مربوط دانسته شده، نه Silk Santal 36 یا Santal 33. منبع اوافلور صفحه بسته حاوی ادوتویلت Whisky Silver است، نه اثبات نسخه اسانس تأمین‌کننده؛ کالای فروشگاه همان بازآفرینی دست‌ساز است، نه آن بسته یا محصول اصلی.


## دو تطبیق و اصلاح شناسنامه با منبع رسمی — ۱ نوامبر ۲۰۲۶

قیمت موقت نام‌محور برای دو محصول موجود ثبت و نت‌های تأییدنشده و متن شفافیت آنها با محافظ عدم تغییر مدیر اصلاح شد. هر دو همچنان غیرقابل سفارش‌اند. هویت یا کیفیت اسانس تحویلی با این مدارک ثابت نمی‌شود.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| Yara — Lattafa | 154 | H | https://lattafa.com/product/yara/ |
| Le Gemme Tygar EDP — Bvlgari | 378.4 | P | https://www.bulgari.com/en-int/fragrances/bvlgari-le-gemme/42183.html |

Yara مرجع با Yara Tous، Moi و Candy یکی نیست. Tygar مرجع با Extrait یا نسخه Refik Anadol یکی نشده؛ نت‌های صفحه رسمی بدون طبقه‌بندی ذخیره شدند. تطبیق نام به معنای تأیید نسخه واقعی اسانس نیست. محافظ جدید تا وقتی نت‌ها، آکوردها، متن شفافیت و وضعیت غیرفعال دست‌نخورده باشند اصلاح می‌کند؛ سفارش‌ها و ویرایش‌های مدیر حفظ می‌شوند.

### مورد کنارگذاشته‌شده

نام محصول محلی `AMOUAGE - Decision 2024` با اطلاعات بررسی‌شده درباره عرضه Decision در ۲۰۲۵ تعارض سال دارد؛ منبع رسمی [Decision](https://amouage.com/products/new-decision) عطر مرجع و [منبع مستقل Parfumo](https://www.parfumo.com/Perfumes/Amouage/decision) سال ۲۰۲۵ را ذکر می‌کند. Decision 42 هم نسخه جداست. در آن زمان قیمت یا تصحیح حدسی برای این مورد ثبت نشد؛ اصلاح بعدی در بخش زیر مستند است.


## پنج تناظر بیشتر — ۱ نوامبر ۲۰۲۶

سه محصول موجود بر اساس منبع رسمی و دو محصول مکمل بر اساس منبع مستقل ثبت شدند. قیمت‌ها موقت و صرفاً نام‌محورند؛ همه غیرفعال و دست‌سازند و هویت اسانس واقعی تأمین‌کننده تأیید نشده است.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | نوع منبع | صفحه مرجع |
|---|---:|---|---|---|
| Goddess EDP — Burberry | 201.3 | P | رسمی | https://us.burberry.com/burberry-goddess-eau-de-parfum-for-women-50ml-p40835971 |
| Good Girl EDP — Carolina Herrera | 221.1 | H | رسمی | https://www.carolinaherrera.com/us/en/p-fragrance/good-girl-eau-de-parfum |
| Libre EDP — Yves Saint Laurent | 256.3 | H | رسمی | https://www.yslbeautyus.com/fragrance/womens-fragrances/libre/libre-eau-de-parfum/109YSL.html |
| Absolutely Irresistible — Givenchy | 150.7 | H | مستقل | https://www.fragrantica.com/perfume/Givenchy/Absolutely-Irresistible-4613.html |
| Erba Pura — Sospiro | 267.3 | H | مستقل | https://www.fragrantica.com/perfume/Sospiro-Perfumes/Erba-Pura-18652.html |

سه منبع رسمی به نسخه اصلی معرفی‌شده برند مربوط‌اند و با نسخه‌های Intense، Parfum، Blush، Suprême یا Le Parfum یکی نشده‌اند؛ برچسب فایل به‌تنهایی نسخه اسانس را تأیید نمی‌کند. نت‌های رسمیِ معرفی‌شده بدون هرم ساختگی و با محافظ ویرایش مدیر ثبت شدند. در فایل، نام Givenchy به «Absolutely» کوتاه شده؛ منبع مستقل آن را Absolutely Irresistible 2008 معرفی می‌کند و با Irresistible فعلی یکی نشده است. منبع مستقل Sospiro Erba Pura 2013 را معرفی می‌کند؛ برابری با Xerjoff Erba Pura یا Erba Pura Magica فرض نشده است.


## پنج تناظر مستقل دیگر — ۱ نوامبر ۲۰۲۶

پنج محصول مکمل دست‌ساز با قیمت موقت نام‌محور ثبت شدند. مرجع‌های زیر مستقل‌اند و تأیید اصالت، نسخه یا هویت واقعی اسانس تأمین‌کننده نیستند؛ همه محصولات غیرفعال‌اند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | منبع مستقل |
|---|---:|---|---|
| Aramis 900 | 305.8 | T | https://www.fragrantica.com/perfume/Aramis/Aramis-900-116.html |
| Jasmin Noir — Bvlgari | 234.3 | H | https://www.fragrantica.com/perfume/Bvlgari/Jasmin-Noir-3750.html |
| Apple Brandy — Kilian | 222.2 | P | https://www.fragrantica.com/perfume/By-Kilian/Apple-Brandy-22614.html |
| Amor Amor — Cacharel | 97.9 | B | https://www.fragrantica.com/perfume/Cacharel/Amor-Amor-238.html |
| Eilish — Billie Eilish | 115.5 | P | https://www.fragrantica.com/perfume/Billie-Eilish/Eilish-70052.html |

صفحات رسمی بررسی‌شده برای این نسخه‌ها اطلاعات کافی نداشتند یا صفحه مستقیم در دسترس نبود. Jasmin Noir مرجع ۲۰۰۸ با Splendida و Mon Jasmin Noir یکی نشده؛ Apple Brandy مرجع ۲۰۱۳ با On the Rocks و Eilish با Intense، شماره ۲ و شماره ۳ یکی نشده‌اند. نت رام و سیوت در صورت ذکر، صرفاً آکورد رایحه مرجع هستند و وجود این مواد در اسانس واقعی را ثابت نمی‌کنند. صفحه عمومی منبع مستقل و دست‌ساز بودن را صریح اعلام می‌کند.


## دو تناظر دانهیل — ۱ نوامبر ۲۰۲۶

دو محصول موجود با قیمت نام‌محور موقت و نت‌های مرجع، با محافظ ویرایش مدیر اصلاح شدند. هر دو غیرفعال و دست‌سازند و منبع، هویت یا کیفیت اسانس تأمین‌کننده را تأیید نمی‌کند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | نوع منبع | صفحه مرجع |
|---|---:|---|---|---|
| Icon — Dunhill | 245.3 | H | رسمی | https://www.dunhill.com/il/icon_cod46530312ax.html |
| Desire Blue — Dunhill | 139.7 | H | مستقل | https://www.fragrantica.com/perfume/Alfred-Dunhill/Desire-Blue-1937.html |

Icon اصلی با Absolute، Racing و Elite یکی نشده است و نت‌های صفحه رسمی بدون هرم ثبت شدند. Desire Blue منبع مستقل فراگرانتیکا دارد، نه شاهد رسمی برند؛ از Desire Blue Ocean مجزا است. در هر دو مورد منبع و دست‌ساز بودن در متن عمومی مشخص شده و قیمت، نسخه واقعی اسانس را اثبات نمی‌کند.


## سه تناظر دیگر با منبع رسمی — ۱ نوامبر ۲۰۲۶

قیمت موقت نام‌محور برای دو محصول موجود و یک محصول مکمل دست‌ساز ثبت شد. هر سه غیرفعال‌اند و هیچ شاهدی هویت و نسخه اسانس واقعی تأمین‌کننده را ثابت نمی‌کند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | منبع رسمی |
|---|---:|---|---|
| Black Opium Eau de Parfum — YSL | 245.3 | H | https://www.yslbeautyus.com/fragrance/womens-fragrances/black-opium/black-opium-eau-de-parfum/252YSL.html |
| Spicebomb Eau de Toilette — Viktor & Rolf | 217.8 | P | https://us.viktor-rolf.com/fragrance/spicebomb-eau-de-toilette-VKR_030.html |
| 212 VIP Eau de Parfum — Carolina Herrera | 177.1 | H | https://www.carolinaherrera.com/br/en/p-fragrance/212-vip |

این مراجع به نسخه‌های اصلی معرفی‌شده توسط برند اشاره می‌کنند و با Black Opium Le Parfum، Spicebomb Extreme یا 212 VIP Rosé و VIP Men یکی نشده‌اند. فایل قیمت نسخه واقعی اسانس را مشخص یا اثبات نمی‌کند. نت‌ها در دو محصول موجود با محافظ ویرایش مدیر اصلاح و نت‌های بدون هرم در مورد 212 VIP ثبت شدند؛ آکورد رام درباره رایحه مرجع است، نه اثبات ماده در اسانس تحویلی.


## دو تناظر رسمی دیگر — ۱ نوامبر ۲۰۲۶

دو محصول موجود با قیمت نام‌محور موقت و نت‌های مرجع رسمی اصلاح شدند؛ همه محصولات غیرفعال و دست‌سازند و هویت اسانس واقعی تأمین‌کننده با این مدارک تأیید نمی‌شود.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | صفحه رسمی |
|---|---:|---|---|
| Guidance EDP — Amouage | 409.2 | H | https://amouage.com/products/100ml-guidance |
| Platinum Égoïste EDT — Chanel | 92.4 | P | https://www.chanel.com/lt/fragrance/p/124460/platinum-egoiste-eau-de-toilette-spray/ |

Guidance با Guidance 46 یکی نشده است. Platinium نام کوتاه‌شده فایل برای Platinum Égoïste در نظر گرفته شده؛ شناسایی نام، نسخه یا کیفیت واقعی اسانس را اثبات نمی‌کند. نت‌ها و متن شفافیت تنها برای داده دست‌نخورده و غیرقابل سفارش به‌روزرسانی شده‌اند.


## اصلاح دسیژن و یک تناظر مستقل — ۱ نوامبر ۲۰۲۶

سال نادرست و داده‌های نامطمئن محصول Decision موجود تنها در صورت دست‌نخورده بودن و غیرفعال بودن اصلاح شد؛ نام نمایشی تصحیح و پیوند قبلی برای جلوگیری از شکستن نشانی‌ها حفظ شد. نت و نام رایحه مرجع از [منبع رسمی آمواج](https://amouage.com/products/new-decision) و سال ۲۰۲۵ از [پارفومو، منبع مستقل](https://www.parfumo.com/Perfumes/Amouage/decision) است. منابع رسمی برای طبقه‌بندی جنسیت در مجموعه‌های متفاوت یکسان نیستند؛ بنابراین جنسیت نامعلوم ثبت شد. ادعاهای تأییدنشده ماندگاری، پخش و طبع حذف شدند و ویرایش مدیر و سفارش‌ها محفوظ ماندند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | نوع منبع | صفحه |
|---|---:|---|---|---|
| Decision EDP — Amouage | 330 | H | رسمی برای نام و نت | https://amouage.com/products/new-decision |
| Narciso Rodriguez for Him | 145.2 | P | مستقل | https://www.fragrantica.com/perfume/Narciso-Rodriguez/Narciso-Rodriguez-for-Him-1063.html |

هر دو قیمت موقت نام‌محور و غیرقابل سفارش‌اند. نسخه Decision 42 و نسخه‌های Bleu Noir، Intense و Vetiver Musc با این دو یکی نشده‌اند. اطلاعات وب درباره مرجع اصلی است و هویت، نسخه یا کیفیت اسانس تأمین‌کننده را اثبات نمی‌کند. منبع مستقل برای محصول نارسیسو در متن عمومی جداگانه ذکر شده است.


## شش شناسنامه رسمی بدون انتساب قیمت — ۱ نوامبر ۲۰۲۶

اطلاعات شش محصول موجود بر اساس صفحه رسمی نسخه مشخص‌شده تصحیح شد. نت‌ها و متن شفافیت فقط در صورت دست‌نخورده بودن داده و غیرفعال بودن محصول تغییر می‌کنند. این اقدام هیچ قیمت، واریانت، سفارش یا موجودی را تغییر نمی‌دهد؛ نسخه اسانس تأمین‌کننده همچنان تأیید نشده و نسخه‌های دیگر یکی نشده‌اند.

| رایحه مرجع | منبع رسمی |
|---|---|
| Bleu de Chanel EDP | https://www.chanel.com/gr/fragrance/p/107360/bleu-de-chanel-eau-de-parfum-spray/ |
| Coco Mademoiselle EDP | https://www.chanel.com/ca-en/fragrance/p/116570/coco-mademoiselle-eau-de-parfum-spray/ |
| Gris Charnel EDP | https://us.bdkparfums.com/products/gris-charnel |
| Ganymede EDP | https://us.marcantoinebarrois.com/products/ganymede |
| Baccarat Rouge 540 EDP | https://www.franciskurkdjian.com/us-en/p/baccarat-rouge-540-eau-de-parfum---refills-RA12235.html |
| Ombré Leather EDP | https://www.tomfordbeauty.com/products/ombre-leather-eau-de-parfum |

قیمت‌های فایل برای این نام‌ها بدون شواهد کافی درباره نسخه اسانس منتسب نشده‌اند. صفحه مرجع باکارا مربوط به ریفیل EDP اصلی است، نه ریفیل فروشی این فروشگاه. نت‌ها تنها ویژگی‌های بویایی مرجع‌اند و اثبات مواد موجود در محصول دست‌ساز نیستند.


## شش شناسنامه رسمی دیگر بدون انتساب قیمت — ۱ نوامبر ۲۰۲۶

اطلاعات شش محصول موجود با منابع رسمی نسخه مشخص‌شده اصلاح شدند؛ ویرایش مدیر، تمام واریانت‌ها، قیمت‌ها و سفارش‌ها حفظ شده‌اند. این نام‌ها از فایل قیمت به نسخه‌ای منتسب نشده‌اند و همچنان غیرقابل سفارش‌اند. مدارک عطر مرجع، هویت یا نسخه واقعی اسانس را ثابت نمی‌کنند.

| رایحه مرجع | صفحه رسمی |
|---|---|
| Bleu de Chanel EDT | https://www.chanel.com/us/fragrance/p/107480/bleu-de-chanel-eau-de-toilette-spray/ |
| Black Orchid EDP | https://www.tomfordbeauty.com/products/black-orchid-eau-de-parfum |
| Sauvage EDP | https://www.dior.com/en_us/beauty/products/sauvage-eau-de-parfum-Y0785220.html |
| Y EDP | https://www.yslbeautyus.com/fragrance/mens-fragrances/y/y-eau-de-parfum/727YSL.html |
| Chrome EDT | https://www.azzaro.com/en/fragrances/azzaro-chrome/eau-de-toilette |
| For Him Bleu Noir EDT | https://www.narcisorodriguezparfums.com/en/narciso-rodriguez-for-him-bleu-noir/for-him-bleu-noir-eau-de-toilette.html |

نسخه‌های EDT، EDP، Parfum و سایر نسخه‌های متفاوت یکی نشده‌اند. صفحه Chrome درباره Parfum هم توضیح می‌دهد؛ فقط توصیف کلی مربوط به EDT بدون هرم ثبت شده است. نت رام Black Orchid صرفاً آکورد عطر مرجع است، نه اثبات مواد اسانس تحویلی. منابع در متن عمومی صریح و نام رسمی از منبع مستقل جداست.


## شش شناسنامه رسمی دیگر بدون انتساب قیمت — ۱ نوامبر ۲۰۲۶

اطلاعات شش محصول موجود با منابع رسمی نسخه مشخص‌شده اصلاح شدند؛ ویرایش مدیر، تمام واریانت‌ها، قیمت‌ها و سفارش‌ها حفظ شده‌اند. قیمت فایل تأمین‌کننده به این نسخه‌ها منتسب نشده و همه محصولات غیرفعال‌اند. اطلاعات مرجع، هویت یا نسخه واقعی اسانس تحویلی را اثبات نمی‌کند.

| رایحه مرجع | صفحه رسمی |
|---|---|
| Bleu de Chanel Parfum | https://www.chanel.com/us/fragrance/p/107170/bleu-de-chanel-parfum-spray/ |
| Ganymede Extrait | https://us.marcantoinebarrois.com/products/ganymede-1 |
| Y Le Parfum | https://www.yslbeautyus.com/fragrance/mens-fragrances/y/y-le-parfum/WW-507861YSL.html |
| Black Orchid Parfum | https://www.tomfordbeauty.com/products/black-orchid-parfum |
| Sauvage EDT | https://www.dior.com/en_int/beauty/products/sauvage-eau-de-toilette-Y0685240.html |
| Gris Charnel Extrait | https://us.bdkparfums.com/products/gris-charnel-extrait |

این عطرهای مرجع با نسخه‌های EDP، EDT یا نسخه‌های دیگر با نام مشابه یکی نشده‌اند. تنها Gris Charnel Extrait بر اساس هرم صریح رسمی دسته‌بندی شده و نت‌های بقیه بدون هرم ذخیره شده‌اند. آکورد رام Black Orchid درباره عطر مرجع است و اثبات ماده در اسانس واقعی نیست.


## هشت شناسنامه رسمی آمواج بدون انتساب قیمت — ۱ نوامبر ۲۰۲۶

هشت محصول موجود با منابع رسمی و با محافظ ویرایش مدیر اصلاح شدند. قیمت، واریانت‌ها، سفارش‌ها و موجودی تغییر نکردند؛ هویت و نسخه واقعی اسانس تأمین‌کننده تأیید نشده است. جنسیت ثبت‌شده در فایل قیمت مبنای انتخاب نسخه اصلی نیست، بنابراین ردیف‌های فاقد نسخه روشن به این محصولات منتسب نشده‌اند.

| رایحه مرجع | صفحه رسمی |
|---|---|
| Epic Man | https://amouage.com/products/epic-man-100ml |
| Epic Woman | https://amouage.com/products/epic-woman |
| Epic 56 Woman | https://amouage.com/products/epic56 |
| Honour Man | https://amouage.com/products/honour-man |
| Honour Woman | https://amouage.com/products/honour-woman-100ml |
| Honour 43 Woman | https://amouage.com/products/honour-43 |
| Memoir Man | https://amouage.com/products/memoir-man |
| Memoir Woman | https://amouage.com/products/memoir-woman |

نسخه‌های Man، Woman و Extrait جداگانه باقی مانده‌اند. در Epic Woman، Honour Woman و Memoir Woman بخش‌های مختلف صفحات رسمی در بعضی نت‌ها یکسان نبودند؛ موارد متعارض کنار گذاشته شدند. آکوردهای ابسنت، چرم و کاستورئوم توصیف رایحه مرجع‌اند و اثبات حضور این مواد در اسانس واقعی نیستند.


## هشت شناسنامه رسمی دیور، هرمس و کارتیر — ۱ نوامبر ۲۰۲۶

هشت محصول موجود براساس منابع رسمی و بدون انتساب قیمت فایل تصحیح شدند؛ داده‌های مدیر، واریانت‌ها، سفارش‌ها و قیمت‌ها محفوظ ماندند. همه محصولات غیرقابل سفارش‌اند و منبع عطر اصلی هویت، نسخه یا کیفیت اسانس واقعی تأمین‌کننده را ثابت نمی‌کند. نت‌ها بدون ساخت هرم اضافی ثبت شده‌اند.

| رایحه مرجع | صفحه رسمی |
|---|---|
| Fahrenheit EDT | https://www.dior.com/en_us/beauty/products/fahrenheit-eau-de-toilette-Y0066001.html |
| Fahrenheit Parfum | https://www.dior.com/en_int/beauty/products/fahrenheit-parfum-Y0866230.html |
| Terre d’Hermès EDT | https://www.hermes.com/us/en/product/terre-d-hermes-eau-de-toilette-V107188V0/ |
| Terre d’Hermès Parfum | https://www.hermes.com/us/en/product/terre-d-hermes-parfum-V107757V0/ |
| Terre d’Hermès Eau Givrée | https://www.hermes.com/us/en/product/terre-d-hermes-eau-givree-eau-de-parfum-V107522V0/ |
| Terre d’Hermès Eau Intense Vétiver | https://www.hermes.com/us/en/product/terre-d-hermes-eau-intense-vetiver-eau-de-parfum-V40946/ |
| Pasha de Cartier Parfum | https://www.cartier.com/en-us/art-of-living/fragrances/mens-fragrances/pasha-de-cartier-parfum-100ml-65100036.html |
| Pasha de Cartier EDT | https://www.cartier.com/en-fr/fragrances/fragrances/pasha-de-cartier/pasha-de-cartier-CR65200003 |

نسخه‌های متفاوت هر مجموعه جداگانه باقی مانده‌اند؛ ردیف‌های فایل قیمت که نسخه مشخص ندارند به هیچ‌کدام منتسب نشده‌اند. آکورد چرم و سایر توصیف‌های بویایی به عطر مرجع مربوط‌اند و وجود مواد متناظر در اسانس را ثابت نمی‌کنند.


## هشت شناسنامه رسمی دیگر — ۱ نوامبر ۲۰۲۶

اطلاعات هشت محصول موجود براساس صفحه رسمی هر نسخه و با محافظ ویرایش مدیر اصلاح شد. قیمت، واریانت و سفارش‌ها تغییر نکردند و محصولات غیرقابل سفارش‌اند. نسخه اسانس تحویلی هنوز تأیید نشده و قیمت‌های نامشخص فایل به این نسخه‌ها نسبت داده نشده‌اند.

| رایحه مرجع | صفحه رسمی |
|---|---|
| Montblanc Legend EDT | https://www.montblanc.com/en-us/fragrances/collection/legend |
| Montblanc Legend Blue EDP | https://www.montblanc.com/en-si/montblanc-legend-blue-eau-de-parfum-100-ml-MB133517.html |
| Versace Eros EDT | https://www.versace.com/us/en/men/accessories/fragrances-body-care/eros/eros-edt-100-ml-blue/R740010-R100MLS_RNUL.html |
| Versace Eros Flame EDP | https://www.versace.com/row/en/men/accessories/fragrances-body-care/eros-flame/eros-flame-edp-100-ml/R741010-R100MLS_RNUL.html |
| Versace Eros Energy EDP | https://www.versace.com/us/en/men/accessories/fragrances-body-care/eros-energy/eros-energy-edp-100-ml-yellow/R742010-R100MLS_RNUL.html |
| Burberry London for Men EDT | https://us.burberry.com/burberry-london-eau-de-toilette-100ml-p34547291 |
| Burberry London for Women EDP | https://us.burberry.com/burberry-london-eau-de-parfum-100ml-p34547261 |
| Le Beau Paradise Garden EDP | https://www.jeanpaulgaultier.com/fr/fr/p/gamme-le-beau/le-beau-paradise-garden-eau-de-parfum-000000000065199801 |

مراجع هر نسخه از نسخه‌های متفاوت همان مجموعه جدا هستند. صفحه رسمی Legend دو فهرست متفاوت برای نسخه کلاسیک و EDT دارد؛ فقط نت‌های مشترک بدون هرم ثبت شدند. نت‌های اعلام‌شده درباره رایحه مرجع هستند و مواد اسانس تحویلی را اثبات نمی‌کنند.


## هشت شناسنامه رسمی شنل، دیور، ایو سن لوران و هرمس — ۱ نوامبر ۲۰۲۶

اطلاعات هشت محصول موجود با منابع رسمی نسخه مشخص و با محافظ ویرایش مدیر اصلاح شدند؛ قیمت، واریانت‌ها، سفارش‌ها و موجودی تغییر نکردند. تمام محصولات غیرفعال‌اند و نسخه واقعی اسانس تأمین‌کننده تأیید نشده است. نسخه‌های مختلف هر مجموعه یکی نشده‌اند و قیمت فایل بدون تعیین نسخه به آنها منتسب نشده است.

| رایحه مرجع | صفحه رسمی |
|---|---|
| Allure Homme Sport EDT | https://www.chanel.com/us/fragrance/p/123630/allure-homme-sport-eau-de-toilette-spray/ |
| Allure Homme Sport Eau Extrême EDP | https://www.chanel.com/us/fragrance/p/123560/allure-homme-sport-eau-extreme-eau-de-parfum-spray/ |
| Allure Homme Sport Cologne | https://www.chanel.com/gb/fragrance/p/123320/allure-homme-sport-cologne-spray/ |
| Sauvage Parfum | https://www.dior.com/en_int/beauty/products/sauvage-parfum-Y0998004.html |
| Libre Le Parfum | https://www.yslbeautyus.com/fragrance/womens-fragrances/libre/libre-le-parfum/WW-51020YSL.html |
| Libre Absolu Platine | https://www.yslbeautyus.com/libre-collection.html |
| Coco Mademoiselle EDP Intense | https://www.chanel.com/us/fragrance/p/116660/coco-mademoiselle-eau-de-parfum-intense-spray/ |
| Voyage d’Hermès Parfum | https://www.hermes.com/us/en/product/voyage-d-hermes-parfum-V107569V0/ |

نام، غلظت ثبت‌شده، نت‌ها، متن شفافیت و غیرفعال بودن قبل از اصلاح بررسی می‌شوند تا ویرایش مدیر بازنویسی نشود. نت‌های عطر مرجع بدون هرم ساختگی ثبت شده و اثبات مواد اسانس تحویلی نیستند.


## هشت شناسنامه رسمی رابان — ۱ نوامبر ۲۰۲۶

هشت محصول موجود با منابع رسمی و با محافظ نام، غلظت، نت و ویرایش مدیر اصلاح شدند. تمام قیمت‌ها، واریانت‌ها، سفارش‌ها و موجودی بدون تغییر مانده‌اند؛ محصولات غیرقابل سفارش‌اند. وب‌سایت کنونی برند از نام Rabanne استفاده می‌کند و شناسایی رایحه اصلی هویت و نسخه اسانس تأمین‌کننده را تأیید نمی‌کند.

| رایحه مرجع | صفحه رسمی |
|---|---|
| 1 Million EDT | https://www.rabanne.com/us/en_US/fragrance/p/1-million--000000000065249551 |
| 1 Million Parfum | https://www.rabanne.com/ww/en/fragrance/p/1-million-parfum--000000000065156001 |
| 1 Million Elixir | https://www.rabanne.com/uk/en_GB/fragrance/p/1-million-elixir--000000000065251972 |
| 1 Million Royal | https://www.rabanne.com/us/en_US/fragrance/p/1-million-royal--000000000065190440 |
| 1 Million Lucky | https://www.rabanne.com/fr/fr/fragrance/p/1-million-lucky--000000000065131403 |
| Invictus EDT | https://www.rabanne.com/ww/en/fragrance/p/invictus--000000000065055742 |
| Invictus Victory | https://www.rabanne.com/uk/en_GB/fragrance/p/invictus-victory--000000000065164673 |
| Invictus Platinum | https://www.rabanne.com/nl/en/fragrance/p/invictus-platinum--000000000065176115 |

نسخه‌های EDT، Parfum و نسخه‌های نام‌دار مجموعه‌ها جدا هستند؛ قیمت‌های فایل بدون اثبات نسخه به آنها نسبت داده نشده‌اند. نت‌ها بدون هرم ساختگی ثبت شدند؛ آکوردهای چرم، کهربای خاکستری و ابسنت صرفاً توصیف رایحه مرجع‌اند و مواد اسانس واقعی را ثابت نمی‌کنند.


## دو قیمت مرجع و شش شناسنامه رسمی — ۱ نوامبر ۲۰۲۶

دو رایحه مرجع تازه بر اساس نام و بالاترین قیمت فایل به‌صورت موقت ثبت و شش شناسنامه موجود با محافظ ویرایش مدیر اصلاح شدند. تمام محصولات غیرفعال و دست‌سازند و هیچ صفحه‌ای هویت یا نسخه واقعی اسانس تحویلی را تأیید نمی‌کند. واریانت‌ها و سفارش‌های قبلی تغییر نکردند.

| رایحه مرجع | دلار/کیلو | کیفیت فایل | صفحه رسمی |
|---|---:|---|---|
| DGVIB3 — Dolce & Gabbana | 148.5 | R | https://www.dolcegabbana.com/en-us/beauty/perfumes-for-him/dgvib3/dgvib3---VP003HVP0009V000.html |
| MMW / 3 Avenue George V — Givenchy | 269.5 | P | https://www.givenchybeauty.com/fr/fr/p/3-avenue-george-v-F10100184.html |

برند ژیوانشی صریحاً نام تازه 3 Avenue George V را برای MMW با حفظ امضای بویایی اعلام کرده؛ این موضوع اثباتی درباره اسانس تأمین‌کننده نیست. برند DGVIB3 را مناسب همه معرفی می‌کند و جنسیت فایل مبنای شناسنامه آن قرار نگرفته است.

شش شناسنامه بدون انتساب قیمت جدید: [Chance EDP](https://www.chanel.com/us/fragrance/p/126520/chance-eau-de-parfum-spray/)، [Chance Eau Tendre EDT](https://www.chanel.com/us/fragrance/p/126310/chance-eau-tendre-eau-de-toilette-spray/)، [Chance Eau Fraîche EDT](https://www.chanel.com/us/fragrance/p/136420/chance-eau-fraiche-eau-de-toilette-spray/)، [Chance Eau Vive EDT](https://www.chanel.com/us/fragrance/p/126550/chance-eau-vive-eau-de-toilette-spray/)، [Eternity for Men EDT](https://www.calvinklein.us/en/eternity-eau-de-toilette-for-men/LX000145.html) و [Eternity for Men Parfum](https://www.calvinklein.us/en/men/fragrance/fragrance/eternity-parfum-for-men/3616303549756.html). نسخه‌های متفاوت یکی نشده‌اند و آکورد رام، وصف رایحه مرجع است نه اثبات ماده اسانس تحویلی.
