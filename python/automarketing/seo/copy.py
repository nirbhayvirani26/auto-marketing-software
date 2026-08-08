"""
Caption / description lakhvanu.

Fakt "sarsu lakho" nahi — lakhi ne TAPASO ane jarur pade to FARI lakho.

`score_caption()` ranking na najariya thi marks aape che; ochha aave to
ene su khute che e batavi ne AI pase fari lakhavie chie. Etle bahar
hamesha ek j level nu caption jaay che, AI no mood gme te hoy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from ..ai.base import CompletionRequest
from ..ai.registry import complete
from ..ai.schemas import SOCIAL_COPY
from ..ai.vision import ProductIntelligence
from ..trends.keywords import TrendPack
from .ranking import CaptionScore, score_caption


@dataclass
class SocialCopy:
    #: Pehli line — 'more' pehla aa j dekhay che.
    hook: str = ""
    caption: str = ""
    hashtags: list[str] = field(default_factory=list)
    call_to_action: str = ""
    #: Lambu, keyword bharelu — Facebook ane reel description mate.
    description: str = ""
    #: Pehla comment ma mukvano hashtag block (IG ni saras practice).
    first_comment: str = ""
    score: Optional[CaptionScore] = None
    revisions: int = 0

    def to_dict(self) -> dict:
        return {
            "hook": self.hook,
            "caption": self.caption,
            "hashtags": self.hashtags,
            "call_to_action": self.call_to_action,
            "description": self.description,
            "first_comment": self.first_comment,
            "score": self.score.to_dict() if self.score else None,
            "revisions": self.revisions,
        }


LANGUAGE_RULES = {
    "en": "Write in clear, simple English.",
    "hi": "Write in Hindi using Devanagari script.",
    "gu": "Write in Gujarati using Gujarati script.",
    "hinglish": (
        "Write in Hinglish — Hindi words in Latin script mixed with English, the way "
        "people actually type on Instagram in India."
    ),
}

PLATFORM_RULES = {
    "instagram": " ".join(
        [
            "Instagram. Only the first line shows before 'more' — it carries the whole post.",
            "Short punchy lines with line breaks. Emojis are fine, 3-6 total, never in the",
            "hook's first 3 words.",
            "Instagram now indexes caption words in search, so the primary keyword must read",
            "naturally in the first sentence.",
        ]
    ),
    "facebook": " ".join(
        [
            "Facebook. People read a little more here, so 2-4 short paragraphs work.",
            "Conversational. A genuine question near the end pulls comments, and comments",
            "are the strongest Facebook signal.",
            "Very few hashtags on Facebook — they do not help ranking there.",
        ]
    ),
}

FORMAT_RULES = {
    "reel": (
        "This caption sits under a Reel. Reels rank on watch time, shares and saves — so "
        "the caption should give a reason to rewatch or send it to a friend."
    ),
    "image": (
        "This caption sits under a single photo. The caption has to do the selling the "
        "photo cannot."
    ),
    "carousel": (
        "This caption sits under a carousel. Tell people there is more to swipe — swipes "
        "are a strong ranking signal."
    ),
    "story": "This is a story. Keep it to 1-2 very short lines, built around a tap or a sticker.",
}


def _system(language: str) -> str:
    return "\n".join(
        [
            "You are a direct-response social media copywriter for a commerce brand.",
            "You write copy that gets saved and shared, not copy that sounds impressive.",
            LANGUAGE_RULES.get(language, LANGUAGE_RULES["en"]),
            "",
            "Hard rules:",
            "- Never invent a price, discount, fabric composition, certification, delivery "
            "time, stock level or review that you were not given.",
            "- Never use: 'In today's fast-paced world', 'Look no further', 'Elevate your', "
            "'Unleash', 'Game-changer', 'Introducing'.",
            "- No em-dash-heavy AI cadence. Short sentences. Real words.",
            "- Hashtags are added separately — never put a hashtag in the caption text.",
        ]
    )


def _prompt(
    product: ProductIntelligence,
    trends: TrendPack,
    *,
    platform: str,
    fmt: str,
    keywords: list[str],
    brand_name: str,
    brand_voice: str,
    product_url: str,
    price: str,
    feedback: list[str],
) -> str:
    lines = [
        f"Write the caption for a {platform} {fmt}.",
        "",
        "PRODUCT (these are the only facts you may state):",
        f"• Name: {product.productName}",
        f"• Category: {product.category} → {product.subCategory}",
    ]
    if product.materials:
        lines.append(f"• Material: {', '.join(product.materials)}")
    if product.colors:
        lines.append(f"• Colour: {', '.join(product.colors)}")
    if product.style:
        lines.append(f"• Style: {product.style}")
    if product.occasions:
        lines.append(f"• Occasion: {', '.join(product.occasions)}")
    if product.keyFeatures:
        lines.append(f"• Features: {'; '.join(product.keyFeatures)}")
    if product.sellingPoints:
        lines.append(f"• Why people buy it: {'; '.join(product.sellingPoints)}")
    if product.objections:
        lines.append(f"• Doubts buyers have: {'; '.join(product.objections)}")
    if price:
        lines.append(f"• Price: {price}")

    lines += [
        "",
        f"AUDIENCE: {product.targetAudience or f'{product.targetGender}, {product.targetAgeRange}'}",
    ]
    if product.emotionalHooks:
        lines.append(f"What they actually feel: {'; '.join(product.emotionalHooks)}")

    lines += [
        "",
        f"PRIMARY KEYWORD (must appear naturally in the first sentence): "
        f"{keywords[0] if keywords else product.subCategory}",
    ]
    if len(keywords) > 1:
        lines.append(f"OTHER KEYWORDS (weave in 2-4): {', '.join(keywords[1:])}")
    if trends.rising_topics:
        lines.append(
            "TRENDING RIGHT NOW (use only if it honestly fits, else ignore): "
            + ", ".join(trends.rising_topics)
        )

    lines.append("")
    if brand_name:
        lines.append(f"BRAND: {brand_name}")
    if brand_voice:
        lines.append(f"BRAND VOICE: {brand_voice}")
    if product_url:
        lines.append(
            f"LINK (do not write the URL, it is appended automatically): {product_url}"
        )

    lines += [
        "",
        PLATFORM_RULES.get(platform, PLATFORM_RULES["instagram"]),
        FORMAT_RULES.get(fmt, FORMAT_RULES["reel"]),
    ]

    if feedback:
        lines += [
            "",
            "YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS — fix every one of them:",
            *[f"- {item}" for item in feedback],
        ]

    return "\n".join(lines)


def _assemble(data: dict) -> str:
    """Hook + body + CTA ne ek caption ma jode, ane hashtag kaadhi naakhe."""
    import re

    parts = []
    for key in ("hook", "body", "callToAction"):
        text = str(data.get(key) or "").strip()
        # Hashtag caption ni bahar rahe che — e alag jaay che.
        text = re.sub(r"#\w+", "", text).strip()
        if text:
            parts.append(text)
    return "\n\n".join(parts)


async def generate_social_copy(
    *,
    product: ProductIntelligence,
    trends: TrendPack,
    platform: str = "instagram",
    fmt: str = "reel",
    brand_name: str = "",
    brand_voice: str = "",
    language: Optional[str] = None,
    product_url: str = "",
    price: str = "",
    max_revisions: int = 2,
) -> SocialCopy:
    """
    Caption lakhe, marks aape, ochha aave to fari lakhave.

    Etle jawab ni gunvatta AI na mood par nahi — checklist par aadharit rahe che.
    """
    language = language or product.language or "en"
    keywords = trends.keywords[:8]
    hashtags = [h.tag for h in trends.hashtags][: (5 if platform == "facebook" else 30)]

    best: Optional[tuple[dict, CaptionScore]] = None
    feedback: list[str] = []
    revisions = 0

    for attempt in range(max_revisions + 1):
        result = await complete(
            CompletionRequest(
                system=_system(language),
                prompt=_prompt(
                    product,
                    trends,
                    platform=platform,
                    fmt=fmt,
                    keywords=keywords,
                    brand_name=brand_name,
                    brand_voice=brand_voice,
                    product_url=product_url,
                    price=price,
                    feedback=feedback,
                ),
                schema=SOCIAL_COPY,
                max_tokens=2500,
            )
        )

        data = result.data if isinstance(result.data, dict) else {}
        caption = _assemble(data)
        score = score_caption(
            caption=caption,
            hashtags=hashtags,
            keywords=keywords,
            platform=platform,
            fmt=fmt,
        )

        if best is None or score.score > best[1].score:
            best = (data, score)

        if score.score >= 85:
            break

        revisions = attempt + 1
        feedback = [f"{c.label} — {c.hint}" for c in score.checks if not c.passed]

    if best is None:
        raise RuntimeError("Caption banavi na shakayu")

    data, score = best
    caption = _assemble(data)

    return SocialCopy(
        hook=str(data.get("hook") or "").strip(),
        caption=caption,
        hashtags=hashtags,
        call_to_action=str(data.get("callToAction") or "").strip(),
        description=str(data.get("description") or "").strip(),
        first_comment=(" ".join(f"#{t}" for t in hashtags) if platform == "instagram" else ""),
        score=score,
        revisions=revisions,
    )
