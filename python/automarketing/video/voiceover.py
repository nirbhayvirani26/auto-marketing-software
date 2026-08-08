"""
Voiceover — reel ma bolvano awaj.

BADHU FREE. Sauthi saru: **edge-tts** — Microsoft Edge na awaj vaapre che,
KOI KEY NAHI, koi limit nahi, ane Hindi/Gujarati pan sunder bole che.
Aa Python ma j male che (Node ma nathi) — etle Python version ni aa
ek moti khubi che.

Providers:
  edge-tts      — KOI KEY NAHI, sauthi saru, 400+ awaj, badhi bhasha
  gemini-tts    — free tier (GEMINI_API_KEY)

(Pollinations no audio API kaadhi naakhyo che — e 2026 ma band thai gayo
 ane 404 aapva mandyo. edge-tts ena karta ghanu saru pan che.)
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Optional

from ..config import settings
from ..errors import RetryableError
from ..pipeline.chain import Candidate, ChainResult, run_chain
from ..pipeline.http import get_client


@dataclass
class Voiceover:
    data: bytes
    mime_type: str
    extension: str
    provider: str
    text: str


# ------------------------------------------------------------------ #
#  edge-tts — koi key nahi, sauthi saru
# ------------------------------------------------------------------ #

#: Bhasha + jaati pramane awaj. Badha Microsoft na neural awaj che.
EDGE_VOICES: dict[str, dict[str, str]] = {
    "en": {
        "female": "en-IN-NeerjaNeural",
        "male": "en-IN-PrabhatNeural",
        "warm": "en-US-AriaNeural",
        "bright": "en-US-JennyNeural",
        "calm": "en-GB-SoniaNeural",
    },
    "hi": {
        "female": "hi-IN-SwaraNeural",
        "male": "hi-IN-MadhurNeural",
        "warm": "hi-IN-SwaraNeural",
        "bright": "hi-IN-SwaraNeural",
        "calm": "hi-IN-MadhurNeural",
    },
    "gu": {
        "female": "gu-IN-DhwaniNeural",
        "male": "gu-IN-NiranjanNeural",
        "warm": "gu-IN-DhwaniNeural",
        "bright": "gu-IN-DhwaniNeural",
        "calm": "gu-IN-NiranjanNeural",
    },
    # Hinglish latin akshar ma lakhelu hoy che — Indian English awaj
    # sauthi saacho lage che.
    "hinglish": {
        "female": "en-IN-NeerjaNeural",
        "male": "en-IN-PrabhatNeural",
        "warm": "en-IN-NeerjaNeural",
        "bright": "en-IN-NeerjaNeural",
        "calm": "en-IN-PrabhatNeural",
    },
}


def edge_voice_for(language: str, voice: str) -> str:
    """Bhasha + pasandgi → Edge no awaj. Khoto naam hoy to pan chale."""
    # User e sidho Edge no voice naam aapyo hoy to e j vaparo.
    if "-" in voice and "Neural" in voice:
        return voice

    lang = (language or "en").lower()
    if lang.startswith("hinglish"):
        key = "hinglish"
    else:
        key = lang[:2]
        if key not in EDGE_VOICES:
            key = "en"

    table = EDGE_VOICES[key]
    return table.get(voice, table["female"])


async def _edge_tts(text: str, language: str, voice: str) -> Voiceover:
    import edge_tts

    selected = edge_voice_for(language, voice)

    # Reel mate thodo zadapi ane thodo uncho awaj vadhu jivant lage che.
    communicate = edge_tts.Communicate(text, selected, rate="+8%", pitch="+2Hz")

    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])

    data = b"".join(chunks)
    if len(data) < 1500:
        raise RetryableError("edge-tts e bahu nanu audio aapyu")

    return Voiceover(
        data=data,
        mime_type="audio/mpeg",
        extension=".mp3",
        provider=f"edge-tts:{selected}",
        text=text,
    )


# ------------------------------------------------------------------ #
#  Gemini TTS — free tier
# ------------------------------------------------------------------ #

GEMINI_VOICES = {
    "female": "Aoede",
    "male": "Charon",
    "warm": "Kore",
    "bright": "Puck",
    "calm": "Leda",
}


def pcm_to_wav(pcm: bytes, sample_rate: int = 24000, channels: int = 1) -> bytes:
    """Gemini raw PCM aape che — WAV header lagavvu pade."""
    byte_rate = sample_rate * channels * 2
    header = (
        b"RIFF"
        + struct.pack("<I", 36 + len(pcm))
        + b"WAVE"
        + b"fmt "
        + struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, channels * 2, 16)
        + b"data"
        + struct.pack("<I", len(pcm))
    )
    return header + pcm


async def _gemini_tts(text: str, voice: str) -> Voiceover:
    import base64
    import re

    from ..config import env

    model = env("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")
    client = get_client()

    response = await client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": settings.gemini_key},
        json={
            "contents": [{"parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {
                            "voiceName": GEMINI_VOICES.get(voice, voice or "Aoede")
                        }
                    }
                },
            },
        },
        timeout=180.0,
    )

    if response.status_code >= 400:
        raise RetryableError(f"Gemini TTS: HTTP {response.status_code} {response.text[:160]}")

    payload = response.json() or {}
    parts = (((payload.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    inline = (parts[0] if parts else {}).get("inlineData") or (parts[0] if parts else {}).get("inline_data") or {}
    b64 = inline.get("data")
    if not b64:
        raise RetryableError("Gemini TTS e audio na aapyu")

    mime = inline.get("mimeType") or inline.get("mime_type") or ""
    raw = base64.b64decode(b64)

    if "wav" in mime.lower():
        return Voiceover(raw, "audio/wav", ".wav", "gemini-tts", text)

    match = re.search(r"rate=(\d+)", mime)
    rate = int(match.group(1)) if match else 24000
    return Voiceover(pcm_to_wav(raw, rate), "audio/wav", ".wav", "gemini-tts", text)


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #


def _edge_available() -> bool:
    try:
        import edge_tts  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


async def generate_voiceover(
    *,
    text: str,
    language: str = "en",
    voice: Optional[str] = None,
    prefer: Optional[str] = None,
) -> ChainResult[Voiceover]:
    """Text → awaj. edge-tts pehla (free ane sauthi saru)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Voiceover mate text nathi")

    voice = voice or settings.voiceover_voice

    return await run_chain(
        [
            Candidate[Voiceover](
                name="edge-tts",
                label="edge-tts (koi key nahi, sauthi saru)",
                configured=_edge_available,
                run=lambda: _edge_tts(text, language, voice),
                timeout=180.0,
            ),
            Candidate[Voiceover](
                name="gemini-tts",
                label="Gemini TTS (free)",
                configured=lambda: bool(settings.gemini_key),
                run=lambda: _gemini_tts(text, voice),
                timeout=200.0,
            ),
        ],
        label="Voiceover",
        prefer=(prefer or settings.tts_provider),
        # edge-tts sauthi saru che — kram jem che em rakho.
        prefer_free=False,
        retries=1,
        backoff=1.5,
    )


def voiceover_status() -> list[dict]:
    """Setup page mate."""
    return [
        {
            "key": "edge-tts",
            "label": "edge-tts",
            "free": True,
            "configured": _edge_available(),
            "note": (
                "KOI KEY NAHI ane sauthi saaro awaj. Hindi, Gujarati ane Indian "
                "English badhu bole che. `pip install edge-tts` (pehle thi thai gayu che)."
            ),
        },
        {
            "key": "gemini-tts",
            "label": "Gemini TTS",
            "free": True,
            "configured": bool(settings.gemini_key),
            "note": "Free tier. GEMINI_API_KEY hoy to apoaap chale che.",
        },
    ]
