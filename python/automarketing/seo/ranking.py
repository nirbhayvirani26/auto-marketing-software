"""
Post ranking — "mari post upar aave" e mate je KHAREKHAR kaam kare che.

Instagram have caption na shabdo pan search ma index kare che (fakt hashtag
nahi). Ane Reels no ranking mukhyatve WATCH TIME, SHARES ane SAVES par chale
che. Etle ahiya be vastu che:

  1. score_caption()  — caption ne 100 ma marks aape ane su sudharvu e kahe
  2. best_post_times()— kaya vakhate mukvathi pehla kalak ma vadhu reach

Aa koi jaadu nathi — aa jaher rite jaanita signal nu checklist che, je
dareak post par apoaap lagu pade che.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from ..config import settings


@dataclass
class Check:
    id: str
    label: str
    passed: bool
    weight: int
    hint: str


@dataclass
class CaptionScore:
    score: int
    grade: str
    checks: list[Check] = field(default_factory=list)
    #: Sudharva jevi sauthi agatya ni traan vaat.
    top_fixes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "grade": self.grade,
            "top_fixes": self.top_fixes,
            "checks": [
                {"id": c.id, "label": c.label, "passed": c.passed, "hint": c.hint}
                for c in self.checks
            ],
        }


CTA_WORDS = (
    "comment", "save", "share", "tag", "dm", "link in bio", "shop", "order",
    "buy", "swipe", "follow", "kaho", "lakho", "moklo", "kahejo", "puchho",
)

WEAK_OPENERS = (
    "in today's", "we are excited", "introducing", "check out our",
    "we are thrilled", "look no further", "are you looking for",
)


def score_caption(
    *,
    caption: str,
    hashtags: list[str],
    keywords: list[str],
    platform: str = "instagram",
    fmt: str = "reel",
) -> CaptionScore:
    """Caption ne ranking na najariya thi tapase."""
    caption = (caption or "").strip()
    lower = caption.lower()
    first_line = caption.split("\n")[0] if caption else ""
    hook = lower[:125]
    primary = (keywords[0] if keywords else "").lower()
    words = [w for w in caption.split() if w]

    keyword_hits = sum(
        1 for k in keywords[:6] if len(k) > 3 and k.lower() in lower
    )

    checks: list[Check] = [
        Check(
            "hook-length",
            "Pehli line 25-100 akshar ni che",
            25 <= len(first_line) <= 100,
            12,
            "Instagram 'more' pehla fakt pehli line batave che — e j hook che.",
        ),
        Check(
            "keyword-in-hook",
            "Mukhya keyword pehla 125 akshar ma che",
            bool(primary) and primary in hook,
            18,
            "IG search caption na shuru na shabdo ne sauthi vadhu vajan aape che.",
        ),
        Check(
            "keyword-density",
            "Bija keywords pan caption ma vanayela che",
            keyword_hits >= 2,
            12,
            "2-4 related keywords sahaj rite naakho — thoosi ne nahi.",
        ),
        Check(
            "no-weak-opener",
            "Kantaadi naakhe evi shuruaat nathi",
            not any(lower.startswith(p) for p in WEAK_OPENERS),
            10,
            "'Introducing...' / 'Check out our...' thi scroll atkato nathi.",
        ),
        Check(
            "cta",
            "Spashta call-to-action che",
            any(word in lower for word in CTA_WORDS),
            14,
            "Comment/Save/Share magto CTA — aa traney signal ranking vadhare che.",
        ),
        Check(
            "length",
            "Lambai barabar che",
            (20 <= len(words) <= 150) if platform == "instagram" else (15 <= len(words) <= 120),
            10,
            "Bahu tunku = ochi mahiti, bahu lambu = koi vanchtu nathi.",
        ),
        Check(
            "hashtag-count",
            "Hashtag ni sankhya barabar che",
            (12 <= len(hashtags) <= 30) if platform == "instagram" else (2 <= len(hashtags) <= 8),
            10,
            (
                "IG par 15-30 vachhe rakho, ane niche tags vadhare."
                if platform == "instagram"
                else "Facebook par 3-5 j — vadhare hoy to spam lage."
            ),
        ),
        Check(
            "line-breaks",
            "Fakra ma vahenchayelu che",
            ("\n" in caption) or len(words) < 30,
            8,
            "Ek moto block koi vanchtu nathi — line break naakho.",
        ),
        Check(
            "no-hashtag-in-body",
            "Caption ni andar hashtag bhelsela nathi",
            caption.count("#") <= 1,
            6,
            "Hashtag chhelle alag rakho — vanchvama saral rahe che.",
        ),
    ]

    if fmt == "reel":
        checks.append(
            Check(
                "reel-hook",
                "Reel no hook pehli 3 second mate lakhayo che",
                bool(re.search(r"[?!]|\d", first_line)),
                10,
                "Sawal, aankdo ke chonkavnaru vidhan — reels watch-time par rank thay che.",
            )
        )

    total = sum(c.weight for c in checks)
    earned = sum(c.weight for c in checks if c.passed)
    score = round((earned / total) * 100) if total else 0

    grade = "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D"

    top_fixes = [
        c.hint for c in sorted((c for c in checks if not c.passed), key=lambda c: -c.weight)[:3]
    ]

    return CaptionScore(score=score, grade=grade, checks=checks, top_fixes=top_fixes)


# ------------------------------------------------------------------ #
#  Kaya vakhate post karvu
# ------------------------------------------------------------------ #


@dataclass
class Slot:
    #: 0 = Ravivar ... 6 = Shanivar (Python nu weekday nathi — Sunday=0)
    weekday: int
    hour: int
    minute: int
    label: str
    strength: str  # "best" | "good"


#: Category pramane sauthi saara slot.
#: Aa jaher engagement study par aadharit SHURUAAT che — tamara potana
#: published posts na aankda par thi aane sudharti jai shakay.
BASE_SLOTS: dict[str, list[Slot]] = {
    "fashion": [
        Slot(2, 11, 0, "Mangal savare", "best"),
        Slot(4, 19, 30, "Guruvar sanje", "best"),
        Slot(6, 11, 30, "Shanivar savare", "good"),
        Slot(0, 20, 0, "Ravivar raate", "good"),
    ],
    "food": [
        Slot(3, 12, 0, "Budhvar bapore", "best"),
        Slot(5, 19, 0, "Shukravar sanje", "best"),
        Slot(6, 13, 0, "Shanivar bapore", "good"),
    ],
    "beauty": [
        Slot(1, 20, 0, "Somvar raate", "best"),
        Slot(4, 21, 0, "Guruvar raate", "best"),
        Slot(0, 11, 0, "Ravivar savare", "good"),
    ],
    "default": [
        Slot(2, 11, 0, "Mangal savare", "best"),
        Slot(3, 19, 0, "Budhvar sanje", "best"),
        Slot(5, 18, 30, "Shukravar sanje", "good"),
        Slot(0, 20, 0, "Ravivar raate", "good"),
    ],
}


def _slots_for(category: str) -> list[Slot]:
    key = (category or "").lower()
    if re.search(r"apparel|fashion|cloth|wear|saree|kurti|shoe|jewel|accessor", key):
        return BASE_SLOTS["fashion"]
    if re.search(r"food|snack|restaurant|bakery|cafe|sweet", key):
        return BASE_SLOTS["food"]
    if re.search(r"beauty|skin|cosmetic|makeup|hair|wellness", key):
        return BASE_SLOTS["beauty"]
    return BASE_SLOTS["default"]


def best_post_times(
    *,
    category: str,
    count: int = 3,
    start_from: Optional[datetime] = None,
    tz_offset_minutes: Optional[int] = None,
) -> list[dict]:
    """
    Have thi pachi na `count` sauthi saara post-time (UTC ma).

    `tz_offset_minutes` — audience na timezone no offset (IST = 330).
    """
    now = start_from or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    offset = tz_offset_minutes
    if offset is None:
        offset = settings.timezone_offset_minutes

    slots = _slots_for(category)
    shift = timedelta(minutes=offset)
    out: list[dict] = []

    for day_ahead in range(14):
        if len(out) >= count:
            break

        # Audience na local time ma aa kayo vaar che.
        local = now + timedelta(days=day_ahead) + shift
        # Python: Monday=0 … Sunday=6. Aapne Sunday=0 joiye.
        weekday = (local.weekday() + 1) % 7

        for slot in slots:
            if slot.weekday != weekday:
                continue

            local_at = local.replace(
                hour=slot.hour, minute=slot.minute, second=0, microsecond=0
            )
            at = local_at - shift

            if at <= now + timedelta(minutes=5):
                continue

            out.append({"at": at, "label": slot.label, "strength": slot.strength})
            if len(out) >= count:
                break

    out.sort(key=lambda item: item["at"])
    return out


def spread_schedule(
    count: int,
    *,
    category: str,
    start_from: Optional[datetime] = None,
    min_gap_hours: float = 20.0,
) -> list[datetime]:
    """
    Ek j product na ghana posts ne fela do — badha ek j vakhate na jaay.
    Instagram par ek pachi ek turant post thay to reach ghatade che.
    """
    gap = timedelta(hours=min_gap_hours)
    slots = best_post_times(category=category, count=count * 3, start_from=start_from)

    chosen: list[datetime] = []
    for slot in slots:
        if len(chosen) >= count:
            break
        if not chosen or (slot["at"] - chosen[-1]) >= gap:
            chosen.append(slot["at"])

    # Slot khuti gaya to gap pramane aagal vadhata jao.
    cursor = chosen[-1] if chosen else (start_from or datetime.now(timezone.utc))
    while len(chosen) < count:
        cursor = cursor + gap
        chosen.append(cursor)

    return chosen
