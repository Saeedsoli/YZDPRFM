#!/usr/bin/env python3
"""عکس نزدیک از کارت محصول و جعبه خرید — برای بازبینی چشمی جشنواره."""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:3000')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'shots')
ARGS = ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--js-flags=--max-old-space-size=256', '--single-process']

with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    ctx = b.new_context(locale='fa-IR', viewport={'width': 390, 'height': 844})
    page = ctx.new_page()

    page.goto(BASE + '/?family=woody', wait_until='networkidle')
    page.wait_for_timeout(2000)
    card = page.locator('.product-card').first
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(800)
    card.screenshot(path=os.path.join(OUT, 'zoom-card.png'))
    print('  ✓ zoom-card.png')

    # شبکه چهار کارتی روی دسکتاپ
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(2000)
    grid = page.locator('.product-grid, #grid, .grid').first
    grid.scroll_into_view_if_needed()
    page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(OUT, 'zoom-grid.png'))
    print('  ✓ zoom-grid.png')

    slug = page.evaluate("() => document.querySelector('.product-card')?.getAttribute('href')")
    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(BASE + slug, wait_until='networkidle')
    page.wait_for_timeout(2000)
    box = page.locator('.buy-box').first
    box.scroll_into_view_if_needed()
    page.wait_for_timeout(600)
    box.screenshot(path=os.path.join(OUT, 'zoom-buybox.png'))
    print('  ✓ zoom-buybox.png')

    ctx.close(); b.close()
