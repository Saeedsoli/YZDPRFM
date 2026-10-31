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
