"""
Image na kaam — Pillow thi.

Ahiya badhu ek jagya e rakhyu che: nani karvi, EXIF pramane sidhi karvi,
JPEG ma badalvi, reel na 9:16 ma kaapvi. Aakha app ma image sathe je pan
kaam thay e ahiya thi j pasar thay che.
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from typing import Optional

from PIL import Image, ImageOps

# Bahu moti image sathe kaam karta memory bhara jaay — Pillow ni
# "decompression bomb" chetavni ne limit ma rakhie chie.
Image.MAX_IMAGE_PIXELS = 200_000_000


@dataclass
class ImageInfo:
    width: int
    height: int
    format: str


def load(data: bytes) -> Image.Image:
    """
    Bytes ne Pillow image ma badle.

    `exif_transpose` — phone na photo ma rotation EXIF ma hoy che; e na
    lagavie to reel ma photo aado dekhay che.
    """
    image = Image.open(io.BytesIO(data))
    image = ImageOps.exif_transpose(image)
    return image


def info(data: bytes) -> Optional[ImageInfo]:
    try:
        with Image.open(io.BytesIO(data)) as image:
            return ImageInfo(image.width, image.height, (image.format or "").lower())
    except Exception:  # noqa: BLE001
        return None


def is_image(data: bytes) -> bool:
    return info(data) is not None


def to_rgb(image: Image.Image) -> Image.Image:
    """
    JPEG ma save karva mate RGB joiye.

    PNG ni paardarshaktа (alpha) hoy to safed background par mukie chie —
    nahi to kaalu dekhay che.
    """
    if image.mode in ("RGB",):
        return image
    if image.mode in ("RGBA", "LA", "P"):
        converted = image.convert("RGBA")
        background = Image.new("RGB", converted.size, (255, 255, 255))
        background.paste(converted, mask=converted.split()[-1])
        return background
    return image.convert("RGB")


def encode_jpeg(image: Image.Image, quality: int = 90) -> bytes:
    buffer = io.BytesIO()
    to_rgb(image).save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def resize_within(data: bytes, max_side: int, quality: int = 88) -> bytes:
    """
    Image ne `max_side` ni andar besaadi ne JPEG banave.
    Aspect ratio jem che em rahe che.
    """
    image = load(data)
    image.thumbnail((max_side, max_side), Image.LANCZOS)
    return encode_jpeg(image, quality)


def normalise_upload(data: bytes, max_side: int = 4000) -> bytes:
    """
    Upload thayeli image ne saaf karvi:
      • EXIF rotation lagavo
      • 4000px thi moti hoy to nani karo (render ghano fast thay)
      • hamesha JPEG (ffmpeg ane Meta banne ne aa game che)
    """
    image = load(data)
    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side), Image.LANCZOS)
    return encode_jpeg(image, quality=92)


def cover_crop(data: bytes, width: int, height: int, quality: int = 92) -> bytes:
    """
    Image ne barabar `width`×`height` ma kaape — vachhe thi, kai khenchay nahi.
    Reel na 1080×1920 mate.
    """
    image = to_rgb(load(data))
    fitted = ImageOps.fit(image, (width, height), method=Image.LANCZOS, centering=(0.5, 0.45))
    buffer = io.BytesIO()
    fitted.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def to_base64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def prepare_for_vision(data: bytes, max_side: int = 1024) -> tuple[str, str]:
    """
    Vision model ne aapva mate image taiyar kare.

    1024px puratu che — vadhu moklvathi fakt token ane bandwidth vadhe che,
    jawab sudhrto nathi. Sathe HEIC/WebP jeva format JPEG ma badli daiye
    chie jethi badha provider samje.

    Return: (base64, mime_type)
    """
    try:
        return to_base64(resize_within(data, max_side, quality=82)), "image/jpeg"
    except Exception:  # noqa: BLE001
        # Pillow na samje evu format — jem che em mokli daiye.
        return to_base64(data), "application/octet-stream"


def make_solid(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    """Test ane placeholder mate saadi image."""
    return encode_jpeg(Image.new("RGB", (width, height), color))
