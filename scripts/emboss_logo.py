#!/usr/bin/env python3
"""
حکاکی لوگوی برند روی بطری‌های تصاویر محصول.

چرا این روش و نه تولید دوباره با هوش مصنوعی:
    مدل تصویرساز هرگز لوگوی دقیق شما را بازتولید نمی‌کند — هر بار
    شکلی نزدیک ولی متفاوت می‌سازد. اینجا فایل واقعی
    `source/brand/logo.png` برداشته و با افکت نوری روی شیشه نشانده
    می‌شود، پس نقش دقیقاً همان لوگوی برند است.

روش کار:
    ۱) بدنه شیشه‌ای بطری با تحلیل گرادیان و روشنایی پیدا می‌شود
    ۲) لوگو متناسب با عرض بدنه مقیاس می‌گیرد
    ۳) به‌جای چسباندن ساده، افکت «حکاکی» ساخته می‌شود:
       سایه ظریف بالا-چپ + نور لبه پایین-راست + کمی روشنایی داخل
       نقش. این همان چیزی است که چشم به‌عنوان «کنده‌کاری روی شیشه»
       می‌شناسد.
    ۴) شدت افکت با روشنایی محل تطبیق می‌یابد — روی شیشه تیره،
       نقش روشن؛ روی شیشه روشن، نقش کمی تیره‌تر.

چرا حکاکی و نه چاپ تخت:
    برچسب چاپی روی بطری بی‌نام، مصنوعی به‌نظر می‌رسد. حکاکی شیشه
    زبان بصری برندهای لوکس است و با هویت By Kilian / Penhaligon's
    که مبنای کار بوده هم‌خوان است.

اجرا:
    python3 scripts/emboss_logo.py --preview     # فقط یک نمونه
    python3 scripts/emboss_logo.py               # همه تصاویر fam-*
"""

import argparse
import glob
import os

import numpy as np
from PIL import Image, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
"""
مرجع حکاکی: فقط **نشان**، نه لاک‌آپ کامل.

فایل مرجع `logo.png` از مرداد ۱۴۰۵ لاک‌آپ کامل است (نشان + «عطر
یزد» + YAZD PERFUME). حک کردن لاک‌آپ روی بطری نتیجه‌اش برچسب
شلوغ می‌شود، نه حکاکی ظریف شیشه — و در اندازه کارت فهرست
(۴۲۰px) نوشتار به لکه‌ای ناخوانا تبدیل می‌شود.

`logo-mark.png` را scripts/make_brand_assets.py می‌سازد.
"""
LOGO = os.path.join(ROOT, "source", "brand", "logo-mark.png")
IMG_DIR = os.path.join(ROOT, "public", "images", "products")
RAW_DIR = os.path.join(ROOT, ".imgraw")

# نسبت عرض لوگو به عرض بدنه بطری — کوچک و ظریف، نه تابلو
LOGO_WIDTH_RATIO = 0.26
# جای عمودی روی بدنه: ۰ بالای بدنه، ۱ پایین آن
VERTICAL_POS = 0.42


def load_logo() -> Image.Image:
    """لوگو را می‌خواند و به ماسک خاکستری تمیز تبدیل می‌کند."""
    im = Image.open(LOGO).convert("RGBA")
    alpha = im.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        im = im.crop(bbox)
    return im


