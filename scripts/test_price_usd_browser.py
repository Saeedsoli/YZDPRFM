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
        await ctx.add_cookies([{'name':'yazd_admin','value':tok,'url':BASE,'httpOnly':True,'sameSite':'Lax'}])
        p=await ctx.new_page()
        errs=[]
        p.on("pageerror", lambda e: errs.append(str(e)[:90]))
        await p.goto(BASE+"/admin", wait_until="domcontentloaded")
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
                # بازخوانی از دیتابیس — **همان SKU** که ویرایش شد.
                #
                # نسخه اول سه ردیف اول جدول را می‌گرفت و امید داشت
                # مقدار تازه بینشان باشد. وقتی price_usd هنوز جایی
                # پر نشده بود کار می‌کرد، ولی حالا هر ۱۴٬۷۷۷ واریانت
                # از منبع داده مقدار دارند و سه ردیف اول ربطی به
                # ویرایش ما ندارند.
                #
                # درست: شناسه دقیقِ فیلدی که پر کردیم را بخوان.
                usd_id = await usd.get_attribute("id")      # usd_<SKU>
                sku = usd_id.replace("usd_", "", 1)
                import subprocess, json as _json
                out = subprocess.run(["node","-e","""
const {db}=require('/home/user/src/db');
const r=db.prepare('SELECT sku,price_usd FROM variants WHERE sku=?').get(process.argv[1]);
console.log(JSON.stringify(r));
""", sku], capture_output=True, text=True).stdout.strip().split("\n")[-1]
                try:
                    row = _json.loads(out)
                    saved = float(row.get("price_usd") or 0)
                except Exception:
                    saved = None
                add("مقدار در دیتابیس ذخیره شد", saved == 18.25,
                    f"{sku} → {saved}")

                await p.reload(wait_until="domcontentloaded"); await p.wait_for_timeout(3000)

        add("هیچ خطای جاوااسکریپت", not errs, "; ".join(errs[:1]))
        await b.close()

    # ── بازگرداندن مقدار اصلی، نه پاک کردن ──
    #
    # 🔴 نسخه اول `price_usd=NULL` می‌گذاشت. وقتی این ستون هنوز
    #    جایی پر نشده بود بی‌ضرر بود، ولی حالا هر واریانت مقدار
    #    واقعی از دیتاست مرجع دارد و NULL گذاشتن یعنی **نابود
    #    کردن داده تولید** — آزمونی که داده را خراب کند از نبودنش
    #    بدتر است.
    #
    #    مقدار درست از seed خوانده و برگردانده می‌شود.
    import subprocess
    subprocess.run(["node","-e","""
const fs=require('fs');
const {db}=require('/home/user/src/db');
const hit=db.prepare('SELECT sku FROM variants WHERE price_usd=18.25').all();
if (!hit.length) process.exit(0);
const seed=JSON.parse(fs.readFileSync('/home/user/seed/perfumes_catalogue_seed.json','utf8'));
const bySku=new Map();
for (const p of seed) for (const v of p.variants) bySku.set(v.sku, v.price_usd);
const upd=db.prepare('UPDATE variants SET price_usd=? WHERE sku=?');
let n=0;
for (const r of hit) {
  // SKU دیتابیس با شناسه عددی ساخته می‌شود؛ از روی محصول پیدایش کن
  const row=db.prepare('SELECT product_id, type, volume_ml FROM variants WHERE sku=?').get(r.sku);
  const prod=db.prepare('SELECT slug FROM products WHERE id=?').get(row.product_id);
  const sp=seed.find(x=>x.slug===prod.slug);
  const sv=sp && sp.variants.find(v=>v.type===row.type && v.volume_ml===row.volume_ml);
  if (sv) { upd.run(sv.price_usd, r.sku); n++; }
}
console.log(n);
"""], capture_output=True)
    print("  (مقدار اصلی برگردانده شد)")
    f=sum(1 for c in checks if not c)
    print(f"\n  {'فیلد قیمت دلاری در پنل کار می‌کند.' if f==0 else str(f)+' ناموفق'}  {len(checks)-f}/{len(checks)}\n")
    sys.exit(0 if f==0 else 1)
asyncio.run(main())
