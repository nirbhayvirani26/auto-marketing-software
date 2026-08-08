"""
Reel job — kaam no aakho hisab.

Reel banta 1 thi 5 minute lage che (vision → trends → script → images →
render → upload). Etle e kaam background ma chale che ane aa document ma
dareak step no hisab rahe che — jethi UI ma "atyare su thai rahyu che"
batavi shakay ane fail thay to KYA fail thayu e sidhu khabar pade.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId

from ..db import connect
from ..db import reel_jobs

#: Step no kram ane emnu "vajan" — progress bar aa pramane vadhe che.
STEP_ORDER: list[tuple[str, str, int]] = [
    ("vision", "Image samajie chie", 8),
    ("trends", "Trending keywords shodhie chie", 8),
    ("reference", "Reference reel ni style samajie chie", 6),
    ("plan", "Reel no script lakhie chie", 10),
    ("media", "Scene ni images taiyar karie chie", 26),
    ("music", "Music pasand karie chie", 4),
    ("voiceover", "Voiceover banavie chie", 6),
    ("render", "Video render karie chie", 22),
    ("upload", "Public URL banavie chie", 6),
    ("copy", "Caption ane hashtags lakhie chie", 8),
    ("distribute", "Jate publish karie chie", 6),
]

STEP_WEIGHTS = {key: weight for key, _, weight in STEP_ORDER}
STEP_LABELS = {key: label for key, label, _ in STEP_ORDER}


def now() -> datetime:
    return datetime.now(timezone.utc)


def initial_steps(*, with_reference: bool, with_distribute: bool) -> list[dict]:
    skip = set()
    if not with_reference:
        skip.add("reference")
    if not with_distribute:
        skip.add("distribute")

    return [
        {"key": key, "label": label, "status": "pending"}
        for key, label, _ in STEP_ORDER
        if key not in skip
    ]


async def create_job(document: dict) -> dict:
    await connect()
    document.setdefault("_id", ObjectId())
    document.setdefault("status", "queued")
    document.setdefault("steps", [])
    document.setdefault("scenes", [])
    document.setdefault("posts", [])
    document.setdefault("created_at", now())
    document.setdefault("updated_at", now())
    await reel_jobs().insert_one(document)
    return document


async def get_job(job_id: Any, brand_id: Optional[str] = None) -> Optional[dict]:
    await connect()
    try:
        query: dict[str, Any] = {"_id": ObjectId(str(job_id))}
    except Exception:  # noqa: BLE001
        return None
    if brand_id:
        query["brand_id"] = brand_id
    return await reel_jobs().find_one(query)


async def update_job(job_id: Any, changes: dict) -> None:
    await connect()
    await reel_jobs().update_one(
        {"_id": ObjectId(str(job_id))},
        {"$set": {**changes, "updated_at": now()}},
    )


async def set_step(
    job_id: Any,
    key: str,
    *,
    status: Optional[str] = None,
    provider: Optional[str] = None,
    ms: Optional[int] = None,
    note: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    """
    Ek step ne update kare.

    Step list ma pehle thi hoy to badle, nahi to umere — etle kram
    khovai jato nathi ane "reference" jeva optional step pan bandh bese che.
    """
    await connect()
    job = await get_job(job_id)
    if not job:
        return

    steps: list[dict] = list(job.get("steps") or [])
    patch = {
        k: v
        for k, v in {
            "status": status,
            "provider": provider,
            "ms": ms,
            "note": note,
            "error": error,
        }.items()
        if v is not None
    }

    for step in steps:
        if step.get("key") == key:
            step.update(patch)
            break
    else:
        steps.append({"key": key, "label": STEP_LABELS.get(key, key), **patch})

    await reel_jobs().update_one(
        {"_id": job["_id"]},
        {"$set": {"steps": steps, "updated_at": now()}},
    )


def progress_of(job: dict) -> int:
    """Step na vajan pramane 0-100."""
    if job.get("status") == "done":
        return 100

    earned = 0.0
    total = 0.0
    for step in job.get("steps") or []:
        weight = STEP_WEIGHTS.get(step.get("key", ""), 5)
        total += weight
        status = step.get("status")
        if status in ("done", "skipped"):
            earned += weight
        elif status == "running":
            earned += weight * 0.4

    return round((earned / total) * 100) if total else 0


def public_view(job: dict, *, output: Optional[dict] = None, thumbnail: Optional[dict] = None) -> dict:
    """API ma bahar aapva layak saaf object."""
    current = next(
        (s for s in (job.get("steps") or []) if s.get("status") == "running"), None
    )

    return {
        "id": str(job["_id"]),
        "status": job.get("status"),
        "mode": job.get("mode"),
        "progress": progress_of(job),
        "current_step": (
            {"key": current.get("key"), "label": current.get("label"), "note": current.get("note")}
            if current
            else None
        ),
        "steps": [
            {
                "key": s.get("key"),
                "label": s.get("label"),
                "status": s.get("status"),
                "provider": s.get("provider"),
                "ms": s.get("ms"),
                "note": s.get("note"),
                "error": s.get("error"),
            }
            for s in (job.get("steps") or [])
        ],
        "error": job.get("error"),
        "warnings": job.get("warnings") or [],
        "duration": job.get("duration"),
        "video_url": (output or {}).get("public_url"),
        "preview_url": f"/api/media/{job['output_id']}" if job.get("output_id") else None,
        "thumbnail_url": f"/api/media/{job['thumbnail_id']}" if job.get("thumbnail_id") else None,
        "scenes": job.get("scenes") or [],
        "analysis": job.get("analysis"),
        "trends": job.get("trends"),
        "copy": job.get("copy"),
        "audio": job.get("audio"),
        "posts": [str(p) for p in (job.get("posts") or [])],
        "ms": job.get("ms"),
        "created_at": job.get("created_at"),
        "finished_at": job.get("finished_at"),
    }
