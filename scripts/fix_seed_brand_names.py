#!/usr/bin/env python3
"""
اصلاح نگارش نام برندها در فایل seed.

چرا لازم است:
    اصلاح‌های نگارشی روی دیتابیس زنده اعمال شدند، ولی `seed/` دست
    نخورده بود. یعنی استقرار از صفر روی Liara دوباره «آمواژ» و
    «پنهالیگونز — پنهالیگونز ابسولو» می‌ساخت.

    این کلاس خطاست که فقط در نخستین استقرار واقعی دیده می‌شود —
    همان جایی که کمترین فرصت اصلاح هست.

اصلاح‌ها:
    ۱) نگارش فارسی برند طبق بازار ایران
    ۲) حذف تکرار نام برند از نام محصول
    ۳) حذف حرکت‌گذاری از نام برند

اجرا:
    python3 scripts/fix_seed_brand_names.py --dry
    python3 scripts/fix_seed_brand_names.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "seed", "perfumes_catalogue_seed.json")
DRY = "--dry" in sys.argv

G = lambda s: f"\033[32m{s}\033[0m"
Y = lambda s: f"\033[33m{s}\033[0m"
D = lambda s: f"\033[2m{s}\033[0m"

# نگارش تأییدشده — همان جدولی که روی دیتابیس اعمال شد
FIXES = {
    "Amouage": "آمواج",
    "Creed": "کرید",
    "Atelier Cologne": "آتلیه کلون",
    "Etat Libre d'Orange": "اتات لیبره د اورنج",
    "Initio Parfums Prives": "اینیشیو پارفومز پرایوز",
    "Juliette Has A Gun": "ژولیت هز ای گان",
    "Robert Piguet": "روبرت پیگه",
    "Thameen London": "تامین لندن",
    "Ermenegildo Zegna": "ارمنجیلدو زگنا",
    "Nishane": "نیشان",
    "Marc-Antoine Barrois": "مارک آنتوان باروآ",
    "Matiere Premiere": "ماتیر پرمیر",
    "Fueguia 1833": "فوگیا ۱۸۳۳",
    "Stéphane Humbert Lucas 777": "استفان هامبرت لوکاس ۷۷۷",
    "Bond No. 9": "باند نامبر ۹",
    "The Merchant of Venice": "مرچنت آو ونیز",
    "Goldfield & Banks": "گلدفیلد و بنکس",
    "Viktor & Rolf": "ویکتور و رولف",
    "Van Cleef & Arpels": "ون کلیف و آرپلز",
    "Escentric Molecules": "اسنتریک مولکولز",
}

HARAKAT = re.compile(r"[\u064B-\u0652\u0670]")


def strip_brand(name: str, brand: str) -> str:
    """حذف نام برند از نام محصول — همان منطق نسخه JavaScript"""
    if not name or not brand:
        return name
    b = re.escape(brand)
    patterns = [
        rf"^{b}\s*[-—–]\s*",
        rf"^{b}\s+",
        rf"\s+{b}$",
        rf"\s*[-—–]\s*{b}$",
        # برند وسط نام: «عطر دست‌ساز پنهالیگونز ابسولو»
        # نام‌های seed پیشوند «عطر دست‌ساز» دارند، پس برند نه اول
        # است نه آخر — بدون این الگو ۳۰۵ مورد جا می‌ماند.
        rf"\s+{b}\s+",
    ]
    out = name
    for pat in patterns:
        if not re.search(pat, out):
            continue
        # الگوی «وسط» با فاصله جایگزین می‌شود تا کلمات به هم نچسبند
        repl = " " if pat.endswith(r"\s+") and pat.startswith(r"\s+") else ""
        nxt = re.sub(pat, repl, out).strip()
        if nxt and len(nxt) >= 2:
            out = nxt
            break
    return re.sub(r"\s{2,}", " ", out).strip()


def main():
    with open(SEED, encoding="utf-8") as f:
        data = json.load(f)

    print(f"\n  {Y('حالت آزمایشی') if DRY else G('اصلاح فایل seed')}\n")
    print(f"  {len(data)} محصول\n")

    brand_fixed = harakat_fixed = name_fixed = title_fixed = 0
    samples = []

    for p in data:
        en = p.get("inspired_brand_en")
        old_brand = p.get("inspired_brand_fa") or ""
        new_brand = old_brand

        # ۱) نگارش درست
        if en in FIXES and FIXES[en] != old_brand:
            new_brand = FIXES[en]
            brand_fixed += 1

        # ۲) حذف حرکت
        stripped = HARAKAT.sub("", new_brand)
        if stripped != new_brand:
            new_brand = stripped
            harakat_fixed += 1

        if new_brand != old_brand:
            p["inspired_brand_fa"] = new_brand
            # نام و عنوان هم نام برند را در خود دارند
            for key in ("name_fa", "title_fa_display", "title_fa_base"):
                if p.get(key) and old_brand and old_brand in p[key]:
                    p[key] = p[key].replace(old_brand, new_brand)

        # ۳) حذف تکرار برند از نام
        nm = p.get("name_fa") or ""
        if new_brand and new_brand in nm:
            nxt = strip_brand(nm, new_brand)
            if nxt != nm:
                if len(samples) < 6:
                    samples.append((f"{new_brand} — {nm}", f"{new_brand} — {nxt}"))
                for key in ("title_fa_display", "title_fa_base"):
                    if p.get(key) and nm in p[key]:
                        p[key] = p[key].replace(nm, nxt)
                        title_fixed += 1
                p["name_fa"] = nxt
                name_fixed += 1

    for before, after in samples:
        print(f"  {D(before)}")
        print(f"  {G(after)}\n")

    print(f"  نگارش برند   : {brand_fixed}")
    print(f"  حذف حرکت     : {harakat_fixed}")
    print(f"  نام محصول    : {name_fixed}")
    print(f"  عنوان نمایشی : {title_fixed}")

    if DRY:
        print(f"\n  برای اعمال بدون --dry اجرا کنید.\n")
        return

    with open(SEED, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(SEED) // 1024
    print(f"\n  {G('فایل seed به‌روز شد')} — {size:,}KB\n")


if __name__ == "__main__":
    main()
