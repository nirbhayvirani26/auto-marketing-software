"""
Product LINK na routes.

"Image upload karo" ni jagya e "link paste karo" — baki badhu e j pipeline
ma jaay che. Ek saathe ghani link pan chale che.
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..errors import UserError
from ..products import add_links, delete_product, get_products, list_products
from ..reels.generate import GenerateInput
from ..reels.runner import start_reel_job
from .deps import current_brand, fail, ok

router = APIRouter(prefix="/api", tags=["products"])


#: "shop.example.com/products/abc" jevu — http ke www vagar pan.
#: Domain ma ochha ma ochho ek dot ane 2+ akshar nu TLD hovu joiye, jethi
#: sadho lakhan ("diamond-ring-copy") bhoolthi link tarike na gansay.
_LOOKS_LIKE_URL = re.compile(
    r"^(?:https?://)?(?:[\w-]+\.)+[a-z]{2,}(?:[:/?#]|$)",
    re.IGNORECASE,
)


def _split_links(raw: str | list[str]) -> list[str]:
    """
    User gme te rite link aape — ek line ma, comma thi, ke ek pachi ek.
    Badhu sambhali laiye chie.

    `http` ke `www.` FARJIYAT NATHI — log mota bhage address bar mathi
    copy kare che ane Chrome `https://` batavtu nathi, etle "myshop.com/..."
    j paste thay che. Ene reject karie to user ne kai samjatu nathi ke
    su khotu che. `scrape_product()` `https://` jate lagavi de che.
    """
    if isinstance(raw, list):
        text = "\n".join(str(r) for r in raw)
    else:
        text = str(raw or "")

    parts = re.split(r"[\s,;]+", text)
    return [p.strip() for p in parts if p.strip() and _LOOKS_LIKE_URL.match(p.strip())]


class AddLinksBody(BaseModel):
    #: Ek link, ghani link, ke aakho text jema link hoy.
    links: str | list[str]
    download_images: bool = True


@router.post("/products")
async def add_product_links(body: AddLinksBody, brand: dict = Depends(current_brand)):
    """
    Website ni product link(s) add karo.

    Naam, kimat, varnan ane IMAGES apoaap aavi jashe. Pachi e product ni
    reel banavi shakay — image upload karvani jarur j nathi.
    """
    links = _split_links(body.links)
    if not links:
        # User ne EXACTLY su malyu e batavvu — "khoti link" kehvathi kai
        # samjatu nathi. Mota bhage e product nu naam ke aadho URL hoy che.
        got = str(body.links if isinstance(body.links, str) else " ".join(body.links))
        sample = got.strip().replace("\n", " ")[:80]
        return fail(
            "Aa link nathi lagti:\n"
            f'  "{sample}"\n\n'
            "Product page ni POORI link joiye — dakhla tarike:\n"
            "  https://tamaristore.com/products/diamond-ring\n\n"
            "Browser na address bar mathi aakhi link copy karo (fakt product nu "
            "naam ke link no chhello bhaag na chale).\n"
            "Ghani link ek saathe mukvi hoy to ek pachi ek line ma paste karo.",
            422,
        )

    result = await add_links(
        links, str(brand["_id"]), download_images=body.download_images
    )

    if not result["products"]:
        return fail(
            "Ek pan link mathi product na madyu.\n"
            + "\n".join(f"• {f['url'][:60]}: {f['error'][:120]}" for f in result["failures"][:5]),
            422,
        )

    return ok(result, 201)


@router.get("/products")
async def get_product_list(brand: dict = Depends(current_brand)):
    return ok(await list_products(str(brand["_id"])))


@router.delete("/products/{product_id}")
async def remove_product(product_id: str, brand: dict = Depends(current_brand)):
    if not await delete_product(product_id, str(brand["_id"])):
        return fail("Product madyu nahi", 404)
    return ok({"deleted": True})


# ------------------------------------------------------------------ #
#  Product thi reel
# ------------------------------------------------------------------ #


class ProductReelBody(BaseModel):
    #: Ek ke ghana product. Ghana hoy to ek j "collection" reel banse.
    product_ids: list[str] = Field(min_length=1, max_length=10)
    target_duration: int = Field(default=30, ge=15, le=90)
    language: str = "en"
    voiceover: bool = False
    avatar_id: Optional[str] = None
    tone: Optional[str] = None
    #: Reel taiyar thay ke turant post kari devu?
    auto_publish: bool = False
    #: now | auto | draft
    publish_when: str = "draft"


@router.post("/products/reel")
async def make_reel_from_products(
    body: ProductReelBody, brand: dict = Depends(current_brand)
):
    """
    Product ni LINK thi seedhu reel.

    Product ni images pehla thi utarayeli che, etle e j reel pipeline ma
    jaay che — vision એne joine product samje che, script lakhe che,
    video banave che, ane caption ma product ni link mukay che.
    """
    brand_id = str(brand["_id"])
    products = await get_products(body.product_ids, brand_id)

    if not products:
        return fail("Ek pan product madyu nahi", 404)

    # Badha product ni images bhegi karo — kram sachvi ne.
    image_ids: list[str] = []
    without_images: list[str] = []
    for product in products:
        ids = [str(i) for i in (product.get("image_ids") or [])]
        if ids:
            # Ek product ni badhi image na naakho — nahi to ek j product
            # aakhi reel bhari de. Collection reel ma dareak ne vaaro joiye.
            image_ids.extend(ids[:2] if len(products) > 1 else ids[:4])
        else:
            without_images.append(product.get("title", "?"))

    if not image_ids:
        return fail(
            "Aa product ni ek pan image na madi, etle reel na bani shake.\n"
            "Site e images block kari hase — e product ni image jate upload karo "
            "(Reel Studio tab ma).",
            422,
        )

    # Product ni vigat AI ne aapiye chie — e caption ne vadhu sachot banave.
    first = products[0]
    hint_parts = []
    for product in products[:5]:
        bits = [product.get("title", "")]
        if product.get("price_text"):
            bits.append(product["price_text"])
        if product.get("description"):
            bits.append(product["description"][:200])
        hint_parts.append(" — ".join(b for b in bits if b))

    result = await start_reel_job(
        GenerateInput(
            brand_id=brand_id,
            image_asset_ids=image_ids,
            mode="multi" if len(products) > 1 else "single",
            target_duration=body.target_duration,
            language=body.language,
            voiceover=body.voiceover,
            avatar_id=body.avatar_id,
            tone=body.tone,
            hint="\n".join(hint_parts),
            price=first.get("price_text", ""),
            product_url=first.get("url", ""),
            product_id=str(first["_id"]),
            auto_distribute=(
                {
                    "account_ids": [],
                    "when": body.publish_when,
                    "hashtags_in_first_comment": True,
                }
                if body.auto_publish
                else None
            ),
        )
    )

    return ok(
        {
            **result,
            "poll_url": f"/api/studio/jobs/{result['job_id']}",
            "products": [p.get("title") for p in products],
            "image_count": len(image_ids),
            "warning": (
                f"Aa product ni image na madi: {', '.join(without_images)}"
                if without_images
                else ""
            ),
        },
        202,
    )


# ------------------------------------------------------------------ #
#  Feed post ni image (reel ni sathe — profile par kayam rahe che)
# ------------------------------------------------------------------ #


class PostImageBody(BaseModel):
    product_ids: list[str] = Field(min_length=1, max_length=10)
    #: portrait (4:5, sauthi saru) | square | story
    size: str = "portrait"
    #: Image par moto text. Khali rakho to fakt saaf product image.
    headline: str = ""
    sub: str = ""
    language: str = "en"


@router.post("/products/post-image")
async def make_post_images(body: PostImageBody, brand: dict = Depends(current_brand)):
    """
    Feed post ni image(s) banave — download karva layak.

    Reel scroll ma dekhaay che, pan feed post PROFILE PAR KAYAM rahe che.
    Etle banne joiye.
    """
    from ..media.postimage import build_post_set
    from ..media.store import public_view, read_bytes, save_media
    from ..media.store import get_assets

    brand_id = str(brand["_id"])
    products = await get_products(body.product_ids, brand_id)
    if not products:
        return fail("Ek pan product madyu nahi", 404)

    # Badha product ni images bhegi karo.
    asset_ids: list[str] = []
    for product in products:
        asset_ids.extend(str(i) for i in (product.get("image_ids") or []))

    if not asset_ids:
        return fail(
            "Aa product ni ek pan image nathi, etle post image na bani shake.",
            422,
        )

    assets = await get_assets(asset_ids)
    raw_images = [await read_bytes(a) for a in assets]

    built = build_post_set(
        raw_images,
        headline=body.headline,
        sub=body.sub,
        language=body.language,
        size=body.size,
    )
    if not built:
        return fail("Post image na bani shaki — images kharab lage che.", 422)

    saved = []
    for index, image in enumerate(built):
        asset = await save_media(
            image.data,
            mime_type="image/jpeg",
            filename=f"post-{products[0].get('title', 'product')[:30]}-{index + 1}.jpg",
            role="generated",
            brand_id=brand_id,
            provider="post-image",
            width=image.width,
            height=image.height,
        )
        saved.append(public_view(asset))

    return ok(
        {
            "images": saved,
            "size": body.size,
            "count": len(saved),
            "note": (
                "Dareak image download kari shakay che. Instagram feed mate "
                "4:5 (portrait) sauthi saru — e sauthi moti jagya roke che."
            ),
        },
        201,
    )


# ------------------------------------------------------------------ #
#  AI STUDIO — ek j click ma badhu
# ------------------------------------------------------------------ #


class AiPackBody(BaseModel):
    product_ids: list[str] = Field(min_length=1, max_length=5)
    #: Ketli scene images (alag angle + alag AI background).
    image_count: int = Field(default=3, ge=1, le=6)
    #: Video pan banavvo?
    make_video: bool = True
    video_duration: int = Field(default=30, ge=15, le=90)
    language: str = "en"
    voiceover: bool = False


@router.post("/products/ai-pack")
async def build_ai_pack(body: AiPackBody, brand: dict = Depends(current_brand)):
    """
    Product ni LINK thi — AI badhu banavi aape:

      • `image_count` post images — TAMARO ASLI product, pan dareak ma
        ALAG angle ane ALAG AI-banavelu background
      • ek reel (video)
      • caption + hashtags (reel na job ma)

    ⚠️ Product ne AI THI FARI NATHI BANAVTA — e jaani joine. AI product
    ne badli naakhe che (heera/setting badlai jaay), ane pachi grahak ne
    biju j male. Etle product tamaro ASLI rakhie chie ane AI pase fakt
    BACKGROUND banavaie chie.
    """
    from ..media.scenegen import build_scenes
    from ..media.store import get_assets, public_view, read_bytes, save_media

    brand_id = str(brand["_id"])
    products = await get_products(body.product_ids, brand_id)
    if not products:
        return fail("Ek pan product madyu nahi", 404)

    asset_ids: list[str] = []
    for product in products:
        asset_ids.extend(str(i) for i in (product.get("image_ids") or []))

    if not asset_ids:
        return fail(
            "Aa product ni ek pan image nathi. Link fari add karo, ke image "
            "jate upload karo.",
            422,
        )

    assets = await get_assets(asset_ids)
    raw_images = [await read_bytes(a) for a in assets]

    # ---- 1. Scene images (asli product + AI background) ----
    scenes, warnings = await build_scenes(
        raw_images, count=body.image_count, size="portrait", aspect="4:5"
    )

    saved_images = []
    for index, scene in enumerate(scenes, 1):
        asset = await save_media(
            scene.data,
            mime_type="image/jpeg",
            filename=f"ai-{products[0].get('title', 'product')[:26]}-{index}.jpg",
            role="generated",
            brand_id=brand_id,
            provider="scenegen",
            prompt=scene.backdrop,
            width=scene.width,
            height=scene.height,
        )
        view = public_view(asset)
        view["backdrop"] = scene.backdrop
        saved_images.append(view)

    # ---- 2. Video ----
    job_id = None
    if body.make_video:
        # Reel banavva mate NAVI scene images j vaapro — e vadhu sundar
        # che. Na bani hoy to asli images thi kaam chalavo.
        video_image_ids = [i["id"] for i in saved_images] or asset_ids[:4]

        first = products[0]
        hint = "\n".join(
            " — ".join(
                filter(
                    None,
                    [
                        p.get("title", ""),
                        p.get("price_text", ""),
                        (p.get("description") or "")[:200],
                    ],
                )
            )
            for p in products[:3]
        )

        result = await start_reel_job(
            GenerateInput(
                brand_id=brand_id,
                image_asset_ids=video_image_ids,
                mode="multi" if len(video_image_ids) > 1 else "single",
                target_duration=body.video_duration,
                language=body.language,
                voiceover=body.voiceover,
                hint=hint,
                price=first.get("price_text", ""),
                product_url=first.get("url", ""),
                product_id=str(first["_id"]),
            )
        )
        job_id = result["job_id"]

    return ok(
        {
            "images": saved_images,
            "image_count": len(saved_images),
            "video_job_id": job_id,
            "poll_url": f"/api/studio/jobs/{job_id}" if job_id else None,
            "warnings": warnings,
            "note": (
                "Images taiyar che. Video banta 2-4 minute lage che — "
                "'Reel Studio' tab ma progress dekhashe."
            ),
        },
        201,
    )


# ------------------------------------------------------------------ #
#  Download — badhu ek ZIP ma
# ------------------------------------------------------------------ #


@router.get("/studio/jobs/{job_id}/download")
async def download_pack(job_id: str, brand: dict = Depends(current_brand)):
    """
    Ek reel job nu BADHU ek ZIP ma — sidhu post kari shakay evu.

    Andar su hoy che:
      VIDEO-1080x1920.mp4   → Instagram Reel / FB Reel ma sidhu upload
      COVER.jpg             → reel no cover
      IMAGE-1..N.jpg        → feed post ni images (4:5)
      CAPTION-instagram.txt → caption + hashtags (copy-paste)
      CAPTION-facebook.txt
      VIGAT.txt             → product ni vigat, keywords, music
    """
    import io
    import zipfile

    from fastapi.responses import StreamingResponse

    from ..media.store import get_asset, read_bytes
    from ..reels.jobs import get_job

    brand_id = str(brand["_id"])
    job = await get_job(job_id, brand_id)
    if not job:
        return fail("Reel job madyo nahi", 404)
    if job.get("status") != "done":
        return fail(f"Reel hju taiyar nathi (status: {job.get('status')})", 409)

    analysis = job.get("analysis") or {}
    copy = job.get("copy") or {}
    trends = job.get("trends") or {}
    audio = job.get("audio") or {}

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        # ---- Video ----
        if job.get("output_id"):
            asset = await get_asset(job["output_id"])
            if asset:
                archive.writestr("VIDEO-1080x1920.mp4", await read_bytes(asset))

        if job.get("thumbnail_id"):
            asset = await get_asset(job["thumbnail_id"])
            if asset:
                archive.writestr("COVER.jpg", await read_bytes(asset))

        # ---- Post ni images ----
        # Ek j image ghana scene ma vaparai hoy che (dakhla: 8 scene, 3
        # image). Badhi scene ni image naakhie to ZIP ma IMAGE-1 thi
        # IMAGE-8 aave ane emathi 5 SARKHI hoy — user ne gothvaay che.
        # Etle FAKT ALAG image j naakhie chie.
        seen: set[str] = set()
        image_number = 0
        for scene in job.get("scenes") or []:
            media_id = scene.get("media_id")
            if not media_id or str(media_id) in seen:
                continue
            seen.add(str(media_id))

            asset = await get_asset(media_id)
            if asset and asset.get("kind") == "image":
                image_number += 1
                archive.writestr(f"IMAGE-{image_number}.jpg", await read_bytes(asset))

        # ---- Caption ----
        for platform in ("instagram", "facebook"):
            block = copy.get(platform) or {}
            if not block:
                continue
            lines = [
                block.get("caption", ""),
                "",
                "-" * 50,
                "HASHTAGS (Instagram par PEHLA COMMENT ma muko):"
                if platform == "instagram"
                else "HASHTAGS:",
                block.get("first_comment") or " ".join(f"#{h}" for h in block.get("hashtags", [])),
            ]
            archive.writestr(f"CAPTION-{platform}.txt", "\n".join(lines))

        # ---- Badhi vigat ----
        info = [
            "=" * 56,
            "PRODUCT",
            "=" * 56,
            f"Naam      : {analysis.get('productName', '')}",
            f"Category  : {analysis.get('category', '')} -> {analysis.get('subCategory', '')}",
            f"Material  : {', '.join(analysis.get('materials') or [])}",
            f"Colour    : {', '.join(analysis.get('colors') or [])}",
            f"Occasion  : {', '.join(analysis.get('occasions') or [])}",
            f"Kona mate : {analysis.get('targetAudience', '')}",
            "",
            "KEM KHARIDE:",
            *[f"  - {s}" for s in (analysis.get('sellingPoints') or [])],
            "",
            "=" * 56,
            "LOG SU SEARCH KARE CHE",
            "=" * 56,
            *[f"  - {k}" for k in (trends.get("keywords") or [])],
            "",
            "=" * 56,
            "MUSIC",
            "=" * 56,
            f"Video ma vagto track : {audio.get('track')}",
            "",
            "Instagram nu TRENDING sound joitu hoy to:",
            f"  IG app ma shodho : {', '.join((audio.get('instagram_hint') or {}).get('search_terms') or [])}",
            "",
            (audio.get("instagram_hint") or {}).get("how_to", ""),
            "",
            "=" * 56,
            "SIDHU POST KARVA MATE",
            "=" * 56,
            "1. VIDEO-1080x1920.mp4 phone ma lai jao",
            "2. Instagram -> Reel -> aa video pasand karo",
            "3. CAPTION-instagram.txt no uper no bhaag caption ma paste karo",
            "4. Post karya pachi PEHLA COMMENT ma hashtags paste karo",
            "5. (Marji nu) IG app ma Audio badli ne trending sound lagavo",
        ]
        archive.writestr("VIGAT.txt", "\n".join(info))

    buffer.seek(0)
    name = (analysis.get("productName") or "post").replace(" ", "-")[:40]

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"content-disposition": f'attachment; filename="{name}.zip"'},
    )
