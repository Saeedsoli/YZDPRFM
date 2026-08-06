#!/usr/bin/env python3
"""
آزمون مرورگری فیلد قیمت دلاری در پنل.

چرا جدا از `test_price_usd.js`:
    آن آزمون API را می‌سنجد — می‌گوید «سرور مقدار را ذخیره
    می‌کند». ولی نمی‌داند مدیر واقعاً می‌تواند از پنل واردش کند:
    آیا ورودی دیده می‌شود؟ آیا دکمه ذخیره مقدارش را می‌فرستد؟

    نمونه واقعی از همین کار: نسخه اول ورودی، کامنت HTML داخل
    رشته قالبی داشت که کل اسکریپت پنل را می‌شکست. آزمون API
    سبز می‌داد و پنل کار نمی‌کرد.

پاک‌سازی: در پایان مقدار آزمونی از دیتابیس پاک می‌شود.

اجرا: python3 scripts/test_price_usd_browser.py   (سرور بالا)
"""
import asyncio, sys, json, urllib.request
from playwright.async_api import async_playwright
BASE="http://127.0.0.1:3000"
checks=[]
def add(l,ok,n=""):
    print(f"  {'✓' if ok else '✗'} {l}" + (f"  — {n}" if n else "")); checks.append(ok)

def post(path, payload):
    req=urllib.request.Request(BASE+path, data=json.dumps(payload).encode(),
        headers={"Content-Type":"application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read().decode())

async def main():
    tok = post("/api/admin/login", {"username":"owner","password":"yazd1404"}).get("token")
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        ctx=await b.new_context(viewport={"width":1280,"height":900})
        p=await ctx.new_page()
        errs=[]
        p.on("pageerror", lambda e: errs.append(str(e)[:90]))
        await p.goto(BASE+"/admin", wait_until="domcontentloaded")
        await p.evaluate(f"localStorage.setItem('yazd_admin_token','{tok}')")
        await p.reload(wait_until="domcontentloaded")
        await p.wait_for_timeout(3500)

        print("\n  ۱) ورود به پنل")
        add("پنل بار شد", await p.locator("#tab-products, [id^=tab-]").count() > 0)

        # رفتن به تب محصولات
        tabs = await p.locator("nav button, .tab, [onclick*='products']").count()
        try:
            await p.locator("text=محصولات").first.click(); await p.wait_for_timeout(1800)
        except: pass

        print("\n  ۲) باز کردن ویرایش محصول")
        # جستجوی محصول
        try:
            box = p.locator("#pSearch, input[placeholder*='جستجو']").first
            if await box.count():
                await box.fill("اونتوس"); await p.wait_for_timeout(2200)
        except Exception as e: print("   ", str(e)[:50])
        btn = p.locator("button:has-text('ویرایش')").first
        add("دکمه ویرایش پیدا شد", await btn.count()>0)
        if await btn.count():
            await btn.click(); await p.wait_for_timeout(2500)

            print("\n  ۳) فیلد قیمت دلاری")
            usd = p.locator("[id^='usd_']").first
            add("ورودی قیمت دلاری روی صفحه است", await usd.count()>0)
            if await usd.count():
                add("ورودی دیده می‌شود", await usd.is_visible())
                add("step=any دارد", await usd.get_attribute("step")=="any",
                    "برای اعشار")
                hdr = await p.locator("#pVariants th").all_inner_texts()
                add("ستون در سرصفحه هست",
                    any("$" in x for x in hdr), " | ".join(hdr[:5]))

                print("\n  ۴) ذخیره از رابط")
                await usd.fill("18.25")
                save = p.locator("#pVariants button[onclick^='saveVariant']").first
                await save.click(); await p.wait_for_timeout(2600)
                # بازخوانی از دیتابیس
                import subprocess
                out = subprocess.run(["node","-e","""
const {db}=require('/home/user/src/db');
const r=db.prepare('SELECT sku,price_usd FROM variants WHERE price_usd IS NOT NULL LIMIT 3').all();
console.log(JSON.stringify(r));
"""], capture_output=True, text=True).stdout.strip().split("\n")[-1]
                add("مقدار در دیتابیس ذخیره شد", "18.25" in out, out[:70])

                await p.reload(wait_until="domcontentloaded"); await p.wait_for_timeout(3000)

        add("هیچ خطای جاوااسکریپت", not errs, "; ".join(errs[:1]))
        await b.close()

    # آزمون نباید داده واقعی بگذارد
    import subprocess
    subprocess.run(["node","-e",
        "const {db}=require('/home/user/src/db');"
        "db.prepare('UPDATE variants SET price_usd=NULL WHERE price_usd=18.25').run();"],
        capture_output=True)
    print("  (مقدار آزمونی پاک شد)")
    f=sum(1 for c in checks if not c)
    print(f"\n  {'فیلد قیمت دلاری در پنل کار می‌کند.' if f==0 else str(f)+' ناموفق'}  {len(checks)-f}/{len(checks)}\n")
    sys.exit(0 if f==0 else 1)
asyncio.run(main())
