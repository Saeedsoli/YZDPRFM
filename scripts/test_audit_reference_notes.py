#!/usr/bin/env python3
"""Read-only fixture tests; never opens the store's database."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile

root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('audit_notes',root/'scripts/audit_reference_notes.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
with tempfile.TemporaryDirectory(prefix='note-audit-') as tmp:
    p=Path(tmp); seed=p/'seed';seed.mkdir();db=p/'fixture.db'
    notes={'top':['rose'],'middle':[],'base':['wood']}
    (seed/'official_note_corrections_v1.json').write_text(json.dumps({'items':[{'product_id':'a','verified_notes':notes,'source_url':'https://example.test/item'},{'product_id':'b','verified_notes':notes,'source_url':'http://example.test/item'}]}))
    (seed/'secondary_supplement_v1.json').write_text(json.dumps([{'id':'a','notes':notes,'source_url':'https://example.test/independent'}]))
    (seed/'supplier_verified_supplement.json').write_text(json.dumps([{'id':'b','notes':notes,'source_url':'https://example.test/legacy'}]))
    con=sqlite3.connect(db);con.execute('CREATE TABLE products(id TEXT,slug TEXT,name_fa TEXT,brand_fa TEXT,notes_top TEXT,notes_middle TEXT,notes_base TEXT,supply_mode TEXT)')
    def add(pid,top,mid,base,mode='MADE_TO_ORDER'):
        con.execute('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)',(pid,pid,pid,'brand',json.dumps(top),json.dumps(mid),json.dumps(base),mode))
    add('a',['rose'],[],['wood']);add('b',['rose'],[],['wood']);add('c',[],[],[]);add('d',['rose'],[],['different']);add('e',['rose'],[],['wood'],'UNAVAILABLE')
    con.commit();con.close();before=db.read_bytes()
    rows=a.audit(db,seed);assert db.read_bytes()==before
    assert [r['status'] for r in rows]==['candidate_match','candidate_match','no_pyramid_notes','no_candidate_match']
    assert rows[0]['candidate_categories']=='independent | official';assert 'example.test/independent' in rows[0]['candidate_urls']
    assert rows[1]['candidate_categories']=='official_candidate' and 'supplier_verified_supplement.json' in rows[1]['candidate_manifests']
    assert a.note_tuple({'top':[]}) is None
    assert a.note_tuple({'top':[123],'middle':[],'base':[]}) is None
print('PASS read-only note audit: exact tiers, source separation, missing/invalid evidence and no-notes cases')
