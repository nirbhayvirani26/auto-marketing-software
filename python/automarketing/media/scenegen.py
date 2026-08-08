"""
Product ne NAVA BACKGROUND ma mukvu — "alag alag angle ane bg" vali images.

⚠️ PEHLA AA VANCHO — kem aa rite karie chie:

Sidhu AI ne kahie "aa product ni navi image banavo" to AI product ne
BADLI naakhe che. Jewellery ma to e ghaatak che — diamond ni sankhya,
setting, gold no rang badhu badlai jaay. Pachi grahak ne biju j male,
ane e tamari brand nu nuksaan che.

Etle aapne aa rite karie chie:
   1. TAMARI ASLI product image — jem ni tem, ek pixel badlaya vagar
   2. Eno safed background kaadhi naakhie
   3. AI pase FAKT BACKGROUND banavaie (marble, silk, phool...)
   4. Banne ne bhega karie — sathe naram pdchhayo

Result: product 100% saacho, background sundar ane navu. Ane page par
ni dareak angle ni image mate alag background — etle "alag alag angle
ane bg" bane che.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from PIL import Image, ImageChops, ImageFilter

from ..pipeline.chain import Candidate, run_chain
from . import images as imagelib
from .imagegen import DIMENSIONS, AspectRatio, _pollinations


@dataclass
class Scene:
    data: bytes
    width: int
    height: int
    backdrop: str
    angle: int


# ------------------------------------------------------------------ #
#  1. Safed background kaadhvo
# ------------------------------------------------------------------ #


def cutout(
    image_bytes: bytes,
    *,
    tolerance: int = 26,
    feather: float = 1.2,
) -> Optional[Image.Image]:
    """
    Product ni image mathi SAFED background kaadhi ne RGBA aape.

    Product photo lagbhag hamesha safed/aachhaa background par hoy che,
    etle aa saral rit ghani saari chale che ane koi AI ni jarur nathi.

    Kaam kai rite thay che:
      • image na CHAAR khune jouine background no rang nakki karie chie
      • e rang thi jetlu male e paardarshak banavie chie
      • kinara ne halka karie chie (feather) — nahi to kaapelu dekhaay

    Product pote safed hoy (dakhla: moti) to aa bhool kari shake — etle
    ketlo bhaag kapayo e joine, bahu vadhu kapay to `None` aapie chie
    (tyare juni image j vaparvi saari).
    """
    try:
        image = imagelib.to_rgb(imagelib.load(image_bytes)).convert("RGB")
    except Exception:  # noqa: BLE001
        return None

    width, height = image.size
    if width < 80 or height < 80:
        return None

    # Khune no rang = background no rang.
    patch = 8
    corners = [
        image.crop((0, 0, patch, patch)),
        image.crop((width - patch, 0, width, patch)),
        image.crop((0, height - patch, patch, height)),
        image.crop((width - patch, height - patch, width, height)),
    ]
    samples = [c.resize((1, 1), Image.LANCZOS).getpixel((0, 0)) for c in corners]
    background = tuple(sum(channel) // len(samples) for channel in zip(*samples))

    # Background bahu ghero hoy to e product no j bhaag hase — chhodi do.
    if sum(background) / 3 < 150:
        return None

    # Dareak pixel background thi ketlo door che.
    flat = Image.new("RGB", image.size, background)
    distance = ImageChops.difference(image, flat).convert("L")

    # ⚠️ AHIYA SAUTHI AGATYA NI VAAT:
    #
    # "Je pixel safed hoy e badha kaadhi naakho" em karie to JEWELLERY
    # ma HEERA PAN KAPAI JAAY che — e pan safed j hoy che. (Aa bhool
    # pehla thai hati: heera ma kaana padi gaya hata.)
    #
    # Saacho niyam: background KINARA SATHE JODAYELU hoy che. Heera
    # sona thi gherayelo hoy che, etle kinara thi tya pahonchi j na
    # shakay. Etle fakt KINARA THI JODAYELO bhaag j kaadhie chie.
    mask = _border_connected_mask(distance, tolerance)

    # Nana daag saaf karo, pachi kinara naram karo.
    mask = mask.filter(ImageFilter.MedianFilter(3))
    mask = mask.filter(ImageFilter.GaussianBlur(feather))

    kept = sum(mask.point(lambda v: 1 if v > 128 else 0).getdata())
    ratio = kept / (width * height)

    # Bahu ochhu bachyu (product j kapai gayu) ke bahu vadhu bachyu
    # (background kapayo j nahi) — banne kissa ma aa rit kaam ni nathi.
    if ratio < 0.02 or ratio > 0.92:
        return None

    result = image.convert("RGBA")
    result.putalpha(mask)
    return result.crop(result.getbbox() or (0, 0, width, height))



def _border_connected_mask(distance: Image.Image, tolerance: int) -> Image.Image:
    """
    Fakt KINARA SATHE JODAYELO background kaadhe.

    Kaam ni rit — "flood fill", jem paint no dabbo dhole:
      • image ni chaaro baaju ni kinari thi shuru karie chie
      • tya thi jetlu "background jevu" male tetlu bharta jaie chie
      • product ni andar (heera, kaana) tya thi pahonchi j nathi shakatu

    Speed mate nani image par kaam karie chie (500px) ane pachi moti
    karie chie — kinara to pachhi blur j thavana che, etle farak nathi
    padto ane 10 gunu fast thay che.
    """
    from collections import deque

    original = distance.size
    work = distance.copy()
    work.thumbnail((500, 500), Image.NEAREST)
    width, height = work.size
    pixels = list(work.getdata())

    # True = "aa background jevu che"
    similar = [value <= tolerance for value in pixels]

    # Kinari na badha background-jeva pixel thi shuru.
    queue = deque()
    reached = bytearray(width * height)

    def push(index: int) -> None:
        if not reached[index] and similar[index]:
            reached[index] = 1
            queue.append(index)

    for x in range(width):
        push(x)                              # uper ni kinari
        push((height - 1) * width + x)       # niche ni kinari
    for y in range(height):
        push(y * width)                      # dabi kinari
        push(y * width + width - 1)          # jamni kinari

    while queue:
        index = queue.popleft()
        x, y = index % width, index // width
        if x > 0:
            push(index - 1)
        if x < width - 1:
            push(index + 1)
        if y > 0:
            push(index - width)
        if y < height - 1:
            push(index + width)

    # reached = background (0), baki badhu product (255)
    small = Image.frombytes(
        "L", (width, height), bytes(0 if r else 255 for r in reached)
    )
    return small.resize(original, Image.BILINEAR)


# ------------------------------------------------------------------ #
#  2. Background banavvu (AI)
# ------------------------------------------------------------------ #

#: Jewellery/luxury mate chalta backgrounds. Dareak scene ne alag male
#: che, etle badhi images sarkhi nathi lagti.
BACKDROPS = [
    "polished white marble surface with soft window light and gentle shadows, luxury product photography backdrop, no objects",
    "soft champagne silk fabric folds, warm diffused light, elegant luxury backdrop, no objects",
    "warm beige studio backdrop with a soft light gradient and subtle vignette, minimal, no objects",
    "dark charcoal slate surface with a single soft spotlight, dramatic luxury backdrop, no objects",
    "cream linen texture with dried flowers blurred in the background, soft natural light, no objects",
    "pale pink pastel gradient backdrop with soft studio lighting, minimal and clean, no objects",
]


async def make_backdrop(prompt: str, aspect: AspectRatio = "4:5") -> bytes:
    """
    FAKT background banave — product nahi.

    Prompt ma "no objects" lakhelu che jaani joine: AI ne kai vastu
    banavvani nathi, fakt saari jagya. Product aapne pote mukvana chie.
    """
    result = await run_chain(
        [
            Candidate(
                name="pollinations",
                label="Pollinations (koi key nahi)",
                run=lambda: _pollinations(prompt, aspect, None),
                timeout=240.0,
            )
        ],
        label="Background image",
        retries=2,
        backoff=2.0,
    )
    return result.data.data


# ------------------------------------------------------------------ #
#  3. Bhega karvu
# ------------------------------------------------------------------ #


def compose(
    product: Image.Image,
    backdrop_bytes: bytes,
    *,
    size: tuple[int, int],
    scale: float = 0.62,
    center: tuple[float, float] = (0.5, 0.52),
    shadow: bool = True,
) -> bytes:
    """
    Kaapela product ne background par mukhe — naram pdchhaya sathe.

    Pdchhayo agatya no che: ena vagar product "chontadelu" lage che,
    jaane photoshop ma chipkavyu hoy. Naram pdchhayo hoy to e kharekhar
    tya mukelu lage che.
    """
    width, height = size

    canvas = imagelib.to_rgb(imagelib.load(backdrop_bytes))
    canvas = canvas.resize(size, Image.LANCZOS) if canvas.size != size else canvas
    canvas = canvas.convert("RGBA")

    # Product ne besti maap ma laavo.
    target_width = int(width * scale)
    ratio = target_width / product.width
    target_height = int(product.height * ratio)
    if target_height > height * 0.78:
        target_height = int(height * 0.78)
        target_width = int(product.width * (target_height / product.height))

    item = product.resize((max(1, target_width), max(1, target_height)), Image.LANCZOS)

    x = int(width * center[0] - item.width / 2)
    y = int(height * center[1] - item.height / 2)

    if shadow:
        # Pdchhayo = product no j aakar, kaalo, dhundhlo, thodo niche.
        blur = max(8, item.width // 22)
        shade = Image.new("RGBA", (item.width + blur * 4, item.height + blur * 4), (0, 0, 0, 0))
        shade.paste((0, 0, 0, 105), (blur * 2, blur * 2), item)
        shade = shade.filter(ImageFilter.GaussianBlur(blur))
        canvas.alpha_composite(
            shade, (x - blur * 2, y - blur * 2 + int(item.height * 0.055))
        )

    canvas.alpha_composite(item, (x, y))
    return imagelib.encode_jpeg(canvas.convert("RGB"), quality=92)


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #


async def build_scenes(
    product_images: list[bytes],
    *,
    count: int = 3,
    size: str = "portrait",
    aspect: AspectRatio = "4:5",
) -> tuple[list[Scene], list[str]]:
    """
    Product ni images mathi `count` navi "scene" images banave —
    dareak ALAG angle ane ALAG background sathe.

    Pacho aave che: (banela scenes, chetavni)
    """
    from .postimage import SIZES

    dimensions = SIZES.get(size, SIZES["portrait"])
    warnings: list[str] = []

    # Kaya angle vaparva layak che (jena background kapai shakya).
    usable: list[tuple[int, Image.Image]] = []
    for index, raw in enumerate(product_images):
        cut = cutout(raw)
        if cut is not None:
            usable.append((index, cut))
        if len(usable) >= count:
            break

    if not usable:
        warnings.append(
            "Product no background kaapi na shakayo (image safed background par "
            "nathi lagti). Etle nava background vali image na bani — asli "
            "image j vaparai che."
        )
        return [], warnings

    if len(usable) < count:
        warnings.append(
            f"{count} ma thi {len(usable)} angle j vaparva layak hata "
            "(bija ni background kapai na shaki)."
        )

    scenes: list[Scene] = []
    for slot, (angle_index, cut) in enumerate(usable):
        prompt = BACKDROPS[slot % len(BACKDROPS)]
        try:
            backdrop = await make_backdrop(prompt, aspect)
        except Exception as error:  # noqa: BLE001
            warnings.append(f"Background {slot + 1} na banyu: {str(error)[:100]}")
            continue

        # Dareak scene ma product ni jagya ane maap thodu alag — badhi
        # images ek j saanchaa ni na lage.
        scale = (0.62, 0.54, 0.68)[slot % 3]
        center = ((0.5, 0.52), (0.5, 0.48), (0.5, 0.55))[slot % 3]

        scenes.append(
            Scene(
                data=compose(cut, backdrop, size=dimensions, scale=scale, center=center),
                width=dimensions[0],
                height=dimensions[1],
                backdrop=prompt.split(",")[0],
                angle=angle_index,
            )
        )

    return scenes, warnings
