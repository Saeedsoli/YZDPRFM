#!/usr/bin/env python3
"""
پردازش تصاویر تولیدشده → آماده سرو روی سایت.

کار این اسکریپت:
    ۱) برش مربع مرکزی و تغییر اندازه به ۱۲۵۴×۱۲۵۴ (استاندارد موجود)
    ۲) خروجی JPG بهینه (کیفیت ۸۲، progressive)
    ۳) خروجی WebP (کیفیت ۸۰) — سرور خودکار به مرورگرهای پشتیبان می‌دهد
    ۴) نسخه کوچک ۴۲۰×۴۲۰ برای کارت فهرست موبایل

چرا دو فرمت:
    سرور بر پایه هدر Accept تصمیم می‌گیرد. WebP حدود ۳۰٪ سبک‌تر
    است ولی JPG برای مرورگرهای قدیمی لازم می‌ماند.

چرا نسخه کوچک:
    کارت فهرست ۳۰۰×۳۰۰ نمایش داده می‌شود. فرستادن فایل ۱۲۵۴ پیکسلی
    برای آن، چند صد کیلوبایت هدر رفتن روی موبایل است.

اجرا: python3 scripts/process_product_images.py
"""

import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".imgraw")
OUT = os.path.join(ROOT, "public", "images", "products")

SIZE_FULL = 1254
SIZE_CARD = 420
Q_JPG = 82
Q_WEBP = 80


def square_crop(im: Image.Image) -> Image.Image:
    """برش مربع از مرکز — بطری همیشه وسط قاب است"""
    w, h = im.size
    if w == h:
        return im
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def process(name: str) -> dict:
    src = os.path.join(SRC, name)
    slug = os.path.splitext(name)[0]

    im = Image.open(src).convert("RGB")
    im = square_crop(im)

    full = im.resize((SIZE_FULL, SIZE_FULL), Image.LANCZOS)
    card = im.resize((SIZE_CARD, SIZE_CARD), Image.LANCZOS)

    paths = {
        "jpg":      os.path.join(OUT, f"{slug}.jpg"),
        "webp":     os.path.join(OUT, f"{slug}.webp"),
        "jpg_sm":   os.path.join(OUT, f"{slug}-sm.jpg"),
        "webp_sm":  os.path.join(OUT, f"{slug}-sm.webp"),
    }

    full.save(paths["jpg"], "JPEG", quality=Q_JPG, optimize=True, progressive=True)
    full.save(paths["webp"], "WEBP", quality=Q_WEBP, method=6)
    card.save(paths["jpg_sm"], "JPEG", quality=Q_JPG, optimize=True, progressive=True)
    card.save(paths["webp_sm"], "WEBP", quality=Q_WEBP, method=6)

    return {k: os.path.getsize(v) for k, v in paths.items()}


def main():
    if not os.path.isdir(SRC):
        print(f"پوشه {SRC} وجود ندارد.")
        sys.exit(1)

    os.makedirs(OUT, exist_ok=True)
    names = sorted(n for n in os.listdir(SRC)
                   if n.endswith(".png") and n.startswith("fam-"))

    if not names:
        print("تصویری برای پردازش نیست.")
        sys.exit(0)

    print(f"\n  پردازش {len(names)} تصویر\n")
    total_raw = total_out = 0

    for n in names:
        raw = os.path.getsize(os.path.join(SRC, n))
        sizes = process(n)
        out = sizes["jpg"] + sizes["webp"] + sizes["jpg_sm"] + sizes["webp_sm"]
        total_raw += raw
        total_out += out
        print(f"  {os.path.splitext(n)[0]:30s} "
              f"{raw//1024:5d}KB → jpg {sizes['jpg']//1024:4d}KB · "
              f"webp {sizes['webp']//1024:4d}KB · "
              f"کارت {sizes['webp_sm']//1024:3d}KB")

    print(f"\n  خام: {total_raw//1024:,}KB → خروجی: {total_out//1024:,}KB")
    print(f"  کاهش: {100 - total_out*100//total_raw}%\n")


if __name__ == "__main__":
    main()
