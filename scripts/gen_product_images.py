#!/usr/bin/env python3
"""
تولید تصاویر محصول — عطر یزد

مسئله:
    ۲٬۱۰۶ محصول فقط ۱۰ تصویر داشتند. ۵۱۹ عطر گلی دقیقاً یک عکس
    مشترک داشتند، پس کاتالوگ شبیه ده کارت تکراری پشت سر هم بود.

راه‌حل:
    برای هر «خانواده بویایی × جنسیت» چند واریانت بصری می‌سازیم و
    محصولات را به‌صورت پایدار (بر پایه هش شناسه) بینشان پخش می‌کنیم.
    پایدار یعنی هر محصول همیشه همان تصویر را می‌گیرد — با هر بار
    اجرا عوض نمی‌شود و کش مرورگر و گوگل خراب نمی‌شود.

قواعد بصری ثابت (زبان مشترک برند):
    • بطری همیشه بی‌نام و بی‌برچسب — هیچ متن یا لوگویی
    • نور پخش پنجره شمالی، سایه نرم
    • مدیوم فرمت، ۱۰۰ میلی‌متر ماکرو، عمق میدان کم
    • ترکیب مربع با فضای خالی سخاوتمندانه
    • آرام، گران، مینیمال — الهام از By Kilian و Penhaligon's

چرا بطری بی‌برچسب:
    محصولات ما بازآفرینی دست‌سازند، نه اصل. نمایش بطری برند اصلی
    گمراه‌کننده و از نظر حقوقی پرخطر است. بطری خنثی صادقانه است.

اجرا:
    python3 scripts/gen_product_images.py --plan     # فقط نقشه
    python3 scripts/gen_product_images.py --check    # کمبودها
"""

import argparse
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "images", "products")

# ─────────────────────────────────────────────
#  زبان بصری مشترک
# ─────────────────────────────────────────────

STYLE_HEAD = (
    "Luxury perfume product photography, editorial still life. "
    "A single unbranded glass perfume bottle, centered. "
    "Completely blank bottle — absolutely no text, no logo, no lettering, "
    "no label, no engraving of any kind. "
)

STYLE_TAIL = (
    " Diffused north-window light, gentle shadow falloff, subtle rim light "
    "along the glass edge. Shallow depth of field. "
    "Shot on medium format, 100mm macro, f/4. "
    "Refined, expensive, minimal, calm. Square composition with generous "
    "negative space around the bottle. No people, no hands, no brand marks."
)


# ─────────────────────────────────────────────
#  صحنه‌ها: خانواده بویایی × جنسیت
# ─────────────────────────────────────────────
# هر ورودی چند واریانت دارد تا صدها محصول یک عکس نگیرند.

