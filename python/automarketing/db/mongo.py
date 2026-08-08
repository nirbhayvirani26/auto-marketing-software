"""
MongoDB connection ane collections.

ORM nathi vaparyu — Motor na collection sidha j vaparie chie. Aa nana
app mate vadhu saaf che ane su thai rahyu che e sidhu dekhay che.

TS app ane Python app na database ALAG che (`auto_marketing` vs
`auto_marketing_py`) jethi ek bija na data ne aado na aave.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from ..config import settings

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None
_indexes_ready = False
_lock = asyncio.Lock()


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=8000,
            maxPoolSize=20,
        )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    global _db
    if _db is None:
        _db = get_client()[settings.mongodb_db]
    return _db


async def connect() -> AsyncIOMotorDatabase:
    """
    Connect kare ane (ek j var) index banave.

    Index na hoy to 1000 post pachi app dhimu padi jaay — etle shuru ma j
    banavi daiye chie.
    """
    global _indexes_ready

    db = get_db()
    await db.command("ping")

    if not _indexes_ready:
        async with _lock:
            if not _indexes_ready:
                await _ensure_indexes(db)
                _indexes_ready = True

    return db


async def close() -> None:
    global _client, _db, _indexes_ready
    if _client is not None:
        _client.close()
    _client = None
    _db = None
    _indexes_ready = False


async def is_reachable() -> bool:
    try:
        await connect()
        return True
    except Exception:  # noqa: BLE001
        return False


# ------------------------------------------------------------------ #
#  Collections
# ------------------------------------------------------------------ #


class Collections:
    USERS = "users"
    BRANDS = "brands"
    ACCOUNTS = "social_accounts"
    AVATARS = "avatars"
    MEDIA = "media_assets"
    REEL_JOBS = "reel_jobs"
    POSTS = "posts"
    TRENDS = "trend_snapshots"
    LOGS = "activity_logs"
    AUTOMATIONS = "automations"


def users():
    return get_db()[Collections.USERS]


def brands():
    return get_db()[Collections.BRANDS]


def accounts():
    return get_db()[Collections.ACCOUNTS]


def avatars():
    return get_db()[Collections.AVATARS]


def media():
    return get_db()[Collections.MEDIA]


def reel_jobs():
    return get_db()[Collections.REEL_JOBS]


def posts():
    return get_db()[Collections.POSTS]


def trends():
    return get_db()[Collections.TRENDS]


def logs():
    return get_db()[Collections.LOGS]


def automations():
    return get_db()[Collections.AUTOMATIONS]


# ------------------------------------------------------------------ #
#  Indexes
# ------------------------------------------------------------------ #


async def _ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[Collections.USERS].create_index([("email", ASCENDING)], unique=True)

    await db[Collections.BRANDS].create_index([("slug", ASCENDING)], unique=True)

    await db[Collections.ACCOUNTS].create_index(
        [("brand_id", ASCENDING), ("platform", ASCENDING)]
    )
    # Ek j Page/IG account be var na aavvu joiye.
    await db[Collections.ACCOUNTS].create_index(
        [("brand_id", ASCENDING), ("external_id", ASCENDING)], unique=True
    )

    await db[Collections.AVATARS].create_index(
        [("brand_id", ASCENDING), ("name", ASCENDING)], unique=True
    )

    await db[Collections.MEDIA].create_index(
        [("brand_id", ASCENDING), ("role", ASCENDING), ("created_at", DESCENDING)]
    )

    await db[Collections.REEL_JOBS].create_index(
        [("brand_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)]
    )

    await db[Collections.POSTS].create_index(
        [("status", ASCENDING), ("scheduled_at", ASCENDING)]
    )
    await db[Collections.POSTS].create_index(
        [("brand_id", ASCENDING), ("created_at", DESCENDING)]
    )

    # Trend cache jaate saaf thai jaay.
    await db[Collections.TRENDS].create_index(
        [("kind", ASCENDING), ("subject", ASCENDING), ("geo", ASCENDING)], unique=True
    )
    await db[Collections.TRENDS].create_index("expires_at", expireAfterSeconds=0)

    # Log 90 divas pachi jaate kadhi naakho — DB bharai na jaay.
    await db[Collections.LOGS].create_index(
        "created_at", expireAfterSeconds=90 * 24 * 3600
    )

    await db[Collections.AUTOMATIONS].create_index([("next_run_at", ASCENDING)])
