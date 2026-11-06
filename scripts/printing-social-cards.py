"""Create exact-text 1200×630 printing cards and two honest category illustrations.

Run: python scripts/printing-social-cards.py
Requires Pillow with RAQM and Inkscape (for code-native SVG graphics).
Existing catalog photos are placed whole; this script does not crop, retouch,
repaint or generate photographs. The notebook/keychain photos were extracted
faithfully from the approved gift-set photo using the built-in image_gen tool.
No request attachments, proofs, order details, contact screenshots or prices are
used. The two illustrative products are explicitly labeled inside the artwork.
Only this script's named outputs are written; older social cards are untouched.
"""

from io import BytesIO
from pathlib import Path
import json
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont, ImageOps, features


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUT = PUBLIC / "social"
MEDIA = PUBLIC / "media/printing"
FONTS = ROOT / "scripts/fonts"
SCALE = 2
WIDTH, HEIGHT = 1200, 630
CREAM = "#f7f3e9"
PAPER = "#fffdf7"
GREEN = "#193f35"
MUTED = "#69776b"
SAGE = "#e2e9d8"
TERRA = "#a95036"
LINE = "#dcded0"
PHOTO_LABEL = "نموذج من منتجات المتجر"
ILLUSTRATION_LABEL = "رسم توضيحي للتخصيص"

# Provenance for the two new photo assets: built-in image_gen edit calls, with
# public/media/printing/memorycraft-gift-set.webp as the inspected edit target.
# Kept here for reproducibility; running this script never invokes image_gen.
PHOTO_EDIT_PROMPTS = {
    "memorycraft-notebook.webp": "Use case: precise-object-edit. Asset type: standalone e-commerce product photograph. Input image is the edit target: the real blue/burgundy FC Barcelona gift-set photograph. Isolate ONLY the tall spiral notebook at the upper right into a portrait 4:5 standalone image. Remove the mug, coaster and keychain. Keep the exact notebook, cover print, lettering FC BARCELONA and MÉS QUE UN CLUB, crest, blue and burgundy colors, perspective, right-side black spiral binding and all proportions unchanged. Keep the existing white faux-fur tabletop and white brick wall backdrop from the photo. Product fully visible, not cropped, modest neutral padding. This is a faithful product extraction, not a new design. Do not invent new merchandise, details, text, branding or logos. No hands, people, UI, watermarks, labels or borders.",
    "memorycraft-keychain.webp": "Use case: precise-object-edit. Asset type: standalone e-commerce product photograph. Input image is the edit target: the real blue/burgundy FC Barcelona gift-set photograph. Isolate ONLY the rectangular keychain in the lower right into a square standalone product image. Keep the exact existing rectangular printed keychain, gold ring and connecting chain, blue and burgundy striped artwork, FC Barcelona crest, BARÇA lettering, football graphic and all proportions unchanged. Remove the mug, notebook and coaster. Keep the original soft white faux-fur background, matched natural light, keychain lying at the same angle. Entire ring, chain and rectangle fully visible with modest padding. Faithful product extraction, not a new product or design. Do not invent new features, print, labels, text, logos, hands, people or packaging.",
}

PRODUCTS = {
    "memorycraft-mug": ("مج بتصميمك", ["صورة، اسم أو فكرة", "على مج تختاره."], "memorycraft-mug.webp"),
    "memorycraft-tshirt": ("تيشيرت بتصميمك", ["اختار المقاس واللون،", "وابعت فكرتك للطباعة."], "memorycraft-tshirt-illustration.webp"),
    "memorycraft-puzzle": ("بازل بصورتك", ["صورتك تتحول لبازل", "بتفاصيل تختارها."], "memorycraft-puzzle-illustration.webp"),
    "memorycraft-frame": ("برواز بصورة مخصصة", ["خلّي صورتك هدية", "في برواز على ذوقك."], "memorycraft-frame.webp"),
    "memorycraft-notebook": ("نوت بوك بتصميمك", ["اسمك أو تصميمك", "على غلاف نوت بوك."], "memorycraft-notebook.webp"),
    "memorycraft-keychain": ("ميدالية مخصصة", ["اسم أو صورة أو شعار", "في ميدالية مخصوص."], "memorycraft-keychain.webp"),
    "memorycraft-desk-sign": ("لوحة مكتبية بستاند", ["عبارة أو صورة تختارها", "على لوحة لمكتبك."], "memorycraft-desk-sign.webp"),
    "memorycraft-baby-set": ("طقم مولود بالاسم", ["اسم المولود وتصميمك", "على طقم مميز."], "memorycraft-baby-set.webp"),
    "memorycraft-gift-set": ("طقم هدايا متناسق", ["فكرة واحدة تجمع", "قطع هديتك."], "memorycraft-gift-set.webp"),
}


