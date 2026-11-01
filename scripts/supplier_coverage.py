#!/usr/bin/env python3
"""Read-only, name-level reconciliation of supplier rows and local price evidence.

This is an audit, never an importer or stock decision. Supplier gender groups rows;
it is not used as a product identity fact. No customer or order data are read.
"""
from __future__ import annotations
import argparse
import collections
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import sqlite3

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path('uploads/لیست_قیمت_عمده.md')
LV_SOURCE = {
    'SUP-LV-900001': ('LOUIS VUITTON', 'Afternoon swim'),
    'SUP-LV-900002': ('LOUIS VUITTON', 'IMAGINATION'),
    'SUP-LV-900003': ('LOUIS VUITTON', 'L`IMMENSITÉ'),
    'SUP-LV-900004': ('LOUIS VUITTON', 'OMBRE NOMADE'),
    'SUP-LV-900005': ('LOUIS VUITTON', 'STELLAR TIMES'),
    'SUP-LV-900006': ('LOUIS VUITTON', 'California Dream'),
}
STATES = {
    'provisional': 'قیمت موقت با شاهد نام؛ هویت اسانس تأییدنشده',
    'secondary': 'قیمت موقت با منبع مستقل؛ هویت اسانس تأییدنشده',
    'legacy': 'قیمت قدیمی فقط نام؛ شاهد رسمی مرجع کامل نیست',
    'ambiguous': 'دارای انتساب اما ردیف مبهم؛ بررسی دستی',
    'conflict': 'اختلاف قیمت یا سابقه؛ بررسی دستی',
    'pending': 'هنوز قیمت مرجع منتسب نشده',
    'no_positive': 'بدون قیمت مثبت',
}

def read_rows(path: Path):
    raw=path.read_bytes();brand='';out=[]
    for line_no,line in enumerate(raw.decode('utf-8-sig').splitlines(),1):
        if line.startswith('## '): brand=line[3:].strip();continue
        if not line.startswith('|'): continue
        cells=[x.strip() for x in line.strip('|').split('|')]
        if len(cells)!=5 or not re.fullmatch(r'\d+(?:\.\d+)?',cells[4]):continue
        try: price=Decimal(cells[4])
        except InvalidOperation: continue
        out.append({'line':line_no,'brand':brand,'fa':cells[0], 'model':cells[1],
                    'gender':cells[2], 'quality':cells[3], 'price':price})
    return out,hashlib.sha256(raw).hexdigest()

def group_rows(rows):
    groups=collections.OrderedDict()
    for row in rows:groups.setdefault((row['brand'],row['model'],row['gender']),[]).append(row)
    return groups

def group_candidate(groups, x):
    """Match source spelling. Multiple gender groups require exact row proof."""
    found=[k for k in groups if k[:2]==(x['supplier_brand'],x['supplier_model'])]
    if not found:return [], 'source_not_found'
    if x.get('supplier_gender'):
        exact=[k for k in found if k[2]==x['supplier_gender']]
        return (exact,'exact') if len(exact)==1 else (found,'ambiguous')
    if len(found)==1:return found,'exact'
    price=Decimal(x['usd_per_kg']);quality=x['quality']
    exact=[k for k in found if any(r['price']==price and r['quality']==quality for r in groups[k])]
    return (exact,'source_row_unique') if len(exact)==1 else (found,'ambiguous')

def manifests(root, source_sha):
    base=root/'seed';files=sorted(base.glob('official_reference_prices_v*.json'),key=lambda p:int(re.search(r'v(\d+)\.json$',p.name).group(1)))
    candidates=[];ids=set()
    for file in files:
        m=json.loads(file.read_text(encoding='utf-8'))
        if m.get('supplier_file_sha256')!=source_sha:raise ValueError(f'supplier hash mismatch: {file.name}')
        for x in m['items']:
            if x['product_id'] in ids:raise ValueError(f'duplicate product reference: {x["product_id"]}')
            ids.add(x['product_id']);candidates.append({**x,'origin':file.name,'legacy':False})
    m=json.loads((base/'lv_reference_prices_v1.json').read_text(encoding='utf-8'))
    if m['supplier_file_sha256']!=source_sha:raise ValueError('LV supplier hash mismatch')
    if {x['product_id'] for x in m['items']}!=set(LV_SOURCE):raise ValueError('LV mapping changed; review required')
    for x in m['items']:
        b,model=LV_SOURCE[x['product_id']]
        if x['product_id'] in ids:raise ValueError('duplicate LV product reference')
        ids.add(x['product_id']);candidates.append({**x,'supplier_brand':b,'supplier_model':model,'origin':'lv_reference_prices_v1.json','legacy':False})
    # Independent references are separate from official evidence.
    for secondary in sorted(base.glob('secondary_reference_prices_v*.json'),key=lambda p:int(re.search(r'v(\d+)\.json$',p.name).group(1))):
        sm=json.loads(secondary.read_text(encoding='utf-8'))
        if sm.get('supplier_file_sha256')!=source_sha:raise ValueError('independent-source supplier hash mismatch')
        for x in sm['items']:
            if x['product_id'] in ids:raise ValueError('duplicate independent product reference')
            ids.add(x['product_id']);candidates.append({**x,'origin':secondary.name,'legacy':False,'secondary':True})
    # Previously imported records without official or independent references.
    staged=json.loads((base/'supplier_exact_prices_staged.json').read_text(encoding='utf-8'))
    for x in staged['prices']:
        if x['product_id'] not in ids:candidates.append({**x,'origin':'supplier_exact_prices_staged.json','legacy':True})
    return candidates

