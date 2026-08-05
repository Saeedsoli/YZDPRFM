#!/usr/bin/env python3
"""
ساخت favicon و آیکن‌های نصب از لوگوی برند.

چرا لازم بود: هیچ صفحه‌ای favicon نداشت — تب مرورگر آیکن خالی
پیش‌فرض نشان می‌داد. برای فروشگاهی با هویت لوکس نقص محسوسی است،
و در «افزودن به صفحه اصلی» روی موبایل هم مربع سفید می‌آمد.

طراحی: نقش خطاطی روشنِ لوگو روی پس‌زمینه ابسیدین برند (#121212)
با حاشیه طلایی نازک. لوگو عمودی (۱۱۱×۳۵۷) است، پس در مربع
وسط‌چین می‌شود و حاشیه امن می‌گیرد.

خروجی:
  public/favicon.ico            ۱۶+۳۲+۴۸ چندلایه (مرورگرهای قدیمی)
  public/favicon-32.png         تب مرورگر
  public/favicon-16.png         تب مرورگر
  public/apple-touch-icon.png   ۱۸۰×۱۸۰ برای iOS
  public/icon-192.png           PWA / اندروید
  public/icon-512.png           PWA / اندروید
  public/site.webmanifest       فراداده نصب

اجرا: python3 scripts/make_favicon.py
"""
from PIL import Image, ImageDraw, ImageEnhance
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
LOGO = os.path.join(PUB, 'images', 'brand_logo.png')

OBSIDIAN = (18, 18, 18, 255)      # --obsidian
GOLD = (197, 155, 39, 255)        # --gold
SAND = (247, 244, 239, 255)       # --sand


def build(size: int, ring: bool = True, radius_ratio: float = 0.22) -> Image.Image:
    """یک آیکن مربع با پس‌زمینه تیره و نقش روشن وسط."""
    # ۴ برابر می‌سازیم و بعد کوچک می‌کنیم — لبه‌ها نرم می‌شوند
    S = size * 4
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # پس‌زمینه گرد
    r = int(S * (0.16 if size <= 16 else radius_ratio))
    draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=OBSIDIAN)

    # حاشیه طلایی نازک — در اندازه‌های ریز حذف می‌شود چون گِل می‌شود
    if ring and size >= 32:
        w = max(2, S // 64)
        draw.rounded_rectangle([w // 2, w // 2, S - 1 - w // 2, S - 1 - w // 2],
                               radius=r, outline=GOLD, width=w)

    # لوگو
    logo = Image.open(LOGO).convert('RGBA')

    # نقش لوگو روشن است؛ آن را به رنگ ماسه‌ای برند در می‌آوریم تا
    # روی زمینه تیره خوانا باشد (کانال آلفا حفظ می‌شود).
    alpha = logo.split()[3]
    tinted = Image.new('RGBA', logo.size, SAND)
    tinted.putalpha(alpha)

    # جا دادن با حاشیه امن.
    # در ۱۶ پیکسل حاشیه باید خیلی کم باشد وگرنه نقش به چند پیکسل
    # خاکستری تبدیل می‌شود و اصلاً خوانده نمی‌شود — با بزرگ‌نمایی
    # آزمایش شد.
    if size <= 16:
        pad = 0.08
    elif size < 64:
        pad = 0.18
    else:
        pad = 0.30
    box = int(S * (1 - pad))
    lw, lh = tinted.size
    scale = min(box / lw, box / lh)
    nw, nh = max(1, int(lw * scale)), max(1, int(lh * scale))
    tinted = tinted.resize((nw, nh), Image.LANCZOS)

    canvas.alpha_composite(tinted, ((S - nw) // 2, (S - nh) // 2))
    out = canvas.resize((size, size), Image.LANCZOS)

    # در ۱۶ پیکسل، نقشِ باریک بعد از کوچک‌شدن به خاکستری کم‌رمق
    # تبدیل می‌شود. کنتراست را بالا می‌بریم تا سفیدِ نقش برگردد —
    # بدون این کار آیکن در تب مرورگر لکه‌ای مبهم دیده می‌شود.
    if size <= 16:
        rr, gg, bb, aa = out.split()
        boost = ImageEnhance.Contrast(Image.merge('RGB', (rr, gg, bb))).enhance(1.9)
        boost = ImageEnhance.Brightness(boost).enhance(1.25)
        rr, gg, bb = boost.split()
        out = Image.merge('RGBA', (rr, gg, bb, aa))

    return out


def main():
    outputs = []

    for name, size, ring in [
        ('favicon-16.png', 16, False),
        ('favicon-32.png', 32, True),
        ('apple-touch-icon.png', 180, True),
        ('icon-192.png', 192, True),
        ('icon-512.png', 512, True),
    ]:
        img = build(size, ring=ring)
        # آیکن iOS نباید آلفا داشته باشد — وگرنه اپل پس‌زمینه سیاه می‌گذارد
        if name == 'apple-touch-icon.png':
            flat = Image.new('RGB', img.size, OBSIDIAN[:3])
            flat.paste(img, mask=img.split()[3])
            img = flat
        path = os.path.join(PUB, name)
        img.save(path)
        outputs.append((name, os.path.getsize(path)))

    # ico چندلایه
    ico_path = os.path.join(PUB, 'favicon.ico')
    build(48, ring=True).save(
        ico_path, format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48)])
    outputs.append(('favicon.ico', os.path.getsize(ico_path)))

    # manifest
    manifest = {
        "name": "عطر یزد",
        "short_name": "عطر یزد",
        "description": "بازآفرینی دست‌ساز رایحه‌های ماندگار",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#121212",
        "theme_color": "#121212",
        "lang": "fa",
        "dir": "rtl",
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png",
             "purpose": "any maskable"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png",
             "purpose": "any maskable"}
        ]
    }
    mpath = os.path.join(PUB, 'site.webmanifest')
    with open(mpath, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    outputs.append(('site.webmanifest', os.path.getsize(mpath)))

    print("  ساخته شد:")
    for name, size in outputs:
        print(f"    {name:24} {size/1024:6.1f} KB")


if __name__ == '__main__':
    main()
