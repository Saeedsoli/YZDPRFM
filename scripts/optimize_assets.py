#!/usr/bin/env python3
"""Optimise every raster and SVG asset that the store serves.

Policy (single source of truth, also written to seed/asset_pipeline_v1.json):
  * product & scene photos
        webp  760px  q66   ← primary modern format
        avif  760px  q50   ← served when the browser accepts it and it is smaller
        jpg   560px  q64   ← fallback for old browsers
        *-sm  webp 320px q70 · avif 320 q52 · jpg 260px q66
  * brand raster logos: max height 120, plus webp/avif twins
  * SVG logos: comments, metadata and surplus precision removed
  * nothing larger than 1200px is kept except the social share card and app icons

The script is idempotent: it records a checksum per produced file and skips
anything already matching the current policy, so re-running it does not
re-compress an image again and again.

Usage:
    python3 scripts/optimize_assets.py [--dry-run] [--force]
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
IMAGES = PUBLIC / 'images'
BRANDS = IMAGES / 'brands'
MANIFEST = ROOT / 'seed' / 'asset_pipeline_v1.json'

POLICY = {
    'version': 1,
    'photo': {'webp': [760, 66], 'avif': [760, 50], 'jpg': [560, 64]},
    'thumb': {'webp': [320, 70], 'avif': [320, 52], 'jpg': [260, 66]},
    'brand': {'max_height': 120, 'webp_q': 82, 'avif_q': 60},
    'max_edge': 1200,
    'exempt_from_max_edge': ['brand-logo-og.png', 'icon-512.png', 'icon-maskable-512.png',
                             'brand_logo.png', 'apple-touch-icon.png'],
}

SIZABLE = ('.jpg', '.jpeg', '.png', '.webp', '.avif')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding='utf-8'))
    return {'version': POLICY['version'], 'policy': POLICY, 'files': {}}


def save_manifest(manifest):
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def resize(im, edge):
    if im.width <= edge:
        return im
    return im.resize((edge, max(1, round(im.height * edge / im.width))), Image.LANCZOS)


def encode(im, fmt, quality):
    from io import BytesIO
    buf = BytesIO()
    if fmt == 'jpg':
        im.convert('RGB').save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
    elif fmt == 'webp':
        im.save(buf, 'WEBP', quality=quality, method=6)
    elif fmt == 'avif':
        im.save(buf, 'AVIF', quality=quality)
    else:
        raise ValueError(fmt)
    return buf.getvalue()


def photo_targets(path):
    """Every raster that is a product/scene photo gets the same four variants."""
    stem = path.stem
    base = Path(str(path).replace(path.suffix, ''))
    if stem.endswith('-sm'):
        return None
    return base


def process_photo(base, manifest, force, dry):
    """base is the path without extension, e.g. public/images/products/fam-woody-m-2"""
    stem = base.name
    thumb = base.with_name(stem + '-sm')
    result = {'kind': 'photo'}
    produced = 0
    saved_before = 0
    for key, target in (('photo', base), ('thumb', thumb)):
        spec = POLICY['photo'] if key == 'photo' else POLICY['thumb']
        source = None
        for ext in ('.webp', '.jpg', '.jpeg', '.png', '.avif'):
            candidate = Path(str(target) + ext)
            if candidate.exists():
                source = candidate
                break
        if source is None:
            continue
        if not force and manifest['files'].get(str(source.relative_to(ROOT))) == sha(source):
            continue
        try:
            im = Image.open(source).convert('RGB')
        except Exception as error:
            print(f'  ! unreadable {source}: {error}')
            continue
        webp_bytes = None
        for fmt, (edge, quality) in spec.items():
            data = encode(resize(im, edge), fmt, quality)
            out = Path(str(target) + ('.jpg' if fmt == 'jpg' else '.' + fmt))
            if fmt in ('avif', 'webp') and webp_bytes is not None and len(data) >= len(webp_bytes):
                continue  # this format does not actually help here
            if fmt == 'webp':
                webp_bytes = data
            old = out.stat().st_size if out.exists() else 0
            if dry:
                print(f'    {out.relative_to(ROOT)} {old//1024}KB -> {len(data)//1024}KB')
            else:
                out.write_bytes(data)
                manifest['files'][str(out.relative_to(ROOT))] = sha(out)
            produced += 1
            saved_before += max(0, old - len(data))
        if not dry:
            manifest['files'][str(source.relative_to(ROOT))] = sha(source)
    return produced, saved_before


def process_brand_raster(path, manifest, force, dry):
    key = str(path.relative_to(ROOT))
    if not force and manifest['files'].get(key) == sha(path):
        return 0, 0
    try:
        im = Image.open(path).convert('RGBA')
    except Exception as error:
        print(f'  ! unreadable {path}: {error}')
        return 0, 0
    limit = POLICY['brand']['max_height']
    if im.height > limit:
        im = im.resize((max(1, round(im.width * limit / im.height)), limit), Image.LANCZOS)
    flat = Image.new('RGB', im.size, (255, 255, 255))
    flat.paste(im, mask=im.split()[-1])
    produced = 0
    saved = 0
    old = path.stat().st_size
    if not dry and im.height <= limit and path.suffix.lower() in ('.png', '.jpg', '.jpeg'):
        from io import BytesIO
        buf = BytesIO()
        if path.suffix.lower() == '.png':
            flat.quantize(colors=64, method=Image.MEDIANCUT).save(buf, 'PNG', optimize=True)
        else:
            flat.save(buf, 'JPEG', quality=90, optimize=True, progressive=True)
        if len(buf.getvalue()) < old:      # never replace a file with a bigger one
            path.write_bytes(buf.getvalue())
    twins = {}
    for fmt, quality in (('webp', POLICY['brand']['webp_q']), ('avif', POLICY['brand']['avif_q'])):
        data = encode(flat, fmt, quality)
        out = path.with_suffix('.' + fmt)
        twins[fmt] = len(data)
        if dry:
            print(f'    {out.relative_to(ROOT)} new {len(data)}B')
        else:
            out.write_bytes(data)
            manifest['files'][str(out.relative_to(ROOT))] = sha(out)
        produced += 1
    if not dry:
        manifest['files'][key] = sha(path)
    saved += max(0, old - path.stat().st_size)
    return produced, saved


WHITESPACE = re.compile(r'>\s+<')


def minify_svg(text):
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    text = re.sub(r'<\?xml.*?\?>', '', text, flags=re.S)
    text = re.sub(r'<metadata.*?</metadata>', '', text, flags=re.S)
    text = re.sub(r'<!DOCTYPE.*?>', '', text, flags=re.S | re.I)
    text = re.sub(r'>\s+<', '><', text)
    text = re.sub(r'\s{2,}', ' ', text)
    text = re.sub(r'(\d+\.\d{3,})', lambda m: f'{float(m.group(1)):.2f}'.rstrip('0').rstrip('.'), text)
    return text.strip()


def process_svg(path, manifest, force, dry):
    key = str(path.relative_to(ROOT))
    if not force and manifest['files'].get(key) == sha(path):
        return 0, 0
    raw = path.read_text(encoding='utf-8')
    out = minify_svg(raw)
    if '<svg' not in out or '<script' in out.lower():
        return 0, 0
    old = path.stat().st_size
    if len(out.encode()) >= old:
        return 0, 0
    if dry:
        print(f'    {key} {old}B -> {len(out.encode())}B')
    else:
        path.write_text(out, encoding='utf-8')
        manifest['files'][key] = sha(path)
    return 1, max(0, old - path.stat().st_size)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()

    manifest = load_manifest()
    if manifest.get('policy') != POLICY:
        manifest = {'version': POLICY['version'], 'policy': POLICY, 'files': {}}

    before = sum(p.stat().st_size for p in IMAGES.rglob('*') if p.is_file())
    produced = saved = 0

    photos = [p for p in IMAGES.rglob('*') if p.is_file() and p.suffix.lower() in SIZABLE]
    bases = {}
    for p in photos:
        if p.suffix.lower() == '.avif':
            continue
        stem = p.stem
        if stem.endswith('-sm'):
            key = p.with_name(stem[:-3])
        else:
            key = p.with_suffix('')
        bases.setdefault(key, []).append(p)

    for base, members in sorted(bases.items()):
        if base.name in POLICY['exempt_from_max_edge']:
            continue
        if BRANDS in base.parents:
            for m in members:
                if m.suffix.lower() in ('.png', '.jpg', '.jpeg'):
                    n, s = process_brand_raster(m, manifest, args.force, args.dry_run)
                    produced += n; saved += s
            continue
        n, s = process_photo(base, manifest, args.force, args.dry_run)
        produced += n; saved += s

    for svg in sorted(BRANDS.glob('*.svg')):
        n, s = process_svg(svg, manifest, args.force, args.dry_run)
        produced += n; saved += s

    if not args.dry_run:
        save_manifest(manifest)

    after = sum(p.stat().st_size for p in IMAGES.rglob('*') if p.is_file())
    print(f'\nproduced {produced} files · saved {saved/1048576:.2f} MB this run')
    print(f'images folder: {before/1048576:.2f} MB -> {after/1048576:.2f} MB')


if __name__ == '__main__':
    main()