def assess(groups,candidates,products,evidence,source_sha,legacy_marker,secondary_evidence=None):
    secondary_evidence=secondary_evidence or {}
    assigned=collections.defaultdict(list);conflicts=collections.defaultdict(list);ambiguous=collections.defaultdict(list);unmapped=[]
    for x in candidates:
        pid=x['product_id'];p=products.get(pid)
        # Manifest presence alone is not proof of local DB application.
        if not p or p['price'] is None:continue
        targets,why=group_candidate(groups,x)
        if not targets:unmapped.append(pid);continue
        if why=='ambiguous':
            for k in targets:ambiguous[k].append(pid)
            continue
        key=targets[0]
        if Decimal(str(p['price']))!=Decimal(x['usd_per_kg']):conflicts[key].append(pid);continue
        ev=evidence.get(pid)
        if x.get('secondary'):
            sev=secondary_evidence.get(pid)
            if ev or not sev or sev['sha']!=source_sha or sev['status']!='secondary_original_found_supplier_essence_unverified' or sev['match_status']!='name_matched_supplier_identity_unverified' or sev['provider']!='Fragrantica' or Decimal(sev['price'])!=Decimal(x['usd_per_kg']) or sev['quality']!=x['quality'] or sev['url']!=x['source_url']:
                conflicts[key].append(pid);continue
            assigned[key].append((pid,'secondary',x));continue
        if x['legacy']:
            if ev or not legacy_marker: conflicts[key].append(pid);continue
            assigned[key].append((pid,'legacy',x));continue
        if not ev or ev['sha']!=source_sha or ev['status']!='name_matched_supplier_identity_unverified' or Decimal(ev['price'])!=Decimal(x['usd_per_kg']) or ev['quality']!=x['quality'] or ev['url']!=x['official_url']:
            conflicts[key].append(pid);continue
        assigned[key].append((pid,'provisional',x))
    result=[]
    for k,rs in groups.items():
        positive=[r for r in rs if r['price']>0]; maximum=max((r['price'] for r in positive),default=None)
        ids=[]
        if conflicts[k]: state='conflict';ids=conflicts[k]
        elif ambiguous[k]:state='ambiguous';ids=ambiguous[k]
        elif assigned[k]:
            ids=[z[0] for z in assigned[k]]
            # More than one product or a non-maximum reference deserves review.
            if len(ids)!=1 or maximum is None or any(Decimal(z[2]['usd_per_kg'])!=maximum for z in assigned[k]):state='conflict'
            else:state=assigned[k][0][1]
        elif maximum is None:state='no_positive'
        else:state='pending'
        top=sorted({r['quality'] for r in positive if r['price']==maximum}) if maximum is not None else []
        result.append({'brand':k[0],'model':k[1],'supplier_gender':k[2],
                       'supplier_names':' / '.join(dict.fromkeys(r['fa'] for r in rs)),
                       'row_count':len(rs),'lines':','.join(str(r['line']) for r in rs),
                       'max_usd_per_kg':str(maximum) if maximum is not None else '',
                       'max_quality':','.join(top),'state':state,'status_fa':STATES[state],
                       'product_ids':' | '.join(sorted(set(ids))),
                       'reference_urls':' | '.join(dict.fromkeys(z[2].get('source_url',z[2].get('official_url','')) for z in assigned[k] if z[2].get('source_url',z[2].get('official_url')))),
                       'source_manifests':' | '.join(dict.fromkeys(z[2].get('origin','') for z in assigned[k] if z[2].get('origin')))})
    return result,unmapped

