"""
AI video clip — Google nu Gemini Omni Flash (Google Flow ma "Omni").

Aa file ffmpeg ni JAGYA E nathi. Reel to ffmpeg j banave che — e sasti,
zadapi ane bharoso layak rit che. Pan ketlak shot ma KHAREKHAR halchal
joiye che: kapdu udtu hoy, model chaale, product ferve. Ena mate aa file.

Rasto jaani joine "image → video" j rakhyo che:

    product ni photo → gpt-image-1 (scene ni image) → Omni (e j image halave)

Sidha text thi video banaviye to AI product ne potani rite kalpi le che ane
kapdu/rang badlai jaay che. Pehla image banavi ne pachi ENE J halavvathi
product jem no tem rahe che — vechan mate aa j ek maatra saacho rasto che.

API — Interactions API (https://ai.google.dev/gemini-api/docs/omni):
    POST /v1beta/interactions      → video (3-10s, 720p, 24fps)
    delivery "uri" → files/<id>    → ACTIVE thay tya sudhi rah → download
"""

from __future__ import annotations

import asyncio
import base64
import re
import time
from dataclasses import dataclass
from typing import Any, Literal, Optional

from ..config import settings
from ..errors import FatalError, NotConfigured, RetryableError
from ..media import images as imagelib
from ..pipeline.chain import Candidate, ChainResult, run_chain
from ..pipeline.http import get_client, request_bytes

GENAI_BASE = "https://generativelanguage.googleapis.com/v1beta"

#: Omni ni potani had — aa thi bahar magiye to e potani rite kaapi de che.
MIN_CLIP_SECONDS = 3
MAX_CLIP_SECONDS = 10

VideoAspectRatio = Literal["9:16", "16:9"]

OMNI_HINT = (
    "GEMINI_API_KEY joiye ane Omni tamara Google account ma chalu hovu joiye "
    "(paid tier). Aa vagar pan reel banse — ffmpeg still image ne halave che."
)


@dataclass
class GeneratedClip:
    data: bytes
    mime_type: str
    provider: str
    prompt: str


# ------------------------------------------------------------------ #
#  Config
# ------------------------------------------------------------------ #


def ai_video_configured() -> bool:
    """AI video chalu che ke nahi. `AI_VIDEO_ENABLED=false` thi bandh."""
    return settings.ai_video_enabled


def ai_video_max_clips() -> int:
    """Ek reel ma ketla AI clip banavva (0 = sav bandh)."""
    return settings.ai_video_max_clips


# ------------------------------------------------------------------ #
#  Jawab mathi video kaadhvu
# ------------------------------------------------------------------ #


def _find_video(payload: dict) -> Optional[dict]:
    """Video kya paḍyo che e shodhe — inline base64 ke Files API no URI."""
    output = payload.get("output_video") or {}
    if output.get("uri"):
        return {"uri": output["uri"], "mime_type": output.get("mime_type")}

    for step in payload.get("steps") or []:
        for content in step.get("content") or []:
            if not isinstance(content, dict):
                continue
            if content.get("type") == "video" and (content.get("data") or content.get("uri")):
                return content

    return None


def _file_id(uri: str) -> str:
    """
    Files API nu id. URI gme te aakar no hoy shake:
        files/abc123
        https://…/v1beta/files/abc123:download?alt=media
    """
    match = re.search(r"files/([^:/?#]+)", uri or "")
    return match.group(1) if match else ""


async def _wait_for_file(file_id: str) -> None:
    """
    File taiyar (ACTIVE) thay tya sudhi rah jue che.

    Omni motu video Files API ma mukе che ane e turant download layak hotu
    nathi — sidhu download karie to khali ke adhuri file aave.
    """
    client = get_client()
    deadline = time.monotonic() + 300.0

    while True:
        response = await client.get(
            f"{GENAI_BASE}/files/{file_id}",
            params={"key": settings.gemini_key},
            timeout=30.0,
        )
        if response.status_code >= 400:
            raise RetryableError(f"Omni file check: HTTP {response.status_code}")

        payload = response.json() or {}
        state = payload.get("state")

        if state in (None, "", "ACTIVE"):
            return
        if state == "FAILED":
            error = (payload.get("error") or {}).get("message") or "FAILED"
            raise FatalError(f"Omni: file process na thai — {error}")
        if time.monotonic() > deadline:
            raise RetryableError("Omni: video taiyar thata bahu var lagi")

        await asyncio.sleep(3.0)


# ------------------------------------------------------------------ #
#  Omni
# ------------------------------------------------------------------ #


