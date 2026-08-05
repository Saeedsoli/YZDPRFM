#!/usr/bin/env python3
"""
عکس‌برداری از همه صفحات در حالت‌های مختلف.

سه دسته عکس گرفته می‌شود:
  ۱) هر صفحه عمومی — موبایل و دسکتاپ
  ۲) حالت‌های خاص — سبد پر، پیشنهاد جستجو، ناموجود، فیلتر
  ۳) پنل مدیریت — همه تب‌ها (نیازمند ورود)

نکته: صفحه کامل (full_page) گرفته می‌شود نه فقط بخش دیده‌شده،
چون هدف بازبینی طراحی است نه سنجش سرعت.

خروجی: shots/<دسته>/<نام>.png

اجرا: python3 scripts/capture_all.py
"""
import asyncio
import os
import shutil
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shots")

MOBILE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}

G = "\033[32m"; R = "\033[31m"; D = "\033[2m"; X = "\033[0m"

# صفحات عمومی: (مسیر، نام فایل، توضیح)
PAGES = [
    ("/",                        "01-home",        "صفحه اصلی"),
    ("/perfume/creed-aventus",   "02-product",     "صفحه محصول"),
    ("/cart",                    "03-cart-empty",  "سبد خالی"),
    ("/checkout",                "04-checkout",    "تسویه حساب"),
    ("/brands",                  "05-brands",      "برندها"),
    ("/journal",                 "06-journal",     "مجله"),
    ("/journal/vetiver-note",    "07-article",     "مقاله"),
    ("/quiz",                    "08-quiz",        "کوییز"),
    ("/essences",                "09-essences",    "خانه‌های اسانس"),
    ("/track",                   "10-track",       "پیگیری سفارش"),
    ("/contact",                 "11-contact",     "تماس"),
    ("/terms",                   "12-terms",       "قوانین"),
    ("/privacy",                 "13-privacy",     "حریم خصوصی"),
    ("/login",                   "14-login",       "ورود مشتری"),
    ("/account",                 "15-account",     "حساب کاربری"),
    ("/wishlist",                "16-wishlist",    "علاقه‌مندی"),
    ("/check",                   "17-check",       "تشخیص اصالت"),
    ("/nope-404",                "18-404",         "صفحه یافت‌نشد"),
]

results = {"ok": 0, "fail": []}


async def shot(page, path, out, full=True):
    """یک عکس؛ خطا کل کار را متوقف نمی‌کند"""
    try:
        await page.goto(BASE + path, wait_until="networkidle", timeout=60000)
        # فرصت برای انیمیشن‌های ورود و تصاویر تنبل
        await page.wait_for_timeout(1400)
        # اسکرول تا انتها تا تصاویر lazy بارگذاری شوند، بعد برگرد بالا
        if full:
            await page.evaluate("""async () => {
                await new Promise(res => {
                    let y = 0;
                    const t = setInterval(() => {
                        window.scrollTo(0, y);
                        y += 700;
                        if (y > document.body.scrollHeight) { clearInterval(t); res(); }
                    }, 60);
                });
                window.scrollTo(0, 0);
            }""")
            await page.wait_for_timeout(900)
        await page.screenshot(path=out, full_page=full)
        results["ok"] += 1
        return True
    except Exception as e:
        results["fail"].append(f"{path} → {str(e)[:60]}")
        return False


async def capture_public(browser):
    """صفحات عمومی در دو اندازه"""
    for label, vp, folder in [("موبایل", MOBILE, "mobile"), ("دسکتاپ", DESKTOP, "desktop")]:
        d = os.path.join(OUT, folder)
        os.makedirs(d, exist_ok=True)
        print(f"\n  {label}")
        ctx = await browser.new_context(
            viewport=vp,
            device_scale_factor=2 if folder == "mobile" else 1,
            user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                        "AppleWebKit/605.1.15 Mobile/15E148") if folder == "mobile" else None,
        )
        pg = await ctx.new_page()
        for path, name, fa in PAGES:
            ok = await shot(pg, path, os.path.join(d, f"{name}.png"))
            print(f"    {G+'✓'+X if ok else R+'✗'+X} {fa}")
        await ctx.close()