def font(size, weight=700):
    return ImageFont.truetype(str(FONTS / f"Cairo-{weight}.ttf"), round(size * SCALE), layout_engine=ImageFont.Layout.RAQM)


def rect(draw, box, fill, radius=0, outline=None, width=1):
    coords = tuple(round(v * SCALE) for v in box)
    if radius:
        draw.rounded_rectangle(coords, radius=round(radius * SCALE), fill=fill, outline=outline, width=round(width * SCALE))
    else:
        draw.rectangle(coords, fill=fill, outline=outline, width=round(width * SCALE))


def text(draw, x, y, value, size=28, color=GREEN, weight=700, rtl=True, anchor=None):
    draw.text((round(x * SCALE), round(y * SCALE)), value, font=font(size, weight), fill=color,
              direction="rtl" if rtl else "ltr", anchor=anchor or ("rt" if rtl else "lt"))


def measure(value, size=28, weight=700, rtl=True):
    return font(size, weight).getlength(value, direction="rtl" if rtl else "ltr") / SCALE


def fit_size(value, maximum, size, minimum=20, weight=700, rtl=True):
    while size > minimum and measure(value, size, weight, rtl) > maximum:
        size -= 1
    if measure(value, size, weight, rtl) > maximum:
        raise ValueError(f"Text does not fit: {value}")
    return size


def pill(draw, right, top, label, fill=SAGE, color=GREEN, size=21):
    w = measure(label, size) + 32
    rect(draw, (right - w, top, right, top + 44), fill, 22)
    text(draw, right - 16, top + 8, label, size, color)


def line(draw, box, color=LINE, width=1):
    draw.line(tuple(round(v * SCALE) for v in box), fill=color, width=round(width * SCALE))


def svg_image(source, size):
    command = shutil.which("inkscape")
    if not command:
        raise RuntimeError("Inkscape is required to render the existing icon and code-native illustrations")
    result = subprocess.run([command, "--pipe", "--export-type=png", "--export-filename=-",
                             f"--export-width={size[0]}", f"--export-height={size[1]}"],
                            input=source.encode("utf-8"), capture_output=True, check=True)
    return Image.open(BytesIO(result.stdout)).convert("RGBA")


def paste_whole(canvas, photo, box, border=10, bg=PAPER):
    """A complete unchanged photograph in a mat, with proportional scaling only."""
    d = ImageDraw.Draw(canvas)
    x, y, w, h = box
    rect(d, (x, y + 5, x + w, y + h + 5), "#dedbcf", 22)
    rect(d, (x, y, x + w, y + h), bg, 22)
    source = Image.open(photo).convert("RGB") if isinstance(photo, (str, Path)) else photo.convert("RGB")
    fitted = ImageOps.contain(source, (round((w - 2 * border) * SCALE), round((h - 2 * border) * SCALE)), Image.Resampling.LANCZOS)
    canvas.paste(fitted, (round((x + w / 2) * SCALE - fitted.width / 2), round((y + h / 2) * SCALE - fitted.height / 2)))


def base():
    im = Image.new("RGB", (WIDTH * SCALE, HEIGHT * SCALE), CREAM)
    d = ImageDraw.Draw(im)
    rect(d, (0, 0, 600, 630), "#e9e2d3")
    rect(d, (0, 0, 600, 12), GREEN)
    rect(d, (600, 0, 1200, 12), "#cf9d76")
    return im, d


def platform_footer(im, label="على جوّه"):
    d = ImageDraw.Draw(im)
    line(d, (634, 544, 1148, 544))
    im.paste(JOWWA_ICON, (1112 * SCALE, 567 * SCALE), JOWWA_ICON)
    text(d, 1098, 567, label, 24, GREEN)
    text(d, 634, 577, "JOWWA", 15, MUTED, rtl=False)