"""
مختصات دستی برای تصاویری که تشخیص خودکار رویشان کار نمی‌کند.

دو تصویر بطری‌هایی دارند که لبه‌شان با پس‌زمینه کنتراست بسیار کمی
دارد (شیشه صورتی روی زمینه صورتی، شیشه شنی روی زمینه کرم). به‌جای
پایین آوردن آستانه — که روی بقیه تصاویر خطای تازه می‌سازد — همین
دو مورد دستی اندازه‌گیری شده‌اند.

مقادیر نسبت به عرض/ارتفاع قاب‌اند تا مستقل از ابعاد کار کنند.
"""
MANUAL_BOX = {
    # (نسبت چپ، نسبت راست، نسبت بالا، نسبت پایین)
    # در این دو تصویر بطری اصلاً وسط قاب نیست — یکی سمت راست و
    # دیگری سمت چپ. تشخیص خودکار که از محور مرکزی به بیرون
    # می‌گردد، طبیعتاً شکست می‌خورد.
    "family-floral":  (0.531, 0.802, 0.44, 0.78),   # بطری سمت راست
    "family-leather": (0.168, 0.438, 0.44, 0.78),   # بطری سمت چپ

    # بطری باریکِ مخروطی روی زمینه شراب‌قرمز. شیشه خودش قرمز است
    # و لبه‌اش با پس‌زمینه تقریباً هم‌رنگ، پس تشخیص خودکار بدنه را
    # پیدا نمی‌کند. بدنه با اسکن ستون‌های پراشباع اندازه‌گیری شد:
    # x از ۰٫۴۵۳ تا ۰٫۵۸۱ عرض قاب.
    "fam-ambery-oriental-w-1": (0.445, 0.590, 0.40, 0.70),

    # بطری پهن و کوتاه که تقریباً تمام عرض قاب را می‌گیرد. اسکن
    # ستونی لبهٔ درخشان سمت چپ شیشه را «بدنه» می‌گرفت و کادر
    # باریکی بیرون از مرکز می‌داد. با چشم اندازه‌گیری شد.
    "fam-ambery-oriental-u-12": (0.300, 0.700, 0.44, 0.66),

    # همان الگوی «شیشه صورتی روی زمینه صورتی» که در بالا ذکر شد:
    # کنتراست لبه تقریباً صفر است و تشخیص خودکار کل قاب را
    # برمی‌گرداند (۰٫۰۲ تا ۰٫۹۹). بدنهٔ کروی وسط قاب است.
    "fam-floral-w-11": (0.330, 0.630, 0.52, 0.74),

    # سومین مورد از همان الگو: شیشهٔ هلویی روشن روی پس‌زمینهٔ
    # صورتی محو. بدنهٔ باریک و بلند وسط قاب است.
    "fam-floral-w-15": (0.455, 0.605, 0.32, 0.62),
}


def manual_box(name: str, w: int, h: int):
    key = os.path.splitext(os.path.basename(name))[0]
    m = MANUAL_BOX.get(key)
    if not m:
        return None
    l, r, t, b = m
    return dict(left=int(w * l), right=int(w * r),
                top=int(h * t), bottom=int(h * b),
                width=int(w * (r - l)), height=int(h * (b - t)))


def find_bottle(im: Image.Image):
    """
    بدنه شیشه‌ای بطری را پیدا می‌کند.

    ایده کلیدی: بطری همیشه در مرکز قاب است. پس **از محور مرکزی به
    بیرون** دنبال نخستین لبه قوی می‌گردیم، نه از کناره‌ها به داخل.

    تلاش اول از کناره‌ها اسکن می‌کرد و گل‌ها و شاخه‌های اطراف را
    جزو بطری می‌گرفت — عرض ۹۱۸ پیکسل گزارش می‌شد یعنی تقریباً کل
    قاب. با اسکن از مرکز، فقط لبه واقعی شیشه پیدا می‌شود.

    ردیف‌هایی که عرضشان با میانه هم‌خوان نیست (گردن باریک، درپوش،
    سایه) کنار گذاشته می‌شوند.
    """
    g = np.asarray(im.convert("L").filter(ImageFilter.GaussianBlur(3)), dtype=float)
    h, w = g.shape
    cx = w // 2
    lo, hi = int(w * 0.22), int(w * 0.78)

    lefts, rights, rows = [], [], []
    for y in range(int(h * 0.18), int(h * 0.95), 3):
        d = np.abs(np.diff(g[y]))
        thr = d[lo:hi].mean() + 1.8 * d[lo:hi].std()

        L = R = None
        for x in range(cx, lo, -1):
            if d[x] > thr:
                L = x
                break
        for x in range(cx, hi):
            if d[x] > thr:
                R = x
                break
        if L is None or R is None or (R - L) < w * 0.12:
            continue
        lefts.append(L); rights.append(R); rows.append(y)

    if len(rows) < 15:
        return None

    rows = np.array(rows); lefts = np.array(lefts); rights = np.array(rights)
    widths = rights - lefts
    med = np.median(widths)

    # فقط ردیف‌هایی که عرضشان به بدنه می‌خورد
    keep = (widths > med * 0.80) & (widths < med * 1.25)
    if keep.sum() < 10:
        return None

    ry, rl, rr = rows[keep], lefts[keep], rights[keep]

    left = int(np.median(rl))
    right = int(np.median(rr))
    # ۱۵٪ بالای ناحیه کنار گذاشته می‌شود تا نقش روی شانه یا درپوش نیفتد
    top = int(np.percentile(ry, 15))
    bot = int(np.percentile(ry, 95))

    bw, bh = right - left, bot - top

    """
    اعتبارسنجی — جلوگیری از حک لوگو در جای اشتباه.

    بطری عطر همیشه ایستاده است: بلندتر از پهنا. اگر تشخیص چیزی
    پهن‌تر از بلند برگرداند، احتمالاً گل، پارچه یا سایه را گرفته.
    در `family-floral` دقیقاً همین شد و لوگو کنار بطری در هوا
    نشست. بهتر است تصویر بدون لوگو بماند تا نقش در جای غلط بنشیند.
    """
    if bh < bw * 0.9:
        return None
    if bw < w * 0.10 or bw > w * 0.55:
        return None
    # مرکز بدنه باید نزدیک محور قاب باشد
    if abs((left + right) / 2 - w / 2) > w * 0.18:
        return None

    return dict(left=left, right=right, top=top, bottom=bot,
                width=bw, height=bh)


