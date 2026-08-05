#!/usr/bin/env python3
"""
عکس‌برداری از صفحات تازه‌ساخته — «چرا ما؟» و نوار اعتماد.

صفحه why-us خیلی بلند است (بیش از ۱۳ هزار پیکسل روی موبایل)،
پس علاوه بر نمای کامل، بخش‌بخش هم بریده می‌شود تا واقعاً
قابل خواندن باشد. نمای کامل در یک تصویر، متن را آنقدر کوچک
می‌کند که بازبینی محتوا ممکن نیست.

خروجی: shots/new-pages/

اجرا: python3 scripts/capture_new.py
"""
import asyncio
import os
import shutil

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "shots", "new-pages")

MOBILE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}

G = "\033[32m"; R = "\033[31m"; D = "\033[2m"; X = "\033[0m"
made = []


async def full(page, path, out, label):
    try:
        await page.goto(BASE + path, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1400)
        # اسکرول تا انتها تا تصاویر تنبل بیایند
        await page.evaluate("""async () => {
            await new Promise(res => {
                let y = 0;
                const t = setInterval(() => {
                    window.scrollTo(0, y); y += 700;
                    if (y > document.body.scrollHeight) { clearInterval(t); res(); }
                }, 55);
            });
            window.scrollTo(0, 0);
        }""")
        await page.wait_for_timeout(800)
        await page.screenshot(path=out, full_page=True)
        made.append(out)
        print(f"    {G}✓{X} {label}")
        return True
    except Exception as e:
        print(f"    {R}✗{X} {label} — {str(e)[:55]}")
        return False


async def clip(page, path, selector, out, label, pad=16, maxh=900):
    """برش دقیق یک بخش — برای خواندن محتوا"""
    try:
        await page.goto(BASE + path, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1300)
        loc = page.locator(selector).first
        if not await loc.count():
            print(f"    {D}· {label} یافت نشد{X}")
            return False
        await loc.scroll_into_view_if_needed()
        await page.wait_for_timeout(500)
        box = await loc.bounding_box()
        vw = page.viewport_size["width"]
        await page.screenshot(path=out, clip={
            "x": 0,
            "y": max(0, box["y"] - pad),
            "width": vw,
            "height": min(maxh, box["height"] + pad * 2),
        })
        made.append(out)
        print(f"    {G}✓{X} {label}")
        return True
    except Exception as e:
        print(f"    {R}✗{X} {label} — {str(e)[:55]}")
        return False


async def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    # مرورگر موجود در کش
    exe = None
    base = os.path.join(os.environ.get("HOME", "/home/user"), ".cache", "ms-playwright")
    if os.path.isdir(base):
        dirs = sorted(d for d in os.listdir(base) if d.startswith("chromium"))
        for d in reversed(dirs):
            for c in ("chrome-headless-shell-linux64/chrome-headless-shell",
                      "chrome-linux/chrome"):
                f = os.path.join(base, d, c)
                if os.path.exists(f):
                    exe = f
                    break
            if exe:
                break

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=exe,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])

        # ── موبایل ──
        print("\n  موبایل ۳۹۰px")
        ctx = await browser.new_context(
            viewport=MOBILE, device_scale_factor=2,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                       "AppleWebKit/605.1.15 Mobile/15E148")
        pg = await ctx.new_page()

        await full(pg, "/why-us", os.path.join(OUT, "01-why-us-full-mobile.png"),
                   "چرا ما؟ — نمای کامل")

        # بخش‌های کلیدی، جدا و خوانا
        parts = [
            (".lead-card",  "02-why-lead.png",     "کارت «کوتاه و صریح»",       760),
            (".safety",     "03-why-safety.png",   "هشدار متانول",              900),
            (".facts",      "04-why-credentials.png", "مدرک و سابقه",           480),
            (".cmp",        "05-why-compare.png",  "جدول مقایسه با بازار",      760),
            (".try",        "06-why-sample.png",   "دعوت به سمپل",              520),
            (".honest",     "07-why-honest.png",   "آنچه استفاده نمی‌کنیم",     560),
        ]
        for sel, name, label, mh in parts:
            await clip(pg, "/why-us", sel, os.path.join(OUT, name), label, maxh=mh)

        # نوار اعتماد صفحه اصلی
        await clip(pg, "/", ".trust-row",
                   os.path.join(OUT, "08-trust-row-mobile.png"),
                   "نوار اعتماد صفحه اصلی", maxh=1000)

        # منو با گزینه تازه
        try:
            await pg.goto(BASE + "/", wait_until="networkidle", timeout=60000)
            await pg.wait_for_timeout(900)
            btn = pg.locator(".menu-btn, .burger, [aria-label*='منو']").first
            if await btn.count():
                await btn.click()
                await pg.wait_for_timeout(700)
                await pg.screenshot(path=os.path.join(OUT, "09-menu-mobile.png"))
                made.append(os.path.join(OUT, "09-menu-mobile.png"))
                print(f"    {G}✓{X} منوی موبایل")
        except Exception:
            print(f"    {D}· منوی موبایل رد شد{X}")

        await ctx.close()

        # ── دسکتاپ ──
        print("\n  دسکتاپ ۱۴۴۰px")
        ctx2 = await browser.new_context(viewport=DESKTOP)
        pg2 = await ctx2.new_page()
        await full(pg2, "/why-us", os.path.join(OUT, "10-why-us-full-desktop.png"),
                   "چرا ما؟ — نمای کامل")
        await clip(pg2, "/", ".trust-row",
                   os.path.join(OUT, "11-trust-row-desktop.png"),
                   "نوار اعتماد", maxh=420)
        await clip(pg2, "/why-us", ".cmp",
                   os.path.join(OUT, "12-compare-desktop.png"),
                   "جدول مقایسه", maxh=600)
        # صفحه اسانس که لینک تازه گرفت
        await full(pg2, "/essences", os.path.join(OUT, "13-essences-desktop.png"),
                   "خانه‌های اسانس (با لینک تازه)")
        await ctx2.close()

        await browser.close()

    total = sum(os.path.getsize(f) for f in made) / 1048576
    print(f"\n  {G}{len(made)} عکس{X} · {total:.1f} مگابایت · shots/new-pages/\n")


asyncio.run(main())
