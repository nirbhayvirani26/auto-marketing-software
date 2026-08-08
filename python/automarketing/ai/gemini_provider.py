"""
Google Gemini — FREE tier, credit card ni jarur nathi.

Aa EK key thi CHAAR kaam thai jaay che:
  • lakhan (caption, script)
  • image samajvi (vision)
  • image banavvi (Gemini 2.5 Flash Image)
  • voiceover (Gemini TTS)

Key: https://aistudio.google.com/apikey
Free limit: ~15 request/minute, 1500/divas — nana business mate puratu.
"""

from __future__ import annotations

from typing import Any

from ..config import settings
from ..errors import FatalError, NotConfigured, RetryableError
from ..pipeline.http import get_client, parse_json_loose
from .base import CompletionRequest, PreparedImage, TextProvider, VisionRequest

BASE = "https://generativelanguage.googleapis.com/v1beta"

HINT = (
    "GEMINI_API_KEY set nathi. https://aistudio.google.com/apikey par thi "
    "FREE key lo (credit card ni jarur nathi) ane .env ma nakho."
)

#: ⚠️ AGATYA NU: Google dareak key ne badha model nu free tier NATHI aapto.
#: Ketlak key par `gemini-2.0-flash` "limit: 0" aape che pan
#: `gemini-flash-latest` (alias) barabar chale che. Kayo model male e
#: key/project/desh pramane badlay che.
#:
#: Etle EK model par aadhaar na rakhta, kram ma try karie chie. Pehlo je
#: chale e vaparie chie ane yaad rakhie chie — pachi dar vakhate e j jaay.
TEXT_FALLBACKS = [
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-3-flash-preview",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
]

# Kram ma: sauthi saaro pehla. Dareak ne ALAG daily quota che, etle
# aa list jetli lambi, etli free quota vadhare.
VISION_FALLBACKS = [
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]

#: Model naam → chale che ke nahi (ek j var shodhie, pachi yaad rahe).
_working: dict[str, str] = {}

#: Thinking model mate vadharani jagya — jovo `_generate` ni andar ni note.
THINKING_HEADROOM = 2048


def _candidates(preferred: str, fallbacks: list[str]) -> list[str]:
    """User e aapelo model pehla, pachi baki — duplicate vagar."""
    order = [preferred, *fallbacks] if preferred else list(fallbacks)
    seen: set[str] = set()
    return [m for m in order if m and not (m in seen or seen.add(m))]


def _is_no_free_tier(message: str) -> bool:
    """
    "limit: 0" no matlab — aa key ne AA MODEL nu free tier apayu j nathi.
    E rate limit NATHI; raah jovathi kai nahi thay, bijo model joiye.
    """
    return "limit: 0" in message or "limit:0" in message


def _is_daily_quota(message: str) -> bool:
    """
    DIVAS ni quota puri thai gai (dakhla: 20 request/divas).

    ⚠️ AA SAUTHI AGATYA NI VAAT CHE:
    Google DAREAK MODEL ne POTANI ALAG daily quota aape che. Etle
    `gemini-flash-latest` khatam thai jaay to pan `gemini-flash-lite-latest`
    ane `gemini-3-flash-preview` hju chale che.

    Etle aane retry NA karvu — raah jovathi kalak sudhi kai nahi thay.
    Bija MODEL par jaavu, ane em karvathi free quota ganu vadhi jaay che.
    """
    return "PerDay" in message or "per day" in message.lower()


def clean_schema(schema: Any) -> Any:
    """
    Gemini na responseSchema ma `additionalProperties`, `$schema` ane
    `enum` na aagal na keys support nathi — e kadhi naakhvi pade, nahi to
    400 aave che.
    """
    if isinstance(schema, list):
        return [clean_schema(item) for item in schema]
    if isinstance(schema, dict):
        return {
            key: clean_schema(value)
            for key, value in schema.items()
            if key not in {"additionalProperties", "$schema", "default", "examples"}
        }
    return schema


