#!/usr/bin/env python3
"""
ساخت پیش‌نمای کامل همه صفحات فروشگاه.

هدف: یک گالری واحد که همه‌چیز را در یک نگاه نشان دهد — برای
بازبینی طراحی، تحویل به مالک، و مقایسه پیش/پس از تغییرات.

═══════════════════════════════════════════════════════════
چه چیزی گرفته می‌شود
═══════════════════════════════════════════════════════════
    ۱) هر صفحه عمومی — موبایل (۳۹۰) و دسکتاپ (۱۴۴۰)
    ۲) حالت‌های واقعی — سبد پر، تسویه با کادو، جستجو، فیلتر
    ۳) صفحات نیازمند ورود — پنل مدیریت با همه تب‌ها
    ۴) خروجی‌های چاپی — فاکتور و برچسب پستی

چرا full_page: هدف بازبینی طراحی است نه سنجش سرعت. بریدن صفحه
در ۸۴۴ پیکسل یعنی نیمی از کار دیده نمی‌شود.

═══════════════════════════════════════════════════════════
🔴 صفحاتی که داده لازم دارند
═══════════════════════════════════════════════════════════
چند صفحه بدون زمینه درست، خالی یا ۴۰۴ می‌شوند:
    /checkout      → سبد خالی باشد به /cart می‌پرد
    /invoice       → توکن مدیر + شماره سفارش واقعی
    /label         → همان
    /review/:token → توکن ۳۲ نویسه‌ای معتبر از دیتابیس
    /account       → بدون ورود فقط فرم ورود نشان می‌دهد

اسکریپت این زمینه‌ها را **خودش می‌سازد** و در پایان پاک می‌کند،
وگرنه گالری نیمی صفحه خالی می‌شود.

خروجی:
    preview/index.html    گالری قابل مرور
    preview/shots/*.png   عکس‌ها

اجرا:
    python3 scripts/make_preview.py            # همه
    python3 scripts/make_preview.py --mobile   # فقط موبایل (سریع‌تر)
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import urllib.request

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get("BASE", "http://127.0.0.1:3000")
OUT = os.path.join(ROOT, "preview")
SHOTS = os.path.join(OUT, "shots")

MOBILE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}
ONLY_MOBILE = "--mobile" in sys.argv

G, R, Y, D, X = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"

ADMIN_USER = os.environ.get("ADMIN_USERNAME", "owner")
ADMIN_PASS = os.environ.get("ADMIN_PASSWORD", "yazd1404")

results = {"ok": 0, "fail": []}


# ─────────────────────────────────────────────────────────
#  زمینه‌سازی
# ─────────────────────────────────────────────────────────
def node(script, *args):
    """اجرای یک قطعه Node در بستر پروژه و برگرداندن آخرین خط"""
    out = subprocess.run(
        ["node", "-e", script, *args],
        capture_output=True, text=True, cwd=ROOT
    ).stdout.strip()
    return out.split("\n")[-1] if out else ""


def admin_token():
    req = urllib.request.Request(
        BASE + "/api/admin/login", method="POST",
        data=json.dumps({"username": ADMIN_USER, "password": ADMIN_PASS}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())["token"]
    except Exception as e:
        print(f"  {R}ورود مدیر ناموفق: {e}{X}")
        return None


def paid_order():
    """شماره یک سفارش پرداخت‌شده برای فاکتور و برچسب"""
    return node("""
const {db}=require('./src/db');
const o=db.prepare("SELECT order_id FROM orders WHERE status IN ('PAID','SHIPPED','DELIVERED') ORDER BY created_at DESC LIMIT 1").get();
console.log(o ? o.order_id : '');
""")


def review_token():
    """
    توکن دعوت‌نامه نظر.

    مسیر /review/:token الگوی سخت‌گیر `^[a-f0-9]{32}$` دارد؛
    رشته دلخواه ۴۰۴ می‌دهد. باید از دیتابیس گرفته شود.
    """
    return node("""
const {db}=require('./src/db');
const r=db.prepare('SELECT token FROM review_invites ORDER BY rowid DESC LIMIT 1').get();
console.log(r ? r.token : '');
""")


def customer_session():
    """
    نشست مشتری واقعی — برای صفحات حساب و علاقه‌مندی.

    🔴 چرا لازم است: /account و /wishlist بدون ورود هر دو همان
    پیام «باید وارد شوید» را نشان می‌دهند. پیش‌نمایی که سه صفحه
    یکسان نشان دهد، کار نکرده است.

    شماره‌ای انتخاب می‌شود که سفارش واقعی دارد تا صفحه حساب
    خالی نباشد. کد یکبارمصرف در حالت توسعه از دیتابیس خوانده
    می‌شود (SMS_PROVIDER=console).
    """
    mob = node("""
