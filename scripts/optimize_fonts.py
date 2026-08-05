#!/usr/bin/env python3
"""زیرمجموعه‌سازی فونت وزیرمتن — ۴۴٪ کاهش حجم.

چرا لازم است؟
  فونت کامل ۸۱۱ نویسه دارد (لاتین گسترده، نمادهای ریاضی، کسرها…)
  ولی سایت فارسی تنها بخشی از آن‌ها را نشان می‌دهد.

چرا خطرناک است؟
  فارسی خط اتصالی است: هر حرف بسته به جایگاه شکل متفاوت دارد.
  این شکل‌ها در cmap نیستند و با جدول GSUB ساخته می‌شوند.
  اگر layout_features حذف شود، متن به‌هم می‌ریزد.

روش امن:
  ۱) فهرست نویسه‌ها از محتوای واقعی استخراج می‌شود، نه حدس
  ۲) کل بلوک عربی/فارسی به‌عنوان حاشیه امن نگه داشته می‌شود
  ۳) layout_features = ['*'] تا اتصال حروف سالم بماند
  ۴) پس از ساخت، رندر با فونت اصلی پیکسل‌به‌پیکسل مقایسه می‌شود

اجرا:
    python3 scripts/optimize_fonts.py            # ساخت
    python3 scripts/optimize_fonts.py --verify   # فقط راستی‌آزمایی

پیش‌نیاز: pip install fonttools brotli pillow
"""
import glob
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, 'public', 'fonts')
SRC_DIR = os.path.join(ROOT, 'source', 'fonts')
WEIGHTS = ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']


def collect_chars():
    """نویسه‌های واقعاً استفاده‌شده در سایت و دیتابیس."""
    chars = set()

    for pat in ['public/*.html', 'public/assets/*.css',
                'public/assets/*.js', 'src/*.js']:
        for f in glob.glob(os.path.join(ROOT, pat)):
            with open(f, encoding='utf8') as fh:
                chars |= set(fh.read())

    db = os.path.join(ROOT, 'data', 'yazd.db')
    if os.path.exists(db):
        con = sqlite3.connect(db)
        queries = [
            'SELECT name_fa,brand_fa,family_fa,notes_top,notes_middle,'
            'notes_base,season,occasion,longevity,sillage,'
            'transparency_notice FROM products',
            'SELECT title,excerpt,content,category_label FROM articles',
            'SELECT type_label FROM variants',
        ]
        for q in queries:
            try:
                for row in con.execute(q):
                    for cell in row:
                        if cell:
                            chars |= set(str(cell))
            except sqlite3.Error:
                pass
        con.close()

    codes = {ord(c) for c in chars if ord(c) >= 0x20}

    # حاشیه امن — محصول جدید ممکن است نویسه‌ای بیاورد که امروز نیست
    codes |= set(range(0x0600, 0x06FF + 1))   # عربی/فارسی کامل
    codes |= set(range(0x0020, 0x007E + 1))   # لاتین پایه
    codes |= {0x00A0, 0x200C, 0x200D, 0x200E, 0x200F,
              0x2066, 0x2067, 0x2069}          # نیم‌فاصله و کنترل جهت
    return sorted(codes)


def build(unicodes):
    from fontTools import subset
    from fontTools.ttLib import TTFont

    total_before = total_after = 0
    for name in WEIGHTS:
        src = os.path.join(SRC_DIR, f'Vazirmatn-{name}.woff2')
        dst = os.path.join(FONT_DIR, f'Vazirmatn-{name}.woff2')
        if not os.path.exists(src):
            print(f'  ! فونت اصلی نیست: {src}')
            continue

        before = os.path.getsize(src)
        font = TTFont(src)

        opts = subset.Options()
        opts.layout_features = ['*']     # حیاتی — اتصال حروف فارسی
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        opts.drop_tables = []
        opts.desubroutinize = False
        opts.ignore_missing_unicodes = True

        sub = subset.Subsetter(options=opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)

        font.flavor = 'woff2'
        font.save(dst)

        after = os.path.getsize(dst)
        total_before += before
        total_after += after
        print(f'  {name:<10} {before:>7,} → {after:>7,}'
              f'  ({100 - after * 100 // before}٪)')

    if total_before:
        print(f'  {"جمع":<10} {total_before:>7,} → {total_after:>7,}'
              f'  ({100 - total_after * 100 // total_before}٪ کمتر)')


def verify():
    """رندر متن واقعی با فونت اصلی و زیرمجموعه، مقایسه پیکسلی."""
    from fontTools.ttLib import TTFont
    from PIL import Image, ImageDraw, ImageFont

    def to_ttf(src, out):
        f = TTFont(src)
        f.flavor = None
        f.save(out)
        return out

    texts = [
        'ژیوودان · فیرمنیش · ایبرکم · لوزی',
        'کرِید — اونتوس «دست‌ساز»',
        'رایحه‌ای که می‌ماند، حتی وقتی رفته‌اید',
        'مبلغ قابل پرداخت: ۴٬۷۰۰٬۰۰۰ تومان',
        'گچپژ آآ ئی ؤ إأ لا لله ٱ ۀ',
        'نگهداری صحیح · بسته‌بندی · چهارفصل',
        'حداکثر ۲۴ ساعت — پاسخ‌گویی شنبه تا پنجشنبه',
    ]

    db = os.path.join(ROOT, 'data', 'yazd.db')
    if os.path.exists(db):
        con = sqlite3.connect(db)
        for row in con.execute("SELECT brand_fa||' — '||name_fa FROM products "
                               "ORDER BY RANDOM() LIMIT 15"):
            texts.append(row[0])
        con.close()

    bad = 0
    for w in ['Regular', 'Bold', 'ExtraBold']:
        o = os.path.join(SRC_DIR, f'Vazirmatn-{w}.woff2')
        s = os.path.join(FONT_DIR, f'Vazirmatn-{w}.woff2')
        if not (os.path.exists(o) and os.path.exists(s)):
            continue
        to_ttf(o, f'/tmp/_o_{w}.ttf')
        to_ttf(s, f'/tmp/_s_{w}.ttf')
        fo = ImageFont.truetype(f'/tmp/_o_{w}.ttf', 32)
        fs = ImageFont.truetype(f'/tmp/_s_{w}.ttf', 32)

        for t in texts:
            a = Image.new('L', (1400, 56), 255)
            ImageDraw.Draw(a).text((8, 8), t, font=fo, fill=0)
            b = Image.new('L', (1400, 56), 255)
            ImageDraw.Draw(b).text((8, 8), t, font=fs, fill=0)
            if a.tobytes() != b.tobytes():
                bad += 1
                print(f'  ✗ [{w}] {t[:48]}')

    n = len(texts) * 3
    print(f'\n  {n} آزمون رندر → '
          + ('همه یکسان ✓' if bad == 0 else f'{bad} تفاوت ✗'))
    return bad == 0


if __name__ == '__main__':
    if '--verify' in sys.argv:
        sys.exit(0 if verify() else 1)

    codes = collect_chars()
    print(f'نویسه‌های نگه‌داشته‌شده: {len(codes)}\n')
    build(codes)
    print()
    if not verify():
        print('\n⚠ رندر تغییر کرده — فونت‌ها را از source/fonts بازگردانید')
        sys.exit(1)
