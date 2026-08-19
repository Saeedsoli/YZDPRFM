#!/usr/bin/env python3
"""
اعمال لوگوی برند روی همه تصاویر محصول و بازتولید نسخه‌های بهینه.

جریان کار:
    ۱) نسخه پشتیبان بدون لوگو در source/product-images/ نگه داشته
       می‌شود تا اگر لوگو عوض شد بتوان دوباره از صفر ساخت — بدون
       این، حکاکی روی حکاکی انباشته می‌شد.
       (عمداً بیرون از .imgraw/ چون آن پوشه موقت است و پاک می‌شود.)
    ۲) لوگو روی نسخه ۱۲۵۴ پیکسلی حک می‌شود
    ۳) از همان خروجی، هر چهار فایل ساخته می‌شود:
       jpg / webp / jpg-sm / webp-sm

    مهم: نسخه کوچک از تصویرِ لوگودار مقیاس می‌گیرد، نه اینکه لوگو
    جداگانه روی آن حک شود. اگر جدا حک می‌شد، لوگو در کارت فهرست
    نسبت متفاوتی پیدا می‌کرد.

اجرا: python3 scripts/apply_logo_all.py
"""

import os
import shutil
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emboss_logo import (load_logo, find_bottle, emboss,   # noqa: E402
                         manual_box)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "public", "images", "products")
BACKUP = os.path.join(ROOT, "source", "product-images")

SIZE_FULL = 1254
SIZE_CARD = 420
Q_JPG = 84
Q_WEBP = 82

# ── چرا کارت کیفیت جداگانه دارد ──
# تصاویر تازهٔ شهریور ۱۴۰۵ پرجزئیات‌تر از دستهٔ اول‌اند (گلبرگ،
# رزین، بافت سنگ) و با همان کیفیت ۸۴، میانگین کارت را از ۲۳ به
# ۲۵ کیلوبایت رساندند — درست روی سقفی که test_images می‌گیرد.
#
# کارت ۴۲۰ پیکسل روی موبایل حدود ۱۶۰ پیکسل دیده می‌شود، پس
# کیفیت ۷۸ با چشم قابل تشخیص نیست ولی حجم را حدود ۲۰٪ کم می‌کند.
# نسخهٔ کامل دست‌نخورده می‌ماند چون آنجا جزئیات واقعاً دیده
# می‌شود.
Q_JPG_CARD = 78
Q_WEBP_CARD = 76


def main():
    logo = load_logo()
    os.makedirs(BACKUP, exist_ok=True)

    # هم تصاویر تازه (fam-*) و هم تصاویر قدیمی خانواده/برند که
    # هنوز به محصولات وصل‌اند — همه باید لوگو داشته باشند، وگرنه
    # کاتالوگ نیمی بطری لوگودار و نیمی بی‌نام نشان می‌دهد.
    names = sorted(n for n in os.listdir(IMG)
                   if n.endswith(".jpg") and "-sm" not in n
                   and (n.startswith("fam-") or n.startswith("family-")
                        or n.startswith("brand-")))

    if not names:
        print("  تصویری برای پردازش نیست.")
        return

    print(f"\n  حک لوگو روی {len(names)} تصویر\n")
    ok = failed = 0

    for n in names:
        src = os.path.join(IMG, n)
        bak = os.path.join(BACKUP, n)

        # نخستین بار: نسخه بدون لوگو را نگه دار
        if not os.path.exists(bak):
            shutil.copy2(src, bak)

        # همیشه از نسخه بدون لوگو شروع کن (جلوگیری از انباشت افکت)
        base = Image.open(bak).convert("RGB")
        # اول تشخیص خودکار؛ اگر رد شد، مختصات دستی
        box = find_bottle(base) or manual_box(n, *base.size)
        if not box:
            print(f"  ✗ {n:32s} بدنه پیدا نشد")
            failed += 1
            continue

        stamped = emboss(base, logo, box)

        full = stamped.resize((SIZE_FULL, SIZE_FULL), Image.LANCZOS)
        card = stamped.resize((SIZE_CARD, SIZE_CARD), Image.LANCZOS)
        stem = os.path.splitext(n)[0]

        full.save(os.path.join(IMG, f"{stem}.jpg"), "JPEG",
                  quality=Q_JPG, optimize=True, progressive=True)
        full.save(os.path.join(IMG, f"{stem}.webp"), "WEBP",
                  quality=Q_WEBP, method=6)
        card.save(os.path.join(IMG, f"{stem}-sm.jpg"), "JPEG",
                  quality=Q_JPG_CARD, optimize=True, progressive=True)
        card.save(os.path.join(IMG, f"{stem}-sm.webp"), "WEBP",
                  quality=Q_WEBP_CARD, method=6)

        kb = os.path.getsize(os.path.join(IMG, f"{stem}-sm.webp")) // 1024
        print(f"  ✓ {n:32s} بدنه {box['width']}×{box['height']}  کارت {kb}KB")
        ok += 1

    print(f"\n  {ok} موفق · {failed} ناموفق")
    print(f"  نسخه بدون لوگو در {BACKUP}\n")


if __name__ == "__main__":
    main()
