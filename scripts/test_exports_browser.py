#!/usr/bin/env python3
"""
آزمون مرورگری دانلود خروجی‌ها از پنل.

چرا جدا از آزمون API:
    آزمون API می‌گوید «سرور CSV می‌دهد». ولی مدیر از **دکمه**
    استفاده می‌کند، نه curl. بین این دو چند چیز می‌تواند بشکند:
    توکن در سرآیند نمی‌رود، Blob ساخته نمی‌شود، نام فایل غلط
    می‌شود، یا بازه انتخابی نادیده گرفته می‌شود.

    این آزمون کلیک واقعی می‌کند و فایل دانلودشده را باز می‌کند.

اجرا: python3 scripts/test_exports_browser.py   (سرور بالا)
"""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright
BASE="http://127.0.0.1:3000"
checks=[]
def add(l,ok,n=""):
    print(f"  {'✓' if ok else '✗'} {l}" + (f"  — {n}" if n else "")); checks.append(ok)
def post(p,d):
    r=urllib.request.Request(BASE+p,data=json.dumps(d).encode(),
        headers={"Content-Type":"application/json"},method="POST")
    with urllib.request.urlopen(r,timeout=20) as x: return json.loads(x.read().decode())
async def main():
    tok=post("/api/admin/login",{"username":"owner","password":"yazd1404"})["token"]
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        ctx=await b.new_context(viewport={"width":1280,"height":900}, accept_downloads=True)
        p=await ctx.new_page()
        errs=[]
        p.on("pageerror", lambda e: errs.append(str(e)[:90]))
        await p.goto(BASE+"/admin", wait_until="domcontentloaded")
        await p.evaluate(f"localStorage.setItem('yazd_admin_token','{tok}')")
        await p.reload(wait_until="domcontentloaded"); await p.wait_for_timeout(3500)

        print("\n  ۱) تب گزارش‌ها")
        try:
            await p.locator("text=گزارش").first.click(); await p.wait_for_timeout(2200)
        except Exception as e: print("   ", str(e)[:50])
        btn=p.locator("button:has-text('دانلود CSV')")
        add("دکمه دانلود روی صفحه است", await btn.count()>0)
        if await btn.count():
            add("دکمه دیده می‌شود", await btn.first.is_visible())

            print("\n  ۲) دانلود واقعی")
            async with p.expect_download(timeout=25000) as dl:
                await btn.first.click()
            f = await dl.value
            name = f.suggested_filename
            add("فایل دانلود شد", bool(name), name)
            add("پسوند csv است", name.endswith(".csv"))
            path = await f.path()
            data = open(path,"rb").read()
            add("محتوا خالی نیست", len(data)>200, f"{len(data)} بایت")
            add("BOM دارد", data[:3]==b"\xef\xbb\xbf", "برای اکسل فارسی")
            txt=data.decode("utf-8-sig")
            add("بلوک خلاصه هست", "گزارش فروش" in txt)
            add("بلوک روزانه هست", "فروش روزانه" in txt)
            add("بلوک محصولات هست", "پرفروش‌ترین محصولات" in txt)
            add("بلوک استان هست", "تفکیک استان" in txt)

            print("\n  ۳) بازه از دکمه انتخابی می‌آید")
            await p.locator("button:has-text('۹۰ روز')").first.click()
            await p.wait_for_timeout(2200)
            async with p.expect_download(timeout=25000) as dl2:
                await btn.first.click()
            f2=await dl2.value
            add("نام فایل بازه را دارد", "90" in f2.suggested_filename,
                f2.suggested_filename)

        add("هیچ خطای جاوااسکریپت", not errs, "; ".join(errs[:1]))
        await b.close()
    fl=sum(1 for c in checks if not c)
    print(f"\n  {'دانلود گزارش کار می‌کند.' if fl==0 else str(fl)+' ناموفق'}  {len(checks)-fl}/{len(checks)}\n")
    sys.exit(0 if fl==0 else 1)
asyncio.run(main())
