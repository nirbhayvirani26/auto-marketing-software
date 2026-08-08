#!/usr/bin/env python
"""
Bahar ni badhi service ne EK NANI SACHI request mokle che.

    python scripts/probe_services.py

"Key set che" ane "key KAAM kare che" — e be alag vaat che. Dakhla tarike
key barabar hoy pan credit khatam hoy, ke free limit lagi hoy. Aa script
e j pakde che, ane SU KARVU e pan kahe che.

(Aa j test app ma Setup tab par button tarike pan che.)
"""

from __future__ import annotations

import _console  # noqa: F401  (Windows console UTF-8)

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from automarketing.ai.base import CompletionRequest, VisionRequest  # noqa: E402
from automarketing.ai.registry import configured_providers, no_provider_message  # noqa: E402
from automarketing.ai.vision import ask_vision  # noqa: E402
from automarketing.config import settings  # noqa: E402
from automarketing.db import close as close_db  # noqa: E402
from automarketing.db import is_reachable  # noqa: E402
from automarketing.media import images as imagelib  # noqa: E402
from automarketing.media.hosts import UploadInput, upload_public  # noqa: E402
from automarketing.media.imagegen import generate_image  # noqa: E402
from automarketing.pipeline.http import close_client, request_bytes  # noqa: E402
from automarketing.social.graph import app_access_token  # noqa: E402
from automarketing.trends.audio import pick_music  # noqa: E402
from automarketing.trends.keywords import google_autocomplete, google_daily_trends  # noqa: E402
from automarketing.video.ffmpeg import engine_status  # noqa: E402
from automarketing.video.fonts import font_status  # noqa: E402
from automarketing.video.voiceover import generate_voiceover  # noqa: E402

rows: list[dict] = []


async def step(label: str, required: bool, fix: str, runner) -> None:
    print(f"  … {label}".ljust(48), end="", flush=True)
    started = time.monotonic()
    try:
        note = await runner()
        secs = time.monotonic() - started
        print(f"\r  ✓ {label:<42} {note}  ({secs:.1f}s)")
        rows.append({"label": label, "required": required, "ok": True, "note": str(note)})
    except Exception as error:  # noqa: BLE001
        first = str(error).split("\n")[0][:150]
        print(f"\r  ✗ {label:<42} {first}")
        rows.append(
            {"label": label, "required": required, "ok": False, "note": str(error), "fix": fix}
        )


