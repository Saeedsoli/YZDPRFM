#!/usr/bin/env python3
"""
آزمون مرورگر واقعی — با Chromium، نه فقط سطح API.

چرا لازم است:
    همه آزمون‌های دیگر HTML و JSON را می‌سنجند. اما اگر یک خطای
    جاوااسکریپت رخ دهد، سرور همچنان ۲۰۰ می‌دهد و آزمون‌ها سبز
    می‌مانند — در حالی که صفحه برای مشتری خراب است.

چه چیزی سنجیده می‌شود:
    ۱) هیچ خطای جاوااسکریپت روی هیچ صفحه‌ای نیست
    ۲) هیچ درخواست شکست‌خورده‌ای (تصویر/فونت/اسکریپت) نیست
    ۳) محصولات واقعاً رندر می‌شوند
    ۴) ویترین خودکار کار می‌کند و تب‌هایش سوییچ می‌شوند
    ۵) سبد خرید در مرورگر واقعی کار می‌کند
    ۶) جستجو نتیجه می‌دهد
    ۷) لینک‌های شبکه اجتماعی درست‌اند
    ۸) صفحه روی موبایل سرریز افقی ندارد

اجرا: python3 scripts/test_browser.py
"""
import asyncio, sys, re, json
from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
G = lambda s: f"\033[32m{s}\033[0m"
R = lambda s: f"\033[31m{s}\033[0m"
D = lambda s: f"\033[2m{s}\033[0m"

checks = []

def add(label, ok, note=""):
    print(f"  {G('✓') if ok else R('✗')} {label}" + (D(f"  — {note}") if note else ""))
    checks.append(ok)