def cta(draw, label="شوف التفاصيل وابدأ طلبك", top=448):
    width = measure(label, 25) + 72
    left = 1148 - width
    rect(draw, (left, top, 1148, top + 62), GREEN, 16)
    text(draw, 1128, top + 14, label, 25, PAPER)
    line(draw, (left + 20, top + 31, left + 35, top + 31), PAPER, 2)
    line(draw, (left + 20, top + 31, left + 26, top + 25), PAPER, 2)
    line(draw, (left + 20, top + 31, left + 26, top + 37), PAPER, 2)


def save_card(im, name):
    target = OUT / name
    output = im.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    output.save(target, "PNG", optimize=True)
    assert output.size == (1200, 630)
    return target


def product_card(key, product):
    title, description, filename = product
    im, d = base()
    paste_whole(im, MEDIA / filename, (34, 36, 532, 514), border=12)
    illustration = "-illustration" in filename
    text(d, 566, 575, ILLUSTRATION_LABEL if illustration else PHOTO_LABEL, 22, MUTED, 400)
    pill(d, 1148, 49, "طباعة على قطعة")
    text(d, 1148, 122, "MemoryCraft", 34, GREEN, 800, rtl=False, anchor="rt")
    text(d, 1148, 171, "ميموري كرافت", 22, MUTED, 400)
    title_size = fit_size(title, 514, 52, minimum=42, weight=800)
    text(d, 1148, 231, title, title_size, GREEN, 800)
    for i, value in enumerate(description):
        text(d, 1148, 326 + i * 44, value, 29, MUTED, 400)
    cta(d)
    platform_footer(im)
    return save_card(im, f"printing-product-{key}-card.png")


SHIRT_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="960" height="960" viewBox="0 0 960 960">
<rect width="960" height="960" fill="#f5f0e5"/>
<circle cx="490" cy="410" r="330" fill="#e2e9d8"/>
<ellipse cx="480" cy="750" rx="265" ry="27" fill="#d4dbc9"/>
<path d="M334 162 L214 230 L121 411 L241 474 L302 372 L302 734 Q480 759 658 734 L658 372 L719 474 L839 411 L746 230 L626 162 L568 146 Q559 221 480 223 Q401 221 392 146 Z" fill="#fffdf7" stroke="#244a3c" stroke-width="10" stroke-linejoin="round"/>
<path d="M392 146 Q401 221 480 223 Q559 221 568 146" fill="none" stroke="#244a3c" stroke-width="15"/>
<path d="M314 709 Q480 727 646 709 M140 391 L251 449 M709 449 L820 391" fill="none" stroke="#ccd6c3" stroke-width="6"/>
<rect x="368" y="320" width="224" height="242" rx="20" fill="#e7eddc" stroke="#73916c" stroke-width="3" stroke-dasharray="10 9"/>
<rect x="409" y="359" width="142" height="112" rx="10" fill="#fffdf7" stroke="#244a3c" stroke-width="5"/>
<circle cx="513" cy="391" r="13" fill="#cc9169"/>
<path d="M411 448 L449 407 L477 438 L496 419 L549 464 L411 464 Z" fill="#9caf89"/>
<path d="M716 152 L716 192 M696 172 L736 172 M215 598 L215 630 M199 614 L231 614" stroke="#b56b43" stroke-width="5" stroke-linecap="round"/>
</svg>"""

PUZZLE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="960" height="960" viewBox="0 0 960 960">
<rect width="960" height="960" fill="#f5f0e5"/>
<circle cx="478" cy="406" r="327" fill="#e2e9d8"/>
<rect x="182" y="187" width="600" height="530" rx="32" fill="#cfd7c5"/>
<rect x="172" y="170" width="600" height="530" rx="32" fill="#fffdf7" stroke="#244a3c" stroke-width="8"/>
<clipPath id="panel"><rect x="188" y="186" width="568" height="498" rx="20"/></clipPath>
<g clip-path="url(#panel)">
<rect x="188" y="186" width="568" height="498" fill="#ecdfbd"/>
<circle cx="623" cy="286" r="59" fill="#c88655"/>
<path d="M188 566 L355 350 L490 507 L575 408 L756 578 V684 H188Z" fill="#9aa889"/>
<path d="M188 615 L359 497 L511 624 L620 541 L756 622 V684 H188Z" fill="#466c55"/>
<g fill="none" stroke="#fffdf7" stroke-width="7" stroke-linecap="round">
<path d="M378 186 V303 C345 284 337 349 378 336 V448 C413 434 420 490 378 479 V684"/>
<path d="M568 186 V345 C603 327 612 389 568 378 V530 C531 512 522 578 568 566 V684"/>
<path d="M188 351 H278 C260 315 319 308 308 351 H470 C455 387 516 393 503 351 H756"/>
<path d="M188 518 H319 C299 554 364 563 350 518 H619 C603 481 670 480 655 518 H756"/>
</g></g>
<path d="M797 452 L797 492 M777 472 L817 472 M139 315 L139 347 M123 331 L155 331" stroke="#b56b43" stroke-width="5" stroke-linecap="round"/>
</svg>"""

