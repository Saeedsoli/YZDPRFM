import re
import json
import os

# ── مسیرها نسبت به ریشه پروژه ──
# پیش‌تر اینجا مسیر مطلق `/home/user/...` نوشته شده بود که فقط روی
# ماشین توسعه کار می‌کرد. با آماده‌سازی مخزن گیت، اسکریپت باید روی
# هر کلونی اجرا شود — پس ریشه از محل خودِ فایل حساب می‌شود.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, 'source', 'dataset',
                       'perfume-dataset-2000plus.md')
SEED_OUT = os.path.join(ROOT, 'seed', 'perfumes_catalogue_seed.json')

def slugify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')

def clean_notes(notes_str):
    if not notes_str or notes_str == '-':
        return []
    return [n.strip() for n in re.split(r'[\،,]', notes_str) if n.strip()]

def map_gender(gender_str):
    g = gender_str.strip()
    if 'مردانه' in g and 'زنانه' not in g:
        return 'MEN'
    elif 'زنانه' in g:
        return 'WOMEN'
    return 'UNISEX'

def map_family_slug(family_en):
    fam = family_en.lower()
    if 'woody' in fam:
        return 'woody'
    elif 'floral' in fam:
        return 'floral'
    elif 'citrus' in fam:
        return 'citrus'
    elif 'oriental' in fam or 'amber' in fam:
        return 'ambery-oriental'
    elif 'aromatic' in fam or 'fougère' in fam or 'fougere' in fam:
        return 'aromatic-fresh'
    elif 'fruity' in fam or 'gourmand' in fam:
        return 'fruity-gourmand'
    elif 'leather' in fam:
        return 'leather'
    elif 'chypre' in fam:
        return 'chypre'
    elif 'aquatic' in fam or 'marine' in fam:
        return 'aquatic'
    return 'fresh-aromatic'

def generate_brand_code(brand_en):
    clean = re.sub(r'[^a-zA-Z]', '', brand_en).upper()
    return clean[:3] if len(clean) >= 3 else clean.ljust(3, 'X')

def generate_scent_code(scent_en):
    clean = re.sub(r'[^a-zA-Z]', '', scent_en).upper()
    return clean[:3] if len(clean) >= 3 else clean.ljust(3, 'X')

