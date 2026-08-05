#!/usr/bin/env python3
"""
ساخت آیکن‌های maskable برای PWA.

مسئله‌ای که حل می‌کند:
    آیکن‌های موجود با `purpose: "any maskable"` اعلام شده بودند،
    ولی طراحی‌شان برای maskable مناسب نبود: قاب طلایی تا لبه
    می‌رفت. اندروید آیکن maskable را به شکل دلخواه سازنده دستگاه
    (دایره، ذره‌بین، مربع گرد) می‌برد و فقط دایره‌ای به شعاع ۴۰٪
    از مرکز «ناحیه امن» است.

    اندازه‌گیری: ۴۸٪ از محتوای آیکن بیرون ناحیه امن بود — یعنی
    قاب طلایی روی بیشتر گوشی‌های اندروید کاملاً بریده می‌شد.

راه‌حل استاندارد — دو آیکن جدا:
    • `purpose: "any"`      → طرح کامل با قاب، برای جاهایی که
                              برش نمی‌خورد (دسکتاپ، فاوآیکن)
    • `purpose: "maskable"` → همان نقش، ولی کوچک‌تر و در مرکز، با
                              پس‌زمینه تمام‌صفحه که برش هر شکلی را
                              تحمل کند

چرا پس‌زمینه تمام‌صفحه لازم است:
    اگر آیکن maskable گوشه شفاف داشته باشد، اندروید پشتش سفید
    می‌گذارد و روی لانچر تیره زشت می‌شود.

اجرا: python3 scripts/make_pwa_icons.py
"""

import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
LOGO = os.path.join(PUB, "images", "brand_logo.png")

# رنگ برند — همان مقدار theme_color در manifest
BG = (18, 18, 18, 255)

# نقش باید داخل دایره‌ای به شعاع ۴۰٪ از مرکز جا شود.
# ۵۲٪ عرض قاب یعنی نیم‌قطر ۲۶٪ — با حاشیه امن راحت.
MASKABLE_RATIO = 0.52


def build_maskable(size: int) -> Image.Image:
    """پس‌زمینه تمام‌صفحه + نقش کوچک در مرکز."""
    canvas = Image.new("RGBA", (size, size), BG)

    logo = Image.open(LOGO).convert("RGBA")
    bbox = logo.getbbox()
    if bbox:
        logo = logo.crop(bbox)

    # مقیاس بر پایه بلندترین بُعد تا نسبت حفظ شود
    target = int(size * MASKABLE_RATIO)
    w, h = logo.size
    scale = target / max(w, h)
    logo = logo.resize((max(1, int(w * scale)), max(1, int(h * scale))),
                       Image.LANCZOS)

    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    canvas.alpha_composite(logo, (x, y))
    return canvas


def safe_zone_check(im: Image.Image) -> float:
    """چند درصد محتوا بیرون ناحیه امن دایره‌ای است؟"""
    import numpy as np
    from PIL import ImageDraw

    W, H = im.size
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    r = int(W * 0.4)
    d.ellipse([W // 2 - r, H // 2 - r, W // 2 + r, H // 2 + r], fill=255)

    arr = np.array(im)
    # «محتوا» یعنی پیکسلی که با پس‌زمینه فرق دارد
    diff = (np.abs(arr[:, :, :3].astype(int) - list(BG[:3])).sum(axis=2) > 30)
    safe = np.array(mask) > 128
    total = diff.sum()
    if total == 0:
        return 0.0
    return (diff & ~safe).sum() / total * 100


def main():
    if not os.path.exists(LOGO):
        print(f"لوگو یافت نشد: {LOGO}")
        return

    print("\n  ساخت آیکن‌های maskable\n")

    for size in (192, 512):
        im = build_maskable(size)
        out = os.path.join(PUB, f"icon-maskable-{size}.png")
        im.save(out, "PNG", optimize=True)
        pct = safe_zone_check(im)
        kb = os.path.getsize(out) // 1024
        flag = "\033[32m✓\033[0m" if pct < 1 else "\033[31m✗\033[0m"
        print(f"  {flag} icon-maskable-{size}.png  {kb}KB  "
              f"بیرون ناحیه امن: {pct:.1f}%")

    # بررسی آیکن‌های موجود برای مقایسه
    print("\n  \033[2mآیکن‌های فعلی (purpose: any)\033[0m")
    for name in ("icon-192.png", "icon-512.png"):
        p = os.path.join(PUB, name)
        if os.path.exists(p):
            pct = safe_zone_check(Image.open(p).convert("RGBA"))
            print(f"    {name}  بیرون ناحیه امن: {pct:.0f}%  "
                  f"\033[2m(برای purpose:any مشکلی نیست)\033[0m")

    print()


if __name__ == "__main__":
    main()