def read_db(path):
    db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')  # consistent snapshot across all read-only queries
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('SQLite integrity check failed')
        products={r[0]:{'price':r[1],'mode':r[2]} for r in db.execute('SELECT id,essence_usd_per_kg,supply_mode FROM products')}
        evidence={r[0]:{'sha':r[1],'price':r[2],'quality':r[3],'status':r[4],'url':r[5]} for r in db.execute('SELECT product_id,supplier_file_sha256,usd_per_kg,quality,match_status,official_url FROM supplier_price_evidence')}
        legacy_marker=bool(db.execute("SELECT 1 FROM settings WHERE key='supplier_exact_price_import_v1'").fetchone())
        secondary={}
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='secondary_reference_evidence'").fetchone():
            secondary={r[0]:{'sha':r[1],'price':r[2],'quality':r[3],'match_status':r[4],'url':r[5],'provider':r[6],'status':r[7]} for r in db.execute('SELECT product_id,supplier_file_sha256,usd_per_kg,quality,match_status,source_url,provider,status FROM secondary_reference_evidence')}
        return products,evidence,legacy_marker,secondary
    finally:db.close()

def apply_review_flags(root, source_sha, rows):
    """Attach manually reviewed ambiguity advisories; never alter price state."""
    flags=json.loads((root/'reports/supplier_review_flags_20261101.json').read_text(encoding='utf-8'))
    if flags.get('source_sha256') != source_sha: raise ValueError('review flags source hash mismatch')
    by_key={(r['brand'],r['model'],r['supplier_gender']):r for r in rows}
    seen=set()
    for item in flags['items']:
        key=(item['brand'],item['model'],item['supplier_gender'])
        if key in seen or key not in by_key or item['expected_fa'] not in by_key[key]['supplier_names'].split(' / ') or not item['warning'] or not item['reference_urls']:
            raise ValueError('review flag does not match source group')
        seen.add(key)
        by_key[key]['review_warning']=item['warning']
        by_key[key]['review_sources']=' | '.join(item['reference_urls'])
    for r in rows:
        r.setdefault('review_warning','')
        r.setdefault('review_sources','')
    return len(seen)

def check_flagged_manifest_candidates(groups, candidates, rows):
    """Fail the audit for manifest candidates touching an unresolved flagged row.

    Examine all manifest entries, including entries not yet applied to the DB.
    A model shared by two gender-labelled source groups is permitted only when
    the source row can be uniquely identified as the unflagged group. These
    labels describe source rows, not the fragrance's gender.
    """
    flagged={(r['brand'],r['model'],r['supplier_gender']) for r in rows if r['review_warning']}
    for candidate in candidates:
        targets, why=group_candidate(groups,candidate)
        if flagged.intersection(targets):
            raise ValueError(f"unresolved supplier review flag in {candidate['origin']}: {candidate['product_id']} ({why})")

def audit(root,db_path):
    rows,sha=read_rows(root/SOURCE);groups=group_rows(rows);products,evidence,legacy_marker,secondary=read_db(db_path)
    candidates=manifests(root,sha);result,unmapped=assess(groups,candidates,products,evidence,sha,legacy_marker,secondary)
    flag_count=apply_review_flags(root,sha,result)
    check_flagged_manifest_candidates(groups,candidates,result)
    counts=collections.Counter(r['state'] for r in result)
    summary={'source_sha256':sha,'supplier_rows':len(rows),'supplier_groups':len(groups),
             'definition':'exact supplier brand + model + supplier gender; not proven unique fragrances',
             'groups_by_state':{k:counts[k] for k in STATES},
             'rows_by_state':{k:sum(r['row_count'] for r in result if r['state']==k) for k in STATES},
             'manual_review_flags':flag_count,
             'local_products':len(products),'local_priced_products':sum(p['price'] is not None for p in products.values()),
             'local_modes':dict(collections.Counter(p['mode'] for p in products.values())),
             'unmapped_priced_manifest_ids':unmapped,
             'priced_products_without_manifest':[pid for pid,p in products.items() if p['price'] is not None and pid not in {x['product_id'] for x in candidates}],
             'disclaimer':'Price/file and name evidence are not supplier essence identity verification or availability.'}
    assert sum(summary['groups_by_state'].values())==len(groups)
    assert sum(summary['rows_by_state'].values())==len(rows)
    return summary,result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--db',type=Path,default=ROOT/'data/yazd.db');ap.add_argument('--csv',type=Path);ap.add_argument('--json',type=Path);args=ap.parse_args()
    summary,rows=audit(ROOT,args.db)
    if args.csv:
        args.csv.parent.mkdir(parents=True,exist_ok=True)
        with args.csv.open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader()
            # Supplier-provided strings should never become spreadsheet formulas.
            def safe(v):
                return "'"+v if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@')) else v
            w.writerows({k:safe(v) for k,v in row.items()} for row in rows)
    text=json.dumps(summary,ensure_ascii=False,indent=2)+'\n'
    if args.json:args.json.parent.mkdir(parents=True,exist_ok=True);args.json.write_text(text,encoding='utf-8')
    print(text,end='')
if __name__=='__main__':main()
