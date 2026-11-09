#!/usr/bin/env python3
"""
آزمون مرورگری نمایش وضعیت موجودی.

چرا جدا از `test_stock_visibility.js`:
    آن آزمون کد را می‌خواند — می‌گوید «رشته card-out در فایل
    هست». ولی نمی‌داند برچسب روی موبایل واقعاً **دیده می‌شود**
    یا زیر قاعده‌ای دیگر پنهان شده.

    نمونه واقعی: `card-peek` و `card-badge` روی دستگاه لمسی
    `display:none` می‌شوند چون hover ندارند. اگر نشان ناموجودی
    به آن‌ها تکیه می‌کرد، روی موبایل — که بیشتر ترافیک است —
    نامرئی بود.

اجرا: python3 scripts/test_stock_ui_browser.py   (سرور بالا)
"""
import asyncio, sys
from playwright.async_api import async_playwright
BASE="http://127.0.0.1:3000"
checks=[]
def add(l,ok,n=""):
    print(f"  {'✓' if ok else '✗'} {l}" + (f"  — {n}" if n else "")); checks.append(ok)

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        ctx=await b.new_context(viewport={"width":390,"height":844})
        p=await ctx.new_page()
        errs=[]
        p.on("pageerror", lambda e: errs.append(str(e)[:80]))
        await p.add_init_script("window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true});")
        await p.goto(BASE+"/", wait_until="domcontentloaded"); await p.wait_for_timeout(2600)

        print("\n  ۱) نشان ناموجودی روی کارت")
        outs = await p.locator(".card-out").count()
        cards = await p.locator(".product-card").count()
        add("برچسب ناموجود دیده می‌شود", outs > 0, f"{outs} برچسب در {cards} کارت")
        # نخستین کارت DOM از ویترین است نه کاتالوگ؛ مرتب‌سازی
        # موجود-اول فقط به کاتالوگ مربوط است.
        first_cls = await p.locator("#grid .product-card").first.get_attribute("class")
        add("نخستین کارت کاتالوگ موجود است",
            first_cls is not None and "is-out" not in first_cls,
            "مرتب‌سازی: موجود اول")

        # آیا برچسب واقعاً دیده می‌شود (نه display:none)؟
        if outs:
            vis = await p.locator(".card-out").first.is_visible()
            add("برچسب روی موبایل واقعاً نمایان است", vis,
                "hover نداریم؛ باید همیشه پیدا باشد")
            txt = await p.locator(".card-out").first.inner_text()
            add("متن برچسب درست است", txt.strip()=="ناموجود", txt)

        print("\n  ۲) دکمه کارت")
        notify = await p.locator(".card-go-notify").count()
        add("دکمه «خبرم کن» روی ناموجودها", notify > 0, f"{notify} عدد")
        add("شمار برچسب و دکمه یکی است", notify == outs, f"{notify} = {outs}")

        print("\n  ۳) فیلتر «فقط موجودها»")
        chip = p.locator("#stockChip")
        add("چیپ روی صفحه است", await chip.count()==1)
        add("کلید دیده می‌شود", await chip.is_visible())
        _bar = await p.locator("#genderBar").bounding_box()
        _c = await chip.bounding_box()
        add("کلید داخل دید اولیه است",
            _c["x"] >= 0 and _c["x"] + _c["width"] <= 390,
            f"x={_c['x']:.0f} — جای اولش x=-108 بود، نامرئی")
        before = await p.locator(".product-card").count()
        await chip.click(); await p.wait_for_timeout(2200)
        after = await p.locator(".product-card").count()
        add("فیلتر نتیجه را کم می‌کند", after < before, f"{before} → {after}")
        add("همه نتایج کاتالوگ موجودند",
            await p.locator("#grid .product-card.is-out").count()==0,
            "ویترین صفحه اصلی جداست و فیلتر نمی‌شود")
        add("کلید حالت فعال می‌گیرد",
            await chip.get_attribute("aria-pressed")=="true")
        add("aria-pressed درست است",
            await chip.get_attribute("aria-pressed")=="true")
        add("نشانی به‌روز شد", "in_stock=1" in p.url, p.url.replace(BASE,"")[:44])

        print("\n  ۴) بازگشت")
        await chip.click(); await p.wait_for_timeout(2200)
        add("فیلتر برداشته می‌شود",
            await p.locator(".product-card").count() > after)
        add("نشانی پاک شد", "in_stock" not in p.url)

        print("\n  ۵) لینک قابل اشتراک")
        p2=await ctx.new_page()
        await p2.goto(BASE+"/?in_stock=1", wait_until="domcontentloaded")
        await p2.wait_for_timeout(2400)
        add("ورود مستقیم با فیلتر کار می‌کند",
            await p2.locator("#grid .product-card.is-out").count()==0
            and await p2.locator("#grid .product-card").count() > 0,
            f"{await p2.locator('#grid .product-card').count()} کارت کاتالوگ")
        add("کلید از نشانی فعال می‌شود",
            await p2.locator("#stockChip").get_attribute("aria-pressed")=="true")
        await p2.close()

        print("\n  ۵.۵) گلچین (صفحه مستقل)")
        await p.goto(BASE+"/golchin", wait_until="domcontentloaded"); await p.wait_for_timeout(1500)
        sc_out = await p.locator("#glGrid .card-out").count()
        sc_all = await p.locator("#glGrid .product-card").count()
        add("گلچین هم وضعیت موجودی را نشان می‌دهد", sc_out > 0,
            f"{sc_out} ناموجود از {sc_all} کارت گلچین")

        print("\n  ۶) سلامت")
        cls = await p.evaluate("window.__cls||0")
        add("پرش چیدمان ناچیز", cls < 0.05, f"CLS={cls:.4f}")
        add("هیچ خطای جاوااسکریپت", not errs, "; ".join(errs[:1]))

        print("\n  ۷) فیلتر جنسیت نشکسته")
        await p.locator("#genderBar .fchip[data-g='MEN']").click()
        await p.wait_for_timeout(2200)
        add("فیلتر جنسیت هنوز کار می‌کند", "gender=MEN" in p.url,
            p.url.replace(BASE,"")[:40])

        await b.close()
    f=sum(1 for c in checks if not c)
    print(f"\n  {'رابط موجودی در مرورگر درست کار می‌کند.' if f==0 else str(f)+' ناموفق'}  {len(checks)-f}/{len(checks)}\n")
    sys.exit(0 if f==0 else 1)
asyncio.run(main())
