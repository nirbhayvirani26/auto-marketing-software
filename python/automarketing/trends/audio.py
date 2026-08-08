"""
Reel nu music.

================== AGATYA NI VAAT — VANCHO ==================
Instagram nu "trending song" (je app ma Reels banavta vakhate dekhay che)
Graph API thi lagavi SHAKATU NATHI. Meta e music catalog API ma kholyu j
nathi — KOI PAN tool aa kari shakatu nathi, ane aa aapna code ni kami nathi.

Etle aapne be vastu aapiye chie:

  1. VIDEO MA BAKE THAYELU MUSIC — Creative Commons track je reel ni andar
     j vagse. Aa 100% auto-post thay che ane copyright strike no dar nathi.

  2. TRENDING AUDIO SUCHAV — IG app ma kaya sound shodhva e batavie chie.
     Reel publish thaya pachi IG app ma → Edit → Audio → e sound lagavo.
     Be tap nu kaam, ane tyare IG no trending-audio boost pan male.

Music na source (badha FREE):
  ccmixter — KOI KEY NAHI
  jamendo  — free key, laakho CC track
  local    — tamari potani mp3 (storage/music/ folder)
============================================================
"""

from __future__ import annotations

import json
import random
import ssl
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..config import music_dir, settings
from ..db import connect
from ..db import media as media_collection
from ..errors import FatalError, RetryableError
from ..media.store import ensure_local_path, save_from_url, save_media
from ..pipeline.chain import Candidate, run_chain
from ..pipeline.http import request_json

MOODS = (
    "upbeat",
    "chill",
    "cinematic",
    "luxury",
    "festive",
    "energetic",
    "romantic",
    "hiphop",
)

MOOD_TAGS = {
    "upbeat": "upbeat+pop+happy",
    "chill": "chillout+lounge+ambient",
    "cinematic": "cinematic+epic+electronic",
    "luxury": "elegant+jazz+lounge",
    "festive": "world+indian+festive",
    "energetic": "energetic+electronic+dance",
    "romantic": "romantic+acoustic+soft",
    "hiphop": "hiphop+trap+beat",
}

#: IG app ma kaya trending sound shodhva — mood pramane.
#: (Aa SEARCH TERMS che, actual song nahi — karan uper lakhyu che.)
IG_AUDIO_HINTS = {
    "upbeat": ["trending upbeat", "viral pop remix", "feel good trending"],
    "chill": ["aesthetic chill", "lofi trending", "soft vibes trending"],
    "cinematic": ["cinematic trending", "epic transition sound", "dramatic reveal"],
    "luxury": ["luxury aesthetic", "rich vibes trending", "elegant transition"],
    "festive": ["festive trending", "wedding trending song", "traditional remix trending"],
    "energetic": ["gym trending", "high energy transition", "workout viral"],
    "romantic": ["romantic trending", "love song trending", "soft romantic viral"],
    "hiphop": ["hiphop trending", "trap remix viral", "drip trending sound"],
}


@dataclass
class MusicTrack:
    title: str
    artist: str
    url: str
    duration: float
    license: str
    source: str


def mood_for_product(
    *,
    category: str = "",
    style: str = "",
    occasions: Optional[list[str]] = None,
    positioning: str = "",
) -> str:
    """Product ni style par thi music no mood nakki kare."""
    text = " ".join([category, style, positioning, *(occasions or [])]).lower()

    if any(w in text for w in ("wedding", "bridal", "festive", "diwali", "navratri",
                               "traditional", "ethnic", "saree", "lehenga")):
        return "festive"
    if any(w in text for w in ("luxury", "premium", "gold", "diamond", "designer",
                               "couture", "watch")):
        return "luxury"
    if any(w in text for w in ("street", "urban", "sneaker", "hoodie", "gym",
                               "sport", "active", "fitness")):
        return "hiphop"
    if any(w in text for w in ("romantic", "date", "valentine", "gift", "perfume", "jewel")):
        return "romantic"
    if any(w in text for w in ("home", "decor", "candle", "skincare", "wellness",
                               "spa", "book")):
        return "chill"
    if any(w in text for w in ("tech", "gadget", "electronic", "camera", "drone")):
        return "cinematic"
    return "upbeat"


