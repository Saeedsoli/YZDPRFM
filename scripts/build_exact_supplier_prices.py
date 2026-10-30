#!/usr/bin/env python3
"""Build staged exact-name supplier prices, not a database import or availability change.

A lexical match does not independently verify the supplier's fragrance identity.
Ambiguous or unmatched rows must not be included. Decimal values remain strings.
"""
import csv, json
from decimal import Decimal
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
records=[]
with (ROOT/'supplier_match_review.csv').open(encoding='utf-8-sig', newline='') as f:
    for row in csv.DictReader(f):
        if row['وضعیت'] != 'تطبیق دقیق':
            continue
        product_id=row['شناسه محصول / پیشنهاد'].strip()
        usd=row['دلار بر کیلو'].strip()
        if not product_id.startswith('YZD-PROD-') or '|' in product_id or Decimal(usd)<=0:
            raise ValueError(f'Unsafe match: {row}')
        records.append({'product_id':product_id,'supplier_brand':row['برند فایل'],
            'supplier_model':row['مدل'],'supplier_gender':row['جنسیت'],
            'quality':row['کیفیت انتخابی'],'usd_per_kg':usd,
            'status':'lexical_match_only'})
ids=[r['product_id'] for r in records]
if len(set(ids)) != len(ids): raise ValueError('Duplicate product IDs')
seed_ids={p['id'] for p in json.loads((ROOT/'seed/perfumes_catalogue_seed.json').read_text(encoding='utf8'))}
if not set(ids) <= seed_ids: raise ValueError('Unknown product ID')
out=ROOT/'seed/supplier_exact_prices_staged.json'
out.write_text(json.dumps({'source':'uploads/لیست_قیمت_عمده.md',
    'note':'Review-only lexical matches; do not activate or import automatically.',
    'prices':records},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(f'{len(records)} staged lexical matches; no database changes')
