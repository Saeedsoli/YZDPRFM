#!/usr/bin/env python3
"""Produce a conservative, review-only supplier match report; never edits the store."""
import csv, json, re, unicodedata, difflib
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
root=Path(__file__).resolve().parent.parent
text=(root/'uploads/لیست_قیمت_عمده.md').read_text(encoding='utf-8')
products=json.loads((root/'seed/perfumes_catalogue_seed.json').read_text(encoding='utf-8'))
supplement=root/'seed/supplier_verified_supplement.json'
if supplement.exists(): products += json.loads(supplement.read_text(encoding='utf-8'))
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or '')).casefold().replace('ي','ی').replace('ك','ک').replace('ı','i')
    return ''.join(c for c in s if c.isalnum() and not unicodedata.combining(c))
# Brand spelling/official house aliases identify candidates only, not verified identity.
# Supplier gender is a matching hint, never a source for public product metadata.
aliases = {
    'amuage':'amouage', 'bykilian':'kilianparis', 'carolinahrrera':'carolinaherrera',
    'dg':'dolcegabbana', 'dior':'christiandior', 'georgioarmani':'giorgioarmani',
    'lattafa':'lattafaperfumes', 'dunhill':'alfreddunhill', 'escentric':'escentricmolecules',
    'memo':'memoparis', 'sospiro':'sospiroperfumes', 'initio':'initioparfumsprives',
    'thierymugler':'mugler', 'victorrolf':'viktorrolf',
    'francickurkdjian':'maisonfranciskurkdjian', 'caron':'caronparis'
}
def brandkey(s):
    v=norm(s)
    return aliases.get(v,v)
groups=defaultdict(list); brand=''
for line in text.splitlines():
    if line.startswith('## '): brand=line[3:].strip()
    elif line.startswith('|'):
        cells=[x.strip() for x in line.strip().strip('|').split('|')]
        if len(cells)!=5: continue
        try: price=Decimal(cells[4])
        except Exception: continue
        groups[(brandkey(brand),norm(cells[1]),norm(cells[2]))].append((brand,*cells[:4],price))
index=defaultdict(list)
for p in products:
    index[(brandkey(p.get('inspired_brand_en','')),norm(p.get('name_en','')),norm(p.get('gender','')))].append(p)
out=[]
for key,rows in groups.items():
    positive=[r for r in rows if r[5]>0]
    if not positive:
        r=rows[0]; out.append(['بدون قیمت مثبت',*r[:5],str(r[5]),'', '', '', '']); continue
    r=max(positive,key=lambda x:x[5]); matches=index.get(key,[])
    status='تطبیق نوشتاری - نیازمند بررسی رسمی' if len(matches)==1 else ('تطبیق تکراری - بررسی' if matches else 'بدون تطبیق دقیق - بررسی')
    candidates=matches
    if not candidates:
        pool=[p for p in products if brandkey(p.get('inspired_brand_en',''))==key[0]]
        def score(p):
            n=norm(p.get('name_en',''))
            similarity=difflib.SequenceMatcher(None,key[1],n).ratio()
            if len(key[1]) >= 4 and key[1] in n: similarity=max(similarity,0.8)
            if norm(p.get('gender',''))==key[2]: similarity += 0.08
            return similarity
        candidates=sorted(pool,key=score,reverse=True)[:4]
        candidates=[p for p in candidates if score(p)>=.62]
        if not pool: status='برند در کاتالوگ پیدا نشد - بررسی'
    out.append([status,*r[:5],str(r[5]),str(r[5]/1000),str(r[5]*300), ' | '.join(p['id'] for p in candidates), ' | '.join(p.get('full_display_en') or (p.get('inspired_brand_en','') + ' - ' + p.get('name_en','')) for p in candidates)])
path=root/'supplier_match_review.csv'
with path.open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['وضعیت','برند فایل','نام فارسی','مدل','جنسیت','کیفیت انتخابی','دلار بر کیلو','دلار بر گرم','تومان بر گرم با دلار ۳۰۰۰۰۰','شناسه محصول / پیشنهاد','نام محصول / پیشنهاد']);w.writerows(out)
from collections import Counter
print('raw rows:',sum(map(len,groups.values())),'unique groups:',len(groups));print(dict(Counter(x[0] for x in out)));print('output:',path)
