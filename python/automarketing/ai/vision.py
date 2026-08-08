"""
Vision — "hu khali product ni image aapish" valu kaam ahiya thay che.

Ek (ke ghani) product image andar aave che, ane bahar aave che aakhi
marketing brief: product su che, kaya material nu, kona mate, kaya
keywords par ranking male, kevi reel banavvi.

Badha provider FREE che, ane kram ma try thay che — ek ni limit lage to
biju apoaap chale.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from ..config import settings
from ..media.images import prepare_for_vision
from ..pipeline.chain import Candidate, ChainResult, run_chain
from .base import PreparedImage, TextProvider, VisionRequest
from .registry import vision_providers
from .schemas import PRODUCT_BRIEF

# ------------------------------------------------------------------ #
#  Result
# ------------------------------------------------------------------ #


@dataclass
class ProductIntelligence:
    """Image jovathi malelі aakhi samajan."""

    productName: str = "Product"
    category: str = "General"
    subCategory: str = ""
    isApparel: bool = False
    apparelType: str = ""

    colors: list[str] = field(default_factory=list)
    materials: list[str] = field(default_factory=list)
    patterns: list[str] = field(default_factory=list)
    style: str = ""
    occasions: list[str] = field(default_factory=list)
    seasons: list[str] = field(default_factory=list)

    targetGender: str = "unknown"
    targetAgeRange: str = "18-35"
    targetAudience: str = ""

    keyFeatures: list[str] = field(default_factory=list)
    sellingPoints: list[str] = field(default_factory=list)
    emotionalHooks: list[str] = field(default_factory=list)
    objections: list[str] = field(default_factory=list)

    suggestedPriceBand: str = ""
    positioning: str = "mid-market"

    visualDescription: str = ""
    sceneSuggestions: list[str] = field(default_factory=list)

    searchKeywords: list[str] = field(default_factory=list)
    seedHashtags: list[str] = field(default_factory=list)

    imageQualityScore: float = 7.0
    imageQualityIssues: list[str] = field(default_factory=list)

    confidence: float = 0.7
    language: str = "en"

    def to_dict(self) -> dict:
        data = self.__dict__.copy()
        data["imageQuality"] = {
            "score": self.imageQualityScore,
            "issues": self.imageQualityIssues,
        }
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "ProductIntelligence":
        return normalise(data)


# ------------------------------------------------------------------ #
#  Prompt
# ------------------------------------------------------------------ #

SYSTEM = " ".join(
    [
        "You are a product analyst for a social commerce brand.",
        "You look at product photos and produce the marketing brief a strategist would write.",
        "Describe ONLY what is visibly in the image. Never invent specs, certifications,",
        "prices, fabric counts or brand names that are not visible.",
        "If something is not visible, leave it out rather than guessing confidently.",
        "Keywords and hashtags must be what real buyers type, not marketing jargon.",
        "Return only the structured JSON requested.",
    ]
)


def _user_prompt(image_count: int, hint: str = "", market: str = "India") -> str:
    lines = [
        (
            f"You are shown {image_count} photos. They may be the SAME product from "
            "different angles, or DIFFERENT products from one collection. Decide which, "
            "and describe the collection as a whole if they differ — use productName for "
            "the collection name in that case."
            if image_count > 1
            else "You are shown one product photo."
        ),
        "",
        "Produce the full marketing brief.",
        f"Primary market: {market}. Tune keywords, price band and occasions to that market.",
    ]
    if hint:
        lines.append(f"The seller adds this context (trust it over your guess): {hint}")

    lines += [
        "",
        "For searchKeywords, think about what someone types into the Instagram search bar "
        "or Google when they want to BUY this — include the category, the style, the "
        "occasion and long-tail phrases.",
        "For seedHashtags, mix: 4 huge (millions of posts), 8 medium (100k-1M), 8 niche "
        "(under 100k). Niche tags are where a small account actually ranks.",
    ]
    return "\n".join(lines)


# ------------------------------------------------------------------ #
#  Generic vision call
# ------------------------------------------------------------------ #


async def ask_vision(
    images: list[bytes],
    request: VisionRequest,
    *,
    prefer: Optional[str] = None,
    max_images: int = 6,
) -> ChainResult[Any]:
    """
    Koi pan image + koi pan schema. Product analysis, reference reel na
    frames, avatar nu varnan — badhu aa j thi chale che.
    """
    if not images:
        raise ValueError("Ek pan image na madi")

    prepared: list[PreparedImage] = []
    for raw in images[:max_images]:
        b64, mime = prepare_for_vision(raw)
        prepared.append(PreparedImage(base64=b64, mime_type=mime))

    providers = vision_providers()

    def make_run(provider: TextProvider):
        async def run():
            return await provider.see(prepared, request)

        return run

    candidates = [
        Candidate(
            name=provider.key,
            label=provider.label,
            free=provider.free,
            configured=provider.configured,
            run=make_run(provider),
            timeout=300.0 if provider.key == "ollama" else 180.0,
        )
        for provider in providers
    ]

    return await run_chain(
        candidates,
        label="AI — image samajvi",
        prefer=(prefer or settings.preferred_vision_provider),
        # Gemini vision ne pehli pasandgi — e sauthi sachot che.
        prefer_free=False,
        # Gemini provider potej model-to-model fallback kare che (dareak
        # model ne alag daily quota hoy che), etle ahiya lambi raah joie
        # e bekaar che. Fakt saachi per-minute limit mate ek retry.
        retries=2,
        backoff=6.0,
    )


# ------------------------------------------------------------------ #
#  Product analysis
# ------------------------------------------------------------------ #


async def analyze_product_images(
    images: list[bytes],
    *,
    hint: str = "",
    market: Optional[str] = None,
    prefer: Optional[str] = None,
) -> ChainResult[ProductIntelligence]:
    """Product ni image(s) → aakhi marketing brief."""
    used = images[:6]

    result = await ask_vision(
        used,
        VisionRequest(
            system=SYSTEM,
            prompt=_user_prompt(
                image_count=len(used),
                hint=hint,
                market=market or settings.market,
            ),
            schema=PRODUCT_BRIEF,
            max_tokens=8000,
        ),
        prefer=prefer,
    )

    return ChainResult(
        data=normalise(result.data if isinstance(result.data, dict) else {}),
        provider=result.provider,
        attempts=result.attempts,
        ms=result.ms,
    )


# ------------------------------------------------------------------ #
#  Saaf karvu
# ------------------------------------------------------------------ #

_GENDERS = {"women", "men", "unisex", "kids"}


def _text(value: Any, fallback: str = "") -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _list(value: Any, limit: int = 30) -> list[str]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        text = str(item).strip()
        if text:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _number(value: Any, fallback: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number:  # NaN
        return fallback
    return max(low, min(high, number))


def normalise(raw: dict) -> ProductIntelligence:
    """
    Nana free model kyarek field khali chhodi de, ke string ni jagya e
    number aape. Aagal no code kyarey crash na thay etle ahiya badhu
    saaf kari daiye chie.
    """
    raw = raw or {}
    quality = raw.get("imageQuality")
    if not isinstance(quality, dict):
        quality = {}

    gender = _text(raw.get("targetGender"), "unknown").lower()

    hashtags = []
    for tag in _list(raw.get("seedHashtags"), 40):
        cleaned = tag.lstrip("#").replace(" ", "").lower()
        cleaned = "".join(ch for ch in cleaned if ch.isalnum() or ch == "_")
        if 2 < len(cleaned) <= 30:
            hashtags.append(cleaned)

    return ProductIntelligence(
        productName=_text(raw.get("productName"), "Product"),
        category=_text(raw.get("category"), "General"),
        subCategory=_text(raw.get("subCategory")),
        isApparel=bool(raw.get("isApparel")),
        apparelType=_text(raw.get("apparelType")),
        colors=_list(raw.get("colors"), 8),
        materials=_list(raw.get("materials"), 8),
        patterns=_list(raw.get("patterns"), 8),
        style=_text(raw.get("style")),
        occasions=_list(raw.get("occasions"), 8),
        seasons=_list(raw.get("seasons"), 4),
        targetGender=gender if gender in _GENDERS else "unknown",
        targetAgeRange=_text(raw.get("targetAgeRange"), "18-35"),
        targetAudience=_text(raw.get("targetAudience")),
        keyFeatures=_list(raw.get("keyFeatures"), 10),
        sellingPoints=_list(raw.get("sellingPoints"), 10),
        emotionalHooks=_list(raw.get("emotionalHooks"), 10),
        objections=_list(raw.get("objections"), 6),
        suggestedPriceBand=_text(raw.get("suggestedPriceBand")),
        positioning=_text(raw.get("positioning"), "mid-market"),
        visualDescription=_text(raw.get("visualDescription")),
        sceneSuggestions=_list(raw.get("sceneSuggestions"), 8),
        searchKeywords=_list(raw.get("searchKeywords"), 25),
        seedHashtags=hashtags,
        imageQualityScore=_number(quality.get("score"), 7.0, 0.0, 10.0),
        imageQualityIssues=_list(quality.get("issues"), 6),
        confidence=_number(raw.get("confidence"), 0.7, 0.0, 1.0),
        language=_text(raw.get("language"), "en"),
    )


def vision_status() -> list[dict]:
    """Setup page mate — kayo vision provider taiyar che."""
    return [provider.status() for provider in vision_providers()]
