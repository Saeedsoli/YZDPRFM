#!/usr/bin/env python3
"""
واردسازی دیتاست عطر — نسخه ۲ (منبع ۲٬۱۱۱ عطر اصیل)

═══════════════════════════════════════════════════════════
چرا این اسکریپت جای import_dataset.py را گرفت
═══════════════════════════════════════════════════════════

منبع پیشین (`perfume-dataset-2000plus.md`) ایراد بنیادی داشت:
بیش از ۹۸٪ رکوردهایش نام‌های ساختگی بودند که از ترکیب تصادفی نام
برند با کلمات قالبی ساخته شده بودند. نمونه‌های واقعی از آن فایل:

    PENHALIGON'S - Penhaligon's Absolu
    PENHALIGON'S - Penhaligon's Sport / Fraiche
    PENHALIGON'S - Cuir de Penhaligon's
    PENHALIGON'S - Vanille Penhaligon's

هیچ‌کدام عطر واقعی نیستند. فروشگاهی که ۲٬۱۰۶ عطر جعلی فهرست کند،
با نخستین مشتری آگاه اعتبارش را از دست می‌دهد.

منبع جدید (`perfume-dataset-2111.md`) ۲٬۱۱۱ عطر شناسنامه‌دار دارد.
سنجیده شد پیش از پذیرش:
    • ۲٬۱۱۱ ردیف، شماره‌گذاری پیوسته ۱ تا ۲۱۱۱، بدون جاافتادگی
    • هر ۲٬۱۱۱ ردیف دقیقاً ۲۷ ستون — صفر سلول خالی
    • فرمول قیمت (تومان = دلار × ۲۰۰٬۰۰۰): صفر خطا در ۲٬۱۱۱ ردیف
    • ۱۲۴ برند واقعی
    • تطابق با کاتالوگ قدیمی: فقط ۴۳ عطر (۲٪) — یعنی ۹۸٪ جایگزین

═══════════════════════════════════════════════════════════
🔴 تصمیم قیمت‌گذاری — مهم‌ترین نکته این فایل
═══════════════════════════════════════════════════════════

قیمت گرمی فایل، بهای **اسانس اورجینال** است نه محصول دست‌ساز.
اعمال مستقیمش یعنی سمپل ۳ میل کرید = ۳٬۶۴۰٬۰۰۰ تومان — حدود
۱۰ تا ۲۰ برابر قیمت فعلی سایت.

با تأیید صریح مالک، **ضرایب قیمت‌گذاری فعلی سایت دست‌نخورده
می‌مانند**. این ضرایب در نسخه اول همین اسکریپت تعریف شده بودند و
قیمت‌های امروز سایت از آن‌ها آمده — پس «حفظ قیمت فعلی» یعنی
«همان ضرایب روی قیمت گرمی منبع جدید».

قیمت دلاری خام در ستون `variants.price_usd` ذخیره می‌شود تا وقتی
فرمول اختصاصی مالک رسید، محاسبه خودکار ممکن باشد.
(جزئیات: docs/PRICING_USD.md)

═══════════════════════════════════════════════════════════
اجرا
═══════════════════════════════════════════════════════════
    python3 scripts/import_dataset_v2.py            # ساخت seed
    python3 scripts/import_dataset_v2.py --verify   # فقط اعتبارسنجی
"""

import io
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, 'source', 'dataset', 'perfume-dataset-2111.md')
SEED_OUT = os.path.join(ROOT, 'seed', 'perfumes_catalogue_seed.json')

# ── ضرایب قیمت‌گذاری — عیناً از نسخه اول ──
# دست نزنید مگر با تصمیم صریح مالک. قیمت‌های زنده سایت از اینها می‌آید.
P_SAMPLE_RATIO, P_SAMPLE_BASE = 0.12, 40000       # سمپل ۳ میل
P_EDP_RATIO,    P_EDP_BASE    = 0.35, 150000      # ادوپرفیوم (بر پایه ۱۰ml)
P_HAIR_RATIO,   P_HAIR_BASE   = 0.22, 120000      # عطر مو ۱۵۰ml (×۵ گرم)
P_BODY_RATIO,   P_BODY_BASE   = 0.12, 100000      # بادی اسپلش ۱۵۰ml (×۱۰ گرم)

USD_RATE = 200000   # نرخ مبنای فایل — فقط برای بازیابی دلار از تومان


def slugify(text):
    text = (text or '').lower()
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')


def clean_notes(s):
    if not s or s in ('-', '—'):
        return []
    return [n.strip() for n in re.split(r'[\،,]', s) if n.strip()]


