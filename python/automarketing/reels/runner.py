"""
Reel job ne background ma chalavvanu.

Ek reel banta 1 thi 5 minute lage che (AI + render). Etle HTTP request ma
raah jovay nahi — browser ke proxy vachhe j timeout kari de. Etle:

  POST /api/studio/generate  → job_id turant pacho male
  GET  /api/studio/jobs/<id> → dar 3 second e progress puchtaa raho

Ek j vakhate ketla reel banse e limit rakhi che, nahi to ffmpeg aakhu CPU
khai jaay ane server dhimo padi jaay.
"""

from __future__ import annotations

import asyncio
import time
from datetime import timedelta


from ..config import settings
from ..db import connect
from ..db import reel_jobs
from ..logs import log_activity
from .generate import GenerateInput, generate_reel
from .jobs import create_job, initial_steps, now, set_step, update_job

#: job_id → shuru thaya no vakhat
_running: dict[str, float] = {}
_queue: list[GenerateInput] = []
_lock = asyncio.Lock()

#: Job atki gayo ganvano samay — aa pachi retry thai shake.
STUCK_AFTER_SECONDS = 25 * 60


async def start_reel_job(payload: GenerateInput) -> dict:
    """Job banavo ane background ma chalu karo. job_id turant pacho male."""
    await connect()

    job = await create_job(
        {
            "brand_id": payload.brand_id,
            "avatar_id": payload.avatar_id,
            "source_image_ids": payload.image_asset_ids,
            "reference_video_id": payload.reference_video_asset_id,
            "mode": payload.mode or "single",
            "target_duration": payload.target_duration,
            "language": payload.language,
            "product_id": payload.product_id,
            "product_url": payload.product_url,
            "tone": payload.tone,
            "created_by": payload.created_by,
            "auto_distribute": payload.auto_distribute,
            "status": "queued",
            "steps": initial_steps(
                with_reference=bool(payload.reference_video_asset_id),
                with_distribute=bool(payload.auto_distribute),
            ),
        }
    )

    payload.job_id = str(job["_id"])

    async with _lock:
        if len(_running) >= settings.reel_max_concurrent:
            _queue.append(payload)
            queued = True
        else:
            queued = False
            _running[payload.job_id] = time.monotonic()

    if queued:
        await set_step(
            job["_id"], "vision",
            status="pending",
            note=f"Line ma {len(_queue)} number — thodi var ma shuru thashe",
        )
    else:
        asyncio.create_task(_run(payload))

    return {"job_id": str(job["_id"]), "queued": queued, "runner": runner_status()}


async def _run(payload: GenerateInput) -> None:
    job_id = payload.job_id or ""
    try:
        job = await generate_reel(payload)

        # Automation e kahyu hoy to jate publish pan kari do.
        auto = (job or {}).get("auto_distribute")
        if auto:
            await _auto_distribute(job, auto)

    except Exception as error:  # noqa: BLE001
        # generate_reel() jate job ne "failed" kari de che — ahiya fakt log.
        await log_activity(
            level="error",
            action="reel.runner",
            message=f"Reel job fail: {error}",
            meta={"job_id": job_id},
        )
    finally:
        async with _lock:
            _running.pop(job_id, None)
            nxt = _queue.pop(0) if _queue else None
            if nxt and nxt.job_id:
                _running[nxt.job_id] = time.monotonic()

        if nxt:
            asyncio.create_task(_run(nxt))


async def _auto_distribute(job: dict, auto: dict) -> None:
    """Reel taiyar thay ke turant publish — automation aa vaapre che."""
    from .publish import distribute_reel

    job_id = job["_id"]
    await set_step(job_id, "distribute", status="running")

    try:
        result = await distribute_reel(
            job_id=str(job_id),
            brand_id=str(job["brand_id"]),
            account_ids=auto.get("account_ids") or None,
            when=auto.get("when") or "now",
            hashtags_in_first_comment=auto.get("hashtags_in_first_comment", True),
            created_by=job.get("created_by"),
        )
        await set_step(
            job_id, "distribute",
            status="done",
            note=f"{len(result['created'])} post",
        )
    except Exception as error:  # noqa: BLE001
        await set_step(job_id, "distribute", status="failed", error=str(error)[:400])
        await update_job(
            job_id,
            {"warnings": [*(job.get("warnings") or []), f"Jate publish na thayu: {error}"]},
        )


def runner_status() -> dict:
    """Atyare ketla chali rahya che — UI ne batavva mate."""
    return {
        "running": len(_running),
        "queued": len(_queue),
        "max_concurrent": settings.reel_max_concurrent,
    }


async def reap_stuck_jobs() -> int:
    """
    Server restart thay to "running" ma atkela job kayam tya rahi jaay.

    Cron dar minute aane call kare che: atkela job ne "failed" kari de che
    (jethi user ne khabar pade) ane queue ma padela job chalu kare che.
    """
    await connect()
    reaped = 0

    # ⚠️ Comparison MONGO ne j karva devu — Python ma nahi.
    #
    # MongoDB datetime ne NAIVE (timezone vagar) pachu aape che. Python ma
    # `naive.timestamp()` ene LOCAL time ganu che, jyare kharekhar e UTC che.
    # IST (UTC+5:30) ma e 5.5 kalak no farak paade che — ane taja job pan
    # "atki gaya" ganai jata hata. Mongo ni andar badhu UTC ma j chhe, etle
    # query ma comparison karvathi aa bhool thati j nathi.
    cutoff = now() - timedelta(seconds=STUCK_AFTER_SECONDS)

    async for job in reel_jobs().find(
        {"status": "running", "updated_at": {"$lt": cutoff}}
    ):
        job_id = str(job["_id"])
        if job_id in _running:
            continue  # aa server par hju chalu che

        await reel_jobs().update_one(
            {"_id": job["_id"]},
            {
                "$set": {
                    "status": "failed",
                    "error": (
                        "Reel banavtaa vachhe atki gayu (server restart thayo hase). "
                        "Fari 'Reel banavo' dabavo."
                    ),
                    "finished_at": now(),
                }
            },
        )
        reaped += 1

    # Queue ma padela job pan chalu karo (server restart pachi).
    async for job in reel_jobs().find({"status": "queued"}).sort("created_at", 1).limit(5):
        job_id = str(job["_id"])
        async with _lock:
            if job_id in _running or len(_running) >= settings.reel_max_concurrent:
                break
            _running[job_id] = time.monotonic()

        asyncio.create_task(
            _run(
                GenerateInput(
                    brand_id=str(job.get("brand_id")),
                    image_asset_ids=[str(i) for i in (job.get("source_image_ids") or [])],
                    mode=job.get("mode"),
                    avatar_id=job.get("avatar_id"),
                    reference_video_asset_id=job.get("reference_video_id"),
                    target_duration=job.get("target_duration") or 40,
                    language=job.get("language") or "en",
                    tone=job.get("tone") or "",
                    created_by=job.get("created_by"),
                    auto_distribute=job.get("auto_distribute"),
                    job_id=job_id,
                )
            )
        )

    return reaped
