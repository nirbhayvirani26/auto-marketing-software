"""
Product ne DB ma save karvu ane eni images utaarvi.

Sauthi agatya nu kaam: product page ni images ne aapna media store ma
laavvi. Ek var e thai jaay etle AAKHU reel pipeline jem nu tem chale che —
ene khabar j nathi ke image link par thi aavi ke user e upload kari.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId

from ..db import connect, get_db
from ..errors import RetryableError, UserError
from ..logs import log_activity
from ..media import images as imagelib
from ..media.store import save_media
from ..pipeline.http import request_bytes
from .scraper import ScrapedProduct, scrape_many, scrape_product

COLLECTION = "products"

#: Ek product ni ketli image utaarvi. 4 puratu che — reel ma etli j
#: vaparay che ane vadhare utaarvathi fakt vakhat ane jagya bagade che.
MAX_IMAGES = 4

#: Aa thi nani image mota bhage icon/thumbnail hoy che — reel ma dhundhli
#: dekhaay. Etle chhodi daiye chie.
MIN_IMAGE_BYTES = 12_000
MIN_IMAGE_SIDE = 400


def products():
    return get_db()[COLLECTION]


def now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ #
#  Images utaarvi
# ------------------------------------------------------------------ #


@dataclass
class _Candidate:
    """Utaareli image + eni gunvatta — pachi sauthi saari pasand karva mate."""

    url: str
    data: bytes
    width: int
    height: int

    @property
    def smallest_side(self) -> int:
        return min(self.width, self.height)

    @property
    def good_enough(self) -> bool:
        """Reel (1080×1920) ma saaf dekhaay evi che?"""
        return self.smallest_side >= MIN_IMAGE_SIDE and len(self.data) >= MIN_IMAGE_BYTES


async def _fetch_candidate(url: str) -> Optional[_Candidate]:
    """
    Image utaare ane eni maap kaadhe. Kharab hoy to None.

    429/5xx par ek var fari try karie chie. Aa vagar CDN ni ek nani rate
    limit pan aakha product ne "image vagar" banavi de che — ane image
    vagar reel bilkul banti nathi, etle ahiya haar maanvi mongi pade che.
    """
    for attempt in range(2):
        try:
            return _measure(url, await request_bytes(url, timeout=60.0))
        except RetryableError as error:
            if attempt:
                return None
            await asyncio.sleep(error.retry_after or 2.0)
        except Exception:  # noqa: BLE001 — ek image na made to vandho nahi
            return None
    return None


def _measure(url: str, raw: bytes) -> Optional[_Candidate]:
    """Utaareli file kharekhar vaparva layak image che ke nahi."""
    # Sav nanu = icon/spacer/tracking pixel.
    if len(raw) < 3_000:
        return None

    info = imagelib.info(raw)
    if not info:
        return None

    return _Candidate(url=url, data=raw, width=info.width, height=info.height)


async def _store_candidate(
    candidate: _Candidate, brand_id: str, product_title: str
) -> Optional[dict]:
    try:
        # EXIF sidhu karo, moti hoy to nani karo, hamesha JPEG.
        normalised = imagelib.normalise_upload(candidate.data)
    except Exception:  # noqa: BLE001
        return None

    return await save_media(
        normalised,
        mime_type="image/jpeg",
        filename=f"{product_title[:40] or 'product'}.jpg",
        role="product",
        brand_id=brand_id,
        provider="product-link",
        prompt=candidate.url,
        width=candidate.width,
        height=candidate.height,
    )


async def download_product_images(
    product: ScrapedProduct,
    brand_id: str,
    *,
    limit: int = MAX_IMAGES,
) -> list[dict]:
    """
    Product ni images utaare — sathe sathe, pan kram sachvi ne.

    Kram agatya no che: pehli image mota bhage sauthi saari "hero" image
    hoy che, ane reel no hook e j image thi bane che.
    """
    urls = product.images[: limit * 3]  # thodi vadhu — ketlik fail thashe
    if not urls:
        return []

    fetched = await asyncio.gather(
        *(_fetch_candidate(url) for url in urls), return_exceptions=True
    )
    candidates = [c for c in fetched if isinstance(c, _Candidate)]
    if not candidates:
        return []

    # Sauthi saari pehla. Pan jo EK PAN "saari" na hoy, to je che ema thi
    # sauthi moti lai laiye chie — user ne 0 image aapva karta nani image
    # aapvi saari. (Nahi to link aapya pachi pan reel na bane, ane karan
    # pan na samjay.)
    good = [c for c in candidates if c.good_enough]
    pool = good or sorted(candidates, key=lambda c: c.smallest_side, reverse=True)[:limit]

    # Kram sachvo — pehli image mota bhage "hero" hoy che ane reel no hook
    # e j image thi bane che.
    order = {url: index for index, url in enumerate(urls)}
    pool = sorted(pool, key=lambda c: order.get(c.url, 999))[:limit]

    saved: list[dict] = []
    for candidate in pool:
        stored = await _store_candidate(candidate, brand_id, product.title)
        if stored:
            saved.append(stored)

    return saved


# ------------------------------------------------------------------ #
#  Save
# ------------------------------------------------------------------ #


def _url_variants(url: str) -> list[str]:
    """
    E J link na badha lakhvana aakar.

    Save karta pehla `scrape_product()` `https://` lagavi de che, etle DB ma
    hamesha puru URL hoy che. Pan user bije var "myshop.com/p/x" paste kare
    to e DB na "https://myshop.com/p/x" sathe match thavu J joiye — nahi to
    aapne ene navi link samjine site ne fari hit karie chie, ane e j 429 nu
    karan bane che.
    """
    clean = (url or "").strip()
    if not clean:
        return []

    bare = re.sub(r"^https?://", "", clean, flags=re.IGNORECASE).rstrip("/")
    seen: list[str] = []
    for candidate in (clean, clean.rstrip("/"), f"https://{bare}", f"http://{bare}", bare):
        if candidate and candidate not in seen:
            seen.append(candidate)
    return seen


async def save_product(
    product: ScrapedProduct,
    brand_id: str,
    *,
    download_images: bool = True,
) -> dict:
    """
    Product ne save kare (ane e j link fari aave to UPDATE kare).

    Same link be var add thay to be product na bane — e j update thay che.
    """
    await connect()

    image_ids: list[str] = []
    if download_images:
        assets = await download_product_images(product, brand_id)
        image_ids = [str(a["_id"]) for a in assets]

    document = {
        "brand_id": brand_id,
        "url": product.url,
        "title": product.title,
        "description": product.description,
        "price": product.price,
        "currency": product.currency,
        "price_text": product.price_text,
        "brand_name": product.brand,
        "availability": product.availability,
        "site_name": product.site_name,
        "source": product.source,
        "source_images": product.images,
        "updated_at": now(),
    }

    existing = await products().find_one({"brand_id": brand_id, "url": product.url})

    if existing:
        # Navi images madi hoy to j badlo — nahi to juni rehva do.
        if image_ids:
            document["image_ids"] = image_ids
        await products().update_one({"_id": existing["_id"]}, {"$set": document})
        saved = await products().find_one({"_id": existing["_id"]})
    else:
        document["image_ids"] = image_ids
        document["created_at"] = now()
        result = await products().insert_one(document)
        saved = await products().find_one({"_id": result.inserted_id})

    return saved


async def add_links(
    urls: list[str],
    brand_id: str,
    *,
    download_images: bool = True,
) -> dict:
    """
    Ek ke GHANI link ek saathe add karo.

    Ek link kharab hoy to baki ni atkati nathi.
    """
    if not urls:
        raise UserError("Ek pan link na aapi")
    if len(urls) > 25:
        raise UserError("Ek var ma 25 thi vadhare link nahi — thoda thoda karo")

    await connect()

    # ---- Pehle thi che e link ne FARI utaarvi nahi ----
    #
    # Aa sauthi agatya nu che. User e j link fari paste kare (bhoolthi, ke
    # "kai thayu ke nahi" jovaa) e sav svaabhavik che. Dar vakhate site ne
    # fari hit karie to site 429 ("bahu request") aape che — ane pachi
    # KHAREKHAR navi link pan atkai jaay che.
    #
    # Product pehla thi save che ane ena par images pan che, to site ne
    # bilkul hit karvani jarur j nathi — je che e j pachu aapi daiye chie.
    fresh: list[str] = []
    already: list[dict] = []

    for url in urls:
        existing = await products().find_one(
            {"brand_id": brand_id, "url": {"$in": _url_variants(url)}}
        )
        if existing and existing.get("image_ids"):
            already.append(existing)
        else:
            fresh.append(url)

    scraped, failures = await scrape_many(fresh) if fresh else ([], [])

    saved: list[dict] = []
    for product in scraped:
        try:
            saved.append(await save_product(product, brand_id, download_images=download_images))
        except Exception as error:  # noqa: BLE001
            failures.append({"url": product.url, "error": str(error)[:300]})

    no_images = [p["title"] for p in saved if not p.get("image_ids")]

    # Pehle thi hata e pan JAWAB MA aapva j joiye. Nahi to user e j link
    # fari paste kare tyare "0 product add thaya" jevu dekhaay ane ene
    # lage ke kaink bagdyu — jyare kharekhar product hajar j che.
    all_products = already + saved

    await log_activity(
        level="warning" if (failures or no_images) else "success",
        action="products.added",
        message=(
            f"{len(saved)} product add thaya"
            + (f", {len(already)} pehle thi hata" if already else "")
            + (f", {len(failures)} fail" if failures else "")
        ),
        brand_id=brand_id,
    )

    warnings: list[str] = []
    if already:
        titles = ", ".join(str(p.get("title", "?")) for p in already[:3])
        warnings.append(
            f"{len(already)} product pehle thi add thayela hata ({titles}) — "
            "site ne fari nathi puchhyu. Vigat taaji joiti hoy to pehla ene "
            "list mathi kaadho (✕), pachi link fari add karo."
        )
    if no_images:
        warnings.append(
            f"{len(no_images)} product ni image na madi ({', '.join(no_images[:3])}) — "
            "e product ni reel nahi bane. Site e images block kari hase; "
            "e product ni image jate upload karo."
        )

    return {
        "products": [public_view(p) for p in all_products],
        "added": len(saved),
        "existing": len(already),
        "failures": failures,
        # Aa agatya nu che — image vagar reel nahi bane, etle user ne
        # turant khabar padvi joiye.
        "warning": "\n".join(warnings),
    }


# ------------------------------------------------------------------ #
#  Read
# ------------------------------------------------------------------ #


async def list_products(brand_id: str, limit: int = 100) -> list[dict]:
    await connect()
    return [
        public_view(doc)
        async for doc in products()
        .find({"brand_id": brand_id})
        .sort("created_at", -1)
        .limit(limit)
    ]


async def get_product(product_id: Any, brand_id: str) -> Optional[dict]:
    await connect()
    try:
        oid = ObjectId(str(product_id))
    except Exception:  # noqa: BLE001
        return None
    return await products().find_one({"_id": oid, "brand_id": brand_id})


async def get_products(product_ids: list[Any], brand_id: str) -> list[dict]:
    """User e aapel KRAM ma pacha aape."""
    await connect()
    oids = []
    for value in product_ids:
        try:
            oids.append(ObjectId(str(value)))
        except Exception:  # noqa: BLE001
            continue
    if not oids:
        return []

    found = {
        doc["_id"]: doc
        async for doc in products().find({"_id": {"$in": oids}, "brand_id": brand_id})
    }
    return [found[oid] for oid in oids if oid in found]


async def delete_product(product_id: Any, brand_id: str) -> bool:
    await connect()
    try:
        oid = ObjectId(str(product_id))
    except Exception:  # noqa: BLE001
        return False
    result = await products().delete_one({"_id": oid, "brand_id": brand_id})
    return result.deleted_count > 0


def public_view(doc: dict) -> dict:
    """API/UI mate saaf object."""
    image_ids = [str(i) for i in (doc.get("image_ids") or [])]
    return {
        "id": str(doc["_id"]),
        "url": doc.get("url"),
        "title": doc.get("title"),
        "description": (doc.get("description") or "")[:400],
        "price": doc.get("price"),
        "currency": doc.get("currency"),
        "price_text": doc.get("price_text"),
        "brand_name": doc.get("brand_name"),
        "availability": doc.get("availability"),
        "site_name": doc.get("site_name"),
        "source": doc.get("source"),
        "image_ids": image_ids,
        "image_urls": [f"/api/media/{i}" for i in image_ids],
        "image_count": len(image_ids),
        "created_at": doc.get("created_at"),
    }


async def ensure_indexes() -> None:
    await connect()
    # Ek j link be var na aave.
    await products().create_index([("brand_id", 1), ("url", 1)], unique=True)
    await products().create_index([("brand_id", 1), ("created_at", -1)])
