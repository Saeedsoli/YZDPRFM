#!/usr/bin/env python3
"""
بنچمارک تجربه واقعی کاربر — با مرورگر واقعی، نه curl.

چرا لازم است: autocannon فقط می‌گوید سرور چقدر سریع جواب می‌دهد.
ولی مشتری «جواب سرور» را نمی‌بیند؛ او منتظر می‌ماند تا صفحه
رسم شود، فونت بیاید، عکس‌ها بارگذاری شوند و دکمه‌ها کلیک‌پذیر
گردند. این فاصله گاهی چند برابر است.

سه معیاری که گوگل برای رتبه‌بندی استفاده می‌کند:
  FCP  اولین محتوایی که کاربر می‌بیند
  LCP  بزرگ‌ترین عنصر صفحه (معمولاً عکس اصلی)
  CLS  جابه‌جایی ناگهانی چیدمان (آزاردهنده‌ترین چیز روی موبایل)

آستانه‌های گوگل: FCP<1.8s · LCP<2.5s · CLS<0.1

هر صفحه چند بار اندازه‌گیری و میانه گرفته می‌شود — یک نمونه
تنها به نویز آلوده است.

اجرا: python3 scripts/bench_pageload.py
"""
import asyncio
import json
import statistics
import sys

from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
RUNS = 5

PAGES = [
    ("/", "صفحه اصلی"),
    ("/perfume/creed-aventus", "صفحه محصول"),
    ("/brands", "برندها"),
    ("/journal", "مجله"),
    ("/cart", "سبد خرید"),
    ("/checkout", "تسویه"),
]

# پروفایل شبکه موبایل ایران — بدون این، عدد روی لوکال‌هاست
# خوش‌بینانه و بی‌معناست
PROFILES = {
    "دسکتاپ (بدون محدودیت)": None,
    "موبایل 4G": {"download": 4_000_000 / 8, "upload": 3_000_000 / 8, "latency": 70},
    "موبایل 3G کند": {"download": 400_000 / 8, "upload": 400_000 / 8, "latency": 400},
}

G = "\033[32m"; Y = "\033[33m"; R = "\033[31m"; D = "\033[2m"; X = "\033[0m"


def verdict(metric, value):
    """رنگ‌بندی طبق آستانه‌های گوگل"""
    limits = {"fcp": (1800, 3000), "lcp": (2500, 4000), "cls": (0.1, 0.25)}
    good, poor = limits[metric]
    if value <= good:
        return G
    if value <= poor:
        return Y
    return R


async def measure(page, url):
    """یک بار بارگذاری و استخراج معیارها.

    نکته: getEntriesByType('largest-contentful-paint') در این نسخه
    Chromium آرایه خالی می‌دهد؛ LCP فقط از راه PerformanceObserver
    قابل گرفتن است و باید **پیش از** ناوبری نصب شود. بدون این،
    اسکریپت به‌اشتباه FCP را به‌جای LCP گزارش می‌کرد و هر دو عدد
    یکسان در می‌آمدند.
    """
    await page.add_init_script("""
        window.__lcp = 0; window.__cls = 0;
        try {
            new PerformanceObserver((l) => {
                for (const e of l.getEntries()) window.__lcp = e.startTime;
            }).observe({type: 'largest-contentful-paint', buffered: true});
            new PerformanceObserver((l) => {
                for (const e of l.getEntries())
                    if (!e.hadRecentInput) window.__cls += e.value;
            }).observe({type: 'layout-shift', buffered: true});
        } catch (e) {}
    """)
    await page.goto(url, wait_until="load", timeout=60000)
    # فرصت به مرورگر برای ثبت LCP نهایی و CLS
    await page.wait_for_timeout(1200)

    return await page.evaluate("""() => {
        const nav = performance.getEntriesByType('navigation')[0] || {};
        const paints = performance.getEntriesByType('paint');
        const fcp = (paints.find(p => p.name === 'first-contentful-paint') || {}).startTime || 0;
        const lcp = window.__lcp || fcp;
        const cls = window.__cls || 0;
        const res = performance.getEntriesByType('resource');
        return {
            fcp, lcp, cls,
            ttfb: nav.responseStart || 0,
            domReady: nav.domContentLoadedEventEnd || 0,
            loaded: nav.loadEventEnd || 0,
            requests: res.length,
            bytes: res.reduce((s, r) => s + (r.transferSize || 0), 0)
        };
    }""")


async def run_profile(browser, name, throttle):
    print(f"\n  {name}")
    print(D + "  " + "─" * 74 + X)
    print(f"  {'صفحه':<16}{'FCP':>9}{'LCP':>9}{'CLS':>8}{'TTFB':>9}{'درخواست':>9}{'حجم':>10}")

    for path, label in PAGES:
        samples = []
        for _ in range(RUNS):
            ctx = await browser.new_context(
                viewport={"width": 390, "height": 844} if "موبایل" in name
                else {"width": 1366, "height": 768},
                user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                            "AppleWebKit/605.1.15 Mobile/15E148")
                if "موبایل" in name else None,
            )
            pg = await ctx.new_page()
            if throttle:
                cdp = await ctx.new_cdp_session(pg)
                await cdp.send("Network.enable")
                await cdp.send("Network.emulateNetworkConditions", {
                    "offline": False,
                    "downloadThroughput": throttle["download"],
                    "uploadThroughput": throttle["upload"],
                    "latency": throttle["latency"],
                })
            try:
                samples.append(await measure(pg, BASE + path))
            except Exception as e:
                print(f"  {R}✗{X} {label}: {str(e)[:50]}")
            await ctx.close()

        if not samples:
            continue

        med = lambda k: statistics.median(s[k] for s in samples)
        fcp, lcp, cls = med("fcp"), med("lcp"), med("cls")
        ttfb, reqs, byts = med("ttfb"), med("requests"), med("bytes")

        print(f"  {label:<16}"
              f"{verdict('fcp', fcp)}{fcp/1000:>8.2f}s{X}"
              f"{verdict('lcp', lcp)}{lcp/1000:>8.2f}s{X}"
              f"{verdict('cls', cls)}{cls:>8.3f}{X}"
              f"{ttfb:>8.0f}ms"
              f"{reqs:>9.0f}"
              f"{byts/1024:>9.0f}KB")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=[
            "--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu",
            "--js-flags=--max-old-space-size=256",
        ])
        print(f"\n  بنچمارک تجربه کاربر  {D}(میانه {RUNS} اندازه‌گیری){X}")
        print(D + f"  آستانه گوگل: FCP<1.8s · LCP<2.5s · CLS<0.1" + X)

        for name, throttle in PROFILES.items():
            await run_profile(browser, name, throttle)

        await browser.close()
    print(f"\n  {D}سبز = خوب · زرد = نیاز به بهبود · قرمز = ضعیف{X}\n")


asyncio.run(main())
