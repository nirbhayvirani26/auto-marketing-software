"""
Reel no script — "kaya scene ma su dekhaay ane su lakhelu hoy".

Aa file nu ek j kaam che: product ni samajan ne EK VECHAN-LAYAK VIDEO
SCRIPT ma badalvu. Reels no ranking watch-time par chale che, etle
script ma traan vastu farjiyat che:

  1. Pehli 3 second no hook — nahi to koi aagal jotu j nathi
  2. Dareak 2-3 second e kaink navu — scroll atke etle
  3. Chhelle spashta CTA — save / share / DM
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

from ..ai.base import CompletionRequest
from ..ai.registry import complete
from ..ai.schemas import REEL_PLAN
from ..ai.vision import ProductIntelligence
from ..trends.keywords import TrendPack
from ..video.aivideo import ai_video_configured, ai_video_max_clips
from ..video.render import MOTIONS

ScenePurpose = Literal[
    "hook", "reveal", "detail", "benefit", "lifestyle", "proof", "offer", "cta"
]
ImageStrategy = Literal["uploaded", "generate", "tryon"]
Mode = Literal["single", "multi", "tryon", "reference"]

PURPOSES = ("hook", "reveal", "detail", "benefit", "lifestyle", "proof", "offer", "cta")
TRANSITIONS = (
    "fade", "slideleft", "slideright", "slideup", "wipeleft",
    "circleopen", "dissolve", "smoothleft", "none",
)


@dataclass
class PlannedScene:
    index: int
    purpose: str
    duration: float
    on_screen_text: str
    voice_line: str
    image_strategy: str
    #: "uploaded" hoy to kai image (0 thi shuru), nahi to -1.
    uploaded_image_index: int
    image_prompt: str
    motion: str
    transition: str
    #: "still" = ffmpeg image ne halave | "video" = Omni kharekhar video banave
    motion_strategy: str = "still"
    #: "video" hoy to — su halvu joiye ane camera kem fare.
    video_prompt: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ReferenceStyle:
    scene_count: int = 6
    average_scene_duration: float = 3.0
    pacing: str = "medium"
    shot_types: list[str] = field(default_factory=list)
    text_style: str = ""
    hook_style: str = ""
    mood: str = ""
    summary: str = ""


@dataclass
class ReelPlan:
    concept: str
    scenes: list[PlannedScene]
    total_duration: float
    music_mood: str
    cover_text: str
    caption_seed: str

    def to_dict(self) -> dict:
        return {
            "concept": self.concept,
            "scenes": [s.to_dict() for s in self.scenes],
            "total_duration": self.total_duration,
            "music_mood": self.music_mood,
            "cover_text": self.cover_text,
            "caption_seed": self.caption_seed,
        }


SYSTEM = " ".join(
    [
        "You are a short-form video director who makes Instagram Reels that actually sell.",
        "You understand the only three things that matter: the first 3 seconds decide the",
        "watch rate, a visual change every 2-3 seconds keeps people watching, and the last",
        "2 seconds decide whether they save or share.",
        "You never write on-screen text longer than 8 words — nobody reads a paragraph on a",
        "moving video.",
        "You never invent prices, offers, discounts, delivery promises or claims that were",
        "not given to you.",
        "You prefer the seller's real product photos for any shot of the product itself.",
        "AI-generated shots are for setting and mood only.",
        "Return only the structured JSON requested.",
    ]
)

LANGUAGE_RULES = {
    "en": "Write on-screen text and voice lines in simple English.",
    "hi": "Write on-screen text and voice lines in Hindi (Devanagari script).",
    "gu": "Write on-screen text and voice lines in Gujarati script.",
    "hinglish": (
        "Write on-screen text and voice lines in Hinglish — Hindi in Latin script, mixed "
        "with English, the way Indian creators actually caption reels."
    ),
}


def _mode_line(mode: str, product_count: int) -> str:
    return {
        "single": (
            "This reel sells ONE product. Show it from multiple angles and build desire for it."
        ),
        "multi": (
            f"This reel shows a COLLECTION of {product_count} products. Give each product its "
            "own 2-3 second beat, keep the pace fast, and end on the collection as a whole. "
            "Do NOT spend the whole reel on one item."
        ),
        "tryon": (
            "This reel shows the brand's own avatar/model WEARING or USING the product. "
            "Lead with the person, not the flat product shot — people stop for faces."
        ),
        "reference": (
            "This reel must copy the structure and feel of the reference reel described "
            "below, but with THIS product and THIS brand."
        ),
    }.get(mode, "This reel sells one product.")


def _prompt(
    *,
    product: ProductIntelligence,
    trends: Optional[TrendPack],
    uploaded_image_count: int,
    product_names: Optional[list[str]],
    mode: str,
    target: int,
    language: str,
    tone: str,
    brand_name: str,
    avatar_description: str,
    reference: Optional[ReferenceStyle],
    price: str,
    ai_video_max: int,
) -> str:
    lines = [
        f"Direct a {target}-second Instagram Reel.",
        "",
        _mode_line(mode, len(product_names or []) or uploaded_image_count),
        LANGUAGE_RULES.get(language, LANGUAGE_RULES["en"]),
    ]
    if tone:
        lines.append(f"Tone: {tone}")
    if brand_name:
        lines.append(f"Brand: {brand_name}")

    lines += [
        "",
        "PRODUCT — these are the only facts you may state:",
        f"• {product.productName} ({product.category} → {product.subCategory})",
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
        lines.append(f"• Why people buy: {'; '.join(product.sellingPoints)}")
    if product.emotionalHooks:
        lines.append(f"• What the buyer feels: {'; '.join(product.emotionalHooks)}")
    if product.objections:
        lines.append(f"• Doubts to answer: {'; '.join(product.objections)}")
    if price:
        lines.append(f"• Price: {price}")
    lines.append(
        f"• Audience: {product.targetAudience or f'{product.targetGender} {product.targetAgeRange}'}"
    )

    if product_names:
        lines += [
            "",
            "PRODUCTS IN THIS COLLECTION (one beat each, in this order):",
            *[f"  photo {i}: {name}" for i, name in enumerate(product_names)],
        ]

    last_index = max(0, uploaded_image_count - 1)
    lines += [
        "",
        f"AVAILABLE PHOTOS: the seller uploaded {uploaded_image_count} real photo(s), "
        f"indexed 0 to {last_index}.",
        "Photo 0 is usually the best hero shot.",
        (
            "Use each uploaded photo at least once before repeating any of them."
            if uploaded_image_count > 1
            else "You only have one photo, so vary the shots with different motion and "
            "different on-screen text rather than repeating the same framing."
        ),
        "",
    ]

    if avatar_description:
        lines += [
            "AVATAR (the brand's face — use imageStrategy 'tryon' for shots with them):",
            avatar_description,
        ]
    else:
        lines.append("No avatar is configured — do not use imageStrategy 'tryon'.")

    if reference:
        lines += [
            "",
            "REFERENCE REEL to copy the structure of:",
            f"• {reference.summary}",
            f"• {reference.scene_count} shots, average {reference.average_scene_duration:.1f}s "
            f"each, {reference.pacing} pacing",
            f"• Shot types: {', '.join(reference.shot_types)}",
            f"• Text style: {reference.text_style}",
            f"• Hook style: {reference.hook_style}",
            f"• Mood: {reference.mood}",
            "Match this rhythm and this hook style. Do NOT copy its exact words.",
        ]

    if trends:
        if trends.rising_topics:
            lines.append(
                "\nTRENDING NOW (use only if it honestly fits): "
                + ", ".join(trends.rising_topics)
            )
        if trends.keywords:
            lines.append(
                "KEYWORDS people search: " + ", ".join(trends.keywords[:8])
            )

    min_scenes = max(4, round(target / 5))
    max_scenes = max(min_scenes + 1, round(target / 2.5))

    lines += [
        "",
        (
            f"LIVE MOTION: you may mark up to {ai_video_max} scene(s) as motionStrategy "
            "'video' — a real AI-generated moving clip instead of an animated photo. "
            "Spend them where movement actually sells: the hook, or a shot where fabric "
            "flows / the model turns / the product is used. A 'video' scene must be "
            "between 3 and 8 seconds. Everything else stays 'still'."
            if ai_video_max > 0
            else "LIVE MOTION is not available. Every scene must use motionStrategy "
            "'still' and videoPrompt must be an empty string."
        ),
        "",
        "RULES:",
        f"• Total of all durationSeconds must be {target} seconds, ±3.",
        f"• Use {min_scenes} to {max_scenes} scenes. More, shorter scenes hold attention "
        "better than fewer long ones.",
        "• Scene 1 is the hook: 2-3.5 seconds, biggest on-screen text, and it must create a "
        "question in the viewer's mind. Never open with the brand name or a logo.",
        "• The last scene is the CTA: ask for a comment, a save, a share or a DM. Be specific.",
        "• Alternate motion between scenes — never the same motion twice in a row.",
        "• Leave onScreenText empty on at least one mid-reel scene so the product can breathe.",
        "",
        "Write the shot list now.",
    ]

    return "\n".join(lines)


async def plan_reel(
    *,
    product: ProductIntelligence,
    trends: Optional[TrendPack] = None,
    uploaded_image_count: int = 1,
    product_names: Optional[list[str]] = None,
    mode: Mode = "single",
    target_duration: int = 40,
    language: str = "en",
    tone: str = "",
    brand_name: str = "",
    avatar_description: str = "",
    reference: Optional[ReferenceStyle] = None,
    price: str = "",
) -> ReelPlan:
    """Product + trends → shot-by-shot reel script."""
    target = max(15, min(90, target_duration))
    ai_video_max = ai_video_max_clips() if ai_video_configured() else 0

    result = await complete(
        CompletionRequest(
            system=SYSTEM,
            prompt=_prompt(
                product=product,
                trends=trends,
                uploaded_image_count=uploaded_image_count,
                product_names=product_names,
                mode=mode,
                target=target,
                language=language,
                tone=tone,
                brand_name=brand_name,
                avatar_description=avatar_description,
                reference=reference,
                price=price,
                ai_video_max=ai_video_max,
            ),
            schema=REEL_PLAN,
            max_tokens=5000,
        )
    )

    raw = result.data if isinstance(result.data, dict) else {}
    return normalise_plan(
        raw,
        product=product,
        uploaded_image_count=uploaded_image_count,
        has_avatar=bool(avatar_description),
        target=target,
        ai_video_max=ai_video_max,
    )


# ------------------------------------------------------------------ #
#  Saaf karvu — AI je aape e hamesha barabar na hoy
# ------------------------------------------------------------------ #


def _clamp(value: Any, low: float, high: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number:
        return fallback
    return max(low, min(high, number))


def _trim_words(text: Any, max_words: int) -> str:
    words = str(text or "").replace("\n", " ").split()
    return " ".join(words[:max_words])


def normalise_plan(
    raw: dict,
    *,
    product: ProductIntelligence,
    uploaded_image_count: int,
    has_avatar: bool,
    target: int,
    ai_video_max: int = 0,
) -> ReelPlan:
    image_count = max(0, uploaded_image_count)
    raw_scenes = raw.get("scenes")
    scenes: list[PlannedScene] = []

    if isinstance(raw_scenes, list):
        for index, item in enumerate(raw_scenes[:24]):
            if not isinstance(item, dict):
                continue
            duration = _clamp(item.get("durationSeconds"), 1.5, 8.0, 3.0)
            if duration <= 0:
                continue

            strategy = str(item.get("imageStrategy") or "uploaded")
            if strategy not in ("uploaded", "generate", "tryon"):
                strategy = "uploaded"
            # Avatar nathi to tryon shakya nathi.
            if strategy == "tryon" and not has_avatar:
                strategy = "generate"
            # Ek pan upload nathi to uploaded shakya nathi.
            if strategy == "uploaded" and image_count == 0:
                strategy = "generate"

            if strategy == "uploaded":
                try:
                    wanted = int(item.get("uploadedImageIndex", index))
                except (TypeError, ValueError):
                    wanted = index
                image_index = (wanted if wanted >= 0 else index) % max(1, image_count)
            else:
                image_index = -1

            purpose = str(item.get("purpose") or "")
            if purpose not in PURPOSES:
                purpose = "hook" if index == 0 else "detail"

            motion = str(item.get("motion") or "")
            if motion not in MOTIONS:
                motion = MOTIONS[index % 6]

            transition = str(item.get("transition") or "")
            if transition not in TRANSITIONS:
                transition = "fade"

            scenes.append(
                PlannedScene(
                    index=index,
                    purpose=purpose,
                    duration=duration,
                    on_screen_text=_trim_words(item.get("onScreenText"), 10),
                    voice_line=str(item.get("voiceLine") or "").strip()[:220],
                    image_strategy=strategy,
                    uploaded_image_index=image_index,
                    image_prompt=str(item.get("imagePrompt") or "").strip()[:1200],
                    motion=motion,
                    transition=transition,
                    motion_strategy=(
                        "video" if item.get("motionStrategy") == "video" else "still"
                    ),
                    video_prompt=str(item.get("videoPrompt") or "").strip()[:900],
                )
            )

    if not scenes:
        scenes = _fallback_scenes(product, target, image_count)

    # Ek j motion be var sathe na aave — video jado lage che.
    for i in range(1, len(scenes)):
        if scenes[i].motion == scenes[i - 1].motion:
            scenes[i].motion = MOTIONS[(MOTIONS.index(scenes[i].motion) + 3) % 6]

    # Chhello scene CTA hovo j joiye.
    if len(scenes) > 2 and scenes[-1].purpose != "cta":
        scenes[-1].purpose = "cta"

    # Kul lambai ne target par lai aavo.
    total = sum(s.duration for s in scenes)
    if total > 0 and abs(total - target) > 1:
        factor = target / total
        for scene in scenes:
            scene.duration = round(max(1.5, min(8.0, scene.duration * factor)), 1)

    # Pehlo scene hook che — 3.5s thi lambo na hovo joiye.
    scenes[0].duration = min(scenes[0].duration, 3.5)
    scenes[0].transition = "none"
    scenes[0].purpose = "hook"

    _apply_video_limit(scenes, ai_video_max)

    for index, scene in enumerate(scenes):
        scene.index = index

    return ReelPlan(
        concept=str(raw.get("concept") or "").strip() or f"{product.productName} reel",
        scenes=scenes,
        total_duration=round(sum(s.duration for s in scenes), 1),
        music_mood=str(raw.get("musicMood") or "upbeat"),
        cover_text=_trim_words(raw.get("coverText") or product.productName, 6),
        caption_seed=str(raw.get("captionSeed") or "").strip(),
    )


def _apply_video_limit(scenes: list[PlannedScene], maximum: int) -> None:
    """
    AI ne "2 thi vadhu video na karo" kahyu hoy chhata e kyarek badha scene
    video kari nakhe che. Ek reel na 10 clip etle 15 minute ane motu bill —
    etle had ahiya CODE ma pan lagavie chie, prompt par bharoso rakhya vagar.

    Kaya scene rakhva: hook sauthi pehla (tya j lok atke che), pachi jena
    mate AI e kharekhar movement lakhyu hoy e.
    """
    if maximum <= 0:
        for scene in scenes:
            scene.motion_strategy = "still"
            scene.video_prompt = ""
        return

    wanted = [
        (position, scene)
        for position, scene in enumerate(scenes)
        if scene.motion_strategy == "video"
    ]
    wanted.sort(
        key=lambda pair: (
            0 if pair[1].purpose == "hook" else 1,
            0 if pair[1].video_prompt else 1,
            pair[0],
        )
    )

    for rank, (_, scene) in enumerate(wanted):
        if rank < maximum:
            # Omni 3-10s j aape che — scene ne e had ma lai aavie chie.
            scene.duration = round(max(3.0, min(8.0, scene.duration)), 1)
        else:
            scene.motion_strategy = "still"
            scene.video_prompt = ""


def _fallback_scenes(
    product: ProductIntelligence, target: int, image_count: int
) -> list[PlannedScene]:
    """AI sav fail thay to pan reel to banvi j joiye."""
    count = max(4, min(8, round(target / 5)))
    per = round(target / count, 1)
    images = max(1, image_count)

    texts = [
        product.sellingPoints[0] if product.sellingPoints else product.productName,
        " · ".join(product.colors) if product.colors else product.subCategory,
        " · ".join(product.materials) if product.materials else product.style,
        product.occasions[0] if product.occasions else "",
        product.keyFeatures[0] if product.keyFeatures else "",
        "Link in bio",
    ]

    return [
        PlannedScene(
            index=index,
            purpose="hook" if index == 0 else "cta" if index == count - 1 else "detail",
            duration=min(per, 3.2) if index == 0 else per,
            on_screen_text=_trim_words(texts[index % len(texts)], 8),
            voice_line="",
            image_strategy="uploaded",
            uploaded_image_index=index % images,
            image_prompt="",
            motion=MOTIONS[index % 6],
            transition="none" if index == 0 else "fade",
        )
        for index in range(count)
    ]