async def capture_states(browser):
    """حالت‌های خاص که با بازکردن ساده صفحه دیده نمی‌شوند"""
    d = os.path.join(OUT, "states")
    os.makedirs(d, exist_ok=True)
    print("\n  حالت‌های خاص")

    ctx = await browser.new_context(viewport=MOBILE, device_scale_factor=2)
    pg = await ctx.new_page()

    # پیشنهاد جستجو باز
    try:
        await pg.goto(BASE + "/", wait_until="networkidle", timeout=60000)
        await pg.locator("#searchWrap").scroll_into_view_if_needed()
        await pg.wait_for_timeout(500)
        await pg.fill("#q", "عود")
        await pg.wait_for_timeout(1700)
        box = await pg.locator("#searchWrap").bounding_box()
        await pg.screenshot(path=os.path.join(d, "20-search-suggest.png"),
                            clip={"x": 0, "y": max(0, box["y"] - 30),
                                  "width": 390, "height": 470})
        print(f"    {G}✓{X} پیشنهاد جستجو")
        results["ok"] += 1
    except Exception as e:
        print(f"    {R}✗{X} پیشنهاد جستجو — {str(e)[:50]}")
        results["fail"].append("suggest")

    # نتیجه جستجو در کاتالوگ
    try:
        await pg.goto(BASE + "/?q=%D8%B9%D9%88%D8%AF", wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(1600)
        await pg.screenshot(path=os.path.join(d, "21-search-results.png"), full_page=True)
        print(f"    {G}✓{X} نتیجه جستجو")
        results["ok"] += 1
    except Exception:
        print(f"    {R}✗{X} نتیجه جستجو")

    # فیلتر جنسیت + خانواده
    try:
        await pg.goto(BASE + "/?gender=WOMEN&family=floral", wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(1600)
        await pg.screenshot(path=os.path.join(d, "22-filtered.png"), full_page=True)
        print(f"    {G}✓{X} کاتالوگ فیلترشده")
        results["ok"] += 1
    except Exception:
        print(f"    {R}✗{X} کاتالوگ فیلترشده")

    # سبد پر — از خودِ API سایت استفاده می‌شود نه دستکاری خام.
    # کلید واقعی 'yazd_cart_v1' است؛ بار اول 'yazd_cart' نوشتم و
    # سبد خالی ماند — با نگاه به عکس معلوم شد.
    try:
        await pg.goto(BASE + "/", wait_until="networkidle", timeout=60000)
        await pg.evaluate("""() => {
            YazdCart.add('YZD-0001-EDP-030',
              'کرید — اونتوس — ادو پرفیوم دست‌ساز ۳۰ میل',
              1515000, '/images/products/brand-creed.jpg', 1);
            YazdCart.add('YZD-0001-SMP-003',
              'کرید — اونتوس — سمپل ۳ میل تست',
              196000, '/images/products/brand-creed.jpg', 2);
        }""")
        await pg.goto(BASE + "/cart", wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(d, "23-cart-full.png"), full_page=True)
        print(f"    {G}✓{X} سبد پر")
        results["ok"] += 1

        # تسویه با سبد پر
        await pg.goto(BASE + "/checkout", wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(1600)
        await pg.screenshot(path=os.path.join(d, "24-checkout-full.png"), full_page=True)
        print(f"    {G}✓{X} تسویه با کالا")
        results["ok"] += 1
    except Exception as e:
        print(f"    {R}✗{X} سبد پر — {str(e)[:50]}")
        results["fail"].append("cart")

    # صفحات نیازمند ورود مشتری.
    # بدون نشست، /account و /wishlist به صفحه ورود می‌روند و عکس
    # تکراری می‌شود — با مقایسه md5 معلوم شد login و account
    # دقیقاً یکسان درآمده بودند.
    try:
        import sqlite3, secrets, time
        dbp = os.path.join(os.path.dirname(OUT), "data", "yazd.db")
        db = sqlite3.connect(dbp)
        cust = db.execute("SELECT mobile FROM customers LIMIT 1").fetchone()
        if cust:
            tok = secrets.token_hex(24)
            db.execute(
                "INSERT INTO sessions (token, kind, subject, created_at, expires_at) "
                "VALUES (?,?,?,?,?)",
                (tok, "CUSTOMER", cust[0],
                 int(time.time() * 1000), int(time.time() * 1000) + 3600_000))
            db.commit()
            db.close()

            await pg.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
            await pg.evaluate(
                "([t,m]) => { localStorage.setItem('yazd_customer_token', t);"
                " localStorage.setItem('yazd_customer_mobile', m); }",
                [tok, cust[0]])

            for path, name, fa in [("/account", "29-account-in", "حساب کاربری (واردشده)"),
                                   ("/wishlist", "30-wishlist-in", "علاقه‌مندی (واردشده)")]:
                ok = await shot(pg, path, os.path.join(d, f"{name}.png"))
                print(f"    {G+'✓'+X if ok else R+'✗'+X} {fa}")

            # نشست موقت پاک شود
            db2 = sqlite3.connect(dbp)
            db2.execute("DELETE FROM sessions WHERE token=?", (tok,))
            db2.commit(); db2.close()
        else:
            db.close()
            print(f"    {D}· صفحات واردشده رد شد (مشتری نیست){X}")
    except Exception as e:
        print(f"    {R}✗{X} صفحات واردشده — {str(e)[:50]}")

    # فرم ثبت‌نام (تب دوم صفحه ورود)
    try:
        await pg.goto(BASE + "/login", wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(900)
        for sel in ["text=ساخت حساب", "text=ثبت‌نام"]:
            if await pg.locator(sel).count():
                await pg.locator(sel).first.click()
                break
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(d, "25-register.png"), full_page=True)
        print(f"    {G}✓{X} فرم ثبت‌نام")
        results["ok"] += 1
    except Exception:
        print(f"    {R}✗{X} فرم ثبت‌نام")

    # کوییز در حال پاسخ
    try:
        await pg.goto(BASE + "/quiz", wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(1200)
        btn = pg.locator(".q-opt, .quiz-opt, button").first
        if await btn.count():
            await btn.click()
            await pg.wait_for_timeout(1000)
        await pg.screenshot(path=os.path.join(d, "26-quiz-step.png"), full_page=True)
        print(f"    {G}✓{X} کوییز مرحله دوم")
        results["ok"] += 1
    except Exception:
        print(f"    {R}✗{X} کوییز مرحله دوم")

    await ctx.close()

    # فاکتور و برچسب — دسکتاپ چون برای چاپ‌اند.
    # نکته: این دو صفحه فقط برای مدیر یا صاحب سفارش باز می‌شوند.
    # بار اول بدون ورود رفتم و «دسترسی مجاز نیست» گرفتم — که
    # رفتار درستِ سامانه است، نه باگ. پس اول وارد پنل می‌شویم.
    ctx2 = await browser.new_context(viewport=DESKTOP)
    pg2 = await ctx2.new_page()
    try:
        await pg2.goto(BASE + "/admin", wait_until="networkidle", timeout=60000)
        await pg2.fill("#usr", os.environ.get("ADMIN_USERNAME", "owner"))
        await pg2.fill("#pw", os.environ.get("ADMIN_PASSWORD", "yazd1404"))
        await pg2.click('button:has-text("ورود")')
        await pg2.wait_for_timeout(2600)
    except Exception:
        pass
    try:
        import sqlite3
        db = sqlite3.connect(os.path.join(os.path.dirname(OUT), "data", "yazd.db"))
        row = db.execute(
            "SELECT order_id FROM orders WHERE status IN "
            "('PAID','PROCESSING','SHIPPED','DELIVERED') ORDER BY rowid DESC LIMIT 1"
        ).fetchone()
        db.close()
        if row:
            oid = row[0]
            for path, name, fa in [(f"/invoice?order={oid}", "27-invoice", "فاکتور"),
                                   (f"/label?order={oid}", "28-label", "برچسب پستی")]:
                ok = await shot(pg2, path, os.path.join(d, f"{name}.png"))
                print(f"    {G+'✓'+X if ok else R+'✗'+X} {fa}")
        else:
            print(f"    {D}· فاکتور رد شد (سفارش تسویه‌شده نیست){X}")
    except Exception as e:
        print(f"    {R}✗{X} فاکتور — {str(e)[:50]}")
    await ctx2.close()


async def capture_admin(browser):
    """پنل مدیریت — همه تب‌ها"""
    d = os.path.join(OUT, "admin")
    os.makedirs(d, exist_ok=True)
    print("\n  پنل مدیریت")

    ctx = await browser.new_context(viewport=DESKTOP)
    pg = await ctx.new_page()

    try:
        await pg.goto(BASE + "/admin", wait_until="networkidle", timeout=60000)
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.path.join(d, "30-login.png"))
        print(f"    {G}✓{X} صفحه ورود")
        results["ok"] += 1

        await pg.fill("#usr", os.environ.get("ADMIN_USERNAME", "owner"))
        await pg.fill("#pw", os.environ.get("ADMIN_PASSWORD", "yazd1404"))
        await pg.click('button:has-text("ورود")')
        await pg.wait_for_timeout(3000)
    except Exception as e:
        print(f"    {R}✗{X} ورود ناموفق — {str(e)[:60]}")
        results["fail"].append("admin login")
        await ctx.close()
        return

    # نام تب‌ها دقیقاً از خودِ admin.html گرفته شده
    tabs = [
        ("سفارش‌ها",            "31-orders"),
        ("گزارش فروش",          "32-reports"),
        ("تحلیل بازدید",        "33-analytics"),
        ("محصولات و موجودی",    "34-products"),
        ("کدهای تخفیف",         "35-coupons"),
        ("نظرات",               "36-reviews"),
        ("تیکت‌های مرجوعی",     "37-tickets"),
        ("مقالات",              "38-articles"),
        ("کارکنان و نقش‌ها",    "39-staff"),
        ("سابقه کارها",         "40-audit"),
        ("تنظیمات فروشگاه",     "41-settings"),
        ("ابزارها",             "42-tools"),
        ("پروفایل من",          "43-profile"),
    ]
    for fa, name in tabs:
        try:
            loc = pg.locator(f"text={fa}").first
            if not await loc.count():
                print(f"    {D}· تب «{fa}» یافت نشد{X}")
                continue
            await loc.click()
            await pg.wait_for_timeout(1500)
            await pg.screenshot(path=os.path.join(d, f"{name}.png"), full_page=True)
            print(f"    {G}✓{X} {fa}")
            results["ok"] += 1
        except Exception as e:
            print(f"    {R}✗{X} {fa} — {str(e)[:45]}")

    # حالت ویرایش موجودی — مهم‌ترین صفحه کاری انبار
    try:
        await pg.locator("text=محصولات و موجودی").first.click()
        await pg.wait_for_timeout(800)
        await pg.fill("#pSearch", "اونتوس")
        await pg.wait_for_timeout(1700)
        if await pg.locator('#pResults button:has-text("ویرایش")').count():
            await pg.locator('#pResults button:has-text("ویرایش")').first.click()
            await pg.wait_for_timeout(1500)
            await pg.screenshot(path=os.path.join(d, "44-stock-editor.png"), full_page=True)
            print(f"    {G}✓{X} ویرایش موجودی (دکمه ±)")
            results["ok"] += 1
    except Exception as e:
        print(f"    {R}✗{X} ویرایش موجودی — {str(e)[:45]}")

    await ctx.close()


async def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    # مرورگر موجود در کش استفاده می‌شود
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=[
            "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
            "--js-flags=--max-old-space-size=384",
        ])
        print(f"\n  عکس‌برداری از {BASE}")
        await capture_public(browser)
        await capture_states(browser)
        await capture_admin(browser)
        await browser.close()

    total_mb = sum(
        os.path.getsize(os.path.join(r, f))
        for r, _, fs in os.walk(OUT) for f in fs
    ) / 1048576

    print(f"\n  {G}{results['ok']} عکس{X} · {total_mb:.1f} مگابایت · shots/")
    if results["fail"]:
        print(f"  {R}{len(results['fail'])} ناموفق:{X}")
        for f in results["fail"][:6]:
            print("    " + f)
    print()


asyncio.run(main())
