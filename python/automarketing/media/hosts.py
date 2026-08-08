"""
Public hosting — Instagram/Facebook ne file aapva mate.

⚠️ AA AAKHA SYSTEM NU SAUTHI MOTU "GOTCHA":
   Meta na server AAPNI file DOWNLOAD kare che. Etle
   `http://localhost:8000/...` KYAREY nahi chale — public https URL joiye j.

Etle ek chain rakhi che. Uper thi niche — je chale e:

  1. base-url   — tamaru potanu domain / ngrok tunnel (sauthi saru, free)
  2. catbox     — KOI KEY NAHI, image + video, kayami rahe che
  3. cloudinary — free 25GB CDN (key joiye pan free che)
  4. tmpfiles   — koi key nahi, pan file fakt 1 kalak rahe che

Tamare kai key na joiti hoy to pan chale — catbox key vagar j chale che.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from ..config import settings
from ..errors import FatalError
from ..pipeline.chain import Candidate, ChainResult, run_chain
from ..pipeline.http import get_client


@dataclass
class UploadedFile:
    url: str
    host: str
    #: Aa URL kyare khatam thashe (khabar hoy to).
    expires_at: Optional[datetime] = None


@dataclass
class UploadInput:
    data: bytes
    filename: str
    mime_type: str
    #: "image" | "video" | "audio"
    kind: str = "image"


# ------------------------------------------------------------------ #
#  Catbox — koi key nahi (200MB sudhi)
# ------------------------------------------------------------------ #


async def _upload_catbox(item: UploadInput) -> UploadedFile:
    client = get_client()
    response = await client.post(
        "https://catbox.moe/user/api.php",
        data={"reqtype": "fileupload"},
        files={"fileToUpload": (item.filename, item.data, item.mime_type)},
        timeout=300.0,
    )

    text = (response.text or "").strip()
    if response.status_code >= 400 or not text.startswith("https://"):
        raise FatalError(f"Catbox: {text[:200] or response.status_code}")

    return UploadedFile(url=text, host="catbox")


# ------------------------------------------------------------------ #
#  tmpfiles — koi key nahi, 1 kalak
# ------------------------------------------------------------------ #


async def _upload_tmpfiles(item: UploadInput) -> UploadedFile:
    client = get_client()
    response = await client.post(
        "https://tmpfiles.org/api/v1/upload",
        files={"file": (item.filename, item.data, item.mime_type)},
        timeout=300.0,
    )
    if response.status_code >= 400:
        raise FatalError(f"tmpfiles: HTTP {response.status_code}")

    page = ((response.json() or {}).get("data") or {}).get("url")
    if not page:
        raise FatalError("tmpfiles: URL na madyu")

    # tmpfiles page nu URL aape che — direct download mate `/dl/` joiye.
    direct = page.replace("tmpfiles.org/", "tmpfiles.org/dl/", 1)
    return UploadedFile(
        url=direct,
        host="tmpfiles",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=55),
    )


# ------------------------------------------------------------------ #
#  Cloudinary — free 25GB CDN
# ------------------------------------------------------------------ #


def _cloudinary_ready() -> bool:
    return bool(settings.cloudinary_cloud and settings.cloudinary_preset)


async def _upload_cloudinary(item: UploadInput) -> UploadedFile:
    resource = "video" if item.kind in ("video", "audio") else "image"
    url = f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud}/{resource}/upload"

    client = get_client()
    response = await client.post(
        url,
        data={"upload_preset": settings.cloudinary_preset},
        files={"file": (item.filename, item.data, item.mime_type)},
        timeout=300.0,
    )

    payload = {}
    try:
        payload = response.json() or {}
    except Exception:  # noqa: BLE001
        pass

    secure_url = payload.get("secure_url")
    if response.status_code >= 400 or not secure_url:
        message = ((payload.get("error") or {}).get("message")) or response.text[:200]
        raise FatalError(f"Cloudinary: {message}")

    return UploadedFile(url=secure_url, host="cloudinary")


# ------------------------------------------------------------------ #
#  Chain
# ------------------------------------------------------------------ #


async def upload_public(
    item: UploadInput,
    *,
    prefer: Optional[str] = None,
) -> ChainResult[UploadedFile]:
    """File ne public URL par mukho. Je host chale e vaparashe."""
    anon = settings.allow_anon_hosts

    candidates = [
        Candidate[UploadedFile](
            name="cloudinary",
            label="Cloudinary (free 25GB CDN)",
            configured=_cloudinary_ready,
            run=lambda: _upload_cloudinary(item),
            timeout=300.0,
        ),
        Candidate[UploadedFile](
            name="catbox",
            label="Catbox (key vagar)",
            configured=lambda: anon,
            run=lambda: _upload_catbox(item),
            timeout=300.0,
        ),
        Candidate[UploadedFile](
            name="tmpfiles",
            label="tmpfiles.org (key vagar, 1 kalak)",
            configured=lambda: anon,
            run=lambda: _upload_tmpfiles(item),
            timeout=300.0,
        ),
    ]

    return await run_chain(
        candidates,
        label="Public media hosting",
        prefer=(prefer or settings.preferred_host),
        retries=1,
        backoff=1.5,
    )


def host_status() -> list[dict]:
    """Setup page mate."""
    anon = settings.allow_anon_hosts
    base = settings.public_media_base_url
    return [
        {
            "key": "base-url",
            "label": "Potanu domain / ngrok tunnel",
            "free": True,
            "configured": bool(base.startswith("https://")),
            "recommended": True,
            "note": (
                "SAUTHI SARU ane sav free. `ngrok http 8000` chalavo ane e https "
                "URL .env ma PUBLIC_MEDIA_BASE_URL ma nakho. Pachi koi upload "
                "karvani jarur j nathi."
            ),
        },
        {
            "key": "catbox",
            "label": "Catbox",
            "free": True,
            "configured": anon,
            "recommended": True,
            "note": "Koi key nahi — turant chale che. Image + video, kayami rahe che.",
        },
        {
            "key": "cloudinary",
            "label": "Cloudinary",
            "free": True,
            "configured": _cloudinary_ready(),
            "recommended": False,
            "note": (
                "Free 25GB CDN. cloudinary.com par signup → Settings → Upload → "
                "Add upload preset → Signing Mode: Unsigned."
            ),
        },
        {
            "key": "tmpfiles",
            "label": "tmpfiles.org",
            "free": True,
            "configured": anon,
            "recommended": False,
            "note": "Koi key nahi, pan file fakt 1 kalak rahe che. Chhelli aasha.",
        },
    ]


def cache_key(data: bytes) -> str:
    """Ek j file be var upload na thay etle."""
    return hashlib.sha256(data).hexdigest()[:32]
