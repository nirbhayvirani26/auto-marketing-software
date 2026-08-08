"""
Trending keywords ane hashtags.

⚠️ EK SAACHI VAAT PEHLA: Instagram pase "trending hashtag" no koi jaher API
nathi. Je tools "IG trending" batave che e badha andaj ke scraping par
chale che. Etle ahiya aapne EK THI VADHU SAACHA FREE SOURCE jodine
bharoso layak jawab banaviye chie:

  1. Google Autocomplete — log kharekhar su type kare che (KOI KEY NAHI)
  2. Google Trends RSS   — aaje su chali rahyu che (KOI KEY NAHI)
  3. AI                  — aa data + product ne jodine hashtag ladder

Ane sauthi agatya nu — hashtag "LADDER". Ek nanu account #fashion
(30 crore post) par kadi nahi dekhay. NANI tags par dekhay che. Etle
broad/medium/niche no bhaag paadi ne aapiye chie.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from ..ai.base import CompletionRequest
from ..ai.registry import complete
from ..ai.schemas import HASHTAG_LADDER
from ..ai.vision import ProductIntelligence
from ..config import settings
from ..db import connect
from ..db import trends as trends_collection
from ..pipeline.chain import Candidate, run_chain_soft
from ..pipeline.http import request_text

CACHE_HOURS = 6


@dataclass
class Hashtag:
    tag: str
    #: "broad" | "medium" | "niche" | "branded"
    tier: str
    reason: str = ""


@dataclass
class TrendPack:
    #: Log su search kare che — caption ma aa shabdo naakhvana.
    keywords: list[str] = field(default_factory=list)
    #: Aaje chali rahela topics je aa product sathe bese che.
    rising_topics: list[str] = field(default_factory=list)
    #: Ready-to-post hashtag set, tier pramane gothvayelu.
    hashtags: list[Hashtag] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)

    @property
    def hashtag_line(self) -> str:
        return " ".join(f"#{h.tag}" for h in self.hashtags)

    def to_dict(self) -> dict:
        return {
            "keywords": self.keywords,
            "rising_topics": self.rising_topics,
            "hashtags": [{"tag": h.tag, "tier": h.tier, "reason": h.reason} for h in self.hashtags],
            "hashtag_line": self.hashtag_line,
            "sources": self.sources,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TrendPack":
        data = data or {}
        return cls(
            keywords=list(data.get("keywords") or []),
            rising_topics=list(data.get("rising_topics") or []),
            hashtags=[
                Hashtag(tag=h.get("tag", ""), tier=h.get("tier", "medium"), reason=h.get("reason", ""))
                for h in (data.get("hashtags") or [])
                if h.get("tag")
            ],
            sources=list(data.get("sources") or []),
        )


# ------------------------------------------------------------------ #
#  Source 1 — Google Autocomplete (KOI KEY NAHI)
# ------------------------------------------------------------------ #


async def google_autocomplete(seed: str, geo: str = "IN") -> list[str]:
    """
    Log search bar ma su type kare che — sidhu Google pase thi.

    Aa keyword research nu sauthi saachu ane sav free source che.
    """
    params = {
        "client": "firefox",
        "hl": "en-IN" if geo == "IN" else "en",
        "gl": geo,
        "q": seed,
    }
    query = "&".join(f"{k}={v.replace(' ', '+')}" for k, v in params.items())
    raw = await request_text(
        f"https://suggestqueries.google.com/complete/search?{query}",
        timeout=12.0,
    )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []

    if isinstance(parsed, list) and len(parsed) > 1 and isinstance(parsed[1], list):
        return [str(item) for item in parsed[1][:12]]
    return []


async def expand_keywords(seeds: Iterable[str], geo: str) -> list[str]:
    """Ek seed thi ghana long-tail keywords — prefix trick sathe."""
    import asyncio

    modifiers = ["", " for ", " best ", " online "]
    jobs = []
    for seed in list(seeds)[:4]:
        for modifier in modifiers:
            jobs.append(google_autocomplete(f"{seed}{modifier}", geo))

    results = await asyncio.gather(*jobs, return_exceptions=True)
    words: list[str] = []
    for result in results:
        if isinstance(result, list):
            words.extend(result)
    return dedupe(words)


# ------------------------------------------------------------------ #
#  Source 2 — Google Trends RSS (KOI KEY NAHI)
# ------------------------------------------------------------------ #

_TITLE_RE = re.compile(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", re.DOTALL)


async def google_daily_trends(geo: str = "IN") -> list[str]:
    """Aaje kaya topics chali rahya che (desh pramane)."""
    raw = await request_text(
        f"https://trends.google.com/trending/rss?geo={geo}",
        timeout=15.0,
    )
    titles = [
        match.strip()
        for match in _TITLE_RE.findall(raw)
        if match.strip() and "daily search trends" not in match.lower()
    ]
    return dedupe(titles)[:25]


# ------------------------------------------------------------------ #
#  Cache
# ------------------------------------------------------------------ #


async def _read_cache(kind: str, subject: str, geo: str) -> Optional[dict]:
    try:
        await connect()
        return await trends_collection().find_one(
            {
                "kind": kind,
                "subject": subject,
                "geo": geo,
                "expires_at": {"$gt": datetime.now(timezone.utc)},
            }
        )
    except Exception:  # noqa: BLE001 — cache na male to pan kaam chale che
        return None


async def _write_cache(kind: str, subject: str, geo: str, payload: dict) -> None:
    try:
        await connect()
        await trends_collection().update_one(
            {"kind": kind, "subject": subject, "geo": geo},
            {
                "$set": {
                    **payload,
                    "kind": kind,
                    "subject": subject,
                    "geo": geo,
                    "expires_at": datetime.now(timezone.utc) + timedelta(hours=CACHE_HOURS),
                }
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        pass


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #

SYSTEM = " ".join(
    [
        "You are an Instagram SEO strategist for small and mid-size commerce brands.",
        "You know hashtag reach is a ladder: huge tags give impressions but never rank a",
        "small account; niche tags are where posts actually get discovered.",
        "You never invent hashtags nobody uses, and never use banned or spammy tags",
        "(no #like4like, #followforfollow, #f4f).",
        "Hashtags must be lowercase, no spaces, no punctuation, no leading #.",
    ]
)


async def build_trend_pack(
    product: ProductIntelligence,
    *,
    geo: Optional[str] = None,
    brand_tag: str = "",
    platform: str = "instagram",
    limit: Optional[int] = None,
) -> TrendPack:
    """Product + atyare nu trend data → ready hashtag ladder."""
    geo = geo or settings.trends_geo
    subject = f"{product.category}|{product.subCategory}".lower()

    sources: list[str] = []
    auto_keywords: list[str] = []
    daily: list[str] = []

    cached = await _read_cache("hashtags", subject, geo)
    if cached:
        auto_keywords = list(cached.get("keywords") or [])
        daily = list(cached.get("rising") or [])
        sources.append(f"cache({cached.get('source', '?')})")
    else:
        seeds = dedupe(
            [product.subCategory, product.productName, product.category]
            + product.searchKeywords[:2]
        )

        expanded = await run_chain_soft(
            [Candidate(name="google-autocomplete", run=lambda: expand_keywords(seeds, geo))],
            label="Keyword expansion",
            timeout=30.0,
            retries=1,
        )
        trending = await run_chain_soft(
            [Candidate(name="google-trends-rss", run=lambda: google_daily_trends(geo))],
            label="Daily trends",
            timeout=25.0,
            retries=1,
        )

        if expanded and expanded.data:
            auto_keywords = expanded.data
            sources.append("google-autocomplete")
        if trending and trending.data:
            daily = trending.data
            sources.append("google-trends")

        await _write_cache(
            "hashtags",
            subject,
            geo,
            {"keywords": auto_keywords, "rising": daily, "source": ",".join(sources)},
        )

    # ---- AI badhu jode ne ladder banave ----
    ai: dict[str, Any] = {}
    try:
        result = await complete(
            CompletionRequest(
                system=SYSTEM,
                prompt=_ladder_prompt(product, auto_keywords, daily, geo, platform),
                schema=HASHTAG_LADDER,
                max_tokens=2000,
            )
        )
        ai = result.data if isinstance(result.data, dict) else {}
        sources.append(f"ai:{result.provider}")
    except Exception:  # noqa: BLE001
        # AI na chalyu to pan image analysis na seed hashtags thi kaam chale.
        pass

    broad = clean_tags(ai.get("broad"), 4)
    medium = clean_tags(ai.get("medium"), 10)
    niche = clean_tags(ai.get("niche"), 12)

    tagged: list[Hashtag] = (
        [Hashtag(t, "broad", "reach") for t in broad]
        + [Hashtag(t, "medium", "discovery") for t in medium]
        + [Hashtag(t, "niche", "ranking") for t in niche]
    )

    if len(tagged) < 8:
        # AI fail thayu — seed hashtags ne tier aapi ne vaparie chie.
        seed_tags = clean_tags(product.seedHashtags, 24)
        tagged = [
            Hashtag(tag, "broad" if i < 4 else "medium" if i < 12 else "niche", "image analysis")
            for i, tag in enumerate(seed_tags)
        ]

    if brand_tag:
        cleaned = clean_tags([brand_tag], 1)
        if cleaned:
            tagged.append(Hashtag(cleaned[0], "branded", "brand"))

    max_tags = limit if limit is not None else (6 if platform == "facebook" else 30)

    seen: set[str] = set()
    hashtags: list[Hashtag] = []
    for item in tagged:
        if item.tag in seen:
            continue
        seen.add(item.tag)
        hashtags.append(item)
        if len(hashtags) >= max_tags:
            break

    keywords = dedupe(
        [str(k).strip() for k in (ai.get("keywords") or []) if str(k).strip()]
        + auto_keywords[:12]
        + product.searchKeywords
    )[:20]

    rising = [str(t).strip() for t in (ai.get("risingTopics") or []) if str(t).strip()][:5]

    return TrendPack(
        keywords=keywords,
        rising_topics=rising,
        hashtags=hashtags,
        sources=sources,
    )


def _ladder_prompt(
    product: ProductIntelligence,
    auto_keywords: list[str],
    daily: list[str],
    geo: str,
    platform: str,
) -> str:
    lines = [
        f"Product: {product.productName}",
        f"Category: {product.category} → {product.subCategory}",
    ]
    if product.style:
        lines.append(f"Style: {product.style}")
    if product.occasions:
        lines.append(f"Occasions: {', '.join(product.occasions)}")
    lines += [
        f"Audience: {product.targetGender}",
        f"Market: {geo}",
        f"Platform: {platform}",
        "",
    ]

    if auto_keywords:
        lines += [
            "What real people are typing into Google right now (use these — real demand):",
            "\n".join(auto_keywords[:40]),
            "",
        ]
    if daily:
        lines += [
            "Topics trending in this country today (use one ONLY if it honestly connects "
            "to the product):",
            ", ".join(daily[:20]),
            "",
        ]
    if product.seedHashtags:
        lines += [
            f"Starting hashtag ideas from image analysis: {', '.join(product.seedHashtags[:20])}",
            "",
        ]

    lines.append("Build the hashtag ladder now.")
    return "\n".join(lines)


# ------------------------------------------------------------------ #
#  Helpers
# ------------------------------------------------------------------ #


def clean_tags(value: Any, limit: int) -> list[str]:
    """Hashtag ne saaf kare — lowercase, fakt akshar/aankda/underscore."""
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        tag = str(item).strip().lower().lstrip("#")
        tag = "".join(ch for ch in tag if ch.isalnum() or ch == "_")
        # 24 thi lambu hoy to e hashtag nahi, model e banaveli vaakya che
        # (dakhla: "kurtimakeyourdreamcometrue"). Kaadhi naakho.
        if 3 <= len(tag) <= 24:
            out.append(tag)
        if len(out) >= limit:
            break
    return out


def dedupe(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        text = str(value).strip()
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out