def run_import():
    input_file = DATASET
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    main_sec = content.split('## 💎 بانک جامع ۲,۱۰۶ عطر تخصصی جهان (Master Fragrance Database)')[1]
    lines = [l.strip() for l in main_sec.split('\n') if l.strip().startswith('|')]

    headers = [col.strip() for col in lines[0].split('|')[1:-1]]
    data_rows = lines[2:]

    processed_products = []
    slug_counts = {}

    for idx, row_str in enumerate(data_rows):
        cols = [c.strip() for c in row_str.split('|')[1:-1]]
        if len(cols) < 27:
            continue

        row_dict = dict(zip(headers, cols))

        brand_en = row_dict['برند (انگلیسی)']
        brand_fa = row_dict['برند (فارسی)']
        scent_en = row_dict['نام عطر (انگلیسی)']
        scent_fa = row_dict['نام عطر (فارسی)']
        
        # Base price per gram in Tomans
        price_per_gram_raw = row_dict['قیمت هر ۱ گرم به تومان (نرخ ۱ دلار = ۲۰۰ هزار تومان)'].replace(',', '')
        try:
            price_per_gram = int(float(price_per_gram_raw))
        except ValueError:
            price_per_gram = 1000000

        base_slug = slugify(f"{brand_en}-{scent_en}")
        if not base_slug:
            base_slug = f"perfume-{idx+1}"

        if base_slug in slug_counts:
            slug_counts[base_slug] += 1
            final_slug = f"{base_slug}-{slug_counts[base_slug]}"
        else:
            slug_counts[base_slug] = 1
            final_slug = base_slug

        brand_code = generate_brand_code(brand_en)
        scent_code = generate_scent_code(scent_en)

        # Build variants with SKU formula: YZD-[BRAND]-[SCENT]-[TYPE]-[VOLUME]
        variants = []
        
        # 1. Sample 3ml
        variants.append({
            "type": "SAMPLE",
            "type_label_fa": "سمپل ۳ میل تست",
            "volume_ml": 3,
            "sku": f"YZD-{brand_code}-{scent_code}-SMP-003",
            "price_toman": int(price_per_gram * 0.12) + 40000, # Handcrafted sample pricing
            "stock": 0
        })

        # 2. EDP Volumes
        for vol in [10, 30, 50, 100]:
            # Scale price based on essence ratio and bottle packaging
            price = int(price_per_gram * (vol / 10.0) * 0.35) + 150000
            variants.append({
                "type": "EDP",
                "type_label_fa": "ادو پرفیوم دست‌ساز",
                "volume_ml": vol,
                "sku": f"YZD-{brand_code}-{scent_code}-EDP-{vol:03d}",
                "price_toman": price,
                "stock": 0
            })

        # 3. Hair Mist 150ml
        variants.append({
            "type": "HAIR_MIST",
            "type_label_fa": "عطر موی دست‌ساز",
            "volume_ml": 150,
            "sku": f"YZD-{brand_code}-{scent_code}-HM-150",
            "price_toman": int(price_per_gram * 5 * 0.22) + 120000,
            "stock": 0
        })

        # 4. Body Splash 150ml
        variants.append({
            "type": "BODY_SPLASH",
            "type_label_fa": "بادی اسپلش دست‌ساز",
            "volume_ml": 150,
            "sku": f"YZD-{brand_code}-{scent_code}-BS-150",
            "price_toman": int(price_per_gram * 10 * 0.12) + 100000,
            "stock": 0
        })

        prod = {
            "id": f"YZD-PROD-{idx+1:04d}",
            "external_row": int(cols[0]),
            "name_fa": f"عطر دست‌ساز {scent_fa}",
            "name_en": f"{scent_en} (Inspired by {brand_en})",
            "full_display_fa": f"عطر دست‌ساز {brand_fa} - {scent_fa}",
            "full_display_en": row_dict['نام کامل انگلیسی عطر (Full EN Display)'],
            "slug": final_slug,
            "inspired_brand_en": brand_en,
            "inspired_brand_fa": brand_fa,
            "gender": map_gender(row_dict['جنسیت']),
            "concentration": row_dict['غلظت'],
            "family_fa": row_dict['گروه بویایی اصلی (فارسی)'],
            "family_en": row_dict['گروه بویایی اصلی (انگلیسی)'],
            "family_slug": map_family_slug(row_dict['گروه بویایی اصلی (انگلیسی)']),
            "character_temperature": row_dict['طبع بویایی'],
            "character_taste": row_dict['طعم بویایی'],
            "notes": {
                "top": clean_notes(row_dict['نت‌های اولیه (Top Notes)']),
                "middle": clean_notes(row_dict['نت‌های میانی (Heart Notes)']),
                "base": clean_notes(row_dict['نت‌های پایه (Base Notes)'])
            },
            "accords": clean_notes(row_dict['آکورد‌های اصلی']),
            "season": row_dict['بهترین فصل استفاده'],
            "occasion": row_dict['موقعیت استفاده مناسب'],
            "longevity_descriptive": row_dict['ماندگاری'],
            "sillage_descriptive": row_dict['پخش بو (سیاژ)'],
            "perfumer": row_dict['عطار / طراح عطر'],
            "release_year": row_dict['سال عرضه'],
            "country": row_dict['کشور مبدأ برند'],
            "market_segment": row_dict['رده بازار'],
            "transclaimer_notice": "این محصول، بازآفرینی دست‌ساز با عصاره خالص اولیه و فرمولاسیون اختصاصی عطر یزد است.",
            "variants": variants
        }

        processed_products.append(prod)

    # Save output seed file
    out_path = SEED_OUT
    with open(out_path, 'w', encoding='utf-8') as out_f:
        json.dump(processed_products, out_f, ensure_ascii=False, indent=2)

    print(f"Successfully processed {len(processed_products)} perfumes into seed file: {out_path}")

if __name__ == '__main__':
    run_import()
