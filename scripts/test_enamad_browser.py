#!/usr/bin/env python3
"""
آزمون مرورگری نشان اعتماد الکترونیک.

چرا جدا از `test_enamad.js`:

    آزمون Node فقط **کد را می‌خواند** — می‌گوید «رشته
    rel="noopener" در فایل هست». ولی نمی‌داند آیا نشان واقعاً در
    DOM ساخته می‌شود، آیا CSP آن را مسدود می‌کند، و آیا فوتر
    هنگام رسیدن تصویر می‌پرد.

    این سه چیز فقط با مرورگر واقعی معلوم می‌شوند.

نکته مهم: سرور اینماد از این محیط در دسترس نیست (و روی localhost
هم نشان را نمی‌دهد). پس درخواست به `trustseal.enamad.ir` را
**رهگیری** می‌کنیم و یک PNG ساختگی برمی‌گردانیم. این دقیقاً همان
مسیری را می‌آزماید که در تولید طی می‌شود، بدون وابستگی به شبکه.

اجرا: python3 scripts/test_enamad_browser.py
"""
import asyncio, base64, json, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3000"
REAL_ID = "580961"
REAL_CODE = "ZWbXjtwpxxh2fPPh72XCAXEIjFrTLMU8"

# PNG ۱×۱ شفاف — جانشین تصویر نشان
PIX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

checks = []
def add(label, ok, note=""):
    mark = "\033[32m✓\033[0m" if ok else "\033[31m✗\033[0m"
    extra = f"  \033[2m— {note}\033[0m" if note else ""
    print(f"  {mark} {label}{extra}")
    checks.append(ok)