def map_gender(g):
    g = (g or '').strip()
    if 'مردانه' in g and 'زنانه' not in g:
        return 'MEN'
    if 'زنانه' in g:
        return 'WOMEN'
    return 'UNISEX'


"""
نگاشت خانواده بویایی — ۱۶۴ مقدار خام به ۹ خانواده سایت.

🔴 چرا ترتیب بررسی اهمیت حیاتی دارد:
    منبع جدید ۱۶۴ ترکیب مثل `Woody Aromatic`، `Oriental Woody`،
    `Chypre Floral` دارد. نسخه اول اسکریپت زنجیره if داشت که اول
    'woody' را می‌دید — پس `Woody Aromatic` (۱۱۹ عطر) و
    `Oriental Woody` (۲۸۴ عطر) هر دو «چوبی» می‌شدند و خانواده
    عنبری با ۲۸۴ عطر خالی می‌ماند.

    راه‌حل: واژه **نخست** رشته تعیین‌کننده است، چون در عطرشناسی
    خانواده اصلی اول می‌آید و بقیه توصیف‌گرند. فقط اگر واژه اول
    شناخته نشد، به جستجوی کل رشته برمی‌گردیم.

🔴 چرا 'aquatic' وجود ندارد:
    سایت هشت خانواده دارد و آبزی جزوشان نیست — نه تصویری برایش
    هست (`FAMILY_IMAGES` در src/db.js) و نه فیلتری. منبع جدید
    فقط ۵ عطر آبزی دارد؛ ساختن خانواده نهم برای ۵ عطر یعنی یک
    دسته تقریباً خالی با تصویر شکسته در ویترین.

    این پنج به `aromatic-fresh` می‌روند که نزدیک‌ترین خانواده
    موجود است — هر پنج‌تا در نام خامشان Aromatic یا Citrus یا
    Aldehydic دارند، پس تخصیص طبیعی است نه تحمیلی.
"""
HEAD_MAP = {
    'oriental': 'ambery-oriental', 'amber': 'ambery-oriental',
    'woody':    'woody',           'smoky':  'woody',
    'floral':   'floral',          'white':  'floral',
    'citrus':   'citrus',
    'aromatic': 'aromatic-fresh',  'green':  'aromatic-fresh',
    'aquatic':  'aromatic-fresh',  'marine': 'aromatic-fresh',
    'aldehydic': 'aromatic-fresh',
    'fruity':   'fruity-gourmand', 'gourmand': 'fruity-gourmand',
    'chypre':   'chypre',
    'leather':  'leather',
    'musk':     'woody',           'spicy': 'ambery-oriental',
    'powdery':  'floral',          'green_': 'aromatic-fresh',
}
FALLBACK_ORDER = ['chypre', 'leather', 'gourmand', 'fruity', 'citrus',
                  'oriental', 'amber', 'floral', 'aquatic', 'marine',
                  'aromatic', 'fougère', 'fougere', 'woody']
FALLBACK_MAP = {
    'chypre': 'chypre', 'leather': 'leather',
    'aquatic': 'aromatic-fresh', 'marine': 'aromatic-fresh',
    'gourmand': 'fruity-gourmand', 'fruity': 'fruity-gourmand',
    'citrus': 'citrus', 'oriental': 'ambery-oriental',
    'amber': 'ambery-oriental', 'floral': 'floral',
    'aromatic': 'aromatic-fresh', 'fougère': 'aromatic-fresh',
    'fougere': 'aromatic-fresh', 'woody': 'woody',
}


def map_family_slug(family_en):
    fam = (family_en or '').lower().strip()
    head = fam.split()[0] if fam else ''
    if head in HEAD_MAP:
        return HEAD_MAP[head]
    for key in FALLBACK_ORDER:
        if key in fam:
            return FALLBACK_MAP[key]
    return 'aromatic-fresh'


def code3(s):
    clean = re.sub(r'[^a-zA-Z]', '', s or '').upper()
    return clean[:3] if len(clean) >= 3 else clean.ljust(3, 'X')


def parse_year(raw):
    """
    سال عرضه در فایل با کاما آمده: «1,959» یعنی ۱۹۵۹.

    🔴 کران پایین ۱۵۰۰ است، نه ۱۷۰۰.
        نخستین اعتبارسنجی با کران ۱۷۰۰ یک ردیف را رد کرد:
        `SANTA MARIA NOVELLA - Acqua della Regina` با سال ۱۵۳۳.
        بررسی نشان داد خطای داده نیست — این عطر تاریخی کاترین دو
        مدیچی است و از قدیمی‌ترین عطرهای ثبت‌شده جهان به شمار
        می‌رود. رده‌اش در همین فایل «نیش باستانی» است.

        درس همیشگی این پروژه: وقتی اعتبارسنجی قرمز شد، اول داده
        واقعی را ببین — گاهی کرانِ تو غلط است نه داده.
    """
    if not raw:
        return None
    digits = re.sub(r'[^\d]', '', str(raw))
    if not digits:
        return None
    y = int(digits)
    return y if 1500 <= y <= 2100 else None


