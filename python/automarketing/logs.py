"""
Activity log.

Shu thayu, kyare thayu, ane fail thayu to KEM — badhu ek jagya e.
Log 90 divas pachi Mongo jate kadhi naakhe che (TTL index).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from .db import connect
from .db import logs as logs_collection


async def log_activity(
    *,
    action: str,
    message: str,
    level: str = "info",  # info | success | warning | error
    brand_id: Optional[str] = None,
    actor: str = "",
    meta: Optional[dict[str, Any]] = None,
) -> None:
    """Log lakhe. Aa kyarey exception nathi fenkato — log ne lidhe kaam
    atkavu na joiye."""
    try:
        await connect()
        await logs_collection().insert_one(
            {
                "level": level,
                "action": action,
                "message": message[:2000],
                "brand_id": brand_id,
                "actor": actor,
                "meta": meta or {},
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception:  # noqa: BLE001
        pass


async def recent_logs(
    *, brand_id: Optional[str] = None, level: str = "", limit: int = 100
) -> list[dict]:
    await connect()
    query: dict[str, Any] = {}
    if brand_id:
        query["brand_id"] = brand_id
    if level:
        query["level"] = level

    return [
        {**doc, "_id": str(doc["_id"])}
        async for doc in logs_collection().find(query).sort("created_at", -1).limit(limit)
    ]
