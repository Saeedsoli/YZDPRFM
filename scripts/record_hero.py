#!/usr/bin/env python3
"""
ضبط ویدیوی انیمیشن هیرو — برای بازبینی حرکت واقعی.

چرا لازم است:
    اسکرین‌شات حرکت را نشان نمی‌دهد. ذرات معلق فقط در ویدیو
    دیده می‌شوند.

نکته فنی:
    Playwright ویدیو را در قالب WebM ضبط می‌کند. مرورگرها و
    نمایشگر Arena این قالب را پخش می‌کنند.

    ویوپورت را کوچک نگه می‌داریم تا حجم فایل معقول بماند —
    هدف دیدن حرکت است، نه کیفیت سینمایی.

اجرا:
    python3 scripts/record_hero.py            # موبایل
    python3 scripts/record_hero.py --desktop
"""

import os
import sys
import shutil
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "hero-video")
BASE = os.getenv("BASE", "http://127.0.0.1:3000")
DESKTOP = "--desktop" in sys.argv

# ثانیه ضبط — یک چرخه کامل ذرات ۱۰ تا ۲۰ ثانیه است،
# ولی ۱۲ ثانیه برای دیدن حرکت کافی است و حجم را کنترل می‌کند.
SECONDS = 12

VIEW = {"width": 1000, "height": 560} if DESKTOP else {"width": 390, "height": 720}
TAG = "desktop" if DESKTOP else "mobile"

os.makedirs(OUT, exist_ok=True)
tmp = os.path.join(OUT, "_tmp")
os.makedirs(tmp, exist_ok=True)

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(
        viewport=VIEW,
        locale="fa-IR",
        record_video_dir=tmp,
        record_video_size=VIEW,
    )
    pg = ctx.new_page()
    pg.goto(BASE, wait_until="networkidle")

    # صبر تا فونت و تصویر کامل بارگذاری شوند — وگرنه ثانیه اول
    # ویدیو حالت نیمه‌ساخته را نشان می‌دهد
    pg.wait_for_timeout(2500)

    # هیرو را در قاب نگه می‌داریم
    pg.evaluate("window.scrollTo(0,0)")

    n = pg.locator(".hero-dust i").count()
    visible = pg.evaluate(
        "()=>[...document.querySelectorAll('.hero-dust i')]"
        ".filter(e=>getComputedStyle(e).display!=='none').length")
    print(f"\n  ضبط {TAG} — {SECONDS} ثانیه")
    print(f"  ذرات: {n} تعریف‌شده · {visible} دیده‌شده")

    pg.wait_for_timeout(SECONDS * 1000)

    ctx.close()   # ویدیو هنگام بستن context ذخیره می‌شود
    b.close()

# انتقال از پوشه موقت با نام معنادار
vids = [f for f in os.listdir(tmp) if f.endswith(".webm")]
if not vids:
    print("  ضبط ناموفق بود.")
    sys.exit(1)

dest = os.path.join(OUT, f"hero-{TAG}.webm")
shutil.move(os.path.join(tmp, vids[0]), dest)
shutil.rmtree(tmp, ignore_errors=True)

kb = os.path.getsize(dest) // 1024
print(f"  {dest}  ({kb}KB)\n")
