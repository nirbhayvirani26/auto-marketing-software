"""
Banelu reel badha account par mokalvanu.

"Instagram ma je jaay e Facebook ma pan jaay" — aa file e j kare che.
Ek j reel, pan dareak platform mate ALAG caption ane ALAG hashtag count,
karan ke Instagram ane Facebook ni ranking sav judi che.

Dareak account no potano Post record bane che, etle ek account fail thay
to bija atkata nathi — ane fari fakt e j account retry thai shake che.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId

from ..db import accounts as accounts_collection
from ..social import interlink
from ..db import connect
from ..db import posts as posts_collection
from ..db import reel_jobs
from ..errors import UserError
from ..logs import log_activity
from ..media.store import ensure_public_url, get_asset
from ..publisher import publish_post
from ..seo.ranking import best_post_times, spread_schedule
from .jobs import get_job, now


async def distribute_reel(
    *,
    job_id: str,
    brand_id: str,
    account_ids: Optional[list[str]] = None,
    when: str = "now",  # now | schedule | auto | draft
    scheduled_at: Optional[datetime] = None,
    hashtags_in_first_comment: bool = True,
    created_by: Optional[str] = None,
) -> dict:
    """Reel ne badha (ke pasand karela) account par mokalo."""
    await connect()

    job = await get_job(job_id, brand_id)
    if not job:
        raise UserError("Reel job madyo nahi")
    if job.get("status") != "done":
        raise UserError(f"Reel hju taiyar nathi (status: {job.get('status')})")
    if not job.get("output_id"):
        raise UserError("Reel nu video madyu nahi")

    video_asset = await get_asset(job["output_id"])
    if not video_asset:
        raise UserError("Reel nu video file madyu nahi")

    # Meta ne download karva mate public URL joiye j. Juno URL puro thai
    # gayo hoy (tmpfiles jeva host) to navo banavi laiye.
    video_url = await ensure_public_url(video_asset)

    thumbnail_url = ""
    if job.get("thumbnail_id"):
        thumb = await get_asset(job["thumbnail_id"])
        if thumb:
            try:
                thumbnail_url = await ensure_public_url(thumb)
            except Exception:  # noqa: BLE001 — cover optional
                thumbnail_url = ""

    query: dict[str, Any] = {"brand_id": brand_id, "status": "connected"}
    if account_ids:
        query["_id"] = {"$in": [ObjectId(a) for a in account_ids]}

    accounts = [doc async for doc in accounts_collection().find(query)]
    if not accounts:
        raise UserError(
            "Ek pan connected account nathi — pehla Accounts page ma "
            "Instagram/Facebook jodo."
        )

    copy = job.get("copy") or {}
    analysis = job.get("analysis") or {}
    batch_id = uuid.uuid4().hex

    created: list[dict] = []
    skipped: list[dict] = []

    # ---- Kaya vakhate ----
    slots: list[datetime] = []
    if when == "auto":
        # Badha account ek j sekande post na kare — IG ne e game nahi.
        slots = spread_schedule(
            len(accounts),
            category=str(analysis.get("category") or "general"),
            min_gap_hours=6 if len(accounts) > 2 else 20,
        )
    elif when == "schedule" and scheduled_at:
        if scheduled_at.tzinfo is None:
            scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
        slots = [
            scheduled_at + timedelta_seconds(index * 90) for index in range(len(accounts))
        ]

    post_ids: list[ObjectId] = []

    # ---- Inter-linking ni taiyari ----
    link_accounts = interlink.accounts_from_docs(accounts)
    product_url = job.get("product_url") or ""

    # Ek j brand na ghana account hoy to j cross-mention no matlab che.
    cross_mention = len(link_accounts) > 1

    # Dar vakhate alag accounts mention thay etle — job na id par thi
    # sthir pan badalto aankdo.
    rotation = int(str(job["_id"])[-4:], 16) if job.get("_id") else 0

    for index, account in enumerate(accounts):
        platform = account.get("platform")
        platform_copy = copy.get(platform)

        if not platform_copy:
            skipped.append(
                {
                    "account": account.get("display_name"),
                    "reason": f"{platform} mate caption madyu nahi — reel fari banavo",
                }
            )
            continue

        use_first_comment = hashtags_in_first_comment and platform == "instagram"
        slot = slots[index] if index < len(slots) else None

        # ---- INTER-LINKING ----
        # Dareak account na caption na chhede: product ni link ane BIJA
        # accounts nu mention. Etle 5 account hoy to ek-bija na follower
        # ne ek-bija ni khabar pade che.
        #
        # `rotation` ma job no counter aapie chie, etle dar vakhate ALAG
        # accounts ne vaaro male — badha ne baari-baari thi promotion.
        caption = interlink.decorate_caption(
            platform_copy.get("caption", ""),
            current=link_accounts[index],
            all_accounts=link_accounts,
            product_url=product_url,
            rotation=rotation,
            language=job.get("language", "en"),
            cross_mention=cross_mention,
        )

        document = {
            "_id": ObjectId(),
            "brand_id": brand_id,
            "account_id": account["_id"],
            "platform": platform,
            "post_type": "reel",
            "caption": caption,
            "product_id": job.get("product_id") or "",
            "product_url": product_url,
            "hashtags": platform_copy.get("hashtags") or [],
            "first_comment": platform_copy.get("first_comment") if use_first_comment else "",
            "media_url": video_url,
            "media_type": "video",
            "thumbnail_url": thumbnail_url,
            "media_asset_id": video_asset["_id"],
            "reel_job_id": job["_id"],
            "seo": platform_copy.get("score"),
            "audio": job.get("audio"),
            "status": "draft" if when == "draft" else "scheduled",
            "scheduled_at": slot,
            "batch_id": batch_id,
            "generated_by_ai": True,
            "source": "reel-studio",
            "created_by": created_by,
            "attempts": 0,
            "created_at": now(),
            "updated_at": now(),
        }
        await posts_collection().insert_one(document)
        post_ids.append(document["_id"])

        entry = {
            "post_id": str(document["_id"]),
            "account": account.get("display_name"),
            "platform": platform,
            "status": document["status"],
            "scheduled_at": slot.isoformat() if slot else None,
        }

        if when == "now":
            result = await publish_post(document["_id"])
            entry["status"] = "published" if result.get("ok") else "failed"
            entry["permalink"] = result.get("permalink")
            entry["error"] = result.get("error")

        created.append(entry)

    await reel_jobs().update_one(
        {"_id": job["_id"]},
        {"$push": {"posts": {"$each": post_ids}}, "$set": {"updated_at": now()}},
    )

    await log_activity(
        level="warning" if any(c.get("error") for c in created) else "success",
        action="reel.distributed",
        message=f"Reel {len(created)} account par gayu ({when})",
        brand_id=brand_id,
        meta={"job_id": str(job["_id"]), "batch_id": batch_id},
    )

    return {
        "batch_id": batch_id,
        "created": created,
        "skipped": skipped,
        "instagram_audio_hint": (job.get("audio") or {}).get("instagram_hint"),
    }


def timedelta_seconds(seconds: int):
    from datetime import timedelta

    return timedelta(seconds=seconds)


def suggested_slots(category: str, count: int = 4) -> list[dict]:
    """"Kaya vakhate mukvu?" — UI ne batavva mate."""
    return [
        {
            "at": slot["at"].isoformat(),
            "label": slot["label"],
            "strength": slot["strength"],
        }
        for slot in best_post_times(category=category, count=count)
    ]
