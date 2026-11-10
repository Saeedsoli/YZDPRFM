#!/usr/bin/env python3
"""Fetch simple brand logos from Wikimedia Commons.

Only files whose Commons licence permits reuse are accepted. Everything else
stays as a typographic wordmark on the site, because a non-free logo cannot be
redistributed and a redrawn look-alike would be a fake.

Usage:
    python3 scripts/fetch_brand_logos.py [--limit N] [--sleep S]

Progress is cached in /tmp/yazd-brand-fetch.json so the run can be resumed.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = '/tmp/yazd-brand-fetch.json'
REGISTRY = os.path.join(ROOT, 'seed', 'brand_logos_v1.json')
ASSET_DIR = os.path.join(ROOT, 'public', 'images', 'brands')
API = 'https://commons.wikimedia.org/w/api.php'
UA = {'User-Agent': 'YazdPerfumeAssets/1.0 (local brand tiles; contact dev@yazdperfume.ir)'}
ALLOWED = {'public domain', 'pd-textlogo', 'pd', 'cc0', 'public domain mark'}


def api(params, retries=4):
    url = API + '?' + urllib.parse.urlencode(params)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as res:
                return json.load(res)
        except Exception:
            time.sleep(5 * (attempt + 1))
    return {}


def search_titles(term, limit=6):
    data = api({'action': 'query', 'list': 'search', 'srsearch': term, 'srnamespace': '6',
                'srlimit': str(limit), 'format': 'json'})
    return [hit['title'] for hit in data.get('query', {}).get('search', [])]


def image_info(titles):
    if not titles:
        return {}
    data = api({'action': 'query', 'titles': '|'.join(titles), 'prop': 'imageinfo',
                'iiprop': 'url|size|mime|extmetadata', 'format': 'json'})
    out = {}
    for page in data.get('query', {}).get('pages', {}).values():
        info = (page.get('imageinfo') or [None])[0]
        if info:
            out[page['title']] = info
    return out


def license_of(info):
    meta = info.get('extmetadata', {})
    short = meta.get('LicenseShortName', {}).get('value', '')
    return str(short).strip()


def is_allowed(info):
    return license_of(info).lower() in ALLOWED


def token_of(brand):
    import unicodedata
    plain = unicodedata.normalize('NFKD', brand).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', plain.lower())


BLOCKED_WORDS = ('assassin', 'brotherhood', 'team', 'films', 'film', 'petal', 'gray')


def title_matches(title, brand):
    """The file must be about this brand.

    Search matches people and namesakes too: "Creed" surfaced the Assassin's
    Creed game, "Montale" a person called Fabio Montale, "Coach" another
    company. Requiring the brand token to *start* the file title, and blocking
    known decoys, keeps those out."""
    name = re.sub(r'[^a-z0-9]', '', title[len('File:'):].lower())
    token = token_of(brand)
    if not token or not name.startswith(token):
        return False
    return not any(word in name for word in BLOCKED_WORDS)


def score(title, brand):
    name = title[len('File:'):].lower()
    simple = re.sub(r'[^a-z0-9]', '', brand.lower())
    plain = re.sub(r'[^a-z0-9]', '', name)
    points = 0
    if simple and simple in plain:
        points += 5
    if 'logo' in name:
        points += 3
    if name.endswith('.svg'):
        points += 2
    if 'old' in name or 'alt' in name or 'wordmark' in name:
        points -= 1
    return points


def safe_svg(text):
    if not re.search(r'<svg[\s>]', text, re.I):
        return False
    return not re.search(r'<script|javascript:|onload\s*=|onerror\s*=|href\s*=\s*"https?:', text, re.I)


def slug(brand):
    import unicodedata
    plain = unicodedata.normalize('NFKD', brand).encode('ascii', 'ignore').decode()
    plain = plain.replace("'", '').replace('’', '')
    return re.sub(r'[^a-z0-9]+', '-', plain.lower()).strip('-')


def brands():
    con = sqlite3.connect('file:%s?mode=ro' % os.path.join(ROOT, 'data', 'yazd.db'), uri=True)
    rows = con.execute(
        'SELECT brand_en, COUNT(*) c FROM products WHERE brand_en IS NOT NULL AND brand_en!="" '
        'GROUP BY brand_en ORDER BY c DESC, brand_en').fetchall()
    return [r[0] for r in rows]


def load_cache():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding='utf-8'))
    return {'tried': {}, 'logos': {}}


def save_cache(cache):
    json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--sleep', type=float, default=1.2)
    args = parser.parse_args()

    os.makedirs(ASSET_DIR, exist_ok=True)
    cache = load_cache()
    todo = [b for b in brands() if b not in cache['tried']]
    if args.limit:
        todo = todo[:args.limit]
    print('remaining brands:', len(todo))

    for brand in todo:
        titles = search_titles('%s logo' % brand)
        time.sleep(args.sleep)
        candidates = sorted(titles, key=lambda t: -score(t, brand))[:6]
        info = image_info(candidates)
        time.sleep(args.sleep)
        free = [(t, i) for t, i in info.items() if is_allowed(i) and title_matches(t, brand)]
        free.sort(key=lambda pair: -score(pair[0], brand))
        record = None
        if free:
            title, meta = free[0]
            src = meta['url'].split('?')[0]
            try:
                with urllib.request.urlopen(urllib.request.Request(src, headers=UA), timeout=60) as res:
                    raw = res.read()
            except Exception:
                raw = b''
            mime = meta.get('mime', '')
            name = slug(brand)
            if raw and mime == 'image/svg+xml':
                text = raw.decode('utf-8', errors='replace')
                if safe_svg(text):
                    file = name + '.svg'
                    open(os.path.join(ASSET_DIR, file), 'w', encoding='utf-8').write(text)
                    record = {'file': file, 'commons_title': title, 'source': meta.get('descriptionurl'),
                              'license': license_of(meta), 'width': meta.get('width'),
                              'height': meta.get('height'), 'bytes': len(raw),
                              'sha256': hashlib.sha256(raw).hexdigest()}
            elif raw and mime in ('image/png', 'image/jpeg') and (meta.get('width') or 0) <= 1200:
                ext = '.png' if mime == 'image/png' else '.jpg'
                file = name + ext
                open(os.path.join(ASSET_DIR, file), 'wb').write(raw)
                record = {'file': file, 'commons_title': title, 'source': meta.get('descriptionurl'),
                          'license': license_of(meta), 'width': meta.get('width'),
                          'height': meta.get('height'), 'bytes': len(raw),
                          'sha256': hashlib.sha256(raw).hexdigest()}
            time.sleep(args.sleep)
        cache['tried'][brand] = {'titles': candidates,
                                 'free': [t for t, _ in free],
                                 'accepted': record['file'] if record else None,
                                 'licenses': {t: license_of(i) for t, i in info.items()}}
        if record:
            cache['logos'][brand] = record
            print('  ok   %-26s %-24s %s' % (brand, record['file'], record['license']))
        else:
            print('  none %-26s' % brand)
        save_cache(cache)

    # merge with existing registry entries so a resumed run never drops a logo
    existing = {}
    if os.path.exists(REGISTRY):
        existing = json.load(open(REGISTRY, encoding='utf-8')).get('logos', {})
    merged = {**existing, **cache['logos']}
    merged = {b: r for b, r in merged.items()
              if os.path.exists(os.path.join(ASSET_DIR, r['file']))}
    json.dump({'version': 1, 'source': 'Wikimedia Commons',
               'note': ('Only files marked as public domain on Wikimedia Commons are bundled. '
                        'Trademarks remain the property of their owners; a bundled logo does not '
                        'claim affiliation, sponsorship or product authenticity.'),
               'logos': dict(sorted(merged.items(), key=lambda kv: kv[0].lower()))},
              open(REGISTRY, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('registry entries:', len(merged))


if __name__ == '__main__':
    main()
