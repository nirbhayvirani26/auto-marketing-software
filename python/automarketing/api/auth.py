"""
Login, password ane session.

Saral rakhyu che: bcrypt thi password, JWT cookie thi session. Cookie
`httponly` che etle JavaScript ene vanchi shakatu nathi (XSS thi rakshan).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
import jwt
from bson import ObjectId

from ..config import settings
from ..db import brands as brands_collection
from ..db import connect
from ..db import users as users_collection
from ..errors import UserError

COOKIE_NAME = "am_session"
ALGORITHM = "HS256"
SESSION_DAYS = 7


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_token(user: dict) -> str:
    payload = {
        "sub": str(user["_id"]),
        "email": user.get("email", ""),
        "name": user.get("name", ""),
        "exp": datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def read_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


# ------------------------------------------------------------------ #
#  Users
# ------------------------------------------------------------------ #


def slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")[:60] or "brand"


async def ensure_seed_user() -> dict:
    """
    Pehli var app chale tyare admin user ane ek brand banavi de.

    Etle user ne "register" karvani jhanjhat j nathi — .env na
    SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD thi sidho login thai jaay.
    """
    await connect()

    email = settings.seed_email.lower().strip()
    existing = await users_collection().find_one({"email": email})

    if not existing:
        user = {
            "_id": ObjectId(),
            "email": email,
            "name": settings.seed_name,
            "password": hash_password(settings.seed_password),
            "created_at": datetime.now(timezone.utc),
        }
        await users_collection().insert_one(user)
        existing = user

    brand = await brands_collection().find_one({})
    if not brand:
        await brands_collection().insert_one(
            {
                "_id": ObjectId(),
                "name": "My Brand",
                "slug": "my-brand",
                "brand_voice": "friendly, confident",
                "target_audience": "",
                "created_at": datetime.now(timezone.utc),
            }
        )

    return existing


async def authenticate(email: str, password: str) -> dict:
    await connect()
    user = await users_collection().find_one({"email": email.lower().strip()})
    if not user or not verify_password(password, user.get("password", "")):
        raise UserError("Email ke password khoto che")
    return user


async def get_user(user_id: Any) -> Optional[dict]:
    await connect()
    try:
        return await users_collection().find_one({"_id": ObjectId(str(user_id))})
    except Exception:  # noqa: BLE001
        return None


async def first_user() -> Optional[dict]:
    """
    Machine (API key) mate — koi ek user joiye che.

    Aa nanu tool che, ek j admin hoy che. Vadhu user hoy to pan API key
    ne pehla user sathe jodi daiye chie — kaam ek j brand nu che.
    """
    await connect()
    return await users_collection().find_one({}, sort=[("created_at", 1)])


async def default_brand() -> dict:
    """
    Atyare ek j brand support kare che — nanu tool che, ane 90% loko ne
    ek j brand joiye che. Vadhu joiye to brands collection ma umeri shakay.
    """
    await connect()
    brand = await brands_collection().find_one({})
    if not brand:
        await ensure_seed_user()
        brand = await brands_collection().find_one({})
    if not brand:
        raise UserError("Brand madyu nahi — `python scripts/seed.py` chalavo")
    return brand
