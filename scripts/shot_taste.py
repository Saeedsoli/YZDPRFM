#!/usr/bin/env python3
"""
بازبینی چشمی پروفایل بویایی — سناریوی واقعی مرورگر.

چرا لازم است: آزمون سطح API فقط می‌گوید داده درست است. اینکه کاربر
واقعاً چیزی می‌بیند یا نه، سؤال دیگری است. در این پروژه یک بار صفحه
محصول برای همه خالی ماند در حالی که سرور ۲۰۰ می‌داد.

سناریو:
    ۱) صفحه اصلی — مهمان تازه: «پیشنهاد برای شما» نباید باشد
    ۲) کوییز کامل حل شود
    ۳) بازگشت به صفحه اصلی — بخش باید با خلاصه سلیقه ظاهر شود
    ۴) «فراموش کن» — بخش برود و پس از بارگذاری دوباره هم نباشد

اجرا: python3 scripts/shot_taste.py
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
    ctx = b.new_context(viewport={"width": 390, "height": 844},
                        device_scale_factor=2, locale="fa-IR")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    print("\n  بازبینی چشمی پروفایل بویایی\n")

    # ── ۱) مهمان تازه ──
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(1800)
    check("مهمان تازه: «پیشنهاد برای شما» پنهان است",
          not pg.locator("#tasteBox").is_visible())

    # ── ۲) حل کوییز ──
    pg.goto(BASE + "/quiz", wait_until="networkidle")
    pg.wait_for_timeout(1200)

    steps = 0
    for _ in range(8):
        opts = pg.locator(".quiz-option, .opt, [data-value]")
        if opts.count() == 0:
            break
        opts.first.click()
        steps += 1
        pg.wait_for_timeout(700)
        if pg.locator(".quiz-result-card").count() > 0:
            break

    results = pg.locator(".quiz-result-card").count()
    check("کوییز تا نتیجه پیش رفت", results > 0,
          f"{steps} گام · {results} پیشنهاد")

    saved = pg.evaluate("() => localStorage.getItem('yazd_taste')")
    check("پروفایل در مرورگر ذخیره شد", bool(saved),
          (saved or "")[:60])

    if results:
        pg.screenshot(path=os.path.join(OUT, "taste_1_quiz.png"))

    # ── ۳) بازگشت به صفحه اصلی ──
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(2500)

    box = pg.locator("#tasteBox")
    vis = box.is_visible()
    check("پس از کوییز: «پیشنهاد برای شما» ظاهر شد", vis)

    if vis:
        cards = pg.locator("#tasteBox .product-card").count()
        check("بخش کارت دارد", cards >= 3, f"{cards} کارت")

        chips = pg.locator("#tasteBox .taste-chip")
        n_chips = chips.count()
        labels = [chips.nth(i).inner_text().strip() for i in range(n_chips)]
        check("خلاصه سلیقه نشان داده می‌شود", n_chips >= 2,
              " · ".join(labels))

        check("لینک تغییر سلیقه هست",
              pg.locator("#tasteBox .taste-link").count() == 1)
        check("دکمه فراموش کن هست",
              pg.locator("#tasteBox .taste-clear").count() == 1)

        box.scroll_into_view_if_needed()
        pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(OUT, "taste_2_home.png"))

        # ── ۴) فراموش کن ──
        pg.locator("#tasteBox .taste-clear").click()
        pg.wait_for_timeout(600)
        check("پس از «فراموش کن» بخش می‌رود",
              not pg.locator("#tasteBox").is_visible())

        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(2200)
        check("فراموشی ماندگار است",
              not pg.locator("#tasteBox").is_visible())

    check("هیچ خطای جاوااسکریپتی رخ نداد", not errors,
          errors[0][:70] if errors else "")

    ctx.close()
    b.close()

print()
if fails:
    print(f"\033[31m  {len(fails)} بررسی ناموفق\033[0m\n")
    sys.exit(1)
print("\033[32m  همه بررسی‌ها سبز — تصاویر در shots/\033[0m\n")
