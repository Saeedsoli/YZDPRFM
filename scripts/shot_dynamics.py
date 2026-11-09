#!/usr/bin/env python3
"""
بازبینی چشمی ویترین فصلی و «اخیراً دیدید».

چرا لازم است: آزمون سطح API فقط می‌گوید داده درست است. اینکه کاربر
واقعاً چیزی می‌بیند یا نه، سؤال دیگری است — در این پروژه یک بار
صفحه محصول برای همه خالی ماند در حالی که سرور ۲۰۰ می‌داد و هیچ
خطای جاوااسکریپتی هم نبود.

سناریو:
    ۱) صفحه اصلی — بازدیدکننده تازه: «اخیراً دیدید» نباید باشد
    ۲) ویترین فصلی باید تب «مناسب <فصل>» داشته باشد
    ۳) بازدید از دو صفحه محصول
    ۴) بازگشت به صفحه اصلی — حالا «اخیراً دیدید» باید ظاهر شود

اجرا: python3 scripts/shot_dynamics.py
"""

import os
import sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "shots")
BASE = os.getenv("BASE", "http://127.0.0.1:3000")

os.makedirs(OUT, exist_ok=True)

fails = []


def check(label, ok, note=""):
    mark = "\033[32m✓\033[0m" if ok else "\033[31m✗\033[0m"
    print(f"  {mark} {label}" + (f"\033[2m  — {note}\033[0m" if note else ""))
    if not ok:
        fails.append(label)


with sync_playwright() as pw:
    b = pw.chromium.launch()
    # موبایل‌اول: همان اندازه‌ای که اکثر مشتریان می‌بینند
    ctx = b.new_context(viewport={"width": 390, "height": 844},
                        device_scale_factor=2, locale="fa-IR")
    pg = ctx.new_page()

    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    print("\n  بازبینی چشمی پویایی\n")

    # ── ۱) بازدیدکننده تازه ──
    pg.goto(BASE + "/golchin", wait_until="networkidle")
    pg.wait_for_timeout(1200)

    recent = pg.locator("#recent")
    check("بازدیدکننده تازه: «اخیراً دیدید» پنهان است",
          not recent.is_visible())

    tabs = pg.locator(".gl-tab")
    n_tabs = tabs.count()
    labels = [tabs.nth(i).inner_text().strip() for i in range(n_tabs)]
    check("گلچین تب فصلی دارد",
          any("مناسب" in t or "فصل" in t for t in labels),
          " · ".join(labels))

    check("تب فصلی در گلچین هست", any("مناسب" in t or "فصل" in t for t in labels),
          " · ".join(labels))

    cards = pg.locator("#glGrid .product-card").count()
    check("گلچین فصلی کارت نشان می‌دهد", cards >= 3, f"{cards} کارت")

    pg.screenshot(path=os.path.join(OUT, "dyn_1_home_new.png"), full_page=False)

    # ── ۲) بازدید از دو محصول ──
    slugs = []
    links = pg.locator("#glGrid .product-card")
    for i in range(min(2, links.count())):
        href = links.nth(i).get_attribute("href")
        if href:
            slugs.append(href)

    for s in slugs:
        pg.goto(BASE + s, wait_until="networkidle")
        pg.wait_for_timeout(1000)

    check("دو صفحه محصول بازدید شد", len(slugs) == 2, " ".join(slugs))

    # در صفحه محصول دوم، ردیف باید محصول اول را نشان دهد
    rec_prod = pg.locator("#recent")
    prod_visible = rec_prod.is_visible()
    print(f"\033[2m      صفحه محصول دوم: ردیف {'دیده می‌شود' if prod_visible else 'هنوز نه (نیاز به ۲ قلم)'}\033[0m")

    # ── ۳) بازگشت به صفحه اصلی ──
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(1200)

    recent = pg.locator("#recent")
    vis = recent.is_visible()
    check("بازدیدکننده بازگشتی: «اخیراً دیدید» ظاهر شد", vis)

    if vis:
        rc = pg.locator("#recent .product-card").count()
        check("ردیف کارت دارد", rc >= 2, f"{rc} کارت")
        check("دکمه پاک کردن هست",
              pg.locator("#recent .recent-clear").count() == 1)
        recent.scroll_into_view_if_needed()
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, "dyn_2_home_return.png"))

    # ── ۴) پاک کردن ──
    if vis:
        pg.locator("#recent .recent-clear").click()
        pg.wait_for_timeout(400)
        check("پس از پاک کردن، ردیف می‌رود",
              not pg.locator("#recent").is_visible())

        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(1000)
        check("پاک کردن ماندگار است (پس از بارگذاری دوباره)",
              not pg.locator("#recent").is_visible())

    check("هیچ خطای جاوااسکریپتی رخ نداد", not errors,
          errors[0][:70] if errors else "")

    ctx.close()
    b.close()

print()
if fails:
    print(f"\033[31m  {len(fails)} بررسی ناموفق\033[0m\n")
    sys.exit(1)
print(f"\033[32m  همه بررسی‌ها سبز — تصاویر در shots/\033[0m\n")
