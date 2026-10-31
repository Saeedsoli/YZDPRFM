#!/usr/bin/env python3
"""Tests for the read-only supplier reconciliation; no real DB is opened."""
from decimal import Decimal
import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import json
import csv
import tempfile

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('coverage_audit',ROOT/'scripts/supplier_coverage.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

def row(brand,model,gender,quality,price,line,fa):
    return {'brand':brand,'model':model,'gender':gender,'quality':quality,'price':Decimal(price),'line':line,'fa':fa}

rows=[row('B','M','Men','H','100',1,'اول'),row('B','M','Men','A','50',2,'اول'),
      row('B','M','Women','I','50',3,'متناقض'),row('C','Z','Unisex','H','0',4,'صفر'),
      row('D','X','Men','H','10',5,'تست'),row('E','Y','Men','H','20',6,'قدیمی')]
groups=a.group_rows(rows)
base={'supplier_brand':'B','supplier_model':'M','product_id':'p','quality':'H','usd_per_kg':'100','official_url':'https://brand.example/one','legacy':False}
assert a.group_candidate(groups,base)==([('B','M','Men')],'source_row_unique')
ambig={**base,'quality':'I','usd_per_kg':'50'}
# Equal price and grade in two groups cannot be attributed by assumption.
extra=a.group_rows(rows+[row('B','M','Men','I','50',7,'نام دوم')])
assert a.group_candidate(extra,ambig)[1]=='ambiguous'
assert a.group_candidate(groups,{**base,'supplier_gender':'Women'})[0]==[('B','M','Women')]
sha='a'*64
products={'p':{'price':'100','mode':'UNAVAILABLE'},'q':{'price':'10','mode':'UNAVAILABLE'},'legacy':{'price':'20','mode':'UNAVAILABLE'}}
ev={'p':{'sha':sha,'price':'100','quality':'H','status':'name_matched_supplier_identity_unverified','url':base['official_url']},
    'q':{'sha':sha,'price':'10','quality':'H','status':'name_matched_supplier_identity_unverified','url':'https://wrong.example'}}
cs=[base,{'supplier_brand':'D','supplier_model':'X','product_id':'q','quality':'H','usd_per_kg':'10','official_url':'https://brand.example/two','legacy':False},
    {'supplier_brand':'E','supplier_model':'Y','supplier_gender':'Men','product_id':'legacy','quality':'H','usd_per_kg':'20','legacy':True}]
result,unmapped=a.assess(groups,cs,products,ev,sha,True);by={(r['brand'],r['model'],r['supplier_gender']):r for r in result}
assert by[('B','M','Men')]['state']=='provisional'
assert by[('B','M','Women')]['state']=='pending'
assert by[('C','Z','Unisex')]['state']=='no_positive'
assert by[('D','X','Men')]['state']=='conflict'
assert by[('E','Y','Men')]['state']=='legacy'
assert not unmapped
result,_=a.assess(groups,cs,products,ev,sha,False);assert next(r for r in result if r['brand']=='E')['state']=='conflict'
changed={**products,'p':{'price':'99','mode':'UNAVAILABLE'}}
result,_=a.assess(groups,cs,changed,ev,sha,True);assert next(r for r in result if r['brand']=='B' and r['supplier_gender']=='Men')['state']=='conflict'
actual,source_sha=a.read_rows(ROOT/a.SOURCE);assert len(actual)==342;assert len(a.group_rows(actual))==265
# Minimal SQLite ensures reads never initialize application schema or mutate data.
with tempfile.TemporaryDirectory(prefix='coverage-db-') as d:
    p=Path(d)/'test.sqlite';db=sqlite3.connect(p)
    db.executescript("CREATE TABLE products(id TEXT,essence_usd_per_kg TEXT,supply_mode TEXT); CREATE TABLE supplier_price_evidence(product_id TEXT,supplier_file_sha256 TEXT,usd_per_kg TEXT,quality TEXT,match_status TEXT,official_url TEXT); CREATE TABLE settings(key TEXT,value TEXT); INSERT INTO products VALUES('sentinel','1','UNAVAILABLE');")
    db.commit();db.close();before=hashlib.sha256(p.read_bytes()).digest()
    out,evidence,marker=a.read_db(p);assert out['sentinel']['price']=='1' and not evidence and marker is False
    assert hashlib.sha256(p.read_bytes()).digest()==before
    with sqlite3.connect(p) as db:assert db.execute("select count(*) from sqlite_master where name='orders'").fetchone()[0]==0
    out_csv=Path(d)/'report.csv';out_json=Path(d)/'report.json'
    r=subprocess.run(['python3',str(ROOT/'scripts/supplier_coverage.py'),'--db',str(p),'--csv',str(out_csv),'--json',str(out_json)],capture_output=True,text=True,timeout=30)
    assert r.returncode==0,r.stderr
    summary=json.loads(out_json.read_text(encoding='utf8'));assert summary['supplier_rows']==342 and summary['supplier_groups']==265
    assert summary['priced_products_without_manifest']==['sentinel']
    with out_csv.open(encoding='utf-8-sig',newline='') as f:assert len(list(csv.DictReader(f)))==265
    assert hashlib.sha256(p.read_bytes()).digest()==before
print('PASS exact grouping, source-row proof, ambiguous groups, no-positive, provenance/owner conflicts, legacy marker and read-only SQLite')
