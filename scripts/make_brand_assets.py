#!/usr/bin/env python3
"""
ساخت همه دارایی‌های برند از یک فایل مرجع.

مرجع یگانه: source/brand/logo.png
    اگر روزی لوگو دوباره عوض شد، فقط همان یک فایل را جایگزین کنید و
    این اسکریپت را بزنید؛ بقیه خودکار بازساخته می‌شوند. پیش از این،
    نسخه‌های لوگو دستی ساخته شده بودند و هیچ زنجیره بازتولیدی نداشتند —
    یعنی تعویض لوگو یعنی گشتن دنبال ده فایل پراکنده.

چرا SVG و نه فقط PNG:
    لوگوی جدید یک نقش خطاطی تک‌رنگ با لبه‌های صاف است — دقیقاً همان
    چیزی که برداری‌سازی رویش بی‌نقص کار می‌کند. نتیجه:
      • نشان ۱٫۶KB به‌جای PNG (در هر اندازه‌ای تیز)
      • رنگ از CSS کنترل می‌شود، پس یک فایل برای زمینه روشن و تیره
      • روی نمایشگر رتینا هیچ‌وقت پیکسلی نمی‌شود
    PNG فقط جایی می‌ماند که SVG پشتیبانی ندارد: schema.org و og:image.

تفاوت بنیادی با لوگوی قبلی — مهم:
    لوگوی قبلی نقش **روشن** بود (۲۴۳,۲۳۹,۲۳۷) و فقط روی زمینه تیره
    دیده می‌شد؛ به همین دلیل هر جای سایت زیرش یک مربع تیره گذاشته
    شده بود. لوگوی جدید نقش **تیره** است (۳۵,۳۱,۳۲). پس هر دو نسخه
    ساخته می‌شود و هر صفحه نسخه متناسب با زمینه‌اش را می‌گیرد.

خروجی:
    source/brand/logo-mark.{png,svg}       فقط نشان
    source/brand/logo-lockup.{png,svg}     نشان + نوشتار
    source/brand/logo-wordmark.{png,svg}   فقط نوشتار
    public/images/brand-mark-{light,dark}.svg
    public/images/brand-lockup-{light,dark}.svg
    public/images/brand_logo.png           نشان روشن — پشتیبان PNG
    public/images/brand-logo-og.png        مربع ۵۱۲ برای اشتراک‌گذاری

اجرا:
    python3 scripts/make_brand_assets.py
    python3 scripts/make_favicon.py      # سپس آیکن‌ها
    python3 scripts/make_pwa_icons.py
"""

import os
import sys

import numpy as np
from PIL import Image

try:
    import potrace
except ImportError:
    sys.exit("پکیج لازم نیست: pip install potracer")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "source", "brand")
PUB = os.path.join(ROOT, "public", "images")
SRC = os.path.join(BRAND, "logo.png")

INK = (35, 31, 32)        # رنگ واقعی نقش در فایل مرجع
SAND = (247, 244, 239)    # --sand   نسخه روشن
OBSIDIAN = (18, 18, 18)   # --obsidian
INK_HEX = "#231F20"
SAND_HEX = "#F7F4EF"


def monochrome(img: Image.Image, rgb=INK) -> Image.Image:
    """
    رنگ را یکدست می‌کند و فقط کانال آلفا را نگه می‌دارد.

    فایل مرجع با پالت (mode=P) ذخیره شده بود؛ لبه‌های نیمه‌شفافش
    رنگ‌های سرگردان داشت (۶۳,۵۹,۶۰ و ۱۱۷,۱۱۷,۱۱۹). بدون یکدست کردن،
    رنگ‌آمیزی مجدد لبه‌ها را کثیف نشان می‌داد.
    """
    a = np.array(img.convert("RGBA"))
    a[:, :, 0], a[:, :, 1], a[:, :, 2] = rgb
    return Image.fromarray(a, "RGBA")


def trim(img: Image.Image) -> Image.Image:
    box = img.getbbox()
    return img.crop(box) if box else img


def split_parts(src: Image.Image):
    """
    نشان را از نوشتار جدا می‌کند.

    روش: پروفایل ستونی آلفا. بین نوشتار و نشان یک شکاف خالی هست
    (در فایل مرجع ستون ۹۸۵ تا ۱۰۹۲). مرز را از خود تصویر پیدا
    می‌کنیم نه با عدد ثابت، تا اگر مرجع عوض شد باز کار کند.
    """
    a = np.array(src.convert("RGBA"))[:, :, 3]
    cols = (a > 128).sum(axis=0)
    nz = np.nonzero(cols)[0]
    if len(nz) == 0:
        raise SystemExit("لوگو خالی است.")

    # بلندترین شکاف داخل محدوده نقش
    best = None
    run = None
    for x in range(nz.min(), nz.max() + 1):
        if cols[x] == 0:
            if run is None:
                run = x
        else:
            if run is not None:
                if best is None or (x - run) > (best[1] - best[0]):
                    best = (run, x)
                run = None
    if best is None:
        raise SystemExit("شکافی بین نشان و نوشتار پیدا نشد.")

    cut = (best[0] + best[1]) // 2
    W, H = src.size
    left = src.crop((0, 0, cut, H))
    right = src.crop((cut, 0, W, H))

    # نشان بلندتر است؛ همان که ارتفاع بیشتری اشغال می‌کند نشان است
    def height_of(im):
        b = im.getbbox()
        return (b[3] - b[1]) if b else 0

    if height_of(right) >= height_of(left):
        return trim(monochrome(right)), trim(monochrome(left))
    return trim(monochrome(left)), trim(monochrome(right))


def _pt(p):
    return p.x, p.y


