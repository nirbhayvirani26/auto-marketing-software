"""
Feed post ni image banavvi — reel ni sathe sathe.

Reel scroll ma dekhaay che, pan FEED POST profile par kayam rahe che ane
log tya thi j product jue che. Etle banne joiye.

Instagram na feed mate **4:5 (1080×1350)** sauthi saru che — e sauthi
vadhu jagya roke che, etle scroll ma sauthi motu dekhaay che.

Product ni image mota bhage chorasa ke safed background vali hoy che.
Ene jem ni tem mukie to 4:5 ma khali jagya rahe. Etle:
   pachhal — e j image, dhundhli ane thodi kaali (jagya bharay che)
   aagal   — asli image, vachhe, puri dekhaay evi
Aa "professional" lage che ane product no koi bhaag kapato nathi.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..video.fonts import resolve_font, script_for_language
from . import images as imagelib

#: Instagram feed na maap.
SIZES = {
    "portrait": (1080, 1350),  # 4:5 — sauthi saru, sauthi moti jagya
    "square": (1080, 1080),  # 1:1
    "story": (1080, 1920),  # 9:16
}


@dataclass
class PostImage:
    data: bytes
    width: int
    height: int
    label: str


def _fit_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except Exception:  # noqa: BLE001
        return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    """Text ne aapel pahodai ma besaade — shabd tutya vagar."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            continue
        current = words[0]
        for word in words[1:]:
            trial = f"{current} {word}"
            if draw.textlength(trial, font=font) <= max_width:
                current = trial
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def build_post_image(
    product_image: bytes,
    *,
    size: str = "portrait",
    headline: str = "",
    sub: str = "",
    language: str = "en",
    accent: tuple[int, int, int] = (222, 184, 135),
) -> PostImage:
    """
    Ek feed-ready post image banave.

    `headline` aapo to uper moto text mukay che. Khali rakho to fakt
    saaf product image male che (jewellery/luxury mate mota bhage e j
    saru lage che — text vagar).
    """
    width, height = SIZES.get(size, SIZES["portrait"])

    source = imagelib.to_rgb(imagelib.load(product_image))

    # ---- Pachhal: e j image, bhari ne, dhundhli ----
    background = source.copy()
    scale = max(width / background.width, height / background.height) * 1.15
    background = background.resize(
        (int(background.width * scale), int(background.height * scale)), Image.LANCZOS
    )
    left = (background.width - width) // 2
    top = (background.height - height) // 2
    background = background.crop((left, top, left + width, top + height))
    background = background.filter(ImageFilter.GaussianBlur(radius=width // 22))

    # Thodu kaalu — aagal nu product ane text ubhu dekhaay.
    background = Image.blend(background, Image.new("RGB", (width, height), (0, 0, 0)), 0.18)

    canvas = background
    draw = ImageDraw.Draw(canvas)

    margin = int(width * 0.07)
    font_path = resolve_font(script_for_language(language))

    # ---- Pehla TEXT ni jagya maapo, PACHI product mukho ----
    # (Ulto karie to product text par chadhi jaay che — pehla aa j bhool
    #  hati ane image ma banne bhega dekhata hata.)
    head_lines: list[str] = []
    sub_lines: list[str] = []
    head_font = sub_font = None
    head_line_height = sub_line_height = 0

    if headline:
        head_font = _fit_font(font_path, int(width * 0.068))
        head_lines = _wrap(draw, headline.upper(), head_font, width - margin * 2)[:2]
        head_line_height = int(width * 0.082)

    if sub:
        sub_font = _fit_font(font_path, int(width * 0.038))
        sub_lines = _wrap(draw, sub, sub_font, width - margin * 2)[:2]
        sub_line_height = int(width * 0.050)

    top_pad = int(height * 0.030)
    head_block = len(head_lines) * head_line_height
    sub_block = len(sub_lines) * sub_line_height

    # Text ni niche/uper thodi have jagya — chipkelu na lage.
    gap = int(height * 0.022) if head_lines else 0
    bottom_pad = int(height * 0.030) if sub_lines else int(height * 0.02)

    product_top = top_pad + head_block + gap
    product_space = height - product_top - sub_block - bottom_pad

    # ---- Aagal: asli product ----
    product = source.copy()
    product.thumbnail((int(width * 0.88), max(100, product_space)), Image.LANCZOS)

    # Bacheli jagya ma vachhe gothvo.
    paste_y = product_top + max(0, (product_space - product.height) // 2)
    canvas.paste(product, ((width - product.width) // 2, paste_y))

    # ---- Have text lakho (product ni uper) ----
    y = top_pad
    for line in head_lines:
        text_width = draw.textlength(line, font=head_font)
        x = (width - text_width) / 2
        # Kaalo pdchhayo — safed background par pan text vanchay.
        draw.text((x + 2, y + 3), line, font=head_font, fill=(0, 0, 0))
        draw.text((x, y), line, font=head_font, fill=(255, 255, 255))
        y += head_line_height

    y = height - bottom_pad - sub_block
    for line in sub_lines:
        text_width = draw.textlength(line, font=sub_font)
        x = (width - text_width) / 2
        draw.text((x + 1, y + 2), line, font=sub_font, fill=(0, 0, 0))
        draw.text((x, y), line, font=sub_font, fill=accent)
        y += sub_line_height

    return PostImage(
        data=imagelib.encode_jpeg(canvas, quality=92),
        width=width,
        height=height,
        label=size,
    )


def build_post_set(
    product_images: list[bytes],
    *,
    headline: str = "",
    sub: str = "",
    language: str = "en",
    size: str = "portrait",
    limit: int = 10,
) -> list[PostImage]:
    """
    CAROUSEL mate ghani image.

    Pehli image par j headline mukie chie — badhi par mukie to carousel
    kachru lage che ane swipe karvani majaa jati rahe.
    """
    out: list[PostImage] = []
    for index, raw in enumerate(product_images[:limit]):
        try:
            out.append(
                build_post_image(
                    raw,
                    size=size,
                    headline=headline if index == 0 else "",
                    sub=sub if index == 0 else "",
                    language=language,
                )
            )
        except Exception:  # noqa: BLE001 — ek image kharab hoy to baki chalu rahe
            continue
    return out
