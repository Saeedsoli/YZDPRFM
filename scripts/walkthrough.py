#!/usr/bin/env python3
"""
سفر کامل کاربر — برای بازبینی چشمی ظاهر و حس کاربری.

چرا این اسکریپت وجود دارد:
    دیدن «حس کاربری» با خواندن کد ممکن نیست. این اسکریپت مسیر
    واقعی یک مشتری را در مرورگر موبایل طی می‌کند و از هر مرحله
    عکس می‌گیرد — از ورود تا سبد خرید.

    جایگزین ارزان و سریع استقرار روی سرور بیرونی، وقتی هدف فقط
    دیدن ظاهر و ارتباط بین صفحه‌هاست.

اجرا:
    python3 scripts/walkthrough.py            # موبایل (پیش‌فرض)
    python3 scripts/walkthrough.py --desktop  # دسکتاپ
"""

import os
import sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "walkthrough")
BASE = os.getenv("BASE", "http://127.0.0.1:3000")
DESKTOP = "--desktop" in sys.argv

os.makedirs(OUT, exist_ok=True)

VIEW = {"width": 1366, "height": 900} if DESKTOP else {"width": 390, "height": 844}
TAG = "d" if DESKTOP else "m"

steps = []


def shot(pg, name, title, full=False):
    """عکس + ثبت در فهرست"""
    n = f"{len(steps)+1:02d}_{TAG}_{name}.png"
    pg.screenshot(path=os.path.join(OUT, n), full_page=full)
    steps.append((n, title))
    print(f"  {len(steps):02d}  {title}")


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport=VIEW, device_scale_factor=2, locale="fa-IR",
                        service_workers="allow")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    print(f"\n  سفر کاربر — {'دسکتاپ' if DESKTOP else 'موبایل'}\n")

    # ── ۱) صفحه اصلی ──
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(2500)
    shot(pg, "home_hero", "صفحه اصلی — نخستین برخورد")

    pg.evaluate("document.querySelector('.search-hub').scrollIntoView({block:'start'})")
    pg.wait_for_timeout(700)
    shot(pg, "home_filters", "جستجو و فیلترها (جنسیت · خانواده · نُت)")

    pg.evaluate("document.querySelector('#showcase').scrollIntoView({block:'start'})")
    pg.wait_for_timeout(900)
    shot(pg, "showcase", "ویترین فصلی")

    pg.evaluate("document.querySelector('#grid').scrollIntoView({block:'start'})")
    pg.wait_for_timeout(900)
    shot(pg, "catalog", "کاتالوگ محصولات")

    # ── ۲) فیلتر نُت ──
    chips = pg.locator("#noteBar .nchip")
    if chips.count():
        chips.first.click()
        pg.wait_for_timeout(1800)
        pg.evaluate("document.querySelector('#catTitle').scrollIntoView({block:'start'})")
        pg.wait_for_timeout(700)
        shot(pg, "note_filter", "نتیجه فیلتر نُت بویایی")
        # پاک کردن فیلتر
        clr = pg.locator("#activeFilters .clear-all, #activeFilters button")
        if clr.count():
            clr.last.click()
            pg.wait_for_timeout(1500)

    # ── ۳) صفحه محصول ──
    card = pg.locator("#grid .product-card").first
    href = card.get_attribute("href")
    pg.goto(BASE + href, wait_until="networkidle")
    pg.wait_for_timeout(2200)
    shot(pg, "product_top", "صفحه محصول — بالای صفحه")

    pg.evaluate("window.scrollBy(0, 700)")
    pg.wait_for_timeout(800)
    shot(pg, "product_variants", "انتخاب حجم و قیمت")

    pg.evaluate("window.scrollBy(0, 900)")
    pg.wait_for_timeout(800)
    shot(pg, "product_notes", "هرم بویایی و مشخصات")

    # ── ۴) افزودن به سبد ──
    add = pg.locator("button:has-text('افزودن به سبد')").first
    if add.count() and add.is_enabled():
        add.click()
        pg.wait_for_timeout(1600)
        shot(pg, "added", "پس از افزودن به سبد")

    # ── ۵) سبد ──
    pg.goto(BASE + "/cart", wait_until="networkidle")
    pg.wait_for_timeout(2000)
    shot(pg, "cart", "سبد خرید", full=True)

    # ── ۶) تسویه ──
    pg.goto(BASE + "/checkout", wait_until="networkidle")
    pg.wait_for_timeout(2000)
    shot(pg, "checkout", "تسویه‌حساب", full=True)

    # ── ۷) کوییز ──
    pg.goto(BASE + "/quiz", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    shot(pg, "quiz_q1", "کوییز — پرسش اول")

    for _ in range(8):
        o = pg.locator(".quiz-option, .opt, [data-value]")
        if o.count() == 0:
            break
        o.first.click()
        pg.wait_for_timeout(650)
        if pg.locator(".quiz-result-card").count():
            break
    pg.wait_for_timeout(1200)
    shot(pg, "quiz_result", "کوییز — نتیجه", full=True)

    # ── ۸) پیشنهاد شخصی در صفحه اصلی ──
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(3000)
    if pg.locator("#tasteBox").is_visible():
        pg.evaluate("document.querySelector('#tasteBox').scrollIntoView({block:'start'})")
        pg.wait_for_timeout(800)
        shot(pg, "taste_box", "پیشنهاد برای شما (بر پایه کوییز)")

    # ── ۹) صفحه‌های محتوایی ──
    for path, name, title in [
        ("/samples", "samples", "سمپل ۳ میل"),
        ("/why-us", "whyus", "چرا عطر یزد؟"),
        ("/essences", "essences", "خانه‌های اسانس"),
        ("/journal", "journal", "مجله"),
        ("/brands", "brands", "برندها"),
        ("/track", "track", "پیگیری سفارش"),
        ("/contact", "contact", "تماس و مرجوعی"),
    ]:
        pg.goto(BASE + path, wait_until="networkidle")
        pg.wait_for_timeout(1500)
        shot(pg, name, title, full=True)

    # ── ۱۰) ورود ──
    pg.goto(BASE + "/login", wait_until="networkidle")
    pg.wait_for_timeout(1400)
    shot(pg, "login", "ورود مشتری")

    ctx.close()
    b.close()

# ── صفحه فهرست ──
rows = "\n".join(
    f'<figure><img src="{n}" alt="{t}" loading="lazy">'
    f'<figcaption>{i+1}. {t}</figcaption></figure>'
    for i, (n, t) in enumerate(steps))

html = f"""<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>سفر کاربر — عطر یزد ({'دسکتاپ' if DESKTOP else 'موبایل'})</title>
<style>
body{{font-family:Vazirmatn,system-ui,sans-serif;background:#F4F4F4;margin:0;padding:30px 16px;color:#1A1A1A}}
h1{{text-align:center;font-size:1.5rem;margin-bottom:6px}}
.sub{{text-align:center;color:#6B6B6B;font-size:.86rem;margin-bottom:30px;line-height:2}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px;max-width:1500px;margin:0 auto}}
figure{{margin:0;background:#FFF;border:1px solid #E4E4E4;border-radius:12px;overflow:hidden;
 box-shadow:0 2px 10px rgba(0,0,0,.05)}}
figure img{{width:100%;display:block;border-bottom:1px solid #EEE}}
figcaption{{padding:11px 13px;font-size:.83rem;font-weight:700}}
</style></head><body>
<h1>سفر کاربر در فروشگاه عطر یزد</h1>
<p class="sub">نمای {'دسکتاپ ۱۳۶۶px' if DESKTOP else 'موبایل ۳۹۰px'} · {len(steps)} مرحله<br>
برای دیدن اندازه واقعی، روی هر تصویر کلیک راست کنید و «باز کردن در تب جدید» بزنید.</p>
<div class="grid">{rows}</div>
</body></html>"""

with open(os.path.join(OUT, f"index_{TAG}.html"), "w") as f:
    f.write(html)

print(f"\n  {len(steps)} عکس در walkthrough/")
print(f"  فهرست: walkthrough/index_{TAG}.html")
print(f"  خطای JS: {errors[0][:60] if errors else 'ندارد'}\n")
