import os
import json
import csv
import re

# ── مسیرها نسبت به ریشه پروژه ──
# خروجی این اسکریپت پیش‌تر در `/home/user/SAMPLE_IMPORT_DATA/` ریخته
# می‌شد — بیرون از پروژه و نامرئی برای گیت. حالا داخل
# `source/dataset/generated/` می‌رود که هم در مخزن دیده می‌شود هم
# جایش با منبعی که از آن ساخته شده یکی است.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, 'source', 'dataset',
                       'perfume-dataset-2000plus.md')
OUT_DIR = os.path.join(ROOT, 'source', 'dataset', 'generated')

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
    if 'woody' in fam: return 'woody'
    elif 'floral' in fam: return 'floral'
    elif 'citrus' in fam: return 'citrus'
    elif 'oriental' in fam or 'amber' in fam: return 'ambery-oriental'
    elif 'aromatic' in fam or 'fougère' in fam or 'fougere' in fam: return 'aromatic-fresh'
    elif 'fruity' in fam or 'gourmand' in fam: return 'fruity-gourmand'
    elif 'leather' in fam: return 'leather'
    elif 'chypre' in fam: return 'chypre'
    elif 'aquatic' in fam or 'marine' in fam: return 'aquatic'
    return 'fresh-aromatic'

def generate_brand_code(brand_en):
    clean = re.sub(r'[^a-zA-Z]', '', brand_en).upper()
    return clean[:3] if len(clean) >= 3 else clean.ljust(3, 'X')

def generate_scent_code(scent_en):
    clean = re.sub(r'[^a-zA-Z]', '', scent_en).upper()
    return clean[:3] if len(clean) >= 3 else clean.ljust(3, 'X')