def parse_rows():
    """ردیف‌های بخش ۱ را می‌خواند و اعتبارسنجی می‌کند."""
    if not os.path.exists(DATASET):
        sys.exit(f"🔴 فایل منبع نیست: {DATASET}")

    content = io.open(DATASET, encoding='utf-8').read()
    if '## بخش ۱' not in content:
        sys.exit("🔴 سرفصل «بخش ۱» پیدا نشد — ساختار فایل عوض شده؟")

    sec = content.split('## بخش ۱')[1].split('## بخش ۲')[0]

    # 🔴 شماره ردیف از ۱۰۰۰ به بعد کاما دارد: «2,111»
    #    الگوی ساده \d+ فقط ۹۹۹ ردیف اول را می‌گیرد — دامی که
    #    در نخستین شمارش همین فایل به آن خوردم.
    pat = re.compile(r'^\|\s*([\d,]+)\s*\|')
    rows = []
    for line in sec.split('\n'):
        s = line.strip()
        if not s.startswith('|'):
            continue
        m = pat.match(s)
        if not m or not m.group(1).replace(',', '').isdigit():
            continue
        cells = [c.strip() for c in s.strip('|').split('|')]
        if len(cells) != 27:
            continue
        rows.append(cells)
    return rows


def verify(rows):
    """اعتبارسنجی پیش از تولید — بهتر است اینجا بشکند تا در تولید."""
    ok = True

    def chk(label, cond, note=''):
        nonlocal ok
        print(f"  {'✓' if cond else '🔴'} {label}" + (f"  — {note}" if note else ''))
        if not cond:
            ok = False

    chk('تعداد ردیف ۲۱۱۱ است', len(rows) == 2111, f"{len(rows)} ردیف")

    nums = [int(r[0].replace(',', '')) for r in rows]
    chk('شماره‌ها پیوسته و یکتا', sorted(nums) == list(range(1, len(rows) + 1)))

    empty = sum(1 for r in rows for c in r if not c or c in ('-', '—'))
    chk('هیچ سلول خالی نیست', empty == 0, f"{empty} خالی")

    bad_price = 0
    for r in rows:
        try:
            if abs(float(r[7].replace(',', '')) * USD_RATE
                   - int(r[8].replace(',', ''))) > 0.5:
                bad_price += 1
        except ValueError:
            bad_price += 1
    chk('فرمول قیمت درست است', bad_price == 0, f"{bad_price} ناهماهنگ")

    bad_year = sum(1 for r in rows if parse_year(r[24]) is None)
    chk('سال عرضه قابل تجزیه است', bad_year == 0, f"{bad_year} نامعتبر")

    fams = Counter(map_family_slug(r[12]) for r in rows)
    SITE_FAMILIES = {'floral', 'ambery-oriental', 'woody', 'aromatic-fresh',
                     'citrus', 'fruity-gourmand', 'leather', 'chypre'}
    chk('هر ۸ خانواده سایت پوشش دارد', set(fams) == SITE_FAMILIES,
        f"{len(fams)} خانواده" + (f" · ناشناخته: {set(fams) - SITE_FAMILIES}"
                                   if set(fams) - SITE_FAMILIES else ''))
    print(f"      {dict(fams.most_common())}")

    return ok


