#!/usr/bin/env python3
"""
خط لوله کامل تصویر محصول — از فایل خام تا فایل قابل سرو.

چرا این اسکریپت وجود دارد:
    پیش‌تر کار در سه مرحله جدا انجام می‌شد: برش دستی، بعد
    `emboss_logo.py`، بعد `process_product_images.py`. هر بار باید
    یادت می‌ماند که ترتیب چیست و نسخه بدون لوگو را کجا نگه داری.
    یک بار همین فراموشی باعث شد تصویری بدون لوگو منتشر شود و آزمون
    «همه تصاویر لوگو خورده‌اند» قرمز شد.

    حالا یک فرمان همه‌چیز را انجام می‌دهد و ترتیب درست را تضمین
    می‌کند.

مراحل:
    ۱) خواندن PNG خام از `.imgraw/raw/`
    ۲) برش مربع مرکزی و تغییر اندازه به ۱۲۵۴×۱۲۵۴
    ۳) ذخیره نسخه **بدون لوگو** در `source/product-images/`
       — این نسخه بایگانی است: اگر روزی لوگو عوض شود، بدون تولید
         دوباره تصویر می‌شود همه را از نو حک کرد
    ۴) حک لوگوی برند روی بدنه بطری (`emboss_logo.py`)
    ۵) خروجی چهارتایی در `public/images/products/`:
       jpg · webp · jpg کوچک · webp کوچک

اگر بدنه بطری پیدا نشود:
    تصویر **منتشر نمی‌شود**. تصویر بدون لوگو بهتر از تصویری نیست که
    نقش برند رویش در هوا نشسته باشد؛ پس همان‌جا رد می‌شود و گزارش
    می‌دهد تا خودت تصمیم بگیری.

اجرا:
    python3 scripts/build_product_images.py            # همه فایل‌های خام
    python3 scripts/build_product_images.py --dry      # فقط گزارش
"""

import argparse
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emboss_logo import load_logo, find_bottle, emboss   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, ".imgraw", "raw")
NOLOGO = os.path.join(ROOT, "source", "product-images")
OUT = os.path.join(ROOT, "public", "images", "products")

SIZE_FULL = 1254
SIZE_CARD = 420
Q_JPG = 82
Q_WEBP = 80

G = lambda s: f"\x1b[32m{s}\x1b[0m"      # noqa: E731
R = lambda s: f"\x1b[31m{s}\x1b[0m"      # noqa: E731
D = lambda s: f"\x1b[2m{s}\x1b[0m"       # noqa: E731


def square_crop(im: Image.Image) -> Image.Image:
    """برش مربع از مرکز — بطری همیشه وسط قاب است"""
    w, h = im.size
    if w == h:
        return im
    side = min(w, h)
    return im.crop(((w - side) // 2, (h - side) // 2,
                    (w - side) // 2 + side, (h - side) // 2 + side))


def build(name: str, logo: Image.Image, dry: bool):
    slug = os.path.splitext(name)[0]
    im = Image.open(os.path.join(RAW, name)).convert("RGB")
    im = square_crop(im).resize((SIZE_FULL, SIZE_FULL), Image.LANCZOS)

    box = find_bottle(im)
    if not box:
        return slug, None, "بدنه بطری پیدا نشد — رد شد"

    if dry:
        return slug, None, f"بدنه {box['width']}×{box['height']}px"

    # ۳) بایگانی نسخه بدون لوگو
    os.makedirs(NOLOGO, exist_ok=True)
    im.save(os.path.join(NOLOGO, slug + ".jpg"), "JPEG",
            quality=94, subsampling=0)

    # ۴) حکاکی
    stamped = emboss(im, logo, box)

    # ۵) خروجی چهارتایی
    os.makedirs(OUT, exist_ok=True)
    card = stamped.resize((SIZE_CARD, SIZE_CARD), Image.LANCZOS)

    paths = {
        "jpg":     os.path.join(OUT, f"{slug}.jpg"),
        "webp":    os.path.join(OUT, f"{slug}.webp"),
        "jpg_sm":  os.path.join(OUT, f"{slug}-sm.jpg"),
        "webp_sm": os.path.join(OUT, f"{slug}-sm.webp"),
    }
    stamped.save(paths["jpg"], "JPEG", quality=Q_JPG,
                 optimize=True, progressive=True)
    stamped.save(paths["webp"], "WEBP", quality=Q_WEBP, method=6)
    card.save(paths["jpg_sm"], "JPEG", quality=Q_JPG,
              optimize=True, progressive=True)
    card.save(paths["webp_sm"], "WEBP", quality=Q_WEBP, method=6)

    sizes = {k: os.path.getsize(v) for k, v in paths.items()}
    return slug, sizes, f"بدنه {box['width']}×{box['height']}px"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true",
                    help="فقط تشخیص بدنه را گزارش کن، چیزی ننویس")
    args = ap.parse_args()

    if not os.path.isdir(RAW):
        print(f"پوشه {RAW} وجود ندارد.")
        sys.exit(1)

    names = sorted(n for n in os.listdir(RAW)
                   if n.lower().endswith((".png", ".jpg"))
                   and n.startswith(("fam-", "brand-")))
    if not names:
        print("تصویر خامی برای پردازش نیست.")
        sys.exit(0)

    logo = load_logo()
    print(f"\n  لوگو: {logo.size[0]}×{logo.size[1]}px")
    print(f"  {len(names)} تصویر خام"
          f"{D('  — حالت آزمایشی') if args.dry else ''}\n")

    ok = skipped = 0
    for n in names:
        slug, sizes, note = build(n, logo, args.dry)
        if sizes is None and "رد شد" in note:
            print(f"  {R('✗')} {slug:28s} {note}")
            skipped += 1
            continue
        ok += 1
        if sizes:
            print(f"  {G('✓')} {slug:28s} {note}"
                  f"{D('  · jpg ' + str(sizes['jpg'] // 1024) + 'KB')}"
                  f"{D(' · webp ' + str(sizes['webp'] // 1024) + 'KB')}"
                  f"{D(' · کارت ' + str(sizes['webp_sm'] // 1024) + 'KB')}")
        else:
            print(f"  {G('✓')} {slug:28s} {note}")

    print(f"\n  {ok} تصویر آماده"
          + (f" · {R(str(skipped) + ' رد شد')}" if skipped else "")
          + "\n")

    if not args.dry and ok:
        print(D("  گام بعد: به‌روزرسانی VARIANT_COUNTS در src/db.js،"))
        print(D("           سپس  node scripts/reassign_images.js\n"))


if __name__ == "__main__":
    main()
