#!/usr/bin/env python3
"""عکس‌برداری از نمایش جشنواره — کارت فهرست، صفحه محصول، سبد.

هدف: دیدن با چشم، نه فقط سبز شدن آزمون. سرریز افقی و شکستن ردیف
قیمت در RTL چیزهایی‌اند که فقط در تصویر معلوم می‌شوند.

اجرا: python3 scripts/capture_campaign.py
"""
import os, sys, json
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:3000')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'shots')
os.makedirs(OUT, exist_ok=True)

# پرچم‌های کم‌مصرف — ۱٫۹ گیگ رم کل سیستم است
ARGS = ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--js-flags=--max-old-space-size=256', '--single-process']

MOBILE = {'width': 390, 'height': 844}
DESK = {'width': 1280, 'height': 900}

problems = []


def shoot(page, path, name, size, full=False):
    page.set_viewport_size(size)
    page.goto(BASE + path, wait_until='networkidle', timeout=45000)
    page.wait_for_timeout(1200)
    f = os.path.join(OUT, name + '.png')
    page.screenshot(path=f, full_page=full)

    # سرریز افقی: عرض محتوا نباید از عرض دید بیشتر باشد
    over = page.evaluate("""() => {
      const w = document.documentElement.clientWidth;
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > w + 1 || r.left < -1)) {
          bad.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40),
                     over: Math.round(Math.max(r.right - w, -r.left)) });
        }
      }
      return bad.slice(0, 5);
    }""")
    if over:
        problems.append((name, 'سرریز افقی', over))
    print(f'  ✓ {name}  ({size["width"]}px)' + (f'  ⚠ سرریز: {over}' if over else ''))
    return f


with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    ctx = b.new_context(locale='fa-IR')
    page = ctx.new_page()

    print('\n  ── فهرست محصولات با جشنواره ──')
    shoot(page, '/?family=woody', 'camp-list-mobile', MOBILE)
    shoot(page, '/?family=woody', 'camp-list-desktop', DESK)

    # درصد واقعاً روی کارت رندر شده؟
    page.goto(BASE + '/?family=woody', wait_until='networkidle')
    page.wait_for_timeout(1500)
    n_off = page.locator('.card-off').count()
    n_old = page.locator('.price-old').count()
    print(f'  نشان تخفیف روی {n_off} کارت · قیمت خط‌خورده روی {n_old} کارت')
    if n_off == 0:
        problems.append(('لیست', 'هیچ نشان تخفیفی رندر نشد', None))

    # اولین محصول را باز کن
    slug = page.evaluate(
        "() => document.querySelector('.product-card')?.getAttribute('href')")
    print(f'\n  ── صفحه محصول: {slug} ──')
    if slug:
        shoot(page, slug, 'camp-product-mobile', MOBILE, full=True)
        shoot(page, slug, 'camp-product-desktop', DESK)
        page.goto(BASE + slug, wait_until='networkidle')
        page.wait_for_timeout(1500)
        flag = page.locator('.camp-flag').count()
        voff = page.locator('.voff').count()
        was = page.locator('#priceWas:visible').count()
        print(f'  جعبه جشنواره: {flag} · نشان روی واریانت: {voff} · قیمت قبلی: {was}')
        if not flag:
            problems.append(('محصول', 'جعبه جشنواره دیده نشد', None))
        if not was:
            problems.append(('محصول', 'قیمت پیش از تخفیف دیده نشد', None))

        # افزودن به سبد و دیدن صفحه سبد
        try:
            page.click('#addBtn', timeout=8000)
            page.wait_for_timeout(1200)
            print('\n  ── سبد خرید ──')
            shoot(page, '/cart', 'camp-cart-mobile', MOBILE, full=True)
            page.goto(BASE + '/cart', wait_until='networkidle')
            page.wait_for_timeout(2500)
            camp_row = page.locator('.camp-row').count()
            txt = page.locator('.summary').inner_text()
            print(f'  سطر جشنواره در سبد: {camp_row}')
            print('  ---\n  ' + txt.replace('\n', '\n  '))
            if not camp_row:
                problems.append(('سبد', 'سطر تخفیف جشنواره دیده نشد', None))
        except Exception as e:
            problems.append(('سبد', f'افزودن به سبد ناموفق: {e}', None))

    ctx.close()
    b.close()

print('\n' + ('=' * 50))
if problems:
    print(f'  {len(problems)} مشکل:')
    for p in problems:
        print(f'   ✗ {p[0]}: {p[1]}  {p[2] or ""}')
    sys.exit(1)
print('  همه‌چیز درست رندر شد.')