async def _omni_clip(
    prompt: str,
    image: Optional[bytes],
    aspect: VideoAspectRatio,
    duration: int,
) -> GeneratedClip:
    api_key = settings.gemini_key
    if not api_key:
        raise NotConfigured(OMNI_HINT)

    model = settings.omni_model

    # Omni pase `duration` no parameter nathi — e prompt mathi j samje che.
    prompt_text = "\n".join(
        [
            prompt.strip(),
            "",
            f"Duration: about {duration} seconds. One single continuous shot, no cuts.",
            "Keep every product, garment, colour, print and face exactly as in the "
            "reference image — animate it, do not redesign it.",
            "No on-screen text, no captions, no subtitles, no logos, no watermarks.",
        ]
    )

    parts: list[dict[str, Any]] = []
    if image:
        b64, _ = imagelib.prepare_for_vision(image, max_side=1024)
        parts.append({"type": "image", "mime_type": "image/jpeg", "data": b64})
    parts.append({"type": "text", "text": prompt_text})

    client = get_client()
    try:
        response = await client.post(
            f"{GENAI_BASE}/interactions",
            params={"key": api_key},
            json={
                "model": model,
                # Fakt text hoy to Omni sadhi string pan sweekare che, pan
                # array hamesha chale che — etle ek j rasto rakhie chie.
                "input": parts,
                "response_format": {
                    "type": "video",
                    "aspect_ratio": aspect,
                    # Video mota bhage 4MB thi motu hoy che ane tyare inline
                    # base64 aavtu nathi — etle hamesha URI j magie chie.
                    "delivery": "uri",
                },
            },
            timeout=360.0,
        )
    except Exception as error:  # noqa: BLE001
        raise RetryableError(f"Omni sudhi pahonchi na shakaya: {error}") from error

    if response.status_code >= 400:
        message = f"Omni: HTTP {response.status_code} {response.text[:300]}"
        if response.status_code == 429 or response.status_code >= 500:
            raise RetryableError(message)
        raise FatalError(message)

    payload = response.json() or {}

    if payload.get("error"):
        error = payload["error"]
        raise FatalError(f"Omni: {error.get('message') or error.get('status') or error}")

    status = payload.get("status")
    if status and status != "completed":
        raise RetryableError(f"Omni: status {status}")

    video = _find_video(payload)
    if not video:
        raise RetryableError("Omni e video na aapyu")

    mime_type = video.get("mime_type") or "video/mp4"

    if video.get("data"):
        data = base64.b64decode(video["data"])
    else:
        file_id = _file_id(video.get("uri") or "")
        if not file_id:
            raise RetryableError(f"Omni no video URI samjayo nahi: {video.get('uri')}")

        await _wait_for_file(file_id)

        data = await request_bytes(
            f"{GENAI_BASE}/files/{file_id}:download",
            params={"alt": "media", "key": api_key},
            timeout=300.0,
        )

    if len(data) < 10_000:
        raise RetryableError("Omni e khali file aapi")

    return GeneratedClip(
        data=data,
        mime_type=mime_type,
        provider=f"omni:{model}",
        prompt=prompt,
    )


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #


async def generate_video_clip(
    prompt: str,
    *,
    image: Optional[bytes] = None,
    aspect: VideoAspectRatio = "9:16",
    duration: float = 5.0,
    prefer: str = "",
) -> ChainResult[GeneratedClip]:
    """
    Ek AI video clip banave.

    Fail thay to `ChainError` phenke che — call karnaar e pakadi ne still
    image par pachho vali javu joiye. Reel aana karane kyarey atakvu na joiye.
    """
    seconds = int(round(max(MIN_CLIP_SECONDS, min(MAX_CLIP_SECONDS, duration))))

    return await run_chain(
        [
            Candidate[GeneratedClip](
                name="omni",
                label="Gemini Omni Flash",
                free=False,
                configured=ai_video_configured,
                run=lambda: _omni_clip(prompt, image, aspect, seconds),
                # 10s no clip banta ~1-2 minute lage che.
                timeout=380.0,
            )
        ],
        label="AI video",
        prefer=(prefer or settings.preferred_video_provider),
        prefer_free=False,
        retries=1,
        backoff=5.0,
    )


def aivideo_status() -> list[dict]:
    """Setup page mate — AI video taiyar che ke nahi."""
    ready = ai_video_configured()
    return [
        {
            "key": "omni",
            "label": f"Gemini Omni Flash ({settings.omni_model})",
            "free": False,
            "configured": ready,
            "note": (
                f"Reel dith {ai_video_max_clips()} clip sudhi — AI_VIDEO_MAX_CLIPS thi badlo"
                if ready
                else OMNI_HINT
            ),
        }
    ]