def build(rows):
    products, slug_counts = [], {}

    for idx, c in enumerate(rows):
        (_, full_en, full_fa, brand_en, brand_fa, scent_en, scent_fa,
         usd_g, toman_g, gender, conc, fam_fa, fam_en, temperament, taste,
         top, heart, base, accords, season, occasion, longevity, sillage,
         perfumer, year, country, tier) = c

        try:
            ppg = int(float(toman_g.replace(',', '')))
        except ValueError:
            ppg = 1000000
        try:
            usd_per_gram = float(usd_g.replace(',', ''))
        except ValueError:
            usd_per_gram = round(ppg / USD_RATE, 2)

        base_slug = slugify(f"{brand_en}-{scent_en}") or f"perfume-{idx+1}"
        if base_slug in slug_counts:
            slug_counts[base_slug] += 1
            final_slug = f"{base_slug}-{slug_counts[base_slug]}"
        else:
            slug_counts[base_slug] = 1
            final_slug = base_slug

        bc, sc = code3(brand_en), code3(scent_en)

        variants = [{
            "type": "SAMPLE", "type_label_fa": "سمپل ۳ میل تست", "volume_ml": 3,
            "sku": f"YZD-{bc}-{sc}-SMP-003",
            "price_toman": int(ppg * P_SAMPLE_RATIO) + P_SAMPLE_BASE,
            "price_usd": usd_per_gram, "stock": 0
        }]
        for vol in (10, 30, 50, 100):
            variants.append({
                "type": "EDP", "type_label_fa": "ادو پرفیوم دست‌ساز",
                "volume_ml": vol, "sku": f"YZD-{bc}-{sc}-EDP-{vol:03d}",
                "price_toman": int(ppg * (vol / 10.0) * P_EDP_RATIO) + P_EDP_BASE,
                "price_usd": usd_per_gram, "stock": 0
            })
        variants.append({
            "type": "HAIR_MIST", "type_label_fa": "عطر موی دست‌ساز",
            "volume_ml": 150, "sku": f"YZD-{bc}-{sc}-HM-150",
            "price_toman": int(ppg * 5 * P_HAIR_RATIO) + P_HAIR_BASE,
            "price_usd": usd_per_gram, "stock": 0
        })
        variants.append({
            "type": "BODY_SPLASH", "type_label_fa": "بادی اسپلش دست‌ساز",
            "volume_ml": 150, "sku": f"YZD-{bc}-{sc}-BS-150",
            "price_toman": int(ppg * 10 * P_BODY_RATIO) + P_BODY_BASE,
            "price_usd": usd_per_gram, "stock": 0
        })

        products.append({
            "id": f"YZD-PROD-{idx+1:04d}",
            "external_row": int(c[0].replace(',', '')),
            # 🔴 «(Inspired by ...)» ممنوع است — تصمیم برند.
            #    نام انگلیسی همان نام واقعی عطر می‌ماند و شفافیت
            #    دست‌ساز بودن از راه transparency_notice و عنوان
            #    فارسی «دست‌ساز» منتقل می‌شود.
            "name_fa": f"عطر دست‌ساز {scent_fa}",
            "name_en": scent_en,
            "full_display_fa": f"عطر دست‌ساز {brand_fa} - {scent_fa}",
            "full_display_en": full_en,
            "slug": final_slug,
            "inspired_brand_en": brand_en,
            "inspired_brand_fa": brand_fa,
            "gender": map_gender(gender),
            "concentration": conc,
            "family_fa": fam_fa,
            "family_en": fam_en,
            "family_slug": map_family_slug(fam_en),
            "character_temperature": temperament,
            "character_taste": taste,
            "notes": {"top": clean_notes(top), "middle": clean_notes(heart),
                      "base": clean_notes(base)},
            "accords": clean_notes(accords),
            "season": season,
            "occasion": occasion,
            "longevity_descriptive": longevity,
            "sillage_descriptive": sillage,
            "perfumer": perfumer,
            "release_year": parse_year(year),
            "country": country,
            "market_segment": tier,
            "transclaimer_notice": "این محصول، بازآفرینی دست‌ساز با عصاره خالص اولیه و فرمولاسیون اختصاصی عطر یزد است.",
            "variants": variants
        })

    return products


def main():
    print("\n  واردسازی دیتاست — منبع ۲٬۱۱۱ عطر اصیل\n")
    rows = parse_rows()

    print("  اعتبارسنجی منبع:")
    if not verify(rows):
        sys.exit("\n  🔴 اعتبارسنجی رد شد — seed ساخته نشد.\n")

    if '--verify' in sys.argv:
        print("\n  ✓ منبع سالم است (حالت بررسی — چیزی نوشته نشد).\n")
        return

    products = build(rows)
    with io.open(SEED_OUT, 'w', encoding='utf-8') as f:
        json.dump(products, f, ensure_ascii=False, indent=2)

    kb = os.path.getsize(SEED_OUT) / 1024
    print(f"\n  ✓ {len(products)} محصول → seed/perfumes_catalogue_seed.json  ({kb/1024:.1f} MB)")
    print(f"    واریانت: {sum(len(p['variants']) for p in products):,}")
    print(f"    برند یکتا: {len({p['inspired_brand_en'] for p in products})}")

    s = products[0]
    print(f"\n  نمونه — {s['full_display_fa']}")
    print(f"    خانواده: {s['family_slug']} · عطار: {s['perfumer']} · سال: {s['release_year']}")
    print(f"    سمپل ۳ml: {s['variants'][0]['price_toman']:,} تومان "
          f"(دلار هر گرم: {s['variants'][0]['price_usd']})\n")


if __name__ == '__main__':
    main()