def to_svg(png: Image.Image, out_path: str) -> int:
    """
    برداری‌سازی از کانال آلفا.

    نکته‌ای که وقت گرفت: potracer مقدار **کم** را نقش می‌گیرد (مثل
    جوهر روی کاغذ سفید)، ولی در آلفا مقدار **زیاد** یعنی نقش. اگر
    آلفا را مستقیم بدهید، خروجی نگاتیو می‌شود — یک مستطیل توپر با
    لوگوی خالی داخلش. پس `255 - alpha` داده می‌شود.
    """
    a = np.array(png.convert("RGBA"))[:, :, 3]
    bmp = potrace.Bitmap(255 - a, blacklevel=0.5)
    path = bmp.trace(turdsize=4, alphamax=1.0,
                     opticurve=True, opttolerance=0.2)

    W, H = png.size
    d = []
    for curve in path:
        sx, sy = _pt(curve.start_point)
        d.append(f"M{sx:.1f} {sy:.1f}")
        for seg in curve:
            if seg.is_corner:
                cx, cy = _pt(seg.c)
                ex, ey = _pt(seg.end_point)
                d.append(f"L{cx:.1f} {cy:.1f}L{ex:.1f} {ey:.1f}")
            else:
                c1x, c1y = _pt(seg.c1)
                c2x, c2y = _pt(seg.c2)
                ex, ey = _pt(seg.end_point)
                d.append(f"C{c1x:.1f} {c1y:.1f} {c2x:.1f} {c2y:.1f} "
                         f"{ex:.1f} {ey:.1f}")
        d.append("Z")

    # fill="currentColor" تا رنگ از CSS بیاید؛ fill-rule برای
    # حفره‌های داخل حروف («ط» و «د» حلقه بسته دارند)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" '
           f'viewBox="0 0 {W} {H}" fill="currentColor" '
           f'fill-rule="evenodd" role="img"><path d="{"".join(d)}"/></svg>')
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)
    return os.path.getsize(out_path)


def colored(svg_src: str, out: str, color: str) -> int:
    s = open(svg_src, encoding="utf-8").read()
    s = s.replace('fill="currentColor"', f'fill="{color}"')
    with open(out, "w", encoding="utf-8") as f:
        f.write(s)
    return os.path.getsize(out)


def tint(img: Image.Image, rgb) -> Image.Image:
    return monochrome(img, rgb)


def main():
    if not os.path.exists(SRC):
        sys.exit(f"فایل مرجع نیست: {SRC}")

    src = Image.open(SRC).convert("RGBA")
    print(f"\n  مرجع: source/brand/logo.png  {src.size[0]}×{src.size[1]}\n")

    mark, word = split_parts(src)
    lockup = trim(monochrome(src))

    made = []
    for img, stem in ((mark, "logo-mark"), (word, "logo-wordmark"),
                      (lockup, "logo-lockup")):
        p = os.path.join(BRAND, f"{stem}.png")
        img.save(p, optimize=True)
        made.append((f"source/brand/{stem}.png", os.path.getsize(p),
                     f"{img.size[0]}×{img.size[1]}"))
        s = os.path.join(BRAND, f"{stem}.svg")
        made.append((f"source/brand/{stem}.svg", to_svg(img, s), "برداری"))

    # ── نسخه‌های رنگی برای سایت ──
    for stem, name in (("logo-mark", "brand-mark"),
                       ("logo-lockup", "brand-lockup")):
        s = os.path.join(BRAND, f"{stem}.svg")
        for suffix, color in (("light", SAND_HEX), ("dark", INK_HEX)):
            o = os.path.join(PUB, f"{name}-{suffix}.svg")
            made.append((f"public/images/{name}-{suffix}.svg",
                         colored(s, o, color), "برداری"))

    # ── پشتیبان PNG نشانِ روشن ──
    # سرویس‌ورکر و صفحه آفلاین به فایل رستری نیاز دارند؛ و اگر
    # مرورگری SVG را در <img> رد کند، این جانشین می‌شود.
    H = 512
    W = round(mark.width * H / mark.height)
    p = os.path.join(PUB, "brand_logo.png")
    tint(mark.resize((W, H), Image.LANCZOS), SAND).save(p, optimize=True)
    made.append(("public/images/brand_logo.png", os.path.getsize(p),
                 f"{W}×{H}"))

    # ── مربع ۵۱۲ برای og:image و schema.org ──
    # این دو جا آلفا را بد رندر می‌کنند (تلگرام پشت شفاف را سفید
    # می‌گذارد و نقشِ روشن ناپدید می‌شود)، پس پس‌زمینه توپر دارد.
    S = 512
    og = Image.new("RGBA", (S, S), OBSIDIAN + (255,))
    box = int(S * 0.62)
    sc = min(box / lockup.width, box / lockup.height)
    lk = tint(lockup.resize((max(1, int(lockup.width * sc)),
                             max(1, int(lockup.height * sc))),
                            Image.LANCZOS), SAND)
    og.alpha_composite(lk, ((S - lk.width) // 2, (S - lk.height) // 2))
    p = os.path.join(PUB, "brand-logo-og.png")
    og.convert("RGB").save(p, "PNG", optimize=True)
    made.append(("public/images/brand-logo-og.png", os.path.getsize(p),
                 f"{S}×{S}"))

    for name, size, note in made:
        print(f"  ✓ {name:38s} {size/1024:6.1f} KB  {note}")

    print("\n  گام بعد:")
    print("    python3 scripts/make_favicon.py")
    print("    python3 scripts/make_pwa_icons.py")
    print("    python3 scripts/apply_logo_all.py   # حکاکی روی بطری‌ها\n")


if __name__ == "__main__":
    main()
