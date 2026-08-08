"""
Image banavvi ane image EDIT karvi.

Be alag kaam che, ane bije kaam j "mari avatar mara kapda pehri ne" ne
shakya banave che:

  generate_image() — prompt → navi image
  compose_image()  — reference image + prompt → navi image
                     (avatar no chehro + product na kapda ek j frame ma)
  virtual_try_on() — kapdu vyakti par pehravi de

Providers:
  openai        — ChatGPT nu gpt-image-1. PAID pan sauthi saru: product ni
                  vigat ane chehro barabar sachve che (input_fidelity: high),
                  ane image par lakhelu text pan saachu aave che.
  gemini-image  — Gemini 2.5 Flash Image, free tier. Reference image samje
                  che ane chehro sthir rakhe che.
  pollinations  — KOI KEY NAHI. Turant chale che. Fakt text→image.

Kram `IMAGE_PROVIDER` nakki kare che (dakhla: `openai`). Pehlo fail thay to
niche na apoaap chale che — etle kaam kyarey atkatu nathi.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Literal, Optional
from urllib.parse import quote

from ..ai.gemini_provider import HINT as GEMINI_HINT
from ..config import settings
from ..errors import FatalError, NotConfigured, RetryableError
from ..pipeline.chain import Candidate, ChainResult, run_chain
from ..pipeline.http import get_client, request_bytes
from . import images as imagelib

AspectRatio = Literal["1:1", "9:16", "16:9", "4:5", "3:4"]

DIMENSIONS: dict[str, tuple[int, int]] = {
    "1:1": (1080, 1080),
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "4:5": (1080, 1350),
    "3:4": (1080, 1440),
}


@dataclass
class ReferenceImage:
    data: bytes
    #: "person" | "garment" | "product" | "style" | "background"
    role: str = "product"


@dataclass
class GeneratedImage:
    data: bytes
    mime_type: str
    provider: str
    prompt: str


REFERENCE_LABELS = {
    "person": (
        "REFERENCE IMAGE — THE PERSON. Keep this exact face, skin tone, hair and "
        "body type. Do not change their identity."
    ),
    "garment": (
        "REFERENCE IMAGE — THE GARMENT. Keep this exact fabric, colour, print, "
        "neckline, sleeves and length."
    ),
    "product": (
        "REFERENCE IMAGE — THE PRODUCT. Keep this exact shape, colour, material "
        "and details."
    ),
    "style": (
        "REFERENCE IMAGE — STYLE ONLY. Copy the lighting, camera angle, colour "
        "grade and composition. Do not copy the subject."
    ),
    "background": "REFERENCE IMAGE — BACKGROUND / SETTING to place the subject into.",
}


# ------------------------------------------------------------------ #
#  Pollinations — koi key nahi
# ------------------------------------------------------------------ #


async def _pollinations(
    prompt: str,
    aspect: AspectRatio,
    seed: Optional[int] = None,
) -> GeneratedImage:
    from ..config import env

    width, height = DIMENSIONS[aspect]
    params = {
        "width": str(width),
        "height": str(height),
        "nologo": "true",
        "model": env("POLLINATIONS_MODEL", "sana"),
        # Seed alag rakhie chie etle ek j prompt par pan dar vakhate
        # thodi alag image aave — badhi reels sarkhi na lage.
        "seed": str(seed if seed is not None else random.randint(1, 1_000_000)),
    }

    query = "&".join(f"{k}={quote(str(v))}" for k, v in params.items())
    url = f"https://image.pollinations.ai/prompt/{quote(prompt[:1500])}?{query}"

    headers = {}
    token = env("POLLINATIONS_TOKEN")
    if token:
        headers["authorization"] = f"Bearer {token}"

    data = await request_bytes(url, headers=headers or None, timeout=240.0)

    # Kyarek HTML error page aave che — kharekhar image che ke nahi joi laiye.
    if len(data) < 5000 or not imagelib.is_image(data):
        raise RetryableError("Pollinations e image ni jagya e kaink biju aapyu")

    return GeneratedImage(data=data, mime_type="image/jpeg", provider="pollinations", prompt=prompt)


# ------------------------------------------------------------------ #
#  OpenAI gpt-image-1 — ChatGPT ni image API
# ------------------------------------------------------------------ #

#: gpt-image-1 fakt aa traan maap aape che. Reel ubhu (9:16) joiye che,
#: etle ubha aakar mate 1024x1536 magie chie ane pachi cover_crop() ene
#: barabar 1080x1920 ma kaapi aape che.
OPENAI_SIZES = {
    "1:1": "1024x1024",
    "9:16": "1024x1536",
    "4:5": "1024x1536",
    "3:4": "1024x1536",
    "16:9": "1536x1024",
}

OPENAI_HINT = (
    "OPENAI_API_KEY set nathi. platform.openai.com/api-keys par thi key lo "
    "(billing chalu hovu joiye). Aa vagar pan chale che — Gemini ke "
    "Pollinations apoaap vaparashe."
)


async def _openai_image(
    prompt: str,
    references: list[ReferenceImage],
    aspect: AspectRatio,
) -> GeneratedImage:
    """
    Be alag endpoint che ane e j aakho fer paade che:

      reference vagar → /images/generations  (sadho prompt → navi image)
      reference sathe → /images/edits        (16 sudhi image reference tarike)

    `edits` j aapno mukhya rasto che — product ni asli photo ane avatar no
    chehro reference tarike aapiye chie, etle AI product ne badli sakto
    nathi. `input_fidelity: high` khaas ena mate j che.
    """
    import base64

    api_key = settings.openai_key
    if not api_key:
        raise NotConfigured(OPENAI_HINT)

    model = settings.openai_image_model
    size = OPENAI_SIZES.get(aspect, "1024x1536")
    quality = settings.openai_image_quality
    url_base = settings.openai_base_url
    client = get_client()
    headers = {"authorization": f"Bearer {api_key}"}

    try:
        if references:
            # Dareak reference ne "aa su che" nu label prompt ma aapiye chie —
            # gpt-image-1 image no kram ane lakhan banne dhyan ma le che.
            labelled_lines = [
                f"Image {i + 1}: {REFERENCE_LABELS.get(ref.role, REFERENCE_LABELS['product'])}"
                for i, ref in enumerate(references[:16])
            ]
            labelled = "\n".join(labelled_lines + ["", prompt])

            files = []
            for index, ref in enumerate(references[:16]):
                prepared = imagelib.resize_within(ref.data, max_side=1536)
                files.append(
                    ("image[]", (f"reference-{index}.jpg", prepared, "image/jpeg"))
                )

            response = await client.post(
                f"{url_base}/images/edits",
                headers=headers,
                data={
                    "model": model,
                    "prompt": labelled[:30_000],
                    "n": "1",
                    "size": size,
                    "quality": quality,
                    "input_fidelity": "high",
                    "output_format": "jpeg",
                },
                files=files,
                timeout=300.0,
            )
        else:
            response = await client.post(
                f"{url_base}/images/generations",
                headers={**headers, "content-type": "application/json"},
                json={
                    "model": model,
                    "prompt": prompt[:30_000],
                    "n": 1,
                    "size": size,
                    "quality": quality,
                    "output_format": "jpeg",
                    # Product photo ma kyarek kapda/body ne moderation adkave
                    # che — `low` thi asli marketing image block thata atke che.
                    "moderation": "low",
                },
                timeout=300.0,
            )
    except Exception as error:  # noqa: BLE001
        raise RetryableError(f"OpenAI sudhi pahonchi na shakaya: {error}") from error

    if response.status_code >= 400:
        message = f"OpenAI: HTTP {response.status_code} {response.text[:300]}"
        if response.status_code == 429 or response.status_code >= 500:
            raise RetryableError(message)
        raise FatalError(message)

    payload = response.json() or {}
    if payload.get("error"):
        raise FatalError(f"OpenAI: {payload['error'].get('message') or payload['error']}")

    items = payload.get("data") or []
    first = items[0] if items else {}

    # gpt-image-1 hamesha base64 aape che; juno/proxy setup ma URL aavi shake.
    if first.get("b64_json"):
        data = base64.b64decode(first["b64_json"])
    elif first.get("url"):
        data = await request_bytes(first["url"], timeout=180.0)
    else:
        raise RetryableError("OpenAI e image na aapi")

    if not imagelib.is_image(data):
        raise RetryableError("OpenAI e image ni jagya e kaink biju aapyu")

    return GeneratedImage(
        data=data,
        mime_type="image/jpeg",
        provider=f"openai:{model}",
        prompt=prompt,
    )


# ------------------------------------------------------------------ #
#  Gemini 2.5 Flash Image — reference samje che
# ------------------------------------------------------------------ #

GEMINI_IMAGE_FALLBACKS = [
    "gemini-2.5-flash-image",
    "gemini-2.0-flash-preview-image-generation",
]


async def _gemini_image(
    prompt: str,
    references: list[ReferenceImage],
    aspect: AspectRatio,
) -> GeneratedImage:
    api_key = settings.gemini_key
    if not api_key:
        raise NotConfigured(GEMINI_HINT)

    models = [settings.gemini_image_model] + [
        m for m in GEMINI_IMAGE_FALLBACKS if m != settings.gemini_image_model
    ]

    parts: list[dict] = []
    for ref in references:
        b64, _ = imagelib.prepare_for_vision(ref.data, max_side=1024)
        parts.append({"text": REFERENCE_LABELS.get(ref.role, REFERENCE_LABELS["product"])})
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": b64}})
    parts.append({"text": prompt})

    client = get_client()
    errors: list[str] = []

    for model in models:
        try:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": api_key},
                json={
                    "contents": [{"role": "user", "parts": parts}],
                    "generationConfig": {
                        "responseModalities": ["IMAGE"],
                        "imageConfig": {"aspectRatio": aspect},
                    },
                },
                timeout=240.0,
            )

            if response.status_code >= 400:
                errors.append(f"{model}: HTTP {response.status_code} {response.text[:160]}")
                continue

            payload = response.json() or {}

            feedback = payload.get("promptFeedback") or {}
            if feedback.get("blockReason"):
                raise FatalError(f"Gemini e prompt block karyu: {feedback['blockReason']}")

            candidates = payload.get("candidates") or []
            for candidate in candidates:
                for part in (candidate.get("content") or {}).get("parts") or []:
                    inline = part.get("inlineData") or part.get("inline_data") or {}
                    b64 = inline.get("data")
                    if b64:
                        import base64

                        return GeneratedImage(
                            data=base64.b64decode(b64),
                            mime_type=inline.get("mimeType") or inline.get("mime_type") or "image/png",
                            provider=f"gemini:{model}",
                            prompt=prompt,
                        )

            errors.append(f"{model}: image na aapi")
        except FatalError:
            raise
        except Exception as error:  # noqa: BLE001
            errors.append(f"{model}: {error}")

    raise RetryableError(" | ".join(errors) or "Gemini image fail")


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #


async def generate_image(
    prompt: str,
    *,
    references: Optional[list[ReferenceImage]] = None,
    aspect: AspectRatio = "9:16",
    seed: Optional[int] = None,
    prefer: Optional[str] = None,
    fit: bool = True,
) -> ChainResult[GeneratedImage]:
    """
    Prompt (ane chhe to reference) thi image banave.

    Reference aapyu hoy to FAKT Gemini chale che — Pollinations reference
    samajtu j nathi, etle ene skip kari daiye chie (khoti image aapva
    karta skip karvu saru).
    """
    references = references or []
    needs_reference = bool(references)

    from ..config import env

    candidates = [
        Candidate[GeneratedImage](
            name="openai",
            label="OpenAI gpt-image-1",
            free=False,
            configured=lambda: bool(settings.openai_key),
            run=lambda: _openai_image(prompt, references, aspect),
            timeout=320.0,
        ),
        Candidate[GeneratedImage](
            name="gemini-image",
            label="Gemini 2.5 Flash Image (free)",
            configured=lambda: bool(settings.gemini_key),
            run=lambda: _gemini_image(prompt, references, aspect),
            timeout=260.0,
        ),
        Candidate[GeneratedImage](
            name="pollinations",
            label="Pollinations (koi key nahi)",
            configured=lambda: (not needs_reference) and settings.allow_anon_hosts,
            run=lambda: _pollinations(prompt, aspect, seed),
            timeout=260.0,
        ),
    ]

    # Reference joitu hoy tyare fakt OpenAI ke Gemini j kaam na che —
    # Pollinations reference image samajtu j nathi. Banne ni key na hoy to
    # saaf kehvu ke su karvu, "not-configured" karta e vadhu kaam nu.
    if needs_reference and not settings.gemini_key and not settings.openai_key:
        raise NotConfigured(
            "Avatar/product sathe ni AI image mate OPENAI_API_KEY ke "
            "GEMINI_API_KEY joiye (Pollinations reference image samajtu nathi). "
            "Free rasto: https://aistudio.google.com/apikey par thi Gemini key lo. "
            "Sauthi saru pariman: platform.openai.com/api-keys (gpt-image-1, paid). "
            "Aa vagar pan reel banse — tamari potani upload kareli image thi."
        )

    result = await run_chain(
        candidates,
        label="AI image",
        prefer=(prefer or env("IMAGE_PROVIDER")),
        # Reference joito hoy to Gemini j kaam nu che — free/paid no sawal nathi.
        prefer_free=False,
        retries=1,
        backoff=2.0,
    )

    if fit:
        width, height = DIMENSIONS[aspect]
        result.data.data = imagelib.cover_crop(result.data.data, width, height)
        result.data.mime_type = "image/jpeg"

    return result


async def compose_image(
    prompt: str,
    references: list[ReferenceImage],
    *,
    aspect: AspectRatio = "9:16",
) -> ChainResult[GeneratedImage]:
    """Reference sathe navi image — "aa vyakti ne aa kapdu pehravo"."""
    return await generate_image(prompt, references=references, aspect=aspect)


TRYON_CATEGORIES = {
    "dresses": ("dress", "saree", "lehenga", "gown", "jumpsuit", "kurti", "anarkali"),
    "lower_body": ("jean", "trouser", "pant", "skirt", "short", "legging", "palazzo"),
}


def tryon_category(apparel_type: str) -> str:
    text = (apparel_type or "").lower()
    for category, words in TRYON_CATEGORIES.items():
        if any(word in text for word in words):
            return category
    return "upper_body"


async def virtual_try_on(
    *,
    person: bytes,
    garment: bytes,
    description: str = "",
    aspect: AspectRatio = "9:16",
) -> ChainResult[GeneratedImage]:
    """
    Kapdu vyakti par pehravi de.

    Free rasto: Gemini 2.5 Flash Image ne banne reference aapiye chie ane
    spashta suchna aapiye chie ke chehro ane kapdu banne jem che em rakhvu.
    """
    prompt = " ".join(
        filter(
            None,
            [
                "Photorealistic fashion photograph.",
                "Dress the person from the first reference image in the exact garment "
                "from the second reference image.",
                "Keep the person's face, skin tone, hair and body proportions completely unchanged.",
                "Keep the garment's exact colour, print, fabric texture, neckline, sleeve "
                "length and hemline.",
                "Natural drape and realistic folds where the fabric meets the body.",
                "Full body or three-quarter shot, soft natural lighting, clean modern "
                "background, shot on an 85mm lens.",
                "No text, no logos, no watermarks anywhere in the image.",
                f"Extra direction: {description}" if description else "",
            ],
        )
    )

    return await generate_image(
        prompt,
        references=[
            ReferenceImage(data=person, role="person"),
            ReferenceImage(data=garment, role="garment"),
        ],
        aspect=aspect,
    )


def imagegen_status() -> list[dict]:
    """Setup page mate."""
    return [
        {
            "key": "openai",
            "label": f"OpenAI {settings.openai_image_model}",
            "free": False,
            "configured": bool(settings.openai_key),
            "note": (
                "ChatGPT ni image API. Product ni vigat ane chehro sauthi barabar "
                "sachve che, ane image par nu text pan saachu aave che. "
                "platform.openai.com/api-keys (paid)"
            ),
        },
        {
            "key": "gemini-image",
            "label": "Gemini 2.5 Flash Image",
            "free": True,
            "configured": bool(settings.gemini_key),
            "note": (
                "Avatar + kapda mate AA J joiye — reference image samje che ane "
                "chehro sthir rakhe che. aistudio.google.com/apikey (free)"
            ),
        },
        {
            "key": "pollinations",
            "label": "Pollinations",
            "free": True,
            "configured": settings.allow_anon_hosts,
            "note": (
                "Koi key nahi — turant chale che. Background ane lifestyle shot "
                "mate saru; avatar mate kaam nu nathi (reference nathi samajtu)."
            ),
        },
    ]