def instagram_audio_hints(mood: str) -> dict:
    mood = mood if mood in IG_AUDIO_HINTS else "upbeat"
    return {
        "mood": mood,
        "search_terms": IG_AUDIO_HINTS[mood],
        "how_to": (
            "Reel publish thaya pachi Instagram app ma reel kholo → ⋯ → Edit → "
            "Audio → uper na koi ek shabd search karo → 'Trending' filter lagavo → "
            "sound select karo. Aa karvathi IG no trending-audio reach boost pan "
            "male che. (API thi aa automatic karvu Meta e badha mate band rakhyu che.)"
        ),
    }


# ------------------------------------------------------------------ #
#  Source 1 — ccMixter (KOI KEY NAHI)
# ------------------------------------------------------------------ #


async def _fetch_ccmixter_raw(url: str) -> str:
    """
    ccMixter BAHU MOTA response headers mokle che.

    Ek thi vadhu result magie to httpx/h11 no default header limit tuti
    jaay che. Etle ahiya sadho `http.client` vaparie chie jya header size
    vadhari shakay che. (Aa kharekhar ni bhool che — testing ma pakdai hati.)
    """
    import asyncio
    import http.client
    from urllib.parse import urlsplit

    def _blocking() -> str:
        parts = urlsplit(url)
        connection = http.client.HTTPSConnection(
            parts.netloc,
            timeout=25,
            context=ssl.create_default_context(),
        )
        # 16KB default ni jagya e 256KB.
        connection._http_vsn = 11  # noqa: SLF001
        http.client._MAXLINE = 262144  # noqa: SLF001
        http.client._MAXHEADERS = 1000  # noqa: SLF001
        try:
            path = parts.path + (f"?{parts.query}" if parts.query else "")
            connection.request(
                "GET",
                path,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Accept": "application/json",
                },
            )
            response = connection.getresponse()
            body = response.read()
            if response.status >= 400:
                raise RetryableError(f"ccMixter HTTP {response.status}")
            return body.decode("utf-8", errors="replace")
        finally:
            connection.close()

    return await asyncio.to_thread(_blocking)


async def _from_ccmixter(mood: str, min_duration: float) -> MusicTrack:
    """
    ccMixter par thi commercial-safe track shodhe.

    NonCommercial track kaadhi naakhya pachi pool nano thai jaay che, etle
    EK query par aadhaar na rakhta kram ma pahodi karta jaie chie:
    khaas tag → e j tag pan juna track sathe → sav saamanya tag.
    Pehli query ma je made e j vaparie chie.
    """
    tags = MOOD_TAGS.get(mood, "upbeat").split("+")
    primary = tags[0]

    queries = [
        f"?f=json&limit=25&tags={primary}&sinced=2+years+ago",
        f"?f=json&limit=25&tags={primary}",
        # Mood na bija shabdo (dakhla: "upbeat+pop+happy" ma thi "pop")
        *[f"?f=json&limit=25&tags={t}" for t in tags[1:3]],
        # Chhelli aasha — instrumental track lagbhag dareak reel ma bese che.
        "?f=json&limit=25&tags=instrumental",
    ]

    items: list = []
    last_error: Optional[Exception] = None

    for query in queries:
        try:
            raw = await _fetch_ccmixter_raw("https://ccmixter.org/api/query" + query)
            parsed = json.loads(raw)
        except (json.JSONDecodeError, Exception) as error:  # noqa: BLE001
            last_error = error
            continue

        if isinstance(parsed, list) and parsed:
            items = parsed
            # Aa query ma commercial-safe track che ke nahi e joi laiye —
            # na hoy to aagal ni query try karie.
            if any(
                not _is_noncommercial(i.get("license_name") or "")
                for i in parsed
            ):
                break

    if not items and last_error:
        raise RetryableError(f"ccMixter sudhi pahonchi na shakaya: {last_error}")

    candidates: list[MusicTrack] = []
    skipped_noncommercial = 0

    for item in items:
        files = item.get("files") or []
        mp3 = next(
            (f for f in files if str(f.get("download_url", "")).endswith(".mp3")), None
        )
        if not mp3:
            continue

        license_name = item.get("license_name") or "Creative Commons"

        # ⚠️ NonCommercial track NA vaparva.
        #
        # Aa tool thi tame PRODUCT VECHO cho — e commercial vaparash che.
        # "Attribution NonCommercial" valu music emaa vaparvani paravanagi
        # nathi. Reel par copyright claim aavi shake ane account ne pan
        # asar thay. Etle e track ne skip j kari daiye chie.
        if _is_noncommercial(license_name):
            skipped_noncommercial += 1
            continue

        duration = _parse_length((mp3.get("file_format_info") or {}).get("length")) or 180.0
        if duration < min_duration:
            continue

        candidates.append(
            MusicTrack(
                title=item.get("upload_name") or "Untitled",
                artist=item.get("user_name") or "ccMixter artist",
                url=mp3["download_url"],
                duration=duration,
                license=license_name,
                source="ccmixter",
            )
        )

    if not candidates:
        raise RetryableError(
            "ccMixter par aa mood no vaparva layak track na madyo"
            + (
                f" ({skipped_noncommercial} track NonCommercial hata — "
                "product vechva mate e vaparay nahi)"
                if skipped_noncommercial
                else ""
            )
        )

    return random.choice(candidates)


