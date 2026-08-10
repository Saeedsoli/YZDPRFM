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


"""
حرف‌های اضافه‌ای که برند را جزء لاینفک نام می‌کنند.

🔴 چرا این فهرست حیاتی است:
    بدون آن، «بلو د شنل» به «بلو د» تبدیل می‌شود و «میس دیور»
    به «میس» — یعنی نام محصول نابود می‌شود.

    این نام‌ها در بازار جهانی با برند شناخته می‌شوند و حذف برند
    از آن‌ها معنا را از بین می‌برد:
        بلو د شنل · میس دیور · تق د هرمس · پاشا د کارتیه
        مون گرلن · ماست دو کارتیه · مای باربری · مستر باربری

    دقیقاً همان فهرستی که scripts/test_brand_names.js دارد. اگر
    این دو واگرا شوند، دیتابیس و seed نام‌های متفاوت می‌گیرند و
    استقرار از صفر چیز دیگری می‌سازد — کلاس خطایی که فقط روی
    سرور تازه دیده می‌شود.
"""
CONNECTORS = {
    "د", "دو", "دِ", "آو", "او", "له", "لا",
    "میس", "مای", "مستر", "مون", "لو", "بلو", "تق",
    "پاشا", "ویاژ", "لنستان", "ماست", "هوم",
}


def strip_brand(name: str, brand: str) -> str:
    """
    حذف نام برند از نام محصول — همان منطق نسخه JavaScript.

    اگر واژه پیش از برند حرف اضافه باشد، برند بخشی از نام است و
    دست نمی‌خورد.
    """
    if not name or not brand:
        return name

    # واژه چسبیده به برند را ببین: اگر حرف اضافه بود، رها کن
    words = name.replace("عطر دست‌ساز", "").split()
    if brand in words:
        i = words.index(brand)
        if i > 0 and words[i - 1] in CONNECTORS:
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
            # 🔴 `full_display_fa` هم باید اینجا باشد.
            #     نبودنش یعنی seed از درون ناسازگار می‌شود: برند
            #     «نیشان» ولی عنوان نمایشی «نیشانه - قره‌گوز».
            #     test_cold_deploy این را گرفت — همان آزمونی که
            #     استقرار از صفر روی لیارا را شبیه‌سازی می‌کند.
            for key in ("name_fa", "title_fa_display", "title_fa_base",
                        "full_display_fa"):
                if p.get(key) and old_brand and old_brand in p[key]:
                    p[key] = p[key].replace(old_brand, new_brand)

        # ۳) حذف تکرار برند از نام
        nm = p.get("name_fa") or ""
        if new_brand and new_brand in nm:
            nxt = strip_brand(nm, new_brand)
            if nxt != nm:
                if len(samples) < 6:
                    samples.append((f"{new_brand} — {nm}", f"{new_brand} — {nxt}"))
                for key in ("title_fa_display", "title_fa_base",
                            "full_display_fa"):
                    if p.get(key) and nm in p[key]:
                        p[key] = p[key].replace(nm, nxt)
                        title_fixed += 1
                p["name_fa"] = nxt
                name_fixed += 1

    """
    ── همگام‌سازی نهایی full_display_fa ──
    🔴 چرا مرحله جدا لازم است:
        `full_display_fa` قالبش «عطر دست‌ساز {برند} - {نام}» است و
        در ساخت seed یک‌بار ساخته می‌شود. مرحله حذف تکرار بالا
        `name_fa` را عوض می‌کند ولی این رشته را نه، چون متن قدیمی
        داخلش با متن جدید تطبیق نمی‌خورد.

        نتیجه ناسازگاری داخلی: name_fa «نامبر ۱۹ پودری» ولی
        full_display_fa «شنل - شنل نامبر ۱۹ پودری».
        test_cold_deploy این را گرفت.

        راه امن: پس از همه اصلاح‌ها، این میدان از روی مقادیر
        نهایی **بازساخته** شود، نه اینکه با replace وصله شود.
    """
    full_rebuilt = 0
    for p_ in data:
        brand = p_.get("inspired_brand_fa") or ""
        nm = p_.get("name_fa") or ""
        if not brand or not nm:
            continue
        # name_fa قالب «عطر دست‌ساز X» دارد؛ X را جدا می‌کنیم
        bare = nm.replace("عطر دست‌ساز", "").strip()
        want = f"عطر دست‌ساز {brand} - {bare}"
        if p_.get("full_display_fa") != want:
            p_["full_display_fa"] = want
            full_rebuilt += 1

    for before, after in samples:
        print(f"  {D(before)}")
        print(f"  {G(after)}\n")

    print(f"  نگارش برند   : {brand_fixed}")
    print(f"  حذف حرکت     : {harakat_fixed}")
    print(f"  نام محصول    : {name_fixed}")
    print(f"  عنوان نمایشی : {title_fixed}")
    print(f"  نمایش کامل   : {full_rebuilt}")

    if DRY:
        print(f"\n  برای اعمال بدون --dry اجرا کنید.\n")
        return

    with open(SEED, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(SEED) // 1024
    print(f"\n  {G('فایل seed به‌روز شد')} — {size:,}KB\n")


if __name__ == "__main__":
    main()