const {db}=require('./src/db');
const o=db.prepare("SELECT mobile FROM orders WHERE mobile IS NOT NULL ORDER BY created_at DESC LIMIT 1").get();
console.log(o ? o.mobile : '');
""")
    if not mob:
        return None, None

    def post(path, data):
        req = urllib.request.Request(
            BASE + path, method="POST", data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"})
        try:
            return json.loads(urllib.request.urlopen(req, timeout=15).read())
        except Exception:
            return {}

    post("/api/auth/request-code", {"mobile": mob})
    code = node("""
const {db}=require('./src/db');
const r=db.prepare('SELECT code FROM otp_codes WHERE mobile=? ORDER BY rowid DESC LIMIT 1').get(process.argv[1]);
console.log(r ? r.code : '');
""", mob)
    if not code:
        return None, None
    tok = post("/api/auth/verify-code", {"mobile": mob, "code": code}).get("token")
    return (tok, mob) if tok else (None, None)


def sample_cart():
    """یک قلم واقعی برای پر کردن سبد"""
    raw = node("""
const {db}=require('./src/db');
const v=db.prepare(`SELECT v.sku, v.price_toman, p.name_fa, p.image_url
  FROM variants v JOIN products p ON p.id=v.product_id
  WHERE v.stock>0 ORDER BY v.price_toman DESC LIMIT 1`).get();
