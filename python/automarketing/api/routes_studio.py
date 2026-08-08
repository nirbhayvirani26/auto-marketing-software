"""
Reel Studio na routes — upload, generate, progress, publish.

Aa j aakha app nu dil che.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field

from ..db import connect
from ..db import media as media_collection
from ..db import reel_jobs
from ..logs import log_activity
from ..media import images as imagelib
from ..media.store import get_asset, public_view as media_view, save_media
from ..reels.generate import GenerateInput
from ..reels.jobs import get_job, public_view as job_view
from ..reels.publish import distribute_reel, suggested_slots
from ..reels.runner import runner_status, start_reel_job
from .deps import current_brand, current_user, fail, ok

router = APIRouter(prefix="/api", tags=["studio"])

MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024

ALLOWED = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
    "video/mp4", "video/quicktime", "video/webm",
    "audio/mpeg", "audio/mp4", "audio/wav",
}


# ------------------------------------------------------------------ #
#  Upload
# ------------------------------------------------------------------ #


@router.post("/uploads")
async def upload_files(
    files: list[UploadFile] = File(...),
    role: str = Form("product"),
    brand: dict = Depends(current_brand),
):
    """
    File upload — product images, avatar photos, reference reels, music.

    Image ne ahiya j saaf kari daiye chie: EXIF rotation, 4000px thi nani,
    ane hamesha JPEG (ffmpeg ane Meta banne ne aa game che).
    """
    if not files:
        return fail("Ek pan file na madi")
    if len(files) > 20:
        return fail("Ek var ma 20 thi vadhare file nahi")

    saved: list[dict] = []
    errors: list[str] = []

    for upload in files:
        try:
            mime = (upload.content_type or "application/octet-stream").lower()
            if mime not in ALLOWED:
                errors.append(f"{upload.filename}: aa format support nathi ({mime})")
                continue

            data = await upload.read()
            limit = MAX_VIDEO_BYTES if mime.startswith("video/") else MAX_IMAGE_BYTES
            if len(data) > limit:
                errors.append(
                    f"{upload.filename}: bahu moti che "
                    f"({len(data) // 1024 // 1024}MB, limit {limit // 1024 // 1024}MB)"
                )
                continue

            width = height = None
            if mime.startswith("image/"):
                try:
                    data = imagelib.normalise_upload(data)
                    mime = "image/jpeg"
                    meta = imagelib.info(data)
                    if meta:
                        width, height = meta.width, meta.height
                except Exception as error:  # noqa: BLE001
                    errors.append(f"{upload.filename}: image vanchi na shakai ({error})")
                    continue

            asset = await save_media(
                data,
                mime_type=mime,
                filename=upload.filename or "upload",
                role=role,
                brand_id=str(brand["_id"]),
                provider="upload",
                width=width,
                height=height,
            )
            saved.append(media_view(asset))

        except Exception as error:  # noqa: BLE001
            errors.append(f"{upload.filename}: {error}")

    if not saved:
        return fail("Ek pan file save na thai.\n" + "\n".join(errors), 422)

    return ok({"files": saved, "errors": errors}, 201)


@router.get("/uploads")
async def list_uploads(
    role: str = "",
    limit: int = 60,
    brand: dict = Depends(current_brand),
):
    """Brand na upload karela media — Studio ma fari vaparva mate."""
    await connect()
    query: dict[str, Any] = {"brand_id": str(brand["_id"])}
    if role:
        query["role"] = role

    assets = [
        doc
        async for doc in media_collection()
        .find(query)
        .sort("created_at", -1)
        .limit(min(limit, 200))
    ]
    return ok([media_view(a) for a in assets])


@router.delete("/uploads/{asset_id}")
async def delete_upload(asset_id: str, brand: dict = Depends(current_brand)):
    await connect()
    result = await media_collection().delete_one(
        {"_id": ObjectId(asset_id), "brand_id": str(brand["_id"])}
    )
    if not result.deleted_count:
        return fail("Media madyu nahi", 404)
    return ok({"deleted": True})


# ------------------------------------------------------------------ #
#  Generate
# ------------------------------------------------------------------ #


class GenerateBody(BaseModel):
    image_asset_ids: list[str] = Field(min_length=1, max_length=20)
    mode: Optional[str] = None
    avatar_id: Optional[str] = None
    reference_video_asset_id: Optional[str] = None
    target_duration: int = Field(default=40, ge=15, le=90)
    language: str = "en"
    tone: str = ""
    hint: str = ""
    price: str = ""
    product_url: str = ""
    voiceover: Optional[bool] = None


@router.post("/studio/generate")
async def generate(
    body: GenerateBody,
    user: dict = Depends(current_user),
    brand: dict = Depends(current_brand),
):
    """
    Reel banavvanu shuru karo.

    Aa route TURANT pacho aave che — reel background ma bane che.
    Progress mate `GET /api/studio/jobs/<job_id>` par poll karo.
    """
    await connect()
    brand_id = str(brand["_id"])

    # Aapelі image kharekhar aa brand ni j che ne.
    owned = await media_collection().count_documents(
        {
            "_id": {"$in": [ObjectId(i) for i in body.image_asset_ids]},
            "brand_id": brand_id,
            "kind": "image",
        }
    )
    if owned != len(body.image_asset_ids):
        return fail("Ketlik image madi nahi. Fari upload karo ane pachi try karo.", 422)

    if body.reference_video_asset_id:
        reference = await get_asset(body.reference_video_asset_id)
        if not reference or reference.get("kind") != "video":
            return fail("Reference video madyu nahi", 422)

    result = await start_reel_job(
        GenerateInput(
            brand_id=brand_id,
            image_asset_ids=body.image_asset_ids,
            mode=body.mode,
            avatar_id=body.avatar_id or None,
            reference_video_asset_id=body.reference_video_asset_id or None,
            target_duration=body.target_duration,
            language=body.language,
            tone=body.tone,
            hint=body.hint,
            price=body.price,
            product_url=body.product_url,
            voiceover=body.voiceover,
            created_by=str(user["_id"]),
        )
    )

    await log_activity(
        action="reel.queued",
        message=(
            f"Reel banavvanu shuru — {len(body.image_asset_ids)} image, "
            f"{body.target_duration}s"
        ),
        brand_id=brand_id,
        actor=user.get("email", ""),
        meta={"job_id": result["job_id"]},
    )

    return ok(
        {
            **result,
            "poll_url": f"/api/studio/jobs/{result['job_id']}",
            "message": (
                "Line ma mukayu — thodi var ma shuru thashe"
                if result["queued"]
                else "Reel banavvanu shuru thai gayu"
            ),
        },
        202,
    )


# ------------------------------------------------------------------ #
#  Jobs
# ------------------------------------------------------------------ #


@router.get("/studio/jobs")
async def list_jobs(limit: int = 30, brand: dict = Depends(current_brand)):
    """Brand na badha reels — "Mari reels" tab mate."""
    await connect()
    jobs = [
        doc
        async for doc in reel_jobs()
        .find({"brand_id": str(brand["_id"])})
        .sort("created_at", -1)
        .limit(min(limit, 100))
    ]

    return ok(
        {
            "runner": runner_status(),
            "jobs": [
                {
                    "id": str(job["_id"]),
                    "status": job.get("status"),
                    "mode": job.get("mode"),
                    "product_name": (job.get("analysis") or {}).get("productName", "—"),
                    "duration": job.get("duration"),
                    "scene_count": len(job.get("scenes") or []),
                    "post_count": len(job.get("posts") or []),
                    "thumbnail_url": (
                        f"/api/media/{job['thumbnail_id']}" if job.get("thumbnail_id") else None
                    ),
                    "preview_url": (
                        f"/api/media/{job['output_id']}" if job.get("output_id") else None
                    ),
                    "error": job.get("error"),
                    "created_at": job.get("created_at"),
                    "ms": job.get("ms"),
                }
                for job in jobs
            ],
        }
    )


@router.get("/studio/jobs/{job_id}")
async def job_status(job_id: str, brand: dict = Depends(current_brand)):
    """Ek reel job ni puri halat — UI dar 3 second e aa puche che."""
    job = await get_job(job_id, str(brand["_id"]))
    if not job:
        return fail("Reel job madyo nahi", 404)

    output = await get_asset(job["output_id"]) if job.get("output_id") else None
    thumbnail = await get_asset(job["thumbnail_id"]) if job.get("thumbnail_id") else None

    return ok(job_view(job, output=output, thumbnail=thumbnail))


@router.delete("/studio/jobs/{job_id}")
async def delete_job(job_id: str, brand: dict = Depends(current_brand)):
    await connect()
    result = await reel_jobs().delete_one(
        {"_id": ObjectId(job_id), "brand_id": str(brand["_id"])}
    )
    if not result.deleted_count:
        return fail("Reel job madyo nahi", 404)
    return ok({"deleted": True})


# ------------------------------------------------------------------ #
#  Publish
# ------------------------------------------------------------------ #


class PublishBody(BaseModel):
    account_ids: Optional[list[str]] = None
    when: str = "now"  # now | schedule | auto | draft
    scheduled_at: Optional[datetime] = None
    hashtags_in_first_comment: bool = True


@router.post("/studio/jobs/{job_id}/publish")
async def publish(
    job_id: str,
    body: PublishBody,
    user: dict = Depends(current_user),
    brand: dict = Depends(current_brand),
):
    """
    Banelu reel badha account par mokalo.
    Instagram par je jaay e Facebook par pan — alag caption sathe.
    """
    if body.when == "schedule" and not body.scheduled_at:
        return fail("Schedule mate vakhat aapo (scheduled_at)", 422)

    result = await distribute_reel(
        job_id=job_id,
        brand_id=str(brand["_id"]),
        account_ids=body.account_ids,
        when=body.when,
        scheduled_at=body.scheduled_at,
        hashtags_in_first_comment=body.hashtags_in_first_comment,
        created_by=str(user["_id"]),
    )
    return ok(result, 201)


@router.get("/studio/jobs/{job_id}/slots")
async def publish_slots(job_id: str, brand: dict = Depends(current_brand)):
    """Publish pehla — kaya vakhate mukvu e suchav."""
    job = await get_job(job_id, str(brand["_id"]))
    if not job:
        return fail("Reel job madyo nahi", 404)

    category = str((job.get("analysis") or {}).get("category") or "general")
    return ok({"ready": job.get("status") == "done", "slots": suggested_slots(category)})


# ------------------------------------------------------------------ #
#  Roj nu reel — "set karo ane bhuli jao"
# ------------------------------------------------------------------ #


class AutomationBody(BaseModel):
    enabled: Optional[bool] = None
    #: Audience na local time ma (IST hoy to 11 = savare 11).
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    minute: Optional[int] = Field(default=None, ge=0, le=59)
    products_per_reel: Optional[int] = Field(default=None, ge=1, le=10)
    duration: Optional[int] = Field(default=None, ge=15, le=90)
    language: Optional[str] = None
    hint: Optional[str] = None
    voiceover: Optional[bool] = None
    #: now | auto | draft
    publish_when: Optional[str] = None
    account_ids: Optional[list[str]] = None


@router.get("/studio/automation")
async def get_automation(brand: dict = Depends(current_brand)):
    """Roj nu reel chalu che? Kyare chalse?"""
    from ..reels.automation import get_config, public_view

    return ok(public_view(await get_config(str(brand["_id"]))))


@router.post("/studio/automation")
async def set_automation(
    body: AutomationBody,
    brand: dict = Depends(current_brand),
):
    """
    Roj nu reel set karo.

    Ek var chalu karo, pachi tamare kai j karvanu nathi — roj aapelaa
    vakhate product images ma thi VAARO pramane ek lai ne aakhi reel
    banse ane Instagram + Facebook par mukai jashe.
    """
    from ..reels.automation import public_view, save_config

    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    config = await save_config(str(brand["_id"]), changes)
    return ok(public_view(config))


@router.post("/studio/automation/run-now")
async def run_automation_now(brand: dict = Depends(current_brand)):
    """Raah joya vagar atyare j ek chalavi jovu — test mate."""
    from ..reels.automation import get_config, pick_next_images
    from ..reels.generate import GenerateInput
    from ..reels.runner import start_reel_job

    brand_id = str(brand["_id"])
    config = await get_config(brand_id)

    image_ids, _ = await pick_next_images(
        brand_id, int(config.get("products_per_reel", 1))
    )
    if not image_ids:
        return fail(
            "Ek pan product image nathi. Pehla Reel Studio ma images upload karo.",
            422,
        )

    result = await start_reel_job(
        GenerateInput(
            brand_id=brand_id,
            image_asset_ids=image_ids,
            mode="multi" if len(image_ids) > 1 else "single",
            target_duration=int(config.get("duration", 30)),
            language=str(config.get("language", "en")),
            hint=str(config.get("hint", "")),
            voiceover=bool(config.get("voiceover", True)),
            auto_distribute={
                "account_ids": [str(a) for a in (config.get("account_ids") or [])],
                "when": str(config.get("publish_when", "draft")),
                "hashtags_in_first_comment": True,
            },
        )
    )
    return ok({**result, "poll_url": f"/api/studio/jobs/{result['job_id']}"}, 202)
