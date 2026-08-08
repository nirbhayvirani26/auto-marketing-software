"""
"Set karo ane bhuli jao" — roj aapoaap reel banine post thai jaay.

n8n ni jarur NATHI. App potej dar minute jue che ke vakhat thayo ke nahi,
ane thayo hoy to:

    product images ma thi VAARO pramane ek lai ne
        → aakhi reel banave (script, music, voiceover, caption)
        → Instagram + Facebook banne par muki de

"Vaaro" agatya nu che — dar vakhate ALAG product jaay che, nahi to ek j
product roj jashe ane log kantaadi jashe.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId

from ..config import settings
from ..db import automations as automations_collection
from ..db import connect
from ..db import media as media_collection
from ..logs import log_activity
from .generate import GenerateInput
from .runner import start_reel_job

#: Ek j document — "aa brand nu roj nu setting".
KIND = "daily-reel"

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    #: Audience na local time pramane (IST hoy to 11 = savare 11).
    "hour": 11,
    "minute": 0,
    #: Ek reel ma ketla product (1 = ek product, 3+ = collection reel).
    "products_per_reel": 1,
    "duration": 30,
    "language": "en",
    "hint": "",
    "voiceover": True,
    #: now = turant post | auto = sauthi saara vakhate | draft = fakt draft
    "publish_when": "now",
    #: Khali = badha connected account.
    "account_ids": [],
    #: Vaaro kya sudhi pahonchyo.
    "cursor": 0,
}


def now() -> datetime:
    return datetime.now(timezone.utc)


async def get_config(brand_id: str) -> dict:
    await connect()
    doc = await automations_collection().find_one({"kind": KIND, "brand_id": brand_id})
    return {**DEFAULTS, **(doc or {})}


async def save_config(brand_id: str, changes: dict) -> dict:
    """Setting badlo. `next_run_at` apoaap fari ganay che."""
    await connect()
    current = await get_config(brand_id)

    allowed = {
        key: changes[key]
        for key in (
            "enabled", "hour", "minute", "products_per_reel", "duration",
            "language", "hint", "voiceover", "publish_when", "account_ids",
        )
        if key in changes
    }

    merged = {**current, **allowed}
    merged["hour"] = max(0, min(23, int(merged["hour"])))
    merged["minute"] = max(0, min(59, int(merged["minute"])))
    merged["products_per_reel"] = max(1, min(10, int(merged["products_per_reel"])))
    merged["duration"] = max(15, min(90, int(merged["duration"])))

    merged["next_run_at"] = compute_next_run(merged)
    merged.pop("_id", None)

    await automations_collection().update_one(
        {"kind": KIND, "brand_id": brand_id},
        {"$set": {**merged, "kind": KIND, "brand_id": brand_id, "updated_at": now()}},
        upsert=True,
    )
    return await get_config(brand_id)


def compute_next_run(config: dict, *, start_from: Optional[datetime] = None) -> datetime:
    """
    Have pachi kyare chalavvu.

    `hour`/`minute` AUDIENCE na local time ma che (IST = UTC+5:30), etle
    offset lagavi ne UTC ma badlie chie — nahi to reel raat na 5 vage
    post thay ane koi jue j nahi.
    """
    base = start_from or now()
    shift = timedelta(minutes=settings.timezone_offset_minutes)

    local = base + shift
    target_local = local.replace(
        hour=int(config.get("hour", 11)),
        minute=int(config.get("minute", 0)),
        second=0,
        microsecond=0,
    )
    if target_local <= local:
        target_local += timedelta(days=1)

    return target_local - shift


async def pick_next_images(brand_id: str, count: int) -> tuple[list[str], int]:
    """
    Vaaro pramane aavti images. Pacho (ids, navo cursor).

    Sauthi juni image pehla — etle badha product ne vaaro male che.
    """
    await connect()
    library = [
        doc
        async for doc in media_collection()
        .find({"brand_id": brand_id, "kind": "image", "role": "product"})
        .sort("created_at", 1)
        .limit(500)
    ]
    if not library:
        return [], 0

    config = await get_config(brand_id)
    cursor = int(config.get("cursor", 0)) % len(library)

    take = min(count, len(library))
    ids = [str(library[(cursor + i) % len(library)]["_id"]) for i in range(take)]
    return ids, (cursor + take) % len(library)


async def run_due(brand_id: str) -> Optional[str]:
    """
    Vakhat thayo hoy to reel shuru karo. Job id pacho aape, nahi to None.

    Reel banta 2-4 minute lage che, etle ahiya RAAH NATHI JOTA — job
    background ma chale che ane taiyar thay ke jate publish thai jaay che
    (`auto_distribute`).
    """
    config = await get_config(brand_id)
    if not config.get("enabled"):
        return None

    next_run = config.get("next_run_at")
    if not next_run:
        await save_config(brand_id, {})
        return None

    if next_run.tzinfo is None:
        next_run = next_run.replace(tzinfo=timezone.utc)
    if next_run > now():
        return None

    # Vakhat thai gayo — pehla NAVO vakhat set karo, pachi kaam karo.
    # (Ulto kariye ane vachhe crash thay to loop ma fasai jaay.)
    await automations_collection().update_one(
        {"kind": KIND, "brand_id": brand_id},
        {"$set": {"next_run_at": compute_next_run(config), "last_run_at": now()}},
    )

    count = int(config.get("products_per_reel", 1))
    image_ids, new_cursor = await pick_next_images(brand_id, count)

    if not image_ids:
        await log_activity(
            level="warning",
            action="automation.daily_reel",
            message=(
                "Roj nu reel na banyu — ek pan product image nathi. "
                "Reel Studio ma images upload karo."
            ),
            brand_id=brand_id,
        )
        return None

    await automations_collection().update_one(
        {"kind": KIND, "brand_id": brand_id}, {"$set": {"cursor": new_cursor}}
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
                "when": str(config.get("publish_when", "now")),
                "hashtags_in_first_comment": True,
            },
        )
    )

    await log_activity(
        level="success",
        action="automation.daily_reel",
        message=f"Roj nu reel shuru thayu ({len(image_ids)} image)",
        brand_id=brand_id,
        meta={"job_id": result["job_id"]},
    )
    return result["job_id"]


async def run_all_due() -> int:
    """Badha brand mate — scheduler dar minute aane call kare che."""
    await connect()
    started = 0

    async for doc in automations_collection().find({"kind": KIND, "enabled": True}):
        try:
            if await run_due(str(doc["brand_id"])):
                started += 1
        except Exception as error:  # noqa: BLE001 — ek brand fail thay to
            # bija atkava na joiye.
            await log_activity(
                level="error",
                action="automation.daily_reel",
                message=f"Roj nu reel shuru na thai shakyu: {error}",
                brand_id=str(doc.get("brand_id")),
            )

    return started


def public_view(config: dict) -> dict:
    """API/UI mate saaf object."""
    next_run = config.get("next_run_at")
    last_run = config.get("last_run_at")
    return {
        "enabled": bool(config.get("enabled")),
        "hour": config.get("hour"),
        "minute": config.get("minute"),
        "products_per_reel": config.get("products_per_reel"),
        "duration": config.get("duration"),
        "language": config.get("language"),
        "hint": config.get("hint"),
        "voiceover": config.get("voiceover"),
        "publish_when": config.get("publish_when"),
        "account_ids": [str(a) for a in (config.get("account_ids") or [])],
        "next_run_at": next_run.isoformat() if isinstance(next_run, datetime) else None,
        "last_run_at": last_run.isoformat() if isinstance(last_run, datetime) else None,
        "timezone_note": (
            f"Vakhat tamara audience na timezone ma che "
            f"(UTC{settings.timezone_offset_minutes / 60:+.1f})"
        ),
    }