SCENES = {
    # ── گلی ── بزرگ‌ترین گروه (۵۱۹ زنانه) — بیشترین واریانت
    ("floral", "WOMEN"): [
        "Bottle with soft rounded shoulders and brushed champagne-gold cap. "
        "Powdery blush and dusty rose palette. Pale pink peony petals and a "
        "magnolia bloom on raw silk. Background smooth blush-to-cream gradient.",

        "Tall slender bottle with a pale rose-gold collar. Ivory garden roses "
        "and loose petals scattered on cream linen. Soft morning haze, "
        "background warm ivory with a faint pink cast.",

        "Faceted clear bottle, thin gold neck ring. Sprigs of white jasmine and "
        "orange blossom across pale grey-lilac stone. Cool soft light, "
        "background muted mauve.",

        "Rounded bottle with matte ceramic-white cap. Dried hydrangea and "
        "powder-pink ranunculus on brushed plaster surface. Airy, chalky "
        "pastel palette, background soft eggshell.",

        # ── دور دوم: ۵۱۹ عطر گلی زنانه با ۴ تصویر یعنی هر عکس ۱۳۴ بار.
        #    شش صحنه تازه با دمای رنگ متفاوت اضافه شد تا فهرست
        #    یکنواخت نباشد؛ دو تای آخر عمداً تیره‌اند.
        "Clean upright rectangular bottle in pale champagne glass with a slim "
        "polished gold cap. Violet and lilac blossoms with dried lavender stems "
        "on pale grey-blue silk. Cool refined palette, background smooth "
        "periwinkle-to-pearl gradient.",

        "Upright opaline cream bottle with a soft gold cap. White gardenia "
        "blooms and glossy green leaves on deep emerald velvet. Dramatic soft "
        "light, background dark forest green.",

        "Slim upright clear bottle with a pale blush cap. A cherry blossom "
        "branch and scattered sakura petals on bleached light wood. High-key "
        "airy light, background luminous white with a warm pink cast.",

        "Upright frosted grey-white bottle with a brushed silver cap. Dried "
        "iris root and candied violet petals on pale taupe suede. Muted "
        "powdery palette, background soft stone grey.",

        "Upright clear bottle with a matte white cap. Lily-of-the-valley sprigs "
        "and dewy green leaves on white marble. Crisp fresh light, background "
        "cool bright white.",

        "Upright faceted bottle with a dark antique-gold cap. Deep crimson "
        "garden roses and fallen petals on burgundy silk. Rich low chiaroscuro "
        "light, background deep wine red.",
    ],
    ("floral", "UNISEX"): [
        "Clean cylindrical bottle with silver-grey cap. White freesia and green "
        "stems on pale concrete. Neutral cool light, background soft grey.",
    ],
    ("floral", "MEN"): [
        "Angular bottle with gunmetal cap. Dark red rose and dried eucalyptus "
        "on slate. Moody directional light, background deep charcoal-green.",
    ],

    # ── شرقی/عنبری ── ۳۹۲ یونیسکس + ۱۳۱ مردانه
    ("ambery-oriental", "UNISEX"): [
        "Amber-tinted glass bottle with an antique brass cap. Resin chunks, "
        "dried amber beads and vanilla pods on dark walnut wood. Warm low "
        "candle-like light, background deep amber-brown.",

        "Squat rounded bottle in honey-gold glass, bronze cap. Cinnamon bark, "
        "star anise and tonka beans on aged parchment. Golden hour warmth, "
        "background burnt sienna.",

        "Tall amber bottle with a dark wooden cap. Frankincense resin and dried "
        "labdanum on textured clay. Smoky atmosphere, single warm light, "
        "background muted terracotta.",

        "Faceted cognac-colored bottle, matte gold collar. Vanilla orchid and "
        "benzoin resin on dark velvet. Rich chiaroscuro lighting, background "
        "near-black with amber glow.",

        # ── دور دوم: ۳۹۲ محصول روی ۴ تصویر خیلی زیاد بود
        "Upright ruby-amber glass bottle with a polished gold cap. Saffron "
        "threads and myrrh resin tears on dark red-brown lacquer. Warm "
        "jewel-toned light, background deep garnet.",

        "Upright deep bronze glass bottle with a matte black cap. Dried rose "
        "buds and oud wood chips on brushed copper. Metallic warm reflections, "
        "background dark copper-brown.",

        "Upright smoky topaz bottle with a matte gold cap. Incense resin and "
        "dried musk pods on grey-brown stone, a thin ribbon of smoke rising. "
        "Soft hazy light, background warm ash grey.",

        "Upright golden honey-toned bottle with a warm brass cap. Honeycomb "
        "and dried apricots on aged linen. Glowing amber light, background "
        "soft wheat gold.",
    ],
    ("ambery-oriental", "MEN"): [
        "Heavy rectangular bottle in smoked topaz glass with a blackened brass "
        "cap. Tobacco leaf, dried figs and oud chips on scorched oak. Dramatic "
        "side light, background deep espresso brown.",

        "Broad-shouldered dark amber bottle, bronze cap. Pipe tobacco, cocoa "
        "nibs and dried plum on worn leather. Low warm light, background "
        "burnt umber.",

        "Upright heavy bottle in near-black glass with a gunmetal cap. Charred "
        "cedar, black amber resin and dried clove on dark iron. Hard low "
        "sidelight, background near-black with a bronze rim glow.",
    ],

    # ── چوبی ── ۲۶۷ مردانه + ۱۳۲ یونیسکس
    ("woody", "MEN"): [
        "Broad rectangular bottle in smoke-grey glass with a matte black cap. "
        "Cedar planks, vetiver roots and dried moss on rough granite. Cool "
        "directional light with hard-edged shadow, background charcoal.",

        "Heavy squared bottle, dark walnut wooden cap. Sandalwood shavings and "
        "black peppercorns on dark slate. Low contrast moody light, background "
        "deep graphite.",

        "Cylindrical bottle in olive-tinted glass, brushed steel cap. Cypress "
        "sprigs and birch bark on weathered driftwood. Overcast diffused light, "
        "background cool stone grey.",

        "Tall angular bottle, dark bronze cap. Oud wood chips and dry patchouli "
        "leaves on cracked dark earth. Single dramatic light beam, background "
        "near-black brown.",

        # ── دور دوم: ۲۶۷ محصول
        "Upright rectangular bottle in deep forest-green glass with a black "
        "wooden cap. Pine needles and cracked cedar bark on wet dark stone. "
        "Cool damp light, background deep pine green.",

        "Upright cylindrical bottle in warm smoke glass with an aged copper "
        "cap. Guaiac wood shavings and dried tonka pods on burnt oak. Warm "
        "amber sidelight, background dark tobacco brown.",
    ],
    ("woody", "UNISEX"): [
        "Softly rounded bottle in pale smoke glass with a light oak cap. Cedar "
        "curls and dried sage on pale ash wood. Bright even light, background "
        "warm greige.",

        "Slim bottle, pale birch cap. Vetiver grass and grey lichen on raw "
        "linen. Soft airy light, background muted sand.",

        "Upright rounded bottle in warm honey glass with a pale ash cap. "
        "Sandalwood blocks and dried vetiver root on woven jute. Warm even "
        "light, background soft camel beige.",
    ],

    # ── آروماتیک/تازه ── ۲۶۲ مردانه + ۱۳۱ یونیسکس
    ("aromatic-fresh", "MEN"): [
        "Clean-lined bottle in cool blue-grey glass with a polished chrome cap. "
        "Rosemary, juniper berries and sea salt crystals on wet slate. Crisp "
        "bright daylight, background cool steel blue.",

        "Angular clear bottle, matte silver cap. Lavender stems and cracked "
        "black pepper on pale grey stone. Sharp clean light, background "
        "misty blue-grey.",

        "Tall clear bottle with a brushed aluminium cap. Mint leaves and "
        "eucalyptus on cold marble with water droplets. Bright cool light, "
        "background icy white-blue.",

        # ── دور دوم: ۲۶۲ محصول
        "Upright squared bottle in deep navy glass with a matte navy cap. "
        "Sea kelp, driftwood and coarse salt on dark wet basalt. Overcast "
        "coastal light, background deep ocean blue-grey.",

        "Upright slim bottle in pale ice-blue glass with a polished steel cap. "
        "Green apple slices and thyme sprigs on frosted glass. Crisp high-key "
        "light, background clean pale aqua.",
    ],
    ("aromatic-fresh", "UNISEX"): [
        "Simple cylindrical clear bottle, soft white cap. Basil and green "
        "cardamom on pale sea-glass surface. Fresh diffused light, background "
        "soft aqua-white.",

        "Rounded clear bottle, pale grey cap. Green fig leaves and dew on "
        "smooth pebbles. Clean natural light, background soft mint-grey.",

        "Upright clear bottle with a pale sage cap. Rosemary, olive branch and "
        "lemon verbena on warm terracotta tile. Mediterranean sunlight, "
        "background sun-warmed clay.",
    ],

    # ── مرکباتی ── ۱۳۱ یونیسکس
    ("citrus", "UNISEX"): [
        "Bright clear bottle with a pale gold cap. Bergamot and blood orange "
        "slices with green leaves on white marble. Sunlit high-key light, "
        "background luminous warm white.",

        "Slim clear bottle, lemon-gold collar. Yuzu, lime zest and neroli "
        "blossom on pale travertine. Sharp sunny light with crisp shadows, "
        "background sunlit cream.",

        "Upright clear bottle with a pale green cap. Mandarin segments, petitgrain "
        "leaves and green cardamom on cool white ceramic. Bright airy light, "
        "background luminous pale citrine.",
    ],
    ("citrus", "MEN"): [
        "Angular clear bottle with a steel cap. Grapefruit halves and cedar "
        "sprig on cool grey stone. Bright contrasty light, background "
        "cool pale grey.",
    ],

    # ── میوه‌ای/گورماند ── ۱۲۹ یونیسکس
    ("fruity-gourmand", "UNISEX"): [
        "Rounded bottle in warm peach-tinted glass with a soft gold cap. Fresh "
        "figs, pear slices and honeycomb on warm cream ceramic. Soft golden "
        "light, background warm apricot.",

        "Squat bottle in caramel glass, bronze cap. Dark cherries, praline and "
        "vanilla pods on rich chocolate-brown surface. Warm intimate light, "
        "background deep cocoa.",

        "Upright bottle in soft rose-caramel glass with a matte cream cap. "
        "Fresh raspberries, almond praline and a vanilla pod on pale pink "
        "marble. Soft sweet light, background warm blush cream.",
    ],
    ("fruity-gourmand", "MEN"): [
        "Rectangular bottle in deep amber glass, dark cap. Blackcurrant, dried "
        "pineapple and birch on dark wood. Warm directional light, background "
        "deep bronze-brown.",
    ],
    ("fruity-gourmand", "WOMEN"): [
        "Soft rounded bottle in rose-peach glass with gold cap. Raspberries, "
        "lychee and sugared petals on blush silk. Sweet soft light, background "
        "warm rose-cream.",
    ],

    # ── چرمی ──
    ("leather", "UNISEX"): [
        "Sturdy rectangular bottle in tobacco-brown glass with an aged brass "
        "cap. Tanned leather hide, suede swatch and dried tobacco on dark oak. "
        "Warm moody light, background rich saddle brown.",
    ],

    # ── شیپر ──
    ("chypre", "MEN"): [
        "Classic faceted bottle in deep green glass with an antique gold cap. "
        "Oakmoss, bergamot peel and patchouli on dark green marble. Refined "
        "low light, background deep forest green.",
    ],
}

