"""
Media store — badhi image / video / audio file ahiya thi j pasar thay che.

Dareak file be jagya e rahe che:
  disk   — `storage/media/...` — render pipeline ne local file joiye che
  public — Catbox/Cloudinary/tunnel — Meta ne download karva mate URL joiye

Etle "save karo" ek j call che, ane public URL jarur pade tyare j bane che.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from bson import ObjectId

from ..config import media_dir, settings
from ..db import media as media_collection
from ..db import connect
from ..errors import UserError
from ..pipeline.http import request_bytes
from . import images as imagelib
from .hosts import UploadInput, upload_public

# ------------------------------------------------------------------ #
#  Helpers
# ------------------------------------------------------------------ #

EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
}

MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024  # 200MB


def extension_for(mime_type: str, fallback: str = ".bin") -> str:
    return EXTENSIONS.get(mime_type.split(";")[0].strip().lower(), fallback)


def kind_for(mime_type: str) -> str:
    mime = mime_type.lower()
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    return "other"


def safe_name(name: str) -> str:
    """Path traversal band — fakt basename ane surakshit akshar."""
    base = Path(name).name
    cleaned = "".join(ch if (ch.isalnum() or ch in "._-") else "_" for ch in base)
    return cleaned[:80] or "file"


def now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ #
#  Save
# ------------------------------------------------------------------ #


async def save_media(
    data: bytes,
    *,
    mime_type: str,
    filename: str = "",
    role: str = "other",
    brand_id: Optional[str] = None,
    provider: str = "",
    prompt: str = "",
    duration: Optional[float] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    make_public: bool = False,
) -> dict:
    """Bytes ne disk par lakhe, DB ma record banave, ane asset pacho aape."""
    await connect()

    kind = kind_for(mime_type)
    ext = extension_for(mime_type, Path(filename).suffix or ".bin")
    asset_id = ObjectId()

    base = safe_name(filename or f"{role}{ext}")
    if not base.lower().endswith(ext.lower()):
        base = f"{base}{ext}"
    stored = f"{uuid.uuid4().hex[:12]}-{base}"

    bucket = now().strftime("%Y-%m")
    directory = media_dir() / bucket
    directory.mkdir(parents=True, exist_ok=True)

    local_path = directory / stored
    local_path.write_bytes(data)

    if kind == "image" and (not width or not height):
        meta = imagelib.info(data)
        if meta:
            width, height = meta.width, meta.height

    document = {
        "_id": asset_id,
        "brand_id": brand_id,
        "kind": kind,
        "role": role,
        "filename": stored,
        "mime_type": mime_type,
        "bytes": len(data),
        "local_path": str(local_path),
        "public_url": None,
        "host": "local",
        "width": width,
        "height": height,
        "duration": duration,
        "provider": provider,
        "prompt": prompt[:2000],
        "expires_at": None,
        "created_at": now(),
    }

    await media_collection().insert_one(document)

    if make_public:
        await ensure_public_url(document)

    return document


async def save_from_url(
    url: str,
    *,
    filename: str = "",
    mime_type: str = "",
    role: str = "other",
    brand_id: Optional[str] = None,
    provider: str = "",
    prompt: str = "",
    duration: Optional[float] = None,
) -> dict:
    """Bahar na URL par thi file lai ne store ma mukhe."""
    if not url.lower().startswith(("http://", "https://")):
        raise UserError(f"Khotu URL: {url[:120]}")

    # `request_bytes` Referer ane browser User-Agent aapoaap mokle che —
    # ghani site (dakhla: ccMixter) vagar 403 aape che.
    data = await request_bytes(url, timeout=300.0)

    if len(data) > MAX_DOWNLOAD_BYTES:
        raise UserError(f"File bahu moti che ({len(data) // 1024 // 1024}MB)")

    if not mime_type:
        # Extension par thi andaj — server no content-type bharoso layak nathi.
        suffix = Path(url.split("?")[0]).suffix.lower()
        reverse = {v: k for k, v in EXTENSIONS.items()}
        mime_type = reverse.get(suffix, "application/octet-stream")

    return await save_media(
        data,
        mime_type=mime_type,
        filename=filename or safe_name(Path(url.split("?")[0]).name or "download"),
        role=role,
        brand_id=brand_id,
        provider=provider,
        prompt=prompt or url,
        duration=duration,
    )


# ------------------------------------------------------------------ #
#  Read
# ------------------------------------------------------------------ #


async def get_asset(asset_id: Any) -> Optional[dict]:
    await connect()
    try:
        oid = ObjectId(str(asset_id))
    except Exception:  # noqa: BLE001
        return None
    return await media_collection().find_one({"_id": oid})


async def get_assets(asset_ids: list[Any]) -> list[dict]:
    """Ghani asset ek saathe — ane USER e aapel KRAM ma pachi aape."""
    await connect()

    oids = []
    for value in asset_ids:
        try:
            oids.append(ObjectId(str(value)))
        except Exception:  # noqa: BLE001
            continue

    if not oids:
        return []

    found = {doc["_id"]: doc async for doc in media_collection().find({"_id": {"$in": oids}})}
    return [found[oid] for oid in oids if oid in found]


async def read_bytes(asset: dict) -> bytes:
    """Asset ni file vanche — disk par thi, nahi to public URL par thi."""
    local = asset.get("local_path")
    if local and Path(local).exists():
        return Path(local).read_bytes()

    public = asset.get("public_url")
    if public:
        # Local file gum thai gai pan public URL che — tya thi pachi laviye.
        return await request_bytes(public, timeout=300.0)

    raise UserError(f"Media file madi nahi: {asset.get('filename')}")


async def ensure_local_path(asset: dict) -> Path:
    """Local path aapo — na hoy to public URL par thi download karo."""
    local = asset.get("local_path")
    if local and Path(local).exists():
        return Path(local)

    data = await read_bytes(asset)
    directory = media_dir() / "restored"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / asset["filename"]
    target.write_bytes(data)

    asset["local_path"] = str(target)
    await media_collection().update_one(
        {"_id": asset["_id"]}, {"$set": {"local_path": str(target)}}
    )
    return target


# ------------------------------------------------------------------ #
#  Public URL
# ------------------------------------------------------------------ #


def _still_valid(asset: dict) -> bool:
    if not asset.get("public_url"):
        return False
    expires = asset.get("expires_at")
    if not expires:
        return True
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    # Ochha ma ochhi 2 minute baaki hovi joiye — Meta ne download karva
    # jetlo vakhat male.
    return (expires - now()).total_seconds() > 120


async def ensure_public_url(asset: dict, *, prefer: Optional[str] = None) -> str:
    """
    Asset ne public URL aapo — nahi hoy to atyare j banavo.

    Kram:
      1. Pehle thi URL che ane hju valid che → e j
      2. PUBLIC_MEDIA_BASE_URL set che → aapno potano /api/media route
         (sauthi saru — koi upload j nahi)
      3. Nahi to host chain (Catbox → Cloudinary → tmpfiles)
    """
    if _still_valid(asset):
        return asset["public_url"]

    base = settings.public_media_base_url
    if base.lower().startswith("https://"):
        url = f"{base}/api/media/{asset['_id']}"
        await media_collection().update_one(
            {"_id": asset["_id"]},
            {"$set": {"public_url": url, "host": "base-url", "expires_at": None}},
        )
        asset.update({"public_url": url, "host": "base-url", "expires_at": None})
        return url

    data = await read_bytes(asset)
    result = await upload_public(
        UploadInput(
            data=data,
            filename=asset["filename"],
            mime_type=asset["mime_type"],
            kind=asset.get("kind", "image"),
        ),
        prefer=prefer,
    )

    uploaded = result.data
    await media_collection().update_one(
        {"_id": asset["_id"]},
        {
            "$set": {
                "public_url": uploaded.url,
                "host": uploaded.host,
                "expires_at": uploaded.expires_at,
            }
        },
    )
    asset.update(
        {
            "public_url": uploaded.url,
            "host": uploaded.host,
            "expires_at": uploaded.expires_at,
        }
    )
    return uploaded.url


async def delete_media(asset: dict) -> None:
    local = asset.get("local_path")
    if local:
        try:
            Path(local).unlink(missing_ok=True)
        except OSError:
            pass
    await media_collection().delete_one({"_id": asset["_id"]})


def public_view(asset: dict) -> dict:
    """API ma bahar aapva layak saaf object."""
    return {
        "id": str(asset["_id"]),
        "kind": asset.get("kind"),
        "role": asset.get("role"),
        "filename": asset.get("filename"),
        "mime_type": asset.get("mime_type"),
        "bytes": asset.get("bytes"),
        "width": asset.get("width"),
        "height": asset.get("height"),
        "duration": asset.get("duration"),
        "public_url": asset.get("public_url"),
        "preview_url": f"/api/media/{asset['_id']}",
        "created_at": asset.get("created_at"),
    }
