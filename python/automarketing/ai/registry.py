"""
Badha AI provider ek jagya e, ane emno kram.

Kram jaani joine aavo che:

  1. groq       — free ane SAUTHI FAST (millisecond ma jawab)
  2. gemini     — free, sauthi hoshiyar, ane vision + image + TTS pan kare
  3. openrouter — free models, backup tarike
  4. ollama     — tamara computer par, internet vagar pan chale

Ek ni limit lage etle biju apoaap chalu thai jaay che. Etle tamaru kaam
kyarey atkatu nathi — ane badhu free rahe che.
"""

from __future__ import annotations

from typing import Any, Optional

from ..config import settings
from ..pipeline.chain import Candidate, ChainResult, run_chain
from .base import CompletionRequest, TextProvider
from .gemini_provider import GeminiProvider
from .ollama_provider import OllamaProvider
from .openai_compat import OpenAiCompatProvider

# ------------------------------------------------------------------ #
#  Providers
# ------------------------------------------------------------------ #

# ⚠️ Groq pase atyare (2026) koi VISION model nathi — emna model list ma
# llava/llama-4-scout jevu kai j nathi. Etle `GROQ_VISION_MODEL` set karyu
# hoy to J vision chain ma umerie chie; nahi to 404 no vadharano prayatna
# thay che ane vakhat bagade che.
groq_provider = OpenAiCompatProvider(
    key="groq",
    label="Groq (free, sauthi fast)",
    base_url="https://api.groq.com/openai/v1",
    api_key=lambda: settings.groq_key,
    model=lambda: settings.groq_model,
    vision_model=(lambda: settings.groq_vision_model) if settings.groq_vision_model else None,
    hint=(
        "GROQ_API_KEY set nathi. https://console.groq.com/keys par thi FREE key "
        "lo — credit card ni jarur nathi ane bahu j fast che."
    ),
)

openrouter_provider = OpenAiCompatProvider(
    key="openrouter",
    label="OpenRouter (free models)",
    base_url="https://openrouter.ai/api/v1",
    api_key=lambda: settings.openrouter_key,
    model=lambda: settings.openrouter_model,
    vision_model=lambda: settings.openrouter_vision_model,
    hint=(
        "OPENROUTER_API_KEY set nathi. https://openrouter.ai/keys par thi FREE "
        "key lo — `:free` valaa models ni koi kimat nathi."
    ),
    extra_headers=lambda: {
        "http-referer": settings.app_url,
        "x-title": "Auto Marketing Software",
    },
)

gemini_provider = GeminiProvider()
ollama_provider = OllamaProvider()


def all_providers() -> list[TextProvider]:
    """Kram ma — pehlo sauthi saaro/fast."""
    return [groq_provider, gemini_provider, openrouter_provider, ollama_provider]


def configured_providers() -> list[TextProvider]:
    return [p for p in all_providers() if p.configured()]


def vision_providers() -> list[TextProvider]:
    """Image joi shake evaa providers, kram ma.

    Gemini pehla — vision ma e sauthi sachot che ane free tier ma pan
    saras chale che.
    """
    ordered = [gemini_provider, groq_provider, openrouter_provider, ollama_provider]
    return [p for p in ordered if p.supports_vision]


def provider_status() -> list[dict]:
    """
    Setup page mate — kayo provider taiyar che ane atyare kayo chale che.

    `active` kadhtaa `AI_PROVIDER` ne maan aapvu J pade — `complete()` pan
    ene j `prefer` tarike aape che. Aa na karie to setup page ek provider
    batave ane kaam biju kare, ane e sauthi gothvai javu evu thay.
    """
    chain = configured_providers()
    preferred = settings.preferred_text_provider
    active = next(
        (p.key for p in chain if p.key == preferred),
        chain[0].key if chain else None,
    )
    return [{**p.status(), "active": p.key == active} for p in all_providers()]


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #


def _candidates(providers: list[TextProvider], make_run) -> list[Candidate[Any]]:
    return [
        Candidate(
            name=provider.key,
            label=provider.label,
            free=provider.free,
            configured=provider.configured,
            run=make_run(provider),
            timeout=300.0 if provider.key == "ollama" else 130.0,
        )
        for provider in providers
    ]


async def complete(
    request: CompletionRequest,
    *,
    prefer: Optional[str] = None,
) -> ChainResult[Any]:
    """
    AI pase structured jawab magho.

    Pehlo je provider chale e no jawab aave che. Badha fail thay to
    `ChainError` — jema dareak e su kahyu e hoy che.
    """
    providers = all_providers()

    def make_run(provider: TextProvider):
        async def run():
            return await provider.complete(request)

        return run

    return await run_chain(
        _candidates(providers, make_run),
        label="AI lakhan",
        prefer=(prefer or settings.preferred_text_provider),
        retries=1,
        backoff=1.0,
    )


def no_provider_message() -> str:
    """Ek pan key na hoy tyare user ne batavvano sandesh."""
    return (
        "Ek pan AI provider ni key set nathi.\n\n"
        "Sauthi saral FREE rasto (2 minute):\n"
        "  1. https://console.groq.com/keys → key copy karo → .env ma GROQ_API_KEY\n"
        "  2. https://aistudio.google.com/apikey → key copy karo → .env ma GEMINI_API_KEY\n\n"
        "Banne free che ane credit card magtaa nathi. Gemini ni key thi image "
        "samajvi, image banavvi ane voiceover — traney kaam pan thai jaay che."
    )