# پشتیبان: اگر ترکیبی در SCENES نبود، از این استفاده می‌شود
FALLBACK = [
    "Elegant clear glass bottle with a soft gold cap on pale neutral stone, "
    "a few dried botanicals nearby. Calm diffused light, background warm greige."
]


def slug_for(family: str, gender: str, idx: int) -> str:
    """نام فایل — پایدار و قابل حدس"""
    g = {"MEN": "m", "WOMEN": "w", "UNISEX": "u"}.get(gender, "u")
    return f"fam-{family}-{g}-{idx + 1}"


def prompt_for(family: str, gender: str, idx: int) -> str:
    variants = SCENES.get((family, gender), FALLBACK)
    return STYLE_HEAD + variants[idx % len(variants)] + STYLE_TAIL


def build_plan(db_rows):
    """
    نقشه تولید: برای هر ترکیب موجود در دیتابیس، چند واریانت لازم است.
    """
    plan = []
    for r in db_rows:
        fam, gen, n = r["family_slug"], r["gender"], r["n"]
        variants = SCENES.get((fam, gen), FALLBACK)
        for i in range(len(variants)):
            plan.append({
                "slug": slug_for(fam, gen, i),
                "family": fam,
                "gender": gen,
                "variant": i,
                "covers": n // len(variants),
                "prompt": prompt_for(fam, gen, i),
            })
    return plan