def process_uploaded_dataset():
    md_path = DATASET
    with open(md_path, 'r', encoding='utf-8') as f:
        content = f.read()

    main_sec = content.split('## 💎 بانک جامع ۲,۱۰۶ عطر تخصصی جهان (Master Fragrance Database)')[1]
    lines = [l.strip() for l in main_sec.split('\n') if l.strip().startswith('|')]

    headers = [col.strip() for col in lines[0].split('|')[1:-1]]
    data_rows = lines[2:]

    os.makedirs(OUT_DIR, exist_ok=True)

    csv_headers = [
        "Row_Number", "Full_Display_EN", "Full_Display_FA", "Brand_EN", "Brand_FA",
        "Perfume_Name_EN", "Brand_Inspired_FA", "Gram_Price_USD", "Gram_Price_Toman",
        "Gender", "Concentration", "Family_FA", "Family_EN", "Family_Slug", "Slug",
        "Temperature", "Taste", "Top_Notes", "Middle_Notes", "Base_Notes", "Accords",
        "Best_Season", "Occasion", "Longevity", "Sillage", "Perfumer", "Release_Year",
        "Country", "Market_Segment", "SKU", "Variant_Type", "Volume_ML", "Variant_Price_Toman", "Stock"
    ]

    sample_rows = []
    full_rows = []
    slug_counts = {}

    all_brands = set()
    all_families = set()

    for idx, row_str in enumerate(data_rows):
        cols = [c.strip() for c in row_str.split('|')[1:-1]]
        if len(cols) < 27:
            continue

        row_dict = dict(zip(headers, cols))

        row_num = int(cols[0])
        full_en = row_dict['نام کامل انگلیسی عطر (Full EN Display)']
        full_fa = row_dict['نام کامل فارسی عطر (Full FA Display)']
        brand_en = row_dict['برند (انگلیسی)']
        brand_fa = row_dict['برند (فارسی)']
        scent_en = row_dict['نام عطر (انگلیسی)']
        scent_fa = row_dict['نام عطر (فارسی)']
        gram_usd = row_dict['قیمت دلاری هر ۱ گرم (USD/g)']
        gram_toman_raw = row_dict['قیمت هر ۱ گرم به تومان (نرخ ۱ دلار = ۲۰۰ هزار تومان)'].replace(',', '')
        
        try:
            gram_toman = int(float(gram_toman_raw))
        except ValueError:
            gram_toman = 1000000

        gender = map_gender(row_dict['جنسیت'])
        concentration = row_dict['غلظت']
        fam_fa = row_dict['گروه بویایی اصلی (فارسی)']
        fam_en = row_dict['گروه بویایی اصلی (انگلیسی)']
        fam_slug = map_family_slug(fam_en)

        all_brands.add((brand_en, brand_fa))
        all_families.add((fam_slug, fam_fa))

        base_slug = slugify(f"{brand_en}-{scent_en}")
        if not base_slug:
            base_slug = f"perfume-{row_num}"

        if base_slug in slug_counts:
            slug_counts[base_slug] += 1
            final_slug = f"{base_slug}-{slug_counts[base_slug]}"
        else:
            slug_counts[base_slug] = 1
            final_slug = base_slug

        brand_code = generate_brand_code(brand_en)
        scent_code = generate_scent_code(scent_en)

        # Generate Variants (Sample 3ml, EDP 10/30/50/100ml, Hair Mist 50ml, Body Splash 100ml)
        variants = [
            ("SAMPLE", "سمپل ۳ میل", 3, int(gram_toman * 0.12) + 40000, 500),
            ("EDP", "ادو پرفیوم", 10, int(gram_toman * 1.0 * 0.35) + 150000, 200),
            ("EDP", "ادو پرفیوم", 30, int(gram_toman * 3.0 * 0.35) + 150000, 150),
            ("EDP", "ادو پرفیوم", 50, int(gram_toman * 5.0 * 0.35) + 150000, 100),
            ("EDP", "ادو پرفیوم", 100, int(gram_toman * 10.0 * 0.35) + 150000, 50),
            ("HAIR_MIST", "عطر مو", 150, int(gram_toman * 5.0 * 0.22) + 120000, 0),
            ("BODY_SPLASH", "بادی اسپلش", 150, int(gram_toman * 10.0 * 0.12) + 100000, 0)
        ]

        for v_type, v_label, v_vol, v_price, v_stock in variants:
            v_code = "SMP" if v_type == "SAMPLE" else ("EDP" if v_type == "EDP" else ("HM" if v_type == "HAIR_MIST" else "BS"))
            sku = f"YZD-{brand_code}-{scent_code}-{v_code}-{v_vol:03d}"

            row_data = {
                "Row_Number": row_num,
                "Full_Display_EN": full_en,
                "Full_Display_FA": full_fa,
                "Brand_EN": brand_en,
                "Brand_FA": brand_fa,
                "Perfume_Name_EN": scent_en,
                "Brand_Inspired_FA": f"عطر دست‌ساز {scent_fa}",
                "Gram_Price_USD": gram_usd,
                "Gram_Price_Toman": gram_toman,
                "Gender": gender,
                "Concentration": concentration,
                "Family_FA": fam_fa,
                "Family_EN": fam_en,
                "Family_Slug": fam_slug,
                "Slug": final_slug,
                "Temperature": row_dict['طبع بویایی'],
                "Taste": row_dict['طعم بویایی'],
                "Top_Notes": row_dict['نت‌های اولیه (Top Notes)'],
                "Middle_Notes": row_dict['نت‌های میانی (Heart Notes)'],
                "Base_Notes": row_dict['نت‌های پایه (Base Notes)'],
                "Accords": row_dict['آکورد‌های اصلی'],
                "Best_Season": row_dict['بهترین فصل استفاده'],
                "Occasion": row_dict['موقعیت استفاده مناسب'],
                "Longevity": row_dict['ماندگاری'],
                "Sillage": row_dict['پخش بو (سیاژ)'],
                "Perfumer": row_dict['عطار / طراح عطر'],
                "Release_Year": row_dict['سال عرضه'],
                "Country": row_dict['کشور مبدأ برند'],
                "Market_Segment": row_dict['رده بازار'],
                "SKU": sku,
                "Variant_Type": v_type,
                "Volume_ML": v_vol,
                "Variant_Price_Toman": v_price,
                "Stock": v_stock
            }

            full_rows.append(row_data)
            if idx < 35:
                sample_rows.append(row_data)

    # Write Full CSV (2,106 items -> 14,742 variants)
    full_csv_path = os.path.join(OUT_DIR, 'products_variants_full_2106.csv')
    with open(full_csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=csv_headers)
        w.writeheader()
        w.writerows(full_rows)

    # Write Sample CSV (35 items -> 245 variants)
    sample_csv_path = os.path.join(OUT_DIR, 'products_variants.csv')
    with open(sample_csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=csv_headers)
        w.writeheader()
        w.writerows(sample_rows)

    print(f"Processed exact uploaded dataset 'Perfume_Comprehensive_Dataset_2000Plus (2).md'!")
    print(f"  - Full CSV written: {full_csv_path} ({len(full_rows)} rows)")
    print(f"  - Sample CSV written: {sample_csv_path} ({len(sample_rows)} rows)")

if __name__ == '__main__':
    process_uploaded_dataset()
