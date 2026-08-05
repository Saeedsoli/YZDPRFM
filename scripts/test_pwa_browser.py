#!/usr/bin/env python3
"""
آزمون PWA در مرورگر واقعی — رفتار سرویس‌ورکر.

چرا این آزمون جدا از test_pwa.js است:
    آن آزمون **پیکربندی** را می‌سنجد (فایل هست؟ هدر درست است؟).
    این آزمون **رفتار** را می‌سنجد: سرویس‌ورکر واقعاً فعال می‌شود؟
    آفلاین چه اتفاقی می‌افتد؟ و مهم‌تر از همه —

    **آیا پاسخ API واقعاً کش نمی‌شود؟**

    این تنها راه اثبات آن ادعاست. خواندن کد کافی نیست؛ باید دید
    که پس از رفتن شبکه، درخواست API شکست می‌خورد (درست) نه اینکه
    داده کهنه برگرداند (فاجعه).

سناریو:
    ۱) بازدید عادی — سرویس‌ورکر ثبت و فعال شود
    ۲) بررسی محتویات کش — نباید هیچ /api/ داخلش باشد
    ۳) قطع شبکه → صفحه از کش بیاید
    ۴) قطع شبکه → درخواست API **شکست بخورد** نه داده کهنه
    ۵) رفتن به صفحه دیده‌نشده در حالت آفلاین → صفحه offline
    ۶) صفحات حساس هرگز کش نشوند

اجرا: python3 scripts/test_pwa_browser.py
"""

import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.getenv("BASE", "http://127.0.0.1:3000")
fails = []


def check(label, ok, note=""):
    mark = "\033[32m✓\033[0m" if ok else "\033[31m✗\033[0m"
    print(f"  {mark} {label}" + (f"\033[2m  — {note}\033[0m" if note else ""))
    if not ok:
        fails.append(label)


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844},
                        locale="fa-IR", service_workers="allow")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    print("\n  آزمون PWA در مرورگر واقعی\n")

    # ── ۱) ثبت و فعال‌سازی ──
    print("\033[2m  ثبت سرویس‌ورکر\033[0m")

    pg.goto(BASE, wait_until="networkidle")
    # ثبت پس از load و در زمان بیکاری انجام می‌شود
    pg.wait_for_timeout(4000)

    state = pg.evaluate("""async () => {
        if (!('serviceWorker' in navigator)) return 'unsupported';
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (!reg) return 'none';
        if (reg.active)     return 'active';
        if (reg.installing) return 'installing';
        if (reg.waiting)    return 'waiting';
        return 'unknown';
    }""")
    check("سرویس‌ورکر ثبت و فعال شد", state == "active", state)

    if state != "active":
        print("\033[31m\n  سرویس‌ورکر فعال نشد — بقیه آزمون‌ها بی‌معناست.\033[0m\n")
        b.close()
        sys.exit(1)

    # اجازه بده کش پوسته کامل شود
    pg.wait_for_timeout(2500)

    # ── ۲) محتویات کش ──
    print("\033[2m\n  محتویات کش\033[0m")

    cached = pg.evaluate("""async () => {
        const out = [];
        for (const n of await caches.keys()) {
            const c = await caches.open(n);
            for (const req of await c.keys()) out.push(req.url);
        }
        return out;
    }""")
    check("پوسته کش شد", len(cached) >= 5, f"{len(cached)} مورد")

    api_cached = [u for u in cached if "/api/" in u]
    check("🔴 هیچ پاسخ API کش نشده", len(api_cached) == 0,
          api_cached[0] if api_cached else f"{len(cached)} مورد بررسی شد")

    sensitive = [u for u in cached if any(
        s in u for s in ("/admin", "/account", "/invoice",
                         "/label", "/checkout", "/login", "/perfume/"))]
    check("هیچ صفحه حساسی کش نشده", len(sensitive) == 0,
          sensitive[0] if sensitive else "")

    has_font = any(".woff2" in u for u in cached)
    has_css = any("theme.css" in u for u in cached)
    check("فونت و CSS کش شده‌اند", has_font and has_css)

    has_offline = any("/offline" in u for u in cached)
    check("صفحه آفلاین کش شده", has_offline)

    # ── ۳) رفتار آفلاین: صفحه ──
    print("\033[2m\n  رفتار آفلاین\033[0m")

    # ابتدا یک صفحه را ببین تا در کش بنشیند
    pg.goto(BASE + "/why-us", wait_until="networkidle")
    pg.wait_for_timeout(1200)

    ctx.set_offline(True)

    ok_page = True
    try:
        pg.goto(BASE + "/why-us", wait_until="domcontentloaded", timeout=12000)
        title = pg.title()
        body_len = len(pg.locator("body").inner_text())
    except Exception as e:
        ok_page = False
        title, body_len = str(e)[:40], 0
    check("صفحه دیده‌شده آفلاین باز می‌شود", ok_page and body_len > 200,
          f"{body_len} نویسه")

    # ── ۴) مهم‌ترین: API آفلاین باید شکست بخورد ──
    api_result = pg.evaluate("""async () => {
        try {
            const r = await fetch('/api/health', { cache: 'no-store' });
            const t = await r.text();
            return { ok: true, status: r.status, body: t.slice(0, 60) };
        } catch (e) {
            return { ok: false, err: String(e).slice(0, 50) };
        }
    }""")
    check("🔴 API آفلاین داده کهنه نمی‌دهد", api_result["ok"] is False,
          api_result.get("body") or api_result.get("err"))

    # ── ۵) صفحه دیده‌نشده → offline ──
    seen_offline = False
    try:
        pg.goto(BASE + "/terms", wait_until="domcontentloaded", timeout=12000)
        txt = pg.locator("body").inner_text()
        seen_offline = "اتصال" in txt or "آفلاین" in txt
    except Exception:
        seen_offline = False
    check("صفحه دیده‌نشده به صفحه آفلاین می‌رسد", seen_offline)

    ctx.set_offline(False)

    # ── ۶) بازگشت به حالت عادی ──
    print("\033[2m\n  بازگشت آنلاین\033[0m")

    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(1500)
    back = pg.evaluate("""async () => {
        const r = await fetch('/api/health');
        return r.ok;
    }""")
    check("پس از بازگشت شبکه، API کار می‌کند", back is True)

    cards = pg.locator("#grid .product-card").count()
    check("کاتالوگ سالم رندر می‌شود", cards >= 6, f"{cards} کارت")

    check("هیچ خطای جاوااسکریپتی رخ نداد", not errors,
          errors[0][:70] if errors else "")

    # ── ۷) manifest از دید مرورگر ──
    print("\033[2m\n  manifest\033[0m")

    mf = pg.evaluate("""async () => {
        const l = document.querySelector('link[rel=manifest]');
        if (!l) return null;
        const r = await fetch(l.href);
        return await r.json();
    }""")
    check("مرورگر manifest را می‌خواند", mf is not None)
    if mf:
        check("نام و آیکن دارد",
              bool(mf.get("name")) and len(mf.get("icons", [])) >= 2,
              f"{len(mf.get('icons', []))} آیکن")
        check("میان‌بر دارد", len(mf.get("shortcuts", [])) >= 2,
              f"{len(mf.get('shortcuts', []))} میان‌بر")

    ctx.close()
    b.close()

print()
if fails:
    print(f"\033[31m  {len(fails)} بررسی ناموفق\033[0m\n")
    sys.exit(1)
print("\033[32m  رفتار PWA در مرورگر درست است.\033[0m\n")