PAPER_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
<rect width="800" height="800" fill="#e9e2d3"/>
<circle cx="400" cy="391" r="290" fill="#dbe4d1"/>
<g transform="rotate(-8 400 410)"><rect x="192" y="131" width="407" height="539" rx="22" fill="#cbd6c0" stroke="#8c9f80" stroke-width="3"/></g>
<g transform="rotate(7 400 410)"><rect x="204" y="121" width="407" height="539" rx="22" fill="#eaf0df" stroke="#b3c3a6" stroke-width="3"/></g>
<rect x="196" y="110" width="407" height="539" rx="22" fill="#fffdf7" stroke="#244a3c" stroke-width="5"/>
<path d="M515 111 V191 H602" fill="#e2e9d8" stroke="#244a3c" stroke-width="5" stroke-linejoin="round"/>
<rect x="239" y="160" width="112" height="62" rx="13" fill="#244a3c"/>
<rect x="239" y="267" width="186" height="14" rx="7" fill="#244a3c"/>
<rect x="239" y="307" width="318" height="10" rx="5" fill="#a7b79c"/>
<rect x="239" y="337" width="288" height="10" rx="5" fill="#a7b79c"/>
<rect x="239" y="367" width="309" height="10" rx="5" fill="#a7b79c"/>
<rect x="239" y="422" width="318" height="148" rx="12" fill="#e7eddc"/>
<rect x="263" y="494" width="42" height="52" rx="5" fill="#91a77c"/>
<rect x="320" y="465" width="42" height="81" rx="5" fill="#c68d62"/>
<rect x="377" y="445" width="42" height="101" rx="5" fill="#244a3c"/>
<rect x="434" y="478" width="42" height="68" rx="5" fill="#91a77c"/>
<rect x="491" y="455" width="42" height="91" rx="5" fill="#c68d62"/>
<path d="M644 260 L644 300 M624 280 L664 280 M154 513 L154 545 M138 529 L170 529" stroke="#b56b43" stroke-width="5" stroke-linecap="round"/>
</svg>"""


def illustrations():
    outputs = []
    for name, source in (("memorycraft-tshirt-illustration.webp", SHIRT_SVG),
                         ("memorycraft-puzzle-illustration.webp", PUZZLE_SVG)):
        im = svg_image(source, (960 * SCALE, 960 * SCALE)).convert("RGB")
        d = ImageDraw.Draw(im)
        if "tshirt" in name:
            text(d, 480, 493, "تصميمك", 34, GREEN, 700, anchor="mt")
        else:
            rect(d, (340, 730, 620, 792), PAPER, 24)
            text(d, 480, 740, "صورتك هنا", 35, GREEN, 700, anchor="mt")
        text(d, 480, 855, ILLUSTRATION_LABEL, 35, MUTED, 700, anchor="mt")
        path = MEDIA / name
        im.resize((960, 960), Image.Resampling.LANCZOS).save(path, "WEBP", quality=94, method=6)
        outputs.append(path)
    return outputs


def paper_art():
    im = svg_image(PAPER_SVG, (800 * SCALE, 800 * SCALE)).convert("RGB")
    d = ImageDraw.Draw(im)
    text(d, 295, 169, "PDF", 33, PAPER, 800, rtl=False, anchor="mt")
    return im


def memorycraft_card():
    im, d = base()
    paste_whole(im, MEDIA / "memorycraft-mug.webp", (32, 57, 324, 430), border=8)
    paste_whole(im, MEDIA / "memorycraft-baby-set.webp", (370, 40, 198, 266), border=7)
    paste_whole(im, MEDIA / "memorycraft-desk-sign.webp", (370, 324, 198, 224), border=7)
    text(d, 566, 575, PHOTO_LABEL, 22, MUTED, 400)
    pill(d, 1148, 49, "هدايا وطباعة على منتجات")
    text(d, 1148, 140, "MemoryCraft", 59, GREEN, 800, rtl=False, anchor="rt")
    text(d, 1148, 223, "ميموري كرافت", 29, MUTED, 700)
    text(d, 1148, 298, "هدايا بتصميمك", 49, GREEN, 800)
    text(d, 1148, 374, "مجّات، لوحات وأطقم مخصصة.", 28, MUTED, 400)
    cta(d, "شوف صفحة المتجر")
    platform_footer(im, "متجر على جوّه")
    return save_card(im, "printing-memorycraft-card.png")


def paper_card():
    im, d = base()
    art = paper_art().resize((568 * SCALE, 568 * SCALE), Image.Resampling.LANCZOS)
    im.paste(art, (16 * SCALE, 19 * SCALE))
    text(d, 566, 575, "رسم توضيحي لخدمة طباعة الملفات", 22, MUTED, 400)
    pill(d, 1148, 49, "طباعة ملفات PDF")
    text(d, 1148, 148, "خدمة طباعة", 61, GREEN, 800)
    text(d, 1148, 231, "الورق", 61, GREEN, 800)
    text(d, 1148, 335, "ارفع ملفك وحدد النسخ.", 29, MUTED, 400)
    text(d, 1148, 381, "أبيض وأسود أو ألوان.", 29, MUTED, 400)
    cta(d, "شوف الخدمة وابدأ طلبك")
    platform_footer(im, "مقدم خدمة على جوّه")
    return save_card(im, "printing-paper-card.png")


def market_card():
    im, d = base()
    art = paper_art()
    paste_whole(im, art, (32, 62, 260, 399), border=8)
    paste_whole(im, MEDIA / "memorycraft-mug.webp", (308, 144, 260, 399), border=8)
    pill(d, 281, 479, "طباعة ورق", fill=PAPER, size=21)
    pill(d, 556, 75, "هدايا بتصميمك", fill=PAPER, size=21)
    text(d, 566, 575, "ورق · منتجات · طباعة مخصصة", 22, MUTED, 400)
    pill(d, 1148, 49, "سوق جوّه")
    text(d, 1148, 143, "المكتبات", 67, GREEN, 800)
    text(d, 1148, 233, "والطباعة", 67, GREEN, 800)
    text(d, 1148, 343, "اختار المكتبة أو المتجر،", 29, MUTED, 400)
    text(d, 1148, 389, "وكمل طلبك خطوة بخطوة.", 29, MUTED, 400)
    cta(d, "استكشف المكتبات والطباعة")
    platform_footer(im)
    return save_card(im, "printing-market-card.png")


if __name__ == "__main__":
    if not features.check("raqm"):
        raise RuntimeError("Pillow with RAQM is required for exact Arabic shaping")
    OUT.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((PUBLIC / "data/printing-catalog.json").read_text("utf-8"))
    known = {product["id"] for product in catalog["products"]}
    if set(PRODUCTS) != known:
        raise ValueError("Update the explicit reviewed product-card map when the source catalog changes")
    JOWWA_ICON = svg_image((PUBLIC / "icon.svg").read_text("utf-8"), (36 * SCALE, 36 * SCALE))
    files = illustrations()
    files += [product_card(key, value) for key, value in PRODUCTS.items()]
    files += [memorycraft_card(), paper_card(), market_card()]
    for file in files:
        print(f"{file.relative_to(ROOT)}  {file.stat().st_size:,} bytes")