def emboss(base: Image.Image, logo: Image.Image, box) -> Image.Image:
    """لوگو را به‌شکل حکاکی روی شیشه می‌نشاند."""
    out = base.convert("RGB")
    W, H = out.size

    target_w = max(28, int(box["width"] * LOGO_WIDTH_RATIO))
    ratio = target_w / logo.width
    target_h = max(28, int(logo.height * ratio))

    lg = logo.resize((target_w, target_h), Image.LANCZOS)
    mask = lg.split()[-1].point(lambda v: 255 if v > 40 else int(v * 2.2))
    mask = mask.filter(ImageFilter.GaussianBlur(0.6))

    cx = (box["left"] + box["right"]) // 2 - target_w // 2
    cy = box["top"] + int(box["height"] * VERTICAL_POS) - target_h // 2
    cx = max(0, min(cx, W - target_w))
    cy = max(0, min(cy, H - target_h))

    # روشنایی محل → شدت افکت با پس‌زمینه تطبیق می‌یابد
    patch = out.crop((cx, cy, cx + target_w, cy + target_h)).convert("L")
    lum = np.asarray(patch, dtype=float).mean() / 255.0

    # روی شیشه تیره نقش روشن‌تر، روی شیشه روشن نقش ملایم‌تر
    hi_strength = int(46 + 40 * (1 - lum))
    lo_strength = int(30 + 34 * lum)

    layer = Image.new("RGB", (target_w, target_h))
    shadow = Image.new("L", (target_w, target_h), 0)
    light = Image.new("L", (target_w, target_h), 0)

    # سایه بالا-چپ، نور پایین-راست → حس فرورفتگی
    shadow.paste(mask, (-1, -1))
    light.paste(mask, (1, 1))
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.1))
    light = light.filter(ImageFilter.GaussianBlur(1.1))

    inner = mask.filter(ImageFilter.GaussianBlur(0.8))

    region = out.crop((cx, cy, cx + target_w, cy + target_h))
    arr = np.asarray(region, dtype=float)

    sh = np.asarray(shadow, dtype=float)[..., None] / 255.0
    li = np.asarray(light, dtype=float)[..., None] / 255.0
    inr = np.asarray(inner, dtype=float)[..., None] / 255.0

    arr = arr - sh * lo_strength          # لبه فرورفته
    arr = arr + li * hi_strength          # لبه نورگرفته
    arr = arr + inr * (hi_strength * 0.22)  # کمی روشنایی داخل نقش

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    out.paste(Image.fromarray(arr), (cx, cy))
    return out


def process(path: str, logo: Image.Image, outdir: str) -> str:
    im = Image.open(path).convert("RGB")
    box = find_bottle(im)
    if not box:
        return "بدنه پیدا نشد"
    res = emboss(im, logo, box)
    os.makedirs(outdir, exist_ok=True)
    res.save(os.path.join(outdir, os.path.basename(path)),
             "JPEG", quality=94, subsampling=0)
    return f"بدنه {box['width']}×{box['height']}px"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    logo = load_logo()
    print(f"\n  لوگو: {logo.size[0]}×{logo.size[1]}px\n")

    srcs = sorted(glob.glob(os.path.join(RAW_DIR, "fam-*.jpg")))
    if not srcs:
        print("  تصویر خامی در .imgraw/ نیست.")
        return

    outdir = os.path.join(RAW_DIR, "preview" if args.preview else "logo")
    if args.preview:
        srcs = srcs[:3]

    for s in srcs:
        note = process(s, logo, outdir)
        print(f"  {os.path.basename(s):32s} {note}")

    print(f"\n  خروجی در {outdir}\n")


if __name__ == "__main__":
    main()