async def main():
    import urllib.request

    def api_post(path, payload, token=None):
        req = urllib.request.Request(
            BASE + path, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json",
                     **({"Authorization": "Bearer " + token} if token else {})},
            method="POST")
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())

    def api_get(path, token=None):
        req = urllib.request.Request(
            BASE + path,
            headers={"Authorization": "Bearer " + token} if token else {})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())

    # ورود مدیر و ثبت کد واقعی
    tok = api_post("/api/admin/login",
                   {"username": "owner", "password": "yazd1404"}).get("token")
    if not tok:
        print("  ورود مدیر ناموفق — آزمون متوقف شد")
        sys.exit(1)

    # ── وضعیت پیش از آزمون نگه داشته می‌شود ──
    # نسخه اول این آزمون در پایان تنظیمات را **خالی** می‌کرد، نه
    # اینکه به حالت اولیه برگرداند. نتیجه: کد واقعی اینماد که مالک
    # ثبت کرده بود، با هر بار اجرای آزمون پاک می‌شد.
    # ممیزی مستندات این را گرفت — آزمون نباید داده واقعی را بخورد.
    _s = api_get("/api/admin/settings", tok)
    ORIGINAL = {"enamad_id": _s.get("enamad_id", "") or "",
                "enamad_code": _s.get("enamad_code", "") or ""}

    saved = api_post("/api/admin/settings",
                     {"enamad_id": REAL_ID, "enamad_code": REAL_CODE}, tok)

    print()
    print("\033[1m  آزمون مرورگری نشان اعتماد\033[0m")
    print("\033[2m  ─────────────────────────────────────────────\033[0m")
    print()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()

        # ── رهگیری درخواست نشان ──
        hits = {"img": 0, "url": None, "referer": None}

        async def handle(route, request):
            hits["img"] += 1
            hits["url"] = request.url
            hits["referer"] = request.headers.get("referer")
            await route.fulfill(status=200, content_type="image/png", body=PIX)

        await page.route("**/trustseal.enamad.ir/**", handle)

        csp_blocked = []
        page.on("console", lambda m: csp_blocked.append(m.text)
                if "Content Security Policy" in m.text else None)

        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ═══ ۱) نشان در صفحه اصلی ═══
        print("\033[1m  ۱) نشان در صفحه اصلی\033[0m")
        await page.goto(BASE + "/", wait_until="networkidle")
        await page.wait_for_timeout(1200)

        seal = page.locator("a.enamad-seal")
        cnt = await seal.count()
        add("لینک نشان در DOM ساخته می‌شود", cnt == 1, f"{cnt} عنصر")

        if cnt:
            href = await seal.get_attribute("href")
            rel = await seal.get_attribute("rel")
            target = await seal.get_attribute("target")
            aria = await seal.get_attribute("aria-label")
            add("نشانی شامل شناسه و کد است",
                REAL_ID in (href or "") and REAL_CODE in (href or ""))
            add("‎rel=noopener در DOM واقعی هست", rel == "noopener", str(rel))
            add("‎target=_blank هست", target == "_blank")
            add("‎aria-label برای صفحه‌خوان هست", bool(aria), (aria or "")[:40])

            img = page.locator("a.enamad-seal img")
            add("تصویر بدون اسکرول کاربر بار می‌شود", hits["img"] > 0,
                f"{hits['img']} درخواست — باگی که همین آزمون گرفت")
            add("CSP تصویر را مسدود نکرد",
                not any("img-src" in c for c in csp_blocked),
                "بدون افزودن دامنه، اینجا قرمز می‌شد")

            alt = await img.get_attribute("alt")
            add("‎alt گویا در DOM هست", bool(alt and len(alt) > 5), alt)

            w = await img.get_attribute("width")
            hgt = await img.get_attribute("height")
            add("ابعاد ثابت روی تگ هست", w == "96" and hgt == "96", f"{w}×{hgt}")

            # مبدأ باید فرستاده شود — اینماد برای احراز لازمش دارد
            add("سرآیند مبدأ فرستاده شد", bool(hits["referer"]),
                str(hits["referer"]))

        add("هیچ خطای جاوااسکریپت رخ نداد", not errors,
            "; ".join(errors[:2]) if errors else "")

        # ═══ ۲) پایداری چیدمان ═══
        print()
        print("\033[1m  ۲) پایداری چیدمان (CLS)\033[0m")

        page2 = await ctx.new_page()
        await page2.route("**/trustseal.enamad.ir/**", handle)
        await page2.add_init_script("""
          window.__cls = 0;
          new PerformanceObserver(list => {
            for (const e of list.getEntries())
              if (!e.hadRecentInput) window.__cls += e.value;
          }).observe({type:'layout-shift', buffered:true});
        """)
        await page2.goto(BASE + "/", wait_until="networkidle")
        await page2.wait_for_timeout(2000)
        cls = await page2.evaluate("window.__cls || 0")
        add("پرش چیدمان صفر مانده", cls < 0.01, f"CLS = {cls:.4f}")

        box = await page2.locator("#enamadSeal").bounding_box()
        add("جعبه نشان ارتفاع دارد", box and box["height"] >= 96,
            f"{box['height']:.0f}px" if box else "بدون جعبه")

        # کادر باید مربع دور تصویر باشد، نه تمام عرض ستون
        seal_box = await page2.locator("a.enamad-seal").bounding_box()
        add("کادر سفید به اندازه تصویر است",
            seal_box and seal_box["width"] < 140,
            f"{seal_box['width']:.0f}px — قاعده عمومی فوتر آن را ۳۵۰ می‌کرد"
            if seal_box else "")
        await page2.close()

        # ═══ ۳) وقتی سرور اینماد جواب ندهد ═══
        print()
        print("\033[1m  ۳) سرور اینماد در دسترس نیست\033[0m")

        page3 = await ctx.new_page()
        await page3.route("**/trustseal.enamad.ir/**",
                          lambda route, req: asyncio.ensure_future(route.abort()))
        await page3.goto(BASE + "/", wait_until="networkidle")
        await page3.wait_for_timeout(1500)

        fallback = await page3.locator(".enamad-badge").count()
        broken = await page3.locator("a.enamad-seal img").count()
        add("به نشان جانشین برمی‌گردد", fallback == 1,
            "تصویر شکسته بدتر از نبودنش است")
        add("تصویر شکسته روی صفحه نمی‌ماند", broken == 0)

        # هر دو حالت باید دقیقاً یک فضا بگیرند
        off_box = await page3.locator("#enamadSeal").bounding_box()
        add("جعبه در حالت جانشین همان ارتفاع را دارد",
            off_box and abs(off_box["height"] - 110) < 2,
            f"{off_box['height']:.0f}px = ۱۱۰px" if off_box else "")
        await page3.close()

        # ═══ ۳.۵) سرور اینماد کند است (نه قطع) ═══
        print()
        print("\033[1m  ۳.۵) سرور اینماد پاسخ نمی‌دهد\033[0m")

        import time as _t
        page35 = await ctx.new_page()

        async def hang(route, req):
            await asyncio.sleep(60)      # معلق نگه می‌داریم

        await page35.route("**/trustseal.enamad.ir/**", hang)
        _t0 = _t.time()
        try:
            await page35.goto(BASE + "/", wait_until="networkidle", timeout=25000)
            _el = _t.time() - _t0
            add("صفحه معلق نمی‌ماند", _el < 20, f"{_el:.1f} ثانیه — مهلت ۸ ثانیه")
        except Exception:
            add("صفحه معلق نمی‌ماند", False, "بیش از ۲۵ ثانیه معلق ماند")
        add("جانشین در حالت کندی می‌نشیند",
            await page35.locator(".enamad-badge").count() == 1)
        await page35.close()

        # ═══ ۴) وقتی کد ثبت نشده ═══
        print()
        print("\033[1m  ۴) کد ثبت‌نشده\033[0m")

        api_post("/api/admin/settings", {"enamad_id": "", "enamad_code": ""}, tok)
        page4 = await ctx.new_page()
        await page4.goto(BASE + "/", wait_until="networkidle")
        await page4.wait_for_timeout(1200)

        add("نشان آزمایشی نمایش داده می‌شود",
            await page4.locator(".enamad-badge").count() == 1)
        add("نشان جعلی ساخته نمی‌شود",
            await page4.locator("a.enamad-seal").count() == 0,
            "سایت ادعای دروغ نمی‌کند")
        txt = await page4.locator(".enamad-badge").inner_text()
        add("متن می‌گوید آزمایشی", "آزمایشی" in txt, txt.strip()[:40])
        await page4.close()

        # ═══ ۵) نیمه‌پر ═══
        print()
        print("\033[1m  ۵) فقط یک بخش ثبت شده\033[0m")

        api_post("/api/admin/settings",
                 {"enamad_id": REAL_ID, "enamad_code": ""}, tok)
        page5 = await ctx.new_page()
        await page5.goto(BASE + "/", wait_until="networkidle")
        await page5.wait_for_timeout(1200)
        add("نشانی ناقص ساخته نمی‌شود",
            await page5.locator("a.enamad-seal").count() == 0,
            "وگرنه تصویر شکسته می‌شد")
        add("جانشین می‌نشیند",
            await page5.locator(".enamad-badge").count() == 1)
        await page5.close()

        # ═══ ۶) صفحه دیگر ═══
        print()
        print("\033[1m  ۶) نشان در همه صفحات\033[0m")

        api_post("/api/admin/settings",
                 {"enamad_id": REAL_ID, "enamad_code": REAL_CODE}, tok)
        for path, name in [("/contact", "تماس با ما"), ("/cart", "سبد خرید")]:
            p = await ctx.new_page()
            await p.route("**/trustseal.enamad.ir/**", handle)
            await p.goto(BASE + path, wait_until="networkidle")
            await p.wait_for_timeout(1200)
            add(f"نشان در «{name}» هست",
                await p.locator("a.enamad-seal").count() == 1)
            await p.close()

        await browser.close()

    # بازگرداندن وضعیت اولیه — آزمون نباید داده واقعی را عوض کند
    api_post("/api/admin/settings", ORIGINAL, tok)
    back = api_get("/api/admin/settings", tok)
    add("تنظیمات به حالت پیش از آزمون برگشت",
        (back.get("enamad_id") or "") == ORIGINAL["enamad_id"] and
        (back.get("enamad_code") or "") == ORIGINAL["enamad_code"],
        f"id={ORIGINAL['enamad_id'] or 'خالی'}")

    failed = sum(1 for c in checks if not c)
    print()
    if failed == 0:
        print(f"\033[32m  نشان در مرورگر واقعی درست کار می‌کند.  {len(checks)}/{len(checks)}\033[0m")
    else:
        print(f"\033[31m  {failed} بررسی ناموفق از {len(checks)}.\033[0m")
    print()
    sys.exit(0 if failed == 0 else 1)


asyncio.run(main())
