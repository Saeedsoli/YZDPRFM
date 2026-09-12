#!/usr/bin/env bash
#
# بستهٔ نجات — هستهٔ غیرقابل بازتولید پروژه
# ═══════════════════════════════════════════
#
# چرا این اسکریپت وجود دارد
# ─────────────────────────
# ورک‌اسپیس این گفتگو سقف حجم دارد و چند بار پیام
# «Workspace over budget» داده. یک بار هم سه کامیت گیت بین
# snapshotها گم شدند (فایل‌ها سالم ماندند ولی تاریخچه رفت).
#
# نکتهٔ کلیدی: از ۸۴ مگابایت پروژه، فقط ~۱۲ مگابایت
# «غیرقابل بازتولید» است. بقیه با اجرای دو اسکریپت ساخته
# می‌شود:
#
#   ۳۱MB  public/images/products  ← apply_logo_all.py
#   ۲۲MB  source/product-images   ← فقط برای بازتولید لوگو
#   ۱۸MB  data/yazd.db            ← از seed/ خودکار ساخته می‌شود
#
# پس بستهٔ نجات فقط هسته را برمی‌دارد و کوچک می‌ماند تا
# دانلودش آسان باشد.
#
# ⚠ این جایگزین گیت نیست، مکمل آن است. گیت تاریخچه دارد؛
# این فقط عکس لحظه‌ای است.
#
# اجرا:  bash scripts/make_rescue_bundle.sh
# خروجی: /home/user/yazd-core-YYYY-MM-DD.tar.gz

set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date +%Y-%m-%d)
OUT="yazd-core-${STAMP}.tar.gz"

# نسخهٔ قبلی حذف شود تا دو فایل هم‌نام روی هم انباشته نشوند
rm -f yazd-core-*.tar.gz

# ── چه چیزی داخل می‌رود ──
# source/product-images عمداً نیست: ۲۲ مگابایت است و فقط وقتی
# لازم می‌شود که لوگو عوض شود. اگر آن روز برسد، تصاویر از نو
# ساخته می‌شوند.
tar --exclude='__pycache__' \
    --exclude='*.pyc' \
    -czf "$OUT" \
    src/ \
    scripts/ \
    docs/ \
    seed/ \
    source/dataset/ \
    source/brand/ \
    source/fonts/ \
    public/*.html \
    public/assets/ \
    public/fonts/ \
    public/*.png \
    public/*.svg \
    public/*.ico \
    public/*.webmanifest \
    public/sw.js \
    package.json package-lock.json \
    Dockerfile liara.json \
    .gitignore .dockerignore .gitattributes .env.example \
    README.md CONTRIBUTING.md SECURITY.md \
    2>/dev/null || true

SIZE=$(du -h "$OUT" | cut -f1)
FILES=$(tar -tzf "$OUT" | wc -l)

echo
echo "  بستهٔ نجات ساخته شد"
echo "  ─────────────────────────────────────"
echo "  فایل   : $OUT"
echo "  حجم    : $SIZE"
echo "  فایل‌ها : $FILES"
echo
echo "  بازسازی کامل — آزموده شده روی پوشهٔ خالی:"
echo "    tar -xzf $OUT"
echo "    npm install                             # ~۹۰ ثانیه"
echo "    node -e \"require('./src/db')\"           # ۲۱۱۱ محصول از seed"
echo "    node scripts/seed_maker_notes.js --all  # ۲۱۱۱ یادداشت عطرساز"
echo
echo "  ⚠ دو چیز در بسته نیست چون بازتولیدشدنی‌اند:"
echo "     • تصاویر محصول (۳۱MB) — از گیت یا زیپ کامل"
echo "     • source/product-images (۲۲MB) — فقط برای تعویض لوگو"
echo
echo "  ⚠ وضعیت supply_mode پس از بازسازی روی UNAVAILABLE است."
echo "    اگر محصولاتی را فعال کرده بودید، دوباره لازم است."
echo
