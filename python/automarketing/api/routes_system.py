"""
System status ane "badhu kharekhar chale che?" test.

"Key set che" ane "key KAAM kare che" — e be alag vaat che (dakhla:
key barabar hoy pan credit khatam hoy). Etle be route che:

  GET  /api/system/status  — fakt "su configure che" (fast)
  POST /api/system/probe   — dareak service ne EK NANI SACHI request
"""

from __future__ import annotations

import time
from typing import Any, Callable

from fastapi import APIRouter, Depends

from ..ai.base import CompletionRequest, VisionRequest
from ..ai.registry import configured_providers, no_provider_message, provider_status
from ..ai.vision import ask_vision, vision_status
from ..config import settings
from ..db import is_reachable
from ..media import images as imagelib
from ..media.hosts import UploadInput, host_status, upload_public
from ..media.imagegen import generate_image, imagegen_status
from ..pipeline.chain import breaker_status
from ..pipeline.http import request_bytes
from ..reels.runner import runner_status
from ..social.graph import app_access_token
from ..trends.audio import music_status, pick_music
from ..video.aivideo import aivideo_status
from ..trends.keywords import google_autocomplete, google_daily_trends
from ..video.ffmpeg import engine_status
from ..video.fonts import font_status
from ..video.voiceover import generate_voiceover, voiceover_status
from .deps import current_user, ok

router = APIRouter(prefix="/api/system", tags=["system"])


# ------------------------------------------------------------------ #
#  Status — fast, fakt config
# ------------------------------------------------------------------ #


@router.get("/status")
async def status(user: dict = Depends(current_user)):
    """"Badhu barabar che ke nahi" — ek j najar ma."""
    engine = engine_status()
    fonts = font_status()
    hosts = host_status()

    groups = [
        {
            "key": "text",
            "title": "AI — lakhan (caption, script, hashtags)",
            "required": True,
            "ready": any(p["configured"] for p in provider_status()),
            "why": (
                "Aa vagar caption ane reel no script nahi bane. "
                "Groq ke Gemini ni FREE key sauthi saral che."
            ),
            "providers": provider_status(),
        },
        {
            "key": "vision",
            "title": "AI — image samajvi",
            "required": True,
            "ready": any(p["configured"] for p in vision_status()),
            "why": (
                "Aa vagar 'khali image aapo' valu kaam nahi thay — product ni "
                "vigat AI kadhi nahi shake."
            ),
            "providers": vision_status(),
        },
        {
            "key": "video",
            "title": "Video engine (ffmpeg + font)",
            "required": True,
            "ready": engine.get("ready", False) and any(f["ok"] for f in fonts),
            "why": (
                "Reel render karva mate. `python scripts/fetch_ffmpeg.py` ane "
                "`python scripts/fetch_fonts.py` — banne free."
            ),
            "providers": [
                {
                    "key": "ffmpeg",
                    "label": "ffmpeg",
                    "free": True,
                    "configured": engine.get("ready", False),
                    "note": engine.get("version") or engine.get("error", ""),
                },
                {
                    "key": "xfade",
                    "label": "Transitions (xfade)",
                    "free": True,
                    "configured": engine.get("has_xfade", False),
                    "note": engine.get("note") or "Scene vachhe smooth transition",
                },
                *[
                    {
                        "key": f"font-{f['script']}",
                        "label": f"Font — {f['script']}",
                        "free": True,
                        "configured": f["ok"],
                        "note": f.get("path") or f.get("error", ""),
                    }
                    for f in fonts
                ],
            ],
        },
        {
            "key": "hosting",
            "title": "Public media hosting",
            "required": True,
            "ready": any(h["configured"] for h in hosts),
            "why": (
                "Meta na server tamari file DOWNLOAD kare che — etle public https "
                "URL joiye j. localhost kyarey nahi chale."
            ),
            "providers": hosts,
        },
        {
            "key": "image-gen",
            "title": "AI image (avatar + kapda, lifestyle shots)",
            "required": False,
            "ready": any(p["configured"] for p in imagegen_status()),
            "why": "Na hoy to pan reel banse — fakt tamari upload kareli image thi.",
            "providers": imagegen_status(),
        },
        {
            "key": "ai-video",
            "title": "AI video clip (Gemini Omni)",
            "required": False,
            "ready": any(p["configured"] for p in aivideo_status()),
            "why": (
                "Marji nu. Na hoy to ffmpeg still image ne halavine reel banave che — "
                "e pan saru j dekhay che. Hoy to hook jeva 1-2 shot ma KHAREKHAR "
                "halchal aave che (kapdu udtu, model fare)."
            ),
            "providers": aivideo_status(),
        },
        {
            "key": "music",
            "title": "Reel nu music",
            "required": False,
            "ready": any(p["configured"] for p in music_status()),
            "why": (
                "Na hoy to reel chup banse. (Note: Instagram nu trending song API "
                "thi lagavi shakatu J NATHI — app publish pachi suchav aape che.)"
            ),
            "providers": music_status(),
        },
        {
            "key": "voice",
            "title": "Voiceover",
            "required": False,
            "ready": any(p["configured"] for p in voiceover_status()),
            "why": "Marji nu. Awaj hoy to watch-time vadhare thay che.",
            "providers": voiceover_status(),
        },
        {
            "key": "meta",
            "title": "Instagram / Facebook connect",
            "required": True,
            "ready": bool(settings.meta_app_id and settings.meta_app_secret),
            "why": "Auto-post karva mate. developers.facebook.com par app banavo (free).",
            "providers": [
                {
                    "key": "meta-app",
                    "label": "Meta App (ID + Secret)",
                    "free": True,
                    "configured": bool(settings.meta_app_id and settings.meta_app_secret),
                    "note": "Facebook Login + Instagram Graph API product add karo",
                }
            ],
        },
        {
            "key": "db",
            "title": "MongoDB",
            "required": True,
            "ready": await is_reachable(),
            "why": "Badho data ahiya rahe che. `mongod` chalu hovo joiye.",
            "providers": [
                {
                    "key": "mongodb",
                    "label": "MongoDB",
                    "free": True,
                    "configured": await is_reachable(),
                    "note": settings.mongodb_uri,
                }
            ],
        },
    ]

    blocking = [g for g in groups if g["required"] and not g["ready"]]

    return ok(
        {
            "ready": not blocking,
            "blocking": [
                {"key": g["key"], "title": g["title"], "why": g["why"]} for g in blocking
            ],
            "groups": groups,
            "runner": runner_status(),
            "circuit_breakers": breaker_status(),
            "no_ai_help": no_provider_message() if not configured_providers() else "",
        }
    )


