#!/usr/bin/env python3
"""عکس صفحه دعوت‌نامه نظر — حالت عادی، خطای اعتبارسنجی، و پس از ثبت.

بدون این، فقط می‌دانیم API درست است؛ نمی‌دانیم مشتری چه می‌بیند.
"""
import os, sys, json, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:3000')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'shots')
os.makedirs(OUT, exist_ok=True)
TOKEN = sys.argv[1] if len(sys.argv) > 1 else None
ARGS = ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--js-flags=--max-old-space-size=256', '--single-process']

problems = []


def overflow(page):
    return page.evaluate("""() => {
      const w = document.documentElement.clientWidth;
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > w + 1 || r.left < -1))
          bad.push(el.tagName + '.' + (el.className || '').toString().slice(0, 28));
      }
      return bad.slice(0, 4);
    }""")


with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    ctx = b.new_context(locale='fa-IR', viewport={'width': 390, 'height': 844})
    p = ctx.new_page()

    # ── حالت عادی ──
    p.goto(f'{BASE}/review/{TOKEN}', wait_until='networkidle')
    p.wait_for_timeout(2200)
    p.screenshot(path=f'{OUT}/invite-mobile.png', full_page=True)
    ov = overflow(p)
    print(f'  ✓ invite-mobile.png' + (f'  ⚠ سرریز {ov}' if ov else ''))
    if ov: problems.append(('موبایل', ov))

    has_stars = p.locator('.ri-star').count()
    has_prod = p.locator('.ri-prod').count()
    print(f'  ستاره: {has_stars} · کارت محصول: {has_prod}')
    if has_stars != 5: problems.append(('ستاره', has_stars))

    # ── خطای اعتبارسنجی: ثبت بدون پر کردن ──
    p.click('#sendBtn')
    p.wait_for_timeout(700)
    p.screenshot(path=f'{OUT}/invite-errors.png', full_page=True)
    errs = p.locator('.ri-err').count()
    print(f'  ✓ invite-errors.png — {errs} پیام خطا')
    if errs < 2: problems.append(('خطا', f'فقط {errs} پیام'))

    # ── دسکتاپ ──
    p.set_viewport_size({'width': 1280, 'height': 900})
    p.reload(wait_until='networkidle')
    p.wait_for_timeout(2000)
    p.screenshot(path=f'{OUT}/invite-desktop.png')
    ov = overflow(p)
    print(f'  ✓ invite-desktop.png' + (f'  ⚠ سرریز {ov}' if ov else ''))

    # ── ثبت واقعی ──
    p.set_viewport_size({'width': 390, 'height': 844})
    p.reload(wait_until='networkidle')
    p.wait_for_timeout(2000)
    p.click('.ri-star[data-n="4"]')
    p.fill('#rName', 'مریم ک.')
    p.fill('#rTitle', 'دقیقاً همان چیزی که انتظار داشتم')
    p.fill('#rBody', 'سه ماه است استفاده می‌کنم. ماندگاری روی پوست من حدود هفت ساعت است '
                     'و چند بار از من پرسیدند چه عطری زده‌ام.')
    p.select_option('#rLong', '4')
    p.select_option('#rSill', '4')
    p.wait_for_timeout(400)
    p.screenshot(path=f'{OUT}/invite-filled.png', full_page=True)
    print('  ✓ invite-filled.png')

    p.click('#sendBtn')
    p.wait_for_timeout(2200)
    p.screenshot(path=f'{OUT}/invite-done.png')
    txt = p.locator('#root').inner_text()
    print('  ── پس از ثبت ──')
    print('  ' + txt.replace('\n', '\n  '))

    # ── لینک مصرف‌شده ──
    p.goto(f'{BASE}/review/{TOKEN}', wait_until='networkidle')
    p.wait_for_timeout(1800)
    p.screenshot(path=f'{OUT}/invite-used.png')
    print('  ── بازدید دوباره ──')
    print('  ' + p.locator('#root').inner_text().replace('\n', '\n  '))

    ctx.close(); b.close()

print()
if problems:
    print('  مشکل:', problems); sys.exit(1)
print('  صفحه درست رندر شد.')