def assign_image(product_id: str, family: str, gender: str) -> str:
    """
    انتخاب پایدار تصویر برای یک محصول.

    از هش شناسه استفاده می‌شود، نه شماره ردیف — پس اگر محصولی
    اضافه یا حذف شد، تصویر بقیه عوض نمی‌شود.
    """
    variants = SCENES.get((family, gender), FALLBACK)
    h = int(hashlib.md5(product_id.encode()).hexdigest()[:8], 16)
    idx = h % len(variants)
    return f"/images/products/{slug_for(family, gender, idx)}.jpg"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true", help="نمایش نقشه تولید")
    ap.add_argument("--check", action="store_true", help="بررسی فایل‌های موجود")
    ap.add_argument("--todo", action="store_true", help="فقط تصاویر ساخته‌نشده")
    args = ap.parse_args()

    # خواندن ترکیب‌ها از دیتابیس با node
    import subprocess
    out = subprocess.run(
        ["node", "-e",
         "const {db}=require('./src/db');"
         "console.log(JSON.stringify(db.prepare("
         "'SELECT family_slug,gender,COUNT(*) n FROM products "
         "GROUP BY family_slug,gender ORDER BY n DESC').all()))"],
        cwd=ROOT, capture_output=True, text=True)
    rows = None
    for l in out.stdout.splitlines():
        l = l.strip()
        if l.startswith("[") and l.endswith("]"):
            try:
                rows = json.loads(l)      # خط لاگ [DB] هم با [ شروع می‌شود
                break
            except json.JSONDecodeError:
                continue
    if rows is None:
        print("خطا در خواندن دیتابیس:", out.stdout, out.stderr)
        sys.exit(1)

    plan = build_plan(rows)

    if args.todo:
        missing = [p for p in plan
                   if not os.path.exists(os.path.join(OUT_DIR, p["slug"] + ".jpg"))]
        print(f"\n  {len(missing)} تصویر باقی مانده:\n")
        for m in missing:
            print(f"  ── {m['slug']}  (~{m['covers']} محصول)")
            print(f"     {m['prompt']}\n")
        sys.exit(0)

    if args.check:
        missing = [p for p in plan
                   if not os.path.exists(os.path.join(OUT_DIR, p["slug"] + ".jpg"))]
        print(f"مجموع تصاویر لازم: {len(plan)}")
        print(f"موجود: {len(plan) - len(missing)}")
        print(f"کم: {len(missing)}")
        for m in missing:
            print("   -", m["slug"])
        sys.exit(0 if not missing else 1)

    # نقشه
    print(f"\n  نقشه تولید تصاویر — {len(plan)} تصویر برای {sum(r['n'] for r in rows)} محصول\n")
    for p in plan:
        print(f"  {p['slug']:34s} ~{p['covers']:4d} محصول")
    print()
    with open(os.path.join(ROOT, "scripts", "image_plan.json"), "w",
              encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)
    print("  نقشه در scripts/image_plan.json ذخیره شد.\n")


if __name__ == "__main__":
    main()