class GeminiProvider(TextProvider):
    key = "gemini"
    label = "Google Gemini (free)"
    free = True
    supports_vision = True

    @property
    def model(self) -> str:
        return settings.gemini_model

    def configured(self) -> bool:
        return bool(settings.gemini_key)

    def missing_key_hint(self) -> str:
        return HINT

    # ---------------------------------------------------------------- #

    async def _generate(
        self,
        *,
        model: str,
        parts: list[dict[str, Any]],
        system: str,
        schema: dict[str, Any],
        max_tokens: int,
        temperature: float,
        timeout: float,
    ) -> Any:
        api_key = settings.gemini_key
        if not api_key:
            raise NotConfigured(HINT)

        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": clean_schema(schema),
                # ⚠️ THINKING TOKENS — aa bahu chidavnaru hoy che.
                #
                # Nava Gemini flash models "thinking" models che: e jawab
                # aapta pehla andar-khane vichare che, ANE E VICHAR PAN
                # `maxOutputTokens` ma THI j gane che.
                #
                # Etle nanu limit (dakhla: 60) aapo to badha token vichar ma
                # j vaparai jaay ane jawab KHALI aave — koi error vagar.
                # (`finishReason: MAX_TOKENS`, `candidatesTokenCount: 0`.)
                #
                # `thinkingBudget: 0` thi band kari shakay? Na — aa models
                # 400 aape che. Etle jagya vadhari daiye chie.
                "maxOutputTokens": max(max_tokens, 512) + THINKING_HEADROOM,
                "temperature": temperature,
            },
        }

        client = get_client()
        response = await client.post(
            f"{BASE}/models/{model}:generateContent",
            params={"key": api_key},
            json=payload,
            timeout=timeout,
        )

        if response.status_code >= 400:
            # ⚠️ Quota no prakar `details` ma hoy che, je jawab na chhede
            # aave che. Etle AAKHA text par check karvu — kaapelu nahi.
            # (Pehla 900 char par check karta hata ane `PerDay` chukai
            # jatu hatu — bahu chidavnaru bug hato.)
            full = response.text
            body = full[:900]

            if response.status_code == 429:
                # Banne kissa ma raah jovano matlab nathi — bijo MODEL
                # joiye. Etle FatalError, jethi `_generate_with_fallback`
                # turant aagal vadhe.
                if _is_no_free_tier(full):
                    raise FatalError(
                        f"'{model}' aa key mate chalu j nathi (free tier quota 0)"
                    )
                if _is_daily_quota(full):
                    raise FatalError(
                        f"'{model}' ni AAJ ni free quota puri thai gai "
                        f"(bija model par jaie chie)"
                    )
                # Aa saachi per-minute limit che — thodi var ma jate saaf
                # thai jaay che, etle retry karva jevu.
                raise RetryableError(
                    "Gemini ni rate limit lagi gai. Thodi var pachi apoaap "
                    "fari try thashe."
                )

            if response.status_code == 404:
                raise FatalError(f"Gemini: '{model}' model aa key mate nathi.")

            if response.status_code == 400 and "API key not valid" in full:
                raise FatalError(
                    "GEMINI_API_KEY khoti che. aistudio.google.com/apikey par thi navi lo."
                )
            if response.status_code >= 500:
                raise RetryableError(f"Gemini server ni bhool ({response.status_code})")
            raise FatalError(f"Gemini: HTTP {response.status_code} {body[:250]}")

        data = response.json()

        feedback = (data or {}).get("promptFeedback") or {}
        if feedback.get("blockReason"):
            raise FatalError(f"Gemini e content block karyu: {feedback['blockReason']}")

        candidates = (data or {}).get("candidates") or []
        if not candidates:
            raise RetryableError("Gemini e khali jawab aapyo")

        candidate = candidates[0]
        if candidate.get("finishReason") == "SAFETY":
            raise FatalError("Gemini e aa content par kaam karvani na paadi.")

        chunks = [
            part.get("text", "")
            for part in (candidate.get("content") or {}).get("parts") or []
        ]
        text = "".join(chunks)
        if not text:
            raise RetryableError("Gemini e khali jawab aapyo")

        return parse_json_loose(text, label="Gemini")

    # ---------------------------------------------------------------- #

    async def _generate_with_fallback(
        self,
        *,
        kind: str,
        preferred: str,
        fallbacks: list[str],
        **kwargs: Any,
    ) -> Any:
        """
        Model kram ma try kare — pehlo je chale e vaparo ane YAAD RAKHO.

        Google dareak key ne badha model nu free tier nathi aapto, ane kayo
        male e badlata rahe che. Ek model par aadhaar rakhie to key barabar
        hova chhata app band thai jaay — e barabar nathi.
        """
        # Pehle thi khabar hoy ke kayo chale che to sidho e j.
        known = _working.get(kind)
        if known:
            try:
                return await self._generate(model=known, **kwargs)
            except FatalError:
                # Have e pan band thai gayo — fari thi shodho.
                _working.pop(kind, None)

        errors: list[str] = []
        for model in _candidates(preferred, fallbacks):
            if model == known:
                continue
            try:
                result = await self._generate(model=model, **kwargs)
                _working[kind] = model
                return result
            except FatalError as error:
                # "aa model nathi male" — bija par jao.
                errors.append(f"{model}: {error}")
            # RetryableError uper jaay che — e kaamchalau bhool che, ane
            # chain no runner ene fari try karse.

        raise FatalError(
            "Gemini: ek pan model na chalyo.\n"
            + "\n".join(f"  • {e}" for e in errors[:5])
            + "\n\nAa mota bhage tyare thay che jyare key na project ne free "
            "tier apayu na hoy. aistudio.google.com/apikey par NAVI key "
            "banavo (naya project ma), athva Groq vapro — e pan free che."
        )

    async def complete(self, request: CompletionRequest) -> Any:
        return await self._generate_with_fallback(
            kind="text",
            preferred=settings.gemini_model,
            fallbacks=TEXT_FALLBACKS,
            parts=[{"text": request.prompt}],
            system=request.system,
            schema=request.schema,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            timeout=120.0,
        )

    async def see(self, images: list[PreparedImage], request: VisionRequest) -> Any:
        parts: list[dict[str, Any]] = [
            {"inlineData": {"mimeType": img.mime_type, "data": img.base64}}
            for img in images
        ]
        parts.append({"text": request.prompt})

        return await self._generate_with_fallback(
            kind="vision",
            preferred=settings.gemini_vision_model,
            fallbacks=VISION_FALLBACKS,
            parts=parts,
            system=request.system,
            schema=request.schema,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            timeout=180.0,
        )
