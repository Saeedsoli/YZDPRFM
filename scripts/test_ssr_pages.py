#!/usr/bin/env python3
"""
آزمون رندر سمت سرور — صفحات مقاله و خانه‌های عطر
════════════════════════════════════════════════

جانشین `test_article_ssr.py` است و هر دو صفحه را می‌سنجد.

الگوی رندر دوگانه (سرور می‌سازد، جاوااسکریپت بازنویسی می‌کند)
یک خطر مشخص دارد: اگر خروجی دو طرف یکی نباشد، چیدمان جلوی چشم
کاربر می‌پرد. سه چیز بررسی می‌شود:

  ۱) متن در HTML خام هست (بدون اجرای JS)
  ۲) خروجی سرور و مرورگر یکسان است
  ۳) CLS پس از اجرای JS در محدوده «خوب» می‌ماند

── چرا آزمون خودش محصولات را فعال می‌کند ──
پیش‌فرض کاتالوگ UNAVAILABLE است و صفحه برندها فقط محصولات
قابل سفارش را می‌شمارد. بدون فعال‌سازی موقت، صفحه خالی است و
آزمون چیزی نمی‌سنجد. حالت لازم ساخته و در پایان دقیقاً
برگردانده می‌شود.

اجرا:  python3 scripts/test_ssr_pages.py
"""

import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "yazd.db")
PORT = 4921
BASE = f"http://127.0.0.1:{PORT}"

G, R, D, B = "\033[32m", "\033[31m", "\033[2m", "\033[1m"
X = "\033[0m"

checks = []


def add(name, ok, note=""):
    checks.append(ok)
    print(f"  {G}✓{X}" if ok else f"  {R}✗{X}", name, f"{D}— {note}{X}" if note else "")


def boot():
    env = {**os.environ, "BACKUP_DISABLED": "1", "PORT": str(PORT)}
    proc = subprocess.Popen(["node", "src/server.js"], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(150):
        try:
            urllib.request.urlopen(f"{BASE}/api/health", timeout=2)
            return proc
        except Exception:
            time.sleep(0.4)
    return proc


def get(path):
    return urllib.request.urlopen(BASE + path).read().decode()


def visible_text(h):
    body = h.split("<body", 1)[1]
    body = re.sub(r"<script[\s\S]*?</script>", "", body)
    body = re.sub(r"<style[\s\S]*?</style>", "", body)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)).strip()


def cls_of(pg, url):
    """امتیاز CLS پس از بارگذاری کامل."""
    pg.goto(url, wait_until="commit")
    pg.wait_for_load_state("networkidle")
    return pg.evaluate("""() => new Promise(res => {
        let v = 0;
        new PerformanceObserver(l => {
            for (const e of l.getEntries())
                if (!e.hadRecentInput) v += e.value;
        }).observe({type: 'layout-shift', buffered: true});
        setTimeout(() => res(v), 1200);
    })""")


