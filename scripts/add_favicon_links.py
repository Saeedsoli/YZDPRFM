#!/usr/bin/env python3
"""
افزودن پیوندهای favicon به همه صفحات.

هیچ صفحه‌ای آیکن نداشت — تب مرورگر خالی بود و «افزودن به صفحه
اصلی» روی موبایل مربع سفید می‌ساخت.

پیوندها بلافاصله پس از <meta name="viewport"> درج می‌شوند تا در
همان بلوک متای بالای <head> باشند.

بارِ دوم اجرا بی‌اثر است (idempotent).

اجرا: python3 scripts/add_favicon_links.py
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')

BLOCK = """<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#121212">"""

VIEWPORT = re.compile(r'(<meta\s+name=["\']viewport["\'][^>]*>)', re.I)

changed, skipped, failed = [], [], []

for path in sorted(glob.glob(os.path.join(PUB, '*.html'))):
    name = os.path.basename(path)
    txt = open(path, encoding='utf-8').read()

    if 'rel="icon"' in txt or "rel='icon'" in txt:
        skipped.append(name)
        continue

    m = VIEWPORT.search(txt)
    if not m:
        failed.append(name)
        continue

    txt = txt[:m.end()] + '\n' + BLOCK + txt[m.end():]
    open(path, 'w', encoding='utf-8').write(txt)
    changed.append(name)

print(f"  افزوده شد ({len(changed)}): {'، '.join(changed)}")
if skipped:
    print(f"  از قبل داشت ({len(skipped)}): {'، '.join(skipped)}")
if failed:
    print(f"  ⚠ بدون viewport ({len(failed)}): {'، '.join(failed)}")
