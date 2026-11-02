#!/usr/bin/env python3
"""Verify owner-approved generic-scent staging against the immutable price list.

This test and manifest do not import, activate, or modify any database.
"""
import json
from decimal import Decimal
from pathlib import Path
from supplier_coverage import read_rows, group_rows

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'seed/generic_scent_owner_approved_v1.json').read_text(encoding='utf-8'))
rows, sha = read_rows(root / 'uploads/لیست_قیمت_عمده.md')
assert sha == manifest['supplier_file_sha256'] == 'bbe8f40610bc765bda0a7d2da9dbe78f4e397458a6991239c3c18d0853f33f5c'
assert manifest['version'] == 'generic_scent_owner_approved_2026_11_v1'
items = manifest['items']
assert len(items) == 6
assert {x['product_id'] for x in items} == {f'GEN-SCENT-{i:04d}' for i in range(1, 7)}
assert len({x['slug'] for x in items}) == len({x['name_fa'] for x in items}) == 6
groups = group_rows(rows)
seen = set()
for x in items:
    key = (x['supplier_brand'], x['supplier_model'], x['supplier_gender'])
    assert key not in seen and key in groups
    seen.add(key)
    maximum = max(r['price'] for r in groups[key] if r['price'] > 0)
    assert Decimal(x['usd_per_kg']) == maximum
    assert any(r['price'] == maximum and r['quality'] == x['quality'] for r in groups[key])
print('PASS: six distinct generic scents, supplier hash and highest price/quality; staging only')