def main():
    from playwright.sync_api import sync_playwright

    print()
    print(f"{B}  رندر سمت سرور — مقاله و خانه‌های عطر{X}")
    print(f"{D}  ────────────────────────────────────────{X}")

    con = sqlite3.connect(DB)
    slugs = [r[0] for r in con.execute("SELECT slug FROM articles ORDER BY id")]
    prev = con.execute(
        "SELECT id, supply_mode FROM products WHERE brand_fa IN ('کرید','آمواج')").fetchall()
    con.execute(
        "UPDATE products SET supply_mode='MADE_TO_ORDER' WHERE brand_fa IN ('کرید','آمواج')")
    con.commit()
    con.close()

    server = boot()
    try:
        # ═══ ۱) مقاله ═══
        print()
        print(f"{B}  ۱) صفحه مقاله{X}")
        raw = {s: len(visible_text(get(f"/journal/{s}"))) for s in slugs}
        add("متن همه مقالات در HTML خام هست", min(raw.values()) > 800,
            f"کمترین {min(raw.values())} نویسه")

        h0 = get(f"/journal/{slugs[0]}")
        add("عنوان در h1 خام آمده",
            len(re.search(r'<h1 id="title">(.*?)</h1>', h0).group(1)) > 3)
        add("بلوک مقاله پنهان نمانده",
            'id="content" style="display:none"' not in h0,
            "متن پنهان مصداق اسپم گوگل است")

        # ═══ ۲) خانه‌های عطر ═══
        print()
        print(f"{B}  ۲) صفحه خانه‌های عطر{X}")
        hb = get("/brands")
        # ⚠ شمارش باید فقط روی بدنه باشد، نه کل فایل: تابع
        # `draw()` سمت مرورگر همان رشته `class="bcard"` را در
        # قالبش دارد و در شمارش خام یکی اضافه می‌آورد. آزمون اول
        # با همین «HTML 3 / API 2» قرمز شد — ایراد از آزمون بود
        # نه کد.
        hb_body = re.sub(r"<script[\s\S]*?</script>", "", hb.split("<body", 1)[1])
        cards = hb_body.count('class="bcard"')
        api = __import__("json").loads(get("/api/brands"))
        add("کارت برندها در HTML خام هست", cards > 0, f"{cards} کارت")
        add("شمار کارت‌ها با API می‌خواند", cards == api["total"],
            f"HTML {cards} / API {api['total']}")
        add("رزرو ارتفاع اسکلت برداشته شده",
            'id="bg" style="min-height:100vh"' not in hb,
            "وگرنه زیر فهرست فضای خالی می‌ماند")
        # آستانه ثابت نمی‌گذاریم: طول متن به تعداد برندهای فعال
        # بستگی دارد که تصمیم مالک است. چیزی که همیشه باید درست
        # باشد این است که نام هر برند فعال در متن خام دیده شود.
        vis = visible_text(hb)
        add("نام همه برندهای فعال در متن خام هست",
            all(b["brand_fa"] in vis for b in api["brands"]),
            f"{len(api['brands'])} برند · {len(vis)} نویسه")

        # ═══ ۳) هماهنگی با مرورگر ═══
        print()
        print(f"{B}  ۳) هماهنگی سرور و مرورگر{X}")
        with sync_playwright() as p:
            br = p.chromium.launch()
            pg = br.new_page(viewport={"width": 390, "height": 844})

            for s in slugs[:3]:
                url = f"{BASE}/journal/{s}"
                pg.goto(url, wait_until="networkidle")
                after = re.sub(r"\s+", " ", pg.eval_on_selector(
                    "#body", "el => el.innerText")).strip()
                html_raw = get(f"/journal/{s}")
                m = re.search(r'<div class="content" id="body">([\s\S]*?)</div>', html_raw)
                inner = m.group(1)
                inner = re.sub(r"<script[\s\S]*?</script>", "", inner)
                srv = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", inner)).strip()
                ratio = min(len(srv), len(after)) / max(len(srv), len(after), 1)
                add(f"مقاله یکسان می‌ماند — {s}", ratio > 0.95,
                    f"سرور {len(srv)} / مرورگر {len(after)}")

            pg.goto(f"{BASE}/brands", wait_until="networkidle")
            n_after = pg.eval_on_selector_all(".bcard", "els => els.length")
            add("شمار کارت برند پس از JS ثابت می‌ماند", n_after == cards,
                f"{cards} → {n_after}")

            # ═══ ۴) پرش چیدمان ═══
            print()
            print(f"{B}  ۴) پرش چیدمان{X}")
            for label, url in [("مقاله", f"{BASE}/journal/{slugs[0]}"),
                               ("خانه‌های عطر", f"{BASE}/brands")]:
                v = cls_of(pg, url)
                # ۰٫۱ حد «خوب» در Core Web Vitals است
                add(f"CLS صفحه {label} در محدوده خوب است", v < 0.1, f"CLS={v:.4f}")

            br.close()
    finally:
        server.terminate()
        con = sqlite3.connect(DB)
        for pid, mode in prev:
            con.execute("UPDATE products SET supply_mode=? WHERE id=?", (mode, pid))
        con.commit()
        con.close()

    failed = checks.count(False)
    print()
    print(f"{G}  رندر سمت سرور تأیید شد.  {len(checks)}/{len(checks)}{X}\n"
          if failed == 0 else f"{R}  {failed} بررسی ناموفق از {len(checks)}.{X}\n")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