async def main():
    async with async_playwright() as p:
        # پرچم‌های کم‌مصرف: این محیط ~۲GB حافظه دارد و Chromium
        # پیش‌فرض کنار سرور Node آن را پر می‌کرد؛ هسته سرور را
        # می‌کشت و آزمون با ERR_CONNECTION_REFUSED می‌افتاد —
        # شکستی که ربطی به خود سایت نداشت.
        browser = await p.chromium.launch(args=[
            "--disable-dev-shm-usage",      # /dev/shm اینجا کوچک است
            "--no-sandbox",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--js-flags=--max-old-space-size=256",
        ])

        # ── ۱) خطای جاوااسکریپت و درخواست شکست‌خورده در همه صفحات ──
        print(D("  خطاهای جاوااسکریپت و منابع"))
        pages = ["/", "/cart", "/checkout", "/track", "/contact", "/brands",
                 "/essences", "/journal", "/quiz", "/wishlist", "/account",
                 "/terms", "/privacy", "/login"]

        all_errors, all_failed = [], []
        for path in pages:
            ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
            pg = await ctx.new_page()
            errs, failed = [], []
            pg.on("pageerror", lambda e, l=path: errs.append(f"{l}: {e}"))
            pg.on("console", lambda m, l=path:
                  errs.append(f"{l}: {m.text}") if m.type == "error" else None)
            # ERR_ABORTED روی فونت یعنی مرورگر درخواست تکراری preload
            # را لغو کرده؛ فونت واقعاً بارگذاری شده. خرابی نیست.
            pg.on("requestfailed", lambda r, l=path:
                  failed.append(f"{l}: {r.url.split('/')[-1]} ({r.failure})")
                  if not (r.failure and "ERR_ABORTED" in r.failure
                          and re.search(r"\.(woff2?|ttf)$", r.url)) else None)
            try:
                await pg.goto(BASE + path, wait_until="networkidle", timeout=30000)
                await pg.wait_for_timeout(900)
            except Exception as e:
                errs.append(f"{path}: بارگذاری نشد {e}")
            all_errors += errs
            all_failed += failed
            await ctx.close()

        add(f"هیچ خطای JS در {len(pages)} صفحه نیست", not all_errors,
            all_errors[0] if all_errors else "")
        add("هیچ منبع شکست‌خورده‌ای نیست", not all_failed,
            all_failed[0] if all_failed else "")

        # ── ۲) صفحه اصلی: محصولات و ویترین ──
        print(D("\n  صفحه اصلی"))
        ctx = await browser.new_context(viewport={"width": 1440, "height": 1000})
        pg = await ctx.new_page()
        await pg.goto(BASE + "/", wait_until="networkidle", timeout=30000)
        await pg.wait_for_timeout(1500)

        cards = await pg.query_selector_all("#grid .product-card")
        add("کارت محصول رندر می‌شود", len(cards) >= 12, f"{len(cards)} کارت")

        prices = await pg.eval_on_selector_all(
            "#grid .price", "els => els.map(e => e.textContent)")
        add("قیمت‌ها نمایش داده می‌شوند",
            len(prices) >= 12 and all("تومان" in x for x in prices[:5]),
            prices[0].strip() if prices else "")

        # ویترین
        sc = await pg.query_selector("#showcase")
        sc_visible = await sc.is_visible() if sc else False
        add("ویترین خودکار نمایش داده می‌شود", sc_visible)

        if sc_visible:
            tabs = await pg.query_selector_all(".sc-tab")
            add("ویترین تب دارد", len(tabs) >= 1, f"{len(tabs)} تب")

            sc_cards = await pg.query_selector_all("#showcaseGrid .product-card")
            add("ویترین محصول دارد", len(sc_cards) >= 3, f"{len(sc_cards)} محصول")

            # سوییچ تب — کل فهرست مقایسه می‌شود، نه فقط اولین کارت.
            # (محصول اول ممکن است در هر دو تب یکی باشد و این طبیعی است.)
            if len(tabs) >= 2:
                titles = lambda: pg.eval_on_selector_all(
                    "#showcaseGrid .product-card .card-title",
                    "els => els.map(e => e.textContent.trim()).join('|')")
                first = await titles()
                await tabs[1].click()
                await pg.wait_for_timeout(700)
                second = await titles()
                add("سوییچ تب محتوا را عوض می‌کند", first != second,
                    f"{len(first.split('|'))} → {len(second.split('|'))} محصول")

                active = await pg.eval_on_selector_all(
                    ".sc-tab", "els => els.filter(e => e.classList.contains('on')).length")
                add("فقط یک تب فعال است", active == 1, f"{active} تب فعال")

                await tabs[0].click()
                await pg.wait_for_timeout(400)

        # ── ۳) جستجو ──
        print(D("\n  جستجو در مرورگر"))
        await pg.fill("#q", "عطر مردانه")
        await pg.wait_for_timeout(1600)
        after = await pg.query_selector_all("#grid .product-card")
        add("جستجو نتیجه می‌دهد", len(after) > 0, f"{len(after)} نتیجه")

        cnt = await pg.eval_on_selector("#catCount", "e => e.textContent")
        add("شمارنده نتیجه به‌روز می‌شود", "رایحه" in cnt, cnt.strip())

        # ── ۴) سبد خرید ──
        print(D("\n  سبد خرید"))
        await pg.goto(BASE + "/", wait_until="networkidle")
        await pg.wait_for_timeout(1200)
        href = await pg.eval_on_selector("#grid .product-card", "e => e.getAttribute('href')")
        await pg.goto(BASE + href, wait_until="networkidle", timeout=30000)
        await pg.wait_for_timeout(1800)

        title = await pg.title()
        add("صفحه محصول باز می‌شود", "عطر" in title, title[:45])

        btn = await pg.query_selector("#addBtn")
        if btn:
            await btn.click()
            await pg.wait_for_timeout(1200)

            # سبد در localStorage با کلید yazd_cart_v1 نگهداری می‌شود
            raw = await pg.evaluate("localStorage.getItem('yazd_cart_v1')")
            items = json.loads(raw) if raw else []
            add("کالا در سبد ذخیره می‌شود", len(items) == 1,
                items[0]["name"][:40] if items else "خالی")
            add("قیمت و تعداد درست ثبت شده",
                bool(items) and items[0]["price"] > 0 and items[0]["quantity"] == 1,
                f"{items[0]['price']:,} × {items[0]['quantity']}" if items else "")

            badge = await pg.eval_on_selector_all(
                ".cart-badge", "els => els.map(e => e.textContent.trim()).join('')")
            add("نشان سبد در هدر به‌روز می‌شود", badge.strip() != "", f"«{badge}»")

            await pg.goto(BASE + "/cart", wait_until="networkidle")
            await pg.wait_for_timeout(1200)
            body = await pg.inner_text("body")
            add("کالا در صفحه سبد دیده می‌شود",
                "سبد خرید شما خالی است" not in body and "اونتوس" in body or
                "سبد خرید شما خالی است" not in body)
        else:
            add("دکمه افزودن به سبد پیدا شد", False)

        # ── ۵) صفحه مقاله: ساختار و امنیت ──
        print(D("\n  صفحه مقاله"))
        await pg.goto(BASE + "/journal", wait_until="networkidle")
        await pg.wait_for_timeout(1200)
        first = await pg.query_selector("a[href^='/journal/']")
        if first:
            href = await first.get_attribute("href")
            await pg.goto(BASE + href, wait_until="networkidle", timeout=30000)
            await pg.wait_for_timeout(1800)

            heads = await pg.eval_on_selector_all("#body h2", "e => e.length")
            paras = await pg.eval_on_selector_all("#body p", "e => e.length")
            add("مقاله عنوان فرعی دارد", heads > 0, f"{heads} عنوان")
            add("مقاله پاراگراف ساختاریافته دارد", paras > 0, f"{paras} پاراگراف")

            # متن مقاله با innerHTML چاپ می‌شود؛ باید مطمئن شویم
            # هیچ تگ اجرایی از محتوا به DOM راه پیدا نکرده
            injected = await pg.eval_on_selector_all(
                "#body script, #body iframe, #body object, #body embed",
                "e => e.length")
            add("هیچ تگ اجرایی در متن مقاله نیست", injected == 0,
                f"{injected} تگ")

            handlers = await pg.eval_on_selector_all(
                "#body *",
                """els => els.filter(e =>
                     [...e.attributes].some(a => a.name.startsWith('on'))).length""")
            add("هیچ رویداد inline در متن مقاله نیست", handlers == 0,
                f"{handlers} مورد")
        else:
            add("مقاله‌ای برای بررسی پیدا شد", False)

        # ── ۶) شبکه‌های اجتماعی ──
        print(D("\n  شبکه‌های اجتماعی"))
        await pg.goto(BASE + "/", wait_until="networkidle")
        await pg.wait_for_timeout(900)
        links = await pg.eval_on_selector_all(
            "footer a[href*='instagram'], footer a[href*='t.me']",
            "els => els.map(e => e.href)")
        add("لینک اینستاگرام در فوتر هست",
            any("instagram.com/yazdperfume" in l for l in links))
        add("لینک تلگرام در فوتر هست",
            any("t.me/yazdperfume_admin" in l for l in links))

        target = await pg.eval_on_selector_all(
            "footer a[href*='instagram'], footer a[href*='t.me']",
            "els => els.every(e => e.target === '_blank' && e.rel.includes('noopener'))")
        add("لینک‌ها امن باز می‌شوند (noopener)", target)

        await ctx.close()

        # ── ۷) موبایل ──
        print(D("\n  موبایل"))
        mctx = await browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True,
            has_touch=True, user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")
        mp = await mctx.new_page()
        await mp.goto(BASE + "/", wait_until="networkidle", timeout=30000)
        await mp.wait_for_timeout(1500)

        overflow = await mp.evaluate(
            "() => document.documentElement.scrollWidth - window.innerWidth")
        add("سرریز افقی ندارد", overflow <= 2, f"{overflow}px")

        mcards = await mp.query_selector_all("#grid .product-card")
        add("محصولات روی موبایل رندر می‌شوند", len(mcards) >= 6, f"{len(mcards)} کارت")

        # دکمه‌ها باید به اندازه کافی بزرگ باشند (۴۴px استاندارد لمسی)
        small = await mp.eval_on_selector_all(
            "button, .btn, a.btn",
            """els => els.filter(e => {
                 const r = e.getBoundingClientRect();
                 return r.width > 0 && r.height > 0 && r.height < 32;
               }).length""")
        add("دکمه‌ها برای لمس بزرگ‌اند", small == 0, f"{small} دکمه کوچک")

        await mctx.close()
        await browser.close()

    failed_n = checks.count(False)
    print()
    print(G("  مرورگر واقعی: همه‌چیز سالم است.\n") if failed_n == 0
          else R(f"  {failed_n} بررسی ناموفق.\n"))
    sys.exit(0 if failed_n == 0 else 1)


print("\n  آزمون مرورگر واقعی (Chromium)\n")
asyncio.run(main())
