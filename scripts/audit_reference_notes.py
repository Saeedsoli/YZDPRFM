#!/usr/bin/env python3
"""Conservative read-only inventory of note-specific manifest matches.

A match is only a candidate for review, not proof of a source's current
contents, historical migration, the supplier essence, or handmade ingredients.
Absence of a match is not proof that no source exists elsewhere.
"""
import argparse
import csv
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
TIERS = ('top', 'middle', 'base')


def note_tuple(notes):
    if not isinstance(notes, dict) or any(not isinstance(notes.get(k), list) or not all(isinstance(v, str) for v in notes[k]) for k in TIERS):
        return None
    return tuple(tuple(notes[k]) for k in TIERS)


def candidates(seed):
    sources = [
        ('official_note_corrections_v*.json', 'official', 'verified_notes'),
        ('active_official_note_corrections_v*.json', 'official', 'verified_notes'),
        ('secondary_note_corrections_v*.json', 'independent', 'notes'),
        ('official_supplement_v*.json', 'official', 'notes'),
        # The earlier supplier supplement predates versioned supplements. Its
        # URLs and notes are candidates only; some source_note fields point to
        # a different page or explicitly say an official pyramid was not found.
        ('supplier_verified_supplement.json', 'official_candidate', 'notes'),
        ('secondary_supplement_v*.json', 'independent', 'notes'),
        ('owner_reference_selection_v*.json', 'owner_selected', 'notes'),
        ('secondary_reference_prices_v*.json', 'independent', 'notes'),
    ]
    out = {}
    for pattern, category, field in sources:
        for file in sorted(seed.glob(pattern)):
            data = json.loads(file.read_text(encoding='utf-8'))
            items = data if isinstance(data, list) else data.get('items', [])
            for item in items:
                pid = item.get('product_id') or item.get('id')
                notes = note_tuple(item.get(field))
                url = item.get('additional_note_url') or item.get('source_url')
                parsed = urlsplit(url or '')
                if not pid or notes is None or parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
                    continue
                out.setdefault(pid, []).append({'notes': notes, 'url': url, 'category': category, 'file': file.name})
    return out


def classify(product, evidence):
    notes = tuple(tuple(json.loads(product['notes_' + k] or '[]')) for k in TIERS)
    if not any(notes):
        return 'no_pyramid_notes', []
    matches = [x for x in evidence.get(product['id'], []) if x['notes'] == notes]
    return ('candidate_match' if matches else 'no_candidate_match'), matches


def audit(db_path, seed):
    evidence = candidates(seed)
    db = sqlite3.connect(db_path.resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        rows = db.execute("SELECT id,slug,name_fa,brand_fa,notes_top,notes_middle,notes_base FROM products WHERE supply_mode IN ('MADE_TO_ORDER','IN_STOCK') ORDER BY id").fetchall()
        result = []
        for p in rows:
            status, matches = classify(p, evidence)
            result.append({'product_id':p['id'], 'slug':p['slug'], 'brand_fa':p['brand_fa'], 'name_fa':p['name_fa'], 'status':status,
                           'candidate_categories':' | '.join(sorted({m['category'] for m in matches})),
                           'candidate_manifests':' | '.join(sorted({m['file'] for m in matches})),
                           'candidate_urls':' | '.join(sorted({m['url'] for m in matches}))})
        return result
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=ROOT/'data/yazd.db')
    parser.add_argument('--seed', type=Path, default=ROOT/'seed')
    parser.add_argument('--csv', type=Path)
    args = parser.parse_args()
    rows = audit(args.db, args.seed)
    if args.csv:
        # Never overwrite an existing file, particularly the source database.
        with args.csv.open('x', encoding='utf-8-sig', newline='') as f:
            w = csv.DictWriter(f, fieldnames=['product_id','slug','brand_fa','name_fa','status','candidate_categories','candidate_manifests','candidate_urls'])
            w.writeheader(); w.writerows(rows)
    print(json.dumps({'active_products':len(rows), 'candidate_matches':sum(r['status']=='candidate_match' for r in rows),
                      'no_candidate_match':sum(r['status']=='no_candidate_match' for r in rows),
                      'no_pyramid_notes':sum(r['status']=='no_pyramid_notes' for r in rows),
                      'limitation':'Candidate manifest equality only; sources not rechecked, accord and other fields not audited; no supplier identity or ingredient verification.'}, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