#: NonCommercial license na ola. ccMixter "Attribution Noncommercial",
#: "BY-NC", "noncommercial (3.0)" jevaa alag alag rite lakhe che.
_NONCOMMERCIAL = ("noncommercial", "non-commercial", "by-nc", "nc-sa", "nc 3.0")


def _is_noncommercial(license_name: str) -> bool:
    """
    Aa license commercial vaparash ne na paade che?

    Product vechva mate NC music vaparvu e license no bhang che — etle
    aavaa track pipeline ma aavva j na joiye.
    """
    text = (license_name or "").lower().replace("_", " ")
    return any(marker in text for marker in _NONCOMMERCIAL)


def _parse_length(value: Optional[str]) -> float:
    if not value:
        return 0.0
    try:
        parts = [float(p) for p in str(value).split(":")]
    except ValueError:
        return 0.0
    total = 0.0
    for part in parts:
        total = total * 60 + part
    return total


# ------------------------------------------------------------------ #
#  Source 2 — Jamendo (free key)
# ------------------------------------------------------------------ #


async def _from_jamendo(mood: str, min_duration: float) -> MusicTrack:
    params = {
        "client_id": settings.jamendo_client_id,
        "format": "json",
        "limit": "30",
        "tags": MOOD_TAGS.get(mood, "upbeat"),
        "audioformat": "mp32",
        "order": "popularity_month",
        "durationbetween": f"{int(min_duration)}_400",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    payload = await request_json(f"https://api.jamendo.com/v3.0/tracks/?{query}", timeout=30.0)

    headers = (payload or {}).get("headers") or {}
    if headers.get("status") != "success":
        raise FatalError(f"Jamendo: {headers.get('error_message') or 'fail'}")

    usable = [
        track
        for track in (payload.get("results") or [])
        if track.get("duration", 0) >= min_duration
        and (track.get("audiodownload") or track.get("audio"))
    ]
    if not usable:
        raise RetryableError("Jamendo par aa mood no track na madyo")

    pick = random.choice(usable[:15])
    return MusicTrack(
        title=pick.get("name", "Untitled"),
        artist=pick.get("artist_name", "Unknown"),
        url=pick.get("audiodownload") or pick.get("audio"),
        duration=float(pick.get("duration") or 0),
        license=pick.get("license_ccurl") or "Jamendo (Creative Commons)",
        source="jamendo",
    )


# ------------------------------------------------------------------ #
#  Source 3 — tamari potani mp3
# ------------------------------------------------------------------ #


def _local_tracks() -> list[Path]:
    directory = music_dir()
    if not directory.exists():
        return []
    return [
        path
        for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in {".mp3", ".m4a", ".wav", ".ogg"}
    ]


async def _from_local() -> MusicTrack:
    files = _local_tracks()
    if not files:
        raise FatalError(f"{music_dir()} ma ek pan audio file nathi")

    pick = random.choice(files)
    return MusicTrack(
        title=pick.stem,
        artist="Local library",
        url=pick.as_uri(),
        duration=0.0,
        license="Tamari potani file",
        source="local",
    )


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #


async def pick_music(
    *,
    mood: str,
    min_duration: float,
    brand_id: Optional[str] = None,
    prefer_uploaded: bool = True,
) -> Optional[dict]:
    """
    Ek track pasand kari, download kari, MediaAsset tarike save kare.

    Pacho `{"asset": ..., "track": MusicTrack}` aave che, ke `None` jo
    kai j na made (tyare reel chup-chaap banse — atkatu nathi).
    """
    await connect()

    # Brand e potani music upload kari hoy to e ne pehli pasandgi.
    if prefer_uploaded and brand_id:
        uploaded = [
            doc
            async for doc in media_collection()
            .find({"brand_id": brand_id, "role": "music", "provider": "upload"})
            .sort("created_at", -1)
            .limit(20)
        ]
        usable = [d for d in uploaded if not d.get("duration") or d["duration"] >= min_duration]
        if usable:
            asset = random.choice(usable)
            return {
                "asset": asset,
                "track": MusicTrack(
                    title=asset.get("filename", "upload"),
                    artist="Tamaru upload",
                    url=asset.get("public_url") or "",
                    duration=asset.get("duration") or 0.0,
                    license="Tamaru potanu",
                    source="upload",
                ),
            }

    try:
        result = await run_chain(
            [
                Candidate[MusicTrack](
                    name="ccmixter",
                    label="ccMixter (koi key nahi)",
                    configured=lambda: settings.allow_anon_hosts,
                    run=lambda: _from_ccmixter(mood, min_duration),
                    timeout=45.0,
                ),
                Candidate[MusicTrack](
                    name="jamendo",
                    label="Jamendo (free key)",
                    configured=lambda: bool(settings.jamendo_client_id),
                    run=lambda: _from_jamendo(mood, min_duration),
                    timeout=45.0,
                ),
                Candidate[MusicTrack](
                    name="local",
                    label="Tamari potani mp3",
                    configured=lambda: bool(_local_tracks()),
                    run=_from_local,
                    timeout=15.0,
                ),
            ],
            label="Reel nu music",
            retries=1,
            backoff=1.0,
        )
    except Exception:  # noqa: BLE001 — music na made to pan reel banvu joiye
        return None

    track = result.data

    try:
        # Ek j track vaar vaar download na karie.
        existing = await media_collection().find_one({"role": "music", "prompt": track.url})
        if existing:
            await ensure_local_path(existing)
            return {"asset": existing, "track": track}

        if track.url.startswith("file://"):
            from urllib.request import url2pathname
            from urllib.parse import urlsplit

            local = Path(url2pathname(urlsplit(track.url).path))
            asset = await save_media(
                local.read_bytes(),
                mime_type="audio/mpeg",
                filename=local.name,
                role="music",
                brand_id=brand_id,
                provider=track.source,
                prompt=track.url,
                duration=track.duration,
            )
        else:
            asset = await save_from_url(
                track.url,
                filename=f"{track.source}-{abs(hash(track.url)) % 10**8}.mp3",
                mime_type="audio/mpeg",
                role="music",
                brand_id=brand_id,
                provider=track.source,
                prompt=track.url,
                duration=track.duration,
            )

        await ensure_local_path(asset)
        return {"asset": asset, "track": track}
    except Exception:  # noqa: BLE001
        return None


def music_status() -> list[dict]:
    """Setup page mate."""
    return [
        {
            "key": "ccmixter",
            "label": "ccMixter",
            "free": True,
            "configured": settings.allow_anon_hosts,
            "note": "Koi key nahi — turant chale che. Creative Commons music.",
        },
        {
            "key": "jamendo",
            "label": "Jamendo",
            "free": True,
            "configured": bool(settings.jamendo_client_id),
            "note": (
                "Laakho CC track ane vadhu variety. devportal.jamendo.com par thi "
                "FREE client_id lo."
            ),
        },
        {
            "key": "local",
            "label": "Tamari potani mp3",
            "free": True,
            "configured": bool(_local_tracks()),
            "note": f"{music_dir()} folder ma mp3 mukho.",
        },
    ]