console.log(JSON.stringify(v||null));
""")
    try:
        v = json.loads(raw)
    except Exception:
        v = None
    if not v:
        return None
    return [{
        "sku": v["sku"], "name": v["name_fa"], "price": v["price_toman"],
        "quantity": 1, "image": v["image_url"]
    }]


# ─────────────────────────────────────────────────────────
#  فهرست صفحات
# ─────────────────────────────────────────────────────────
# (مسیر، نام فایل، عنوان فارسی، دسته، نیاز)
PAGES = [
    ("/",                       "home",         "صفحه اصلی",            "خرید",  None),
    ("/perfume/creed-aventus",  "product",      "صفحه محصول",           "خرید",  None),
    ("/brands",                 "brands",       "برندها",               "خرید",  None),
    ("/essences",               "essences",     "خانه‌های اسانس",        "خرید",  None),
    ("/samples",                "samples",      "سمپل ۳ میل",           "خرید",  None),
    ("/quiz",                   "quiz",         "پیشنهاد هوشمند",       "خرید",  None),

    ("/cart",                   "cart-empty",   "سبد خالی",             "سفارش", None),
    ("/cart",                   "cart-full",    "سبد پر",               "سفارش", "cart"),
    ("/checkout",               "checkout",     "تسویه حساب",           "سفارش", "cart"),
    ("/checkout",               "checkout-gift","تسویه + کادو",         "سفارش", "gift"),
    ("/track",                  "track",        "پیگیری سفارش",         "سفارش", None),

    ("/journal",                "journal",      "مجله آموزشی",          "محتوا", None),
    ("/journal/vetiver-note",   "article",      "مقاله",                "محتوا", None),
    ("/why-us",                 "why-us",       "چرا ما؟",              "محتوا", None),
    ("/check",                  "check",        "بررسی سلامت",          "محتوا", None),
    ("/contact",                "contact",      "تماس با ما",           "محتوا", None),
    ("/terms",                  "terms",        "قوانین فروشگاه",       "محتوا", None),
    ("/privacy",                "privacy",      "حریم خصوصی",           "محتوا", None),

    ("/login",                  "login",        "ورود مشتری",           "حساب", None),
    ("/account",                "account-out",  "حساب — بدون ورود",     "حساب", None),
    ("/account",                "account-in",   "حساب — واردشده",       "حساب", "auth"),
    ("/wishlist",               "wishlist",     "علاقه‌مندی‌ها",         "حساب", "auth"),

    ("/nope-404",               "404",          "صفحه یافت نشد",        "سیستم", None),
    ("/offline",                "offline",      "قطع اتصال",            "سیستم", None),
    ("/payment/sandbox?a=demo", "payment-box",  "درگاه آزمایشی",        "سیستم", None),
]

# صفحاتی که با پارامتر پویا ساخته می‌شوند
DYNAMIC = [
    ("invoice",      "فاکتور فروش",       "چاپی"),
    ("label",        "برچسب پستی",        "چاپی"),
    ("review",       "دعوت‌نامه نظر",      "سیستم"),
]

ADMIN_TABS = [
    ("dashboard",  "داشبورد"),
    ("orders",     "سفارش‌ها"),
    ("products",   "محصولات"),
    ("stock",      "موجودی"),
    ("coupons",    "کدهای تخفیف"),
    ("campaigns",  "جشنواره‌ها"),
    ("articles",   "مقالات"),
    ("tickets",    "تیکت‌ها"),
    ("reviews",    "نظرات"),
    ("reports",    "گزارش‌ها"),
    ("settings",   "تنظیمات"),
    ("staff",      "کارکنان"),
]


async def shot(page, url, out_name, label, full=True):
    """یک عکس؛ شکست یکی کل کار را متوقف نمی‌کند"""
    try:
        await page.goto(url, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(1600)
        path = os.path.join(SHOTS, out_name + ".png")
        await page.screenshot(path=path, full_page=full)
        kb = os.path.getsize(path) // 1024
        print(f"  {G}✓{X} {label:<26}{D}{kb}KB{X}")
        results["ok"] += 1
        return True
    except Exception as e:
        print(f"  {R}✗{X} {label:<26}{D}{str(e)[:52]}{X}")
        results["fail"].append(label)
        return False


async def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(SHOTS, exist_ok=True)

    print(f"\n  ساخت پیش‌نمای کامل  {D}{BASE}{X}\n")

    tok = admin_token()
    oid = paid_order()
    rtok = review_token()
    cart = sample_cart()
    cust_tok, cust_mob = customer_session()

    print(f"  {D}زمینه: مدیر {'✓' if tok else '✗'} · "
          f"سفارش {oid or '—'} · دعوت‌نامه {'✓' if rtok else '—'} · "
          f"سبد {'✓' if cart else '—'} · "
          f"مشتری {cust_mob or '—'}{X}\n")

    manifest = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()

        for view_name, view in (("mobile", MOBILE),
                                *(() if ONLY_MOBILE else (("desktop", DESKTOP),))):
            print(f"{Y}  ── {view_name} ({view['width']}px){X}")
            ctx = await browser.new_context(viewport=view, device_scale_factor=2,
                                            locale="fa-IR")
            page = await ctx.new_page()

            # نشست مدیر با کوکی HttpOnly؛ داده‌های غیرحساس همچنان محلی‌اند.
            if tok:
                await ctx.add_cookies([{'name':'yazd_admin','value':tok,'url':BASE,'httpOnly':True,'sameSite':'Lax'}])
            await page.goto(BASE + "/", wait_until="domcontentloaded")

            for path, name, label, cat, need in PAGES:
                # زمینه‌سازی هر صفحه
                if need in ("cart", "gift"):
                    if not cart:
                        continue
                    await page.evaluate(
                        "c => localStorage.setItem('yazd_cart_v1', JSON.stringify(c))",
                        cart)
                else:
                    await page.evaluate(
                        "() => localStorage.removeItem('yazd_cart_v1')")

                # ورود مشتری فقط برای نماهایی که لازمش دارند
                if need == "auth" and cust_tok:
                    await page.evaluate(
                        "([t, m]) => { localStorage.setItem('yazd_customer_token', t);"
                        " localStorage.setItem('yazd_customer_mobile', m); }",
                        [cust_tok, cust_mob])
                elif need != "auth":
                    await page.evaluate(
                        "() => { localStorage.removeItem('yazd_customer_token');"
                        " localStorage.removeItem('yazd_customer_mobile'); }")

                url = BASE + path
                out = f"{view_name}-{name}"
                ok = await shot(page, url, out, f"{label}")

                # تیک کادو پس از بارگذاری تسویه
                if ok and need == "gift":
                    try:
                        await page.check("#fGift")
                        await page.wait_for_timeout(2200)
                        await page.screenshot(
                            path=os.path.join(SHOTS, out + ".png"), full_page=True)
                    except Exception:
                        pass

                if ok and view_name == "mobile":
                    manifest.append({"file": out, "label": label,
                                     "cat": cat, "path": path})

            # ── صفحات پویا ──
            dyn = []
            if oid:
                dyn.append((f"/invoice?order={oid}", "invoice", "فاکتور فروش", "چاپی"))
                dyn.append((f"/label?order={oid}",   "label",   "برچسب پستی", "چاپی"))
            if rtok:
                dyn.append((f"/review/{rtok}", "review", "دعوت‌نامه نظر", "سیستم"))

            for path, name, label, cat in dyn:
                out = f"{view_name}-{name}"
                if await shot(page, BASE + path, out, label):
                    if view_name == "mobile":
                        manifest.append({"file": out, "label": label,
                                         "cat": cat, "path": path.split("?")[0]})

            await ctx.close()

        # ── پنل مدیریت: فقط دسکتاپ، چون ابزار کار است ──
        if tok:
            print(f"{Y}  ── پنل مدیریت{X}")
            ctx = await browser.new_context(viewport=DESKTOP, device_scale_factor=2,
                                            locale="fa-IR")
            await ctx.add_cookies([{'name':'yazd_admin','value':tok,'url':BASE,'httpOnly':True,'sameSite':'Lax'}])
            page = await ctx.new_page()
            await page.goto(BASE + "/admin", wait_until="networkidle")
            await page.wait_for_timeout(3000)

            for tab, label in ADMIN_TABS:
                out = f"admin-{tab}"
                try:
                    # تب‌ها با data-tab یا onclick سوییچ می‌شوند
                    el = page.locator(f"[data-tab='{tab}']").first
                    if await el.count():
                        await el.click()
                        await page.wait_for_timeout(2000)
                    else:
                        await page.evaluate(
                            "t => window.showTab && window.showTab(t)", tab)
                        await page.wait_for_timeout(2000)
                    p = os.path.join(SHOTS, out + ".png")
                    await page.screenshot(path=p, full_page=True)
                    kb = os.path.getsize(p) // 1024
                    print(f"  {G}✓{X} پنل — {label:<20}{D}{kb}KB{X}")
                    results["ok"] += 1
                    manifest.append({"file": out, "label": f"پنل — {label}",
                                     "cat": "پنل", "path": "/admin"})
                except Exception as e:
                    print(f"  {R}✗{X} پنل — {label:<20}{D}{str(e)[:44]}{X}")
                    results["fail"].append(f"پنل {label}")

            await ctx.close()

        await browser.close()

    build_thumbs()
    build_gallery(manifest)

    print(f"\n  {G}{results['ok']} عکس{X}"
          + (f" · {R}{len(results['fail'])} ناموفق{X}" if results["fail"] else ""))
    print(f"  {D}گالری: preview/index.html{X}\n")


# ─────────────────────────────────────────────────────────
#  بندانگشتی
# ─────────────────────────────────────────────────────────
def build_thumbs():
    """
    نسخه سبک برای کارت‌های گالری.

    🔴 چرا لازم است: عکس full_page صفحه حساب ۲۳٬۷۵۲ پیکسل ارتفاع
    دارد. بارگذاری ۶۸ تای این‌ها در یک صفحه یعنی گالری عملاً باز
    نمی‌شود — روی موبایل حتی مرورگر را می‌خواباند.

    مجموع از ۴۹ مگابایت به حدود ۱ مگابایت می‌رسد. اصل عکس‌ها
    دست‌نخورده می‌مانند و با کلیک باز می‌شوند.
    """
    try:
        from PIL import Image
    except ImportError:
        print(f"  {Y}Pillow نیست — بندانگشتی ساخته نشد{X}")
        return

    tdir = os.path.join(OUT, "thumbs")
    os.makedirs(tdir, exist_ok=True)
    W, MAXH = 400, 620
    n = 0
    for f in sorted(os.listdir(SHOTS)):
        if not f.endswith(".png"):
            continue
        im = Image.open(os.path.join(SHOTS, f)).convert("RGB")
        w, h = im.size
        im = im.resize((W, round(h * W / w)), Image.LANCZOS)
        if im.height > MAXH:
            im = im.crop((0, 0, W, MAXH))
        im.save(os.path.join(tdir, f[:-4] + ".jpg"), "JPEG",
                quality=78, optimize=True)
        n += 1
    print(f"  {D}{n} بندانگشتی ساخته شد{X}")


# ─────────────────────────────────────────────────────────
#  گالری
# ─────────────────────────────────────────────────────────
def build_gallery(items):
    """
    صفحه مرور.

    🔴 بدون وابستگی بیرونی: پیش‌نمای درون‌برنامه‌ای در iframe
    ایزوله اجرا می‌شود و به شبکه دسترسی ندارد. پس فونت، CSS و
    اسکریپت همه inline‌اند و تصاویر مسیر نسبی دارند.
    """
    cats = []
    for it in items:
        if it["cat"] not in cats:
            cats.append(it["cat"])

    def card(it):
        has_desktop = os.path.exists(
            os.path.join(SHOTS, it["file"].replace("mobile-", "desktop-") + ".png"))
        dsk = it["file"].replace("mobile-", "desktop-")
        return f"""
      <figure class="card" data-cat="{it['cat']}">
        <a href="shots/{it['file']}.png" target="_blank" class="thumb">
          <img src="thumbs/{it['file']}.jpg" alt="{it['label']}" loading="lazy">
        </a>
        <figcaption>
          <b>{it['label']}</b>
          <code>{it['path']}</code>
          <span class="links">
            <a href="shots/{it['file']}.png" target="_blank">موبایل</a>
            {'· <a href="shots/' + dsk + '.png" target="_blank">دسکتاپ</a>' if has_desktop else ''}
          </span>
        </figcaption>
      </figure>"""

    sections = ""
    for c in cats:
        got = [i for i in items if i["cat"] == c]
        sections += f"""
    <section id="cat-{cats.index(c)}">
      <h2>{c} <small>{len(got)} صفحه</small></h2>
      <div class="grid">{''.join(card(i) for i in got)}</div>
    </section>"""

    chips = "".join(
        f'<button class="chip" data-f="{c}">{c}</button>' for c in cats)

    html = f"""<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>پیش‌نمای صفحات | عطر یزد</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0 }}
  body {{ font-family: Vazirmatn, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #121212; color: #F7F4EF; line-height: 1.8;
    padding: 30px 22px 70px; }}
  header {{ max-width: 1500px; margin: 0 auto 26px; }}
  h1 {{ font-size: 1.5rem; font-weight: 800; letter-spacing: -.3px }}
  .sub {{ color: #9A9A96; font-size: .84rem; margin-top: 5px }}
  .bar {{ display: flex; gap: 8px; flex-wrap: wrap; margin: 20px 0 4px }}
  .chip {{ font: inherit; font-size: .78rem; font-weight: 600; cursor: pointer;
    background: #1D1D1B; color: #DDD; border: 1px solid #333;
    border-radius: 30px; padding: 7px 15px; transition: .18s }}
  .chip:hover {{ border-color: #C59B27; color: #C59B27 }}
  .chip.on {{ background: #C59B27; border-color: #C59B27; color: #121212 }}
  section {{ max-width: 1500px; margin: 0 auto 40px }}
  h2 {{ font-size: 1.02rem; font-weight: 700; margin: 26px 0 14px;
    padding-bottom: 9px; border-bottom: 1px solid #2A2A28;
    display: flex; align-items: baseline; gap: 10px }}
  h2 small {{ font-size: .72rem; color: #8A8A86; font-weight: 500 }}
  /* align-items:start لازم است — بدون آن کارت‌های یک ردیف
     ارتفاع بلندترین را می‌گیرند و زیر تصویر فضای خالی می‌ماند. */
  .grid {{ display: grid; gap: 18px; align-items: start;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)) }}
  .card {{ background: #1A1A18; border: 1px solid #2A2A28; border-radius: 13px;
    overflow: hidden; transition: .2s }}
  .card:hover {{ border-color: #C59B27; transform: translateY(-2px) }}
  .thumb {{ display: block; aspect-ratio: 400/560; overflow: hidden;
    background: #0C0C0B; position: relative }}
  .thumb img {{ width: 100%; height: 100%; display: block; object-fit: cover;
    object-position: top center }}
  figcaption {{ padding: 11px 13px 13px }}
  figcaption b {{ display: block; font-size: .85rem; font-weight: 700 }}
  figcaption code {{ display: block; font-size: .69rem; color: #8A8A86;
    direction: ltr; text-align: right; margin: 3px 0 7px;
    font-family: ui-monospace, monospace }}
  .links {{ font-size: .72rem; color: #666 }}
  .links a {{ color: #C59B27; text-decoration: none }}
  .links a:hover {{ text-decoration: underline }}
  .hide {{ display: none }}
</style>
</head>
<body>
<header>
  <h1>پیش‌نمای کامل صفحات</h1>
  <div class="sub">فروشگاه عطر یزد · {len(items)} نما · عکس واقعی از مرورگر
    (موبایل ۳۹۰px · دسکتاپ ۱۴۴۰px) — برای اندازه کامل روی تصویر بزنید</div>
  <div class="bar">
    <button class="chip on" data-f="*">همه</button>{chips}
  </div>
</header>
{sections}
<script>
document.querySelectorAll('.chip').forEach(b => b.onclick = () => {{
  document.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  const f = b.dataset.f;
  document.querySelectorAll('.card').forEach(c =>
    c.classList.toggle('hide', f !== '*' && c.dataset.cat !== f));
  document.querySelectorAll('section').forEach(s =>
    s.classList.toggle('hide', !s.querySelector('.card:not(.hide)')));
}});
</script>
</body>
</html>"""

    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    asyncio.run(main())