async def main() -> int:
    print("\n╔══════════════════════════════════════════════════════════╗")
    print("║  Badhi service kharekhar chale che ke nahi               ║")
    print("╚══════════════════════════════════════════════════════════╝\n")

    image = imagelib.make_solid(256, 256, (30, 120, 200))

    # ---- MongoDB (sauthi pehla — DB band hoy to bija test khota karan
    #      sathe fail thay ane user gothvai jaay) ----
    async def check_db():
        if not await is_reachable():
            raise RuntimeError("MongoDB sudhi pahonchi na shakaya")
        return settings.mongodb_db

    await step(
        "MongoDB", True,
        "`mongod` chalu karo (bija terminal ma), ke .env ma MONGODB_URI barabar karo.",
        check_db,
    )

    # ---- ffmpeg + fonts ----
    async def check_video():
        engine = engine_status()
        if not engine.get("ready"):
            raise RuntimeError(engine.get("error") or "ffmpeg madyu nahi")
        fonts = [f for f in font_status() if f["ok"]]
        if not fonts:
            raise RuntimeError("Ek pan font na madyo")
        xfade = "xfade ✓" if engine.get("has_xfade") else "xfade ✗"
        return f"{engine['version'].split('Copyright')[0].strip()[:38]} · {xfade}"

    await step(
        "Video engine (ffmpeg + font)", True,
        "`python scripts/fetch_ffmpeg.py` ane `python scripts/fetch_fonts.py` chalavo.",
        check_video,
    )

    # ---- Text AI ----
    providers = configured_providers()
    if not providers:
        print("  ✗ AI lakhan                                ek pan key set nathi")
        rows.append(
            {
                "label": "AI lakhan",
                "required": True,
                "ok": False,
                "note": "Ek pan AI key set nathi",
                "fix": no_provider_message(),
            }
        )
    else:
        for provider in providers:
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

            await step(
                f"AI lakhan — {provider.key}", False, provider.missing_key_hint(), check_text
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

    await step(
        "AI — image samajvi", True,
        "GEMINI_API_KEY (free) naakho — https://aistudio.google.com/apikey",
        check_vision,
    )

    # ---- Public hosting ----
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
        fetched = await request_bytes(uploaded.data.url, timeout=45.0)
        if len(fetched) < 500:
            raise RuntimeError("URL khulyu pan file khali aavi")
        return f"{uploaded.data.host} · bahar thi khule che"

    await step(
        "Public media hosting", True,
        "MEDIA_ALLOW_ANON_HOSTS=true rakho (Catbox key vagar chale che), ke "
        "`ngrok http 8000` chalavi ne PUBLIC_MEDIA_BASE_URL set karo. "
        "Aa vagar IG/FB par post NAHI thay.",
        check_hosting,
    )

    # ---- Trends ----
    async def check_trends():
        words = await google_autocomplete("cotton kurti", settings.trends_geo)
        topics = await google_daily_trends(settings.trends_geo)
        if not words and not topics:
            raise RuntimeError("Google par thi kai na madyu")
        return f"{len(words)} keyword · {len(topics)} topic"

    await step("Trends (Google, key vagar)", False, "Internet/proxy check karo.", check_trends)

    # ---- Image generation ----
    async def check_imagegen():
        result = await generate_image(
            "A plain blue ceramic mug on a white table, soft daylight",
            aspect="9:16",
            fit=False,
        )
        meta = imagelib.info(result.data.data)
        return f"{result.data.provider} · {meta.width}x{meta.height}" if meta else result.data.provider

    await step(
        "AI image (avatar + kapda)", False,
        "Pollinations key vagar chale che. Avatar mate GEMINI_API_KEY naakho.",
        check_imagegen,
    )

    # ---- Music ----
    async def check_music():
        picked = await pick_music(mood="upbeat", min_duration=30)
        if not picked:
            raise RuntimeError("Ek pan track na madyo")
        return f"{picked['track'].source} · {picked['track'].title[:28]}"

    await step(
        "Reel nu music", False,
        "ccMixter key vagar chale che. Vadhu variety mate JAMENDO_CLIENT_ID (free).",
        check_music,
    )

    # ---- Voiceover ----
    async def check_voice():
        result = await generate_voiceover(text="Short voiceover test.", language="en")
        return f"{result.data.provider} · {len(result.data.data) // 1024} KB"

    await step(
        "Voiceover", False,
        "`pip install edge-tts` (pehle thi thai gayu che) — koi key joiti nathi.",
        check_voice,
    )

    # ---- Meta ----
    async def check_meta():
        await app_access_token()
        return f"app {settings.meta_app_id} barabar che"

    await step(
        "Instagram / Facebook app", True,
        "developers.facebook.com/apps → META_APP_ID + META_APP_SECRET",
        check_meta,
    )

    # ---- Report ----
    blocking = [r for r in rows if r["required"] and not r["ok"]]
    optional = [r for r in rows if not r["required"] and not r["ok"]]
    passed = sum(1 for r in rows if r["ok"])

    print(f"\n  {passed}/{len(rows)} chale che\n")

    if blocking:
        print("  ⚠ AA THAY TYA SUDHI REEL NAHI BANE:\n")
        for row in blocking:
            print(f"    • {row['label']}")
            for line in str(row["note"]).split("\n")[:5]:
                print(f"      {line[:150]}")
            if row.get("fix"):
                for line in str(row["fix"]).split("\n"):
                    print(f"      → {line}")
            print()

    if optional:
        print("  ○ Aa na hoy to pan chale, pan hoy to saru:\n")
        for row in optional:
            print(f"    • {row['label']} — {str(row.get('fix', ''))[:110]}")
        print()

    if not blocking:
        print("  ✅ Badhu jaruri kaam kare che — `python run.py` chalavo.\n")

    await close_client()
    await close_db()
    return 0 if not blocking else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