# ------------------------------------------------------------------ #
#  Probe — kharekhar chale che ke nahi
# ------------------------------------------------------------------ #


async def _step(
    key: str,
    label: str,
    required: bool,
    fix: str,
    runner: Callable[[], Any],
) -> dict:
    started = time.monotonic()
    try:
        detail = await runner()
        return {
            "key": key,
            "label": label,
            "required": required,
            "ok": True,
            "ms": int((time.monotonic() - started) * 1000),
            "detail": str(detail),
        }
    except Exception as error:  # noqa: BLE001
        return {
            "key": key,
            "label": label,
            "required": required,
            "ok": False,
            "ms": int((time.monotonic() - started) * 1000),
            "error": str(error)[:800],
            "fix": fix,
        }


@router.post("/probe")
async def probe(user: dict = Depends(current_user)):
    """Dareak service ne ek nani SACHI request — thoda token vaparay che."""
    results: list[dict] = []
    image = imagelib.make_solid(256, 256, (30, 120, 200))

    # ---- MongoDB ----
    async def check_db():
        if not await is_reachable():
            raise RuntimeError("MongoDB sudhi pahonchi na shakaya")
        return settings.mongodb_db

    results.append(
        await _step(
            "db", "MongoDB", True,
            "`mongod` chalu karo, ke .env ma MONGODB_URI barabar karo.",
            check_db,
        )
    )

    # ---- ffmpeg ----
    async def check_video():
        engine = engine_status()
        if not engine.get("ready"):
            raise RuntimeError(engine.get("error") or "ffmpeg madyu nahi")
        fonts = [f for f in font_status() if f["ok"]]
        if not fonts:
            raise RuntimeError("Ek pan font na madyo")
        return f"{engine['version'][:60]} · {len(fonts)} font"

    results.append(
        await _step(
            "video", "Video engine (ffmpeg + font)", True,
            "`python scripts/fetch_ffmpeg.py` ane `python scripts/fetch_fonts.py` chalavo.",
            check_video,
        )
    )

    # ---- Text AI ----
    for provider in configured_providers():
        async def check_text(p=provider):
            await p.complete(
                CompletionRequest(
                    system="Reply with JSON only.",
                    prompt='Return exactly {"word":"ok"}',
                    schema={
                        "type": "object",
                        "properties": {"word": {"type": "string"}},
                        "required": ["word"],
                    },
                    max_tokens=50,
                )
            )
            return p.model

        results.append(
            await _step(
                f"text:{provider.key}", f"AI lakhan — {provider.label}", False,
                provider.missing_key_hint(), check_text,
            )
        )

    if not configured_providers():
        results.append(
            {
                "key": "text",
                "label": "AI lakhan",
                "required": True,
                "ok": False,
                "ms": 0,
                "error": "Ek pan AI key set nathi",
                "fix": no_provider_message(),
            }
        )

    # ---- Vision ----
    async def check_vision():
        result = await ask_vision(
            [image],
            VisionRequest(
                system="Reply with JSON only.",
                prompt="Dominant colour in one word.",
                schema={
                    "type": "object",
                    "properties": {"colour": {"type": "string"}},
                    "required": ["colour"],
                },
                max_tokens=60,
            ),
        )
        return result.provider

    results.append(
        await _step(
            "vision", "AI — image samajvi", True,
            "GEMINI_API_KEY (free) naakho — aistudio.google.com/apikey",
            check_vision,
        )
    )

    # ---- Hosting ----
    async def check_hosting():
        if settings.public_media_base_url.lower().startswith("https://"):
            return f"potanu URL: {settings.public_media_base_url}"

        uploaded = await upload_public(
            UploadInput(
                data=image,
                filename=f"probe-{int(time.time())}.jpg",
                mime_type="image/jpeg",
                kind="image",
            )
        )
        # Kharekhar bahar thi khule che ke nahi — AA J asal test che.
        fetched = await request_bytes(uploaded.data.url, timeout=45.0)
        if len(fetched) < 500:
            raise RuntimeError("URL khulyu pan file khali aavi")
        return f"{uploaded.data.host} · bahar thi khule che"

    results.append(
        await _step(
            "hosting", "Public media hosting", True,
            "MEDIA_ALLOW_ANON_HOSTS=true rakho (Catbox key vagar chale che), ke "
            "`ngrok http 8000` chalavi ne PUBLIC_MEDIA_BASE_URL set karo.",
            check_hosting,
        )
    )

    # ---- Trends ----
    async def check_trends():
        words = await google_autocomplete("cotton kurti", settings.trends_geo)
        topics = await google_daily_trends(settings.trends_geo)
        if not words and not topics:
            raise RuntimeError("Google par thi kai na madyu")
        return f"{len(words)} keyword · {len(topics)} topic"

    results.append(
        await _step(
            "trends", "Trends (Google, key vagar)", False,
            "Internet/proxy check karo. Aa na chale to pan AI hashtag banavi de che.",
            check_trends,
        )
    )

    # ---- Image generation ----
    async def check_imagegen():
        result = await generate_image(
            "A plain blue ceramic mug on a white table, soft daylight",
            aspect="9:16",
            fit=False,
        )
        meta = imagelib.info(result.data.data)
        return f"{result.data.provider} · {meta.width}x{meta.height}" if meta else result.data.provider

    results.append(
        await _step(
            "image-gen", "AI image", False,
            "Pollinations key vagar chale che (MEDIA_ALLOW_ANON_HOSTS=true). "
            "Avatar mate GEMINI_API_KEY naakho.",
            check_imagegen,
        )
    )

    # ---- Music ----
    async def check_music():
        picked = await pick_music(mood="upbeat", min_duration=30)
        if not picked:
            raise RuntimeError("Ek pan track na madyo")
        return f"{picked['track'].source} · {picked['track'].title[:30]}"

    results.append(
        await _step(
            "music", "Reel nu music", False,
            "ccMixter key vagar chale che. Vadhu variety mate JAMENDO_CLIENT_ID (free).",
            check_music,
        )
    )

    # ---- Voiceover ----
    async def check_voice():
        result = await generate_voiceover(text="Short voiceover test.", language="en")
        return f"{result.data.provider} · {len(result.data.data) // 1024} KB"

    results.append(
        await _step(
            "voice", "Voiceover", False,
            "`pip install edge-tts` (pehle thi thai gayu che) — koi key joiti nathi.",
            check_voice,
        )
    )

    # ---- Meta ----
    async def check_meta():
        await app_access_token()
        return f"app {settings.meta_app_id} barabar che"

    results.append(
        await _step(
            "meta", "Instagram / Facebook app", True,
            "developers.facebook.com/apps → META_APP_ID + META_APP_SECRET",
            check_meta,
        )
    )

    blocking = [r for r in results if r["required"] and not r["ok"]]
    passed = sum(1 for r in results if r["ok"])

    return ok(
        {
            "ready": not blocking,
            "passed": passed,
            "failed": len(results) - passed,
            "blocking": [
                {"label": r["label"], "error": r.get("error"), "fix": r.get("fix")}
                for r in blocking
            ],
            "results": results,
        }
    )
