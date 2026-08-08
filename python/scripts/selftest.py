#!/usr/bin/env python
"""
Self-test — aakhi pipeline vaar var chalavi ne jue ke kai j tutatu to nathi.

    python scripts/selftest.py              # 10 round, offline
    python scripts/selftest.py 3            # 3 round
    python scripts/selftest.py 3 pipeline   # + AAKHO reel pipeline (dhimu)

BE MODE:
  offline  (default) — koi API key ke internet vagar chale che. Chain,
                       fonts, image processing, ranking, scheduling ane
                       ffmpeg render — badhu tapase che.
  pipeline           — uper nu badhu + KHAREKHAR ek reel banave che
                       (script → images → music → voiceover → render →
                       public URL → caption). Vision ne stub karie chie
                       jethi vision key vagar pan aakho rasto test thay.

Dareak round ma JAANI JOINE juda juda input aapie chie — alag aspect
ratio, alag scene count, unicode text, khali text, lambo text — jethi
"mara computer par to chalyu hatu" jevu na thay.
"""

from __future__ import annotations

import _console  # noqa: F401  (Windows console UTF-8)

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from automarketing.config import storage_dir  # noqa: E402
from automarketing.errors import FatalError, RetryableError  # noqa: E402
from automarketing.media import images as imagelib  # noqa: E402
from automarketing.pipeline.chain import (  # noqa: E402
    Candidate,
    ChainError,
    breaker_status,
    reset_breakers,
    run_chain,
    run_chain_soft,
)
from automarketing.seo.ranking import (  # noqa: E402
    best_post_times,
    score_caption,
    spread_schedule,
)
from automarketing.trends.audio import instagram_audio_hints, mood_for_product  # noqa: E402
from automarketing.video.ffmpeg import engine_status, probe, run_ffmpeg  # noqa: E402
from automarketing.video.fonts import font_status, resolve_font, script_for_language  # noqa: E402
from automarketing.video.render import Scene, TextOverlay, render_reel, wrap_text  # noqa: E402

OUT = storage_dir() / "selftest"

results: list[dict] = []


# ------------------------------------------------------------------ #
#  Nano test framework
# ------------------------------------------------------------------ #


async def test(name: str, runner) -> bool:
    started = time.monotonic()
    try:
        note = await runner()
        ms = int((time.monotonic() - started) * 1000)
        results.append({"name": name, "ok": True, "ms": ms, "note": note or ""})
        print(f"  ✓ {name}" + (f"  — {note}" if note else ""))
        return True
    except Exception as error:  # noqa: BLE001
        ms = int((time.monotonic() - started) * 1000)
        message = str(error)
        results.append({"name": name, "ok": False, "ms": ms, "error": message})
        print(f"  ✗ {name}\n      {message.splitlines()[0][:200]}")
        return False


def assert_that(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)


# ------------------------------------------------------------------ #
#  Test data — dar round e alag
# ------------------------------------------------------------------ #

ASPECTS = [(1200, 1200), (1600, 900), (900, 1600), (2000, 1400), (800, 800), (1080, 1350)]

TEXTS = [
    "Simple text",
    "Text with: colon, 'apostrophe' and 100% percent",
    "Ek bahu j lambo text je jaani joine ghani badhi line ma vahenchai jashe ane "
    "test karshe ke wrap barabar kaam kare che ke nahi",
    "",
    "उत्सव का नया कलेक्शन",
    "તહેવારનું નવું કલેક્શન",
    "Emoji 🔥 test 💯 karo",
    "Special \\ back / slash [brackets] {braces}",
    "A",
    "₹1,299 — 40% OFF",
]

MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none"]
TRANSITIONS = ["fade", "slideleft", "slideup", "circleopen", "dissolve", "wipeleft", "none"]


def make_image(round_no: int, index: int) -> Path:
    from PIL import Image, ImageDraw

    width, height = ASPECTS[(round_no + index) % len(ASPECTS)]
    hue = (round_no * 47 + index * 83) % 360

    import colorsys

    r, g, b = colorsys.hsv_to_rgb(hue / 360, 0.45, 0.20)
    r2, g2, b2 = colorsys.hsv_to_rgb(((hue + 140) % 360) / 360, 0.70, 0.85)

    image = Image.new("RGB", (width, height), (int(r * 255), int(g * 255), int(b * 255)))
    draw = ImageDraw.Draw(image)
    radius = int(min(width, height) * 0.28)
    draw.ellipse(
        [width // 2 - radius, height // 2 - radius, width // 2 + radius, height // 2 + radius],
        fill=(int(r2 * 255), int(g2 * 255), int(b2 * 255)),
    )

    path = OUT / f"r{round_no}-img{index}.jpg"
    path.write_bytes(imagelib.encode_jpeg(image, quality=88))
    return path


# ------------------------------------------------------------------ #
#  1. Provider chain
# ------------------------------------------------------------------ #


async def test_chain(round_no: int) -> None:
    reset_breakers()

    async def good():
        return "ok"

    async def broken():
        raise Exception("500 server error")

    async def fatal():
        raise FatalError("bad key")

    await test(
        f"[{round_no}] chain: pehlo fail → bijo chale",
        lambda: _chain_fallback(good, broken),
    )
    await test(f"[{round_no}] chain: configure na hoy e skip thay", lambda: _chain_skip(good))
    await test(f"[{round_no}] chain: retry fakt retryable par", _chain_retry)
    await test(f"[{round_no}] chain: free provider pehla", lambda: _chain_free(good))
    await test(f"[{round_no}] chain: prefer sauthi pehla", lambda: _chain_prefer(good))
    await test(f"[{round_no}] chain: badha fail → ChainError", lambda: _chain_all_fail(fatal))
    await test(f"[{round_no}] chain: circuit breaker khule che", lambda: _chain_breaker(good, fatal))
    await test(f"[{round_no}] chain: timeout par bija par jaay", lambda: _chain_timeout(good))


async def _chain_fallback(good, broken):
    result = await run_chain(
        [Candidate(name="bad", run=broken), Candidate(name="good", run=good)],
        label="t", retries=0,
    )
    assert_that(result.data == "ok" and result.provider == "good", "bijo provider na chalyo")
    assert_that(len(result.attempts) == 2, "attempts no hisab khoto")
    return f"{len(result.attempts)} attempts"


async def _chain_skip(good):
    result = await run_chain(
        [
            Candidate(name="nokey", run=good, configured=lambda: False),
            Candidate(name="haskey", run=good),
        ],
        label="t", retries=0,
    )
    assert_that(result.provider == "haskey", "configure na hoy e chalyu")
    assert_that(result.attempts[0].skipped == "not-configured", "skip nu karan khotu")
    return None


async def _chain_retry():
    counts = {"retryable": 0, "fatal": 0}

    async def retryable():
        counts["retryable"] += 1
        raise RetryableError("try again")

    async def fatal():
        counts["fatal"] += 1
        raise FatalError("bad key")

    await run_chain_soft([Candidate(name="r", run=retryable)], label="t", retries=2, backoff=0.01)
    await run_chain_soft([Candidate(name="f", run=fatal)], label="t", retries=2, backoff=0.01)

    assert_that(counts["retryable"] == 3, f"retryable {counts['retryable']} var thayu, 3 joitu")
    assert_that(counts["fatal"] == 1, f"fatal {counts['fatal']} var thayu, 1 joitu")
    return f"retryable ×{counts['retryable']}, fatal ×{counts['fatal']}"


async def _chain_free(good):
    result = await run_chain(
        [Candidate(name="paid", run=good, free=False), Candidate(name="free", run=good)],
        label="t", retries=0,
    )
    assert_that(result.provider == "free", "paid provider pehla chalyo")
    return None


async def _chain_prefer(good):
    result = await run_chain(
        [Candidate(name="a", run=good), Candidate(name="b", run=good)],
        label="t", retries=0, prefer="b",
    )
    assert_that(result.provider == "b", "prefer kaam na karyu")
    return None


async def _chain_all_fail(fatal):
    try:
        await run_chain(
            [Candidate(name="x", run=fatal), Candidate(name="y", run=fatal)],
            label="t", retries=0,
        )
    except ChainError as error:
        assert_that(len(error.attempts) == 2, "attempts gum")
        assert_that("x" in error.summary, "summary ma provider nathi")
        return None
    raise AssertionError("ChainError aavvo joito hato")


async def _chain_breaker(good, fatal):
    reset_breakers()
    for _ in range(3):
        await run_chain_soft([Candidate(name="flaky", run=fatal)], label="t", retries=0)

    open_ones = [b for b in breaker_status() if b["provider"] == "flaky"]
    assert_that(open_ones and open_ones[0]["open_for_seconds"] > 0, "breaker khulvu joitu hatu")

    result = await run_chain(
        [Candidate(name="flaky", run=good), Candidate(name="backup", run=good)],
        label="t", retries=0,
    )
    assert_that(result.provider == "backup", "breaker khulyo hova chhata chalyo")
    reset_breakers()
    return "3 fail → skip"


async def _chain_timeout(good):
    async def slow():
        await asyncio.sleep(5)
        return "never"

    reset_breakers()
    result = await run_chain(
        [Candidate(name="slow", run=slow, timeout=0.2), Candidate(name="fast", run=good)],
        label="t", retries=0,
    )
    assert_that(result.provider == "fast", "timeout pachi bijo na chalyo")
    return None


# ------------------------------------------------------------------ #
#  2. Fonts + text
# ------------------------------------------------------------------ #


async def test_text(round_no: int) -> None:
    async def fonts():
        found = []
        for script in ("latin", "devanagari", "gujarati"):
            path = resolve_font(script)
            assert_that(path and Path(path).exists(), f"{script} no font na madyo")
            found.append(script)
        return ", ".join(found)

    async def language_map():
        assert_that(script_for_language("hi") == "devanagari", "hi → devanagari khotu")
        assert_that(script_for_language("gu") == "gujarati", "gu → gujarati khotu")
        assert_that(script_for_language("en") == "latin", "en → latin khotu")
        # Hinglish LATIN akshar ma lakhay che — Devanagari font na aavvo joiye.
        assert_that(script_for_language("hinglish") == "latin", "hinglish → latin khotu")
        return None

    async def wrapping():
        for text in TEXTS:
            wrapped = wrap_text(text, 70, 900)
            lines = wrapped.split("\n") if wrapped else []
            assert_that(len(lines) <= 4, f"'{text[:20]}' {len(lines)} line ma gayu")
        long_word = wrap_text("A" * 400, 90, 900)
        assert_that(isinstance(long_word, str), "lambo shabd crash karyo")
        return f"{len(TEXTS)} case"

    await test(f"[{round_no}] fonts: traney lipi na font made che", fonts)
    await test(f"[{round_no}] fonts: language → lipi barabar mape che", language_map)
    await test(f"[{round_no}] text wrap: 4 line thi vadhu nahi, khali pan chale", wrapping)


# ------------------------------------------------------------------ #
#  3. Ranking + scheduling
# ------------------------------------------------------------------ #


async def test_ranking(round_no: int) -> None:
    async def good_caption():
        score = score_caption(
            caption=(
                "Cotton kurti je aakho divas thandi rakhe che?\n\n"
                "Aa handblock cotton kurti office ane evening banne mate chale che. "
                "Fabric shwas le che, etle June ma pan chip-chip nahi thay.\n\n"
                "Size ma confusion che? Comment ma SIZE lakho, hu fit guide mokli daish."
            ),
            hashtags=[f"tag{i}" for i in range(18)],
            keywords=["cotton kurti", "handblock kurti", "summer kurti"],
            platform="instagram",
            fmt="reel",
        )
        assert_that(score.score >= 70, f"saru caption ne fakt {score.score} malyu")
        assert_that(score.grade in ("A", "B"), f"grade {score.grade}")
        return f"{score.score}/100 · {score.grade}"

    async def bad_caption():
        score = score_caption(
            caption="In today's fast-paced world, look no further than our amazing product!!!",
            hashtags=["a"],
            keywords=["cotton kurti"],
            platform="instagram",
            fmt="reel",
        )
        assert_that(score.score < 55, f"kharab caption ne {score.score} malyu — bahu vadhu")
        assert_that(score.top_fixes, "su sudharvu e na kahyu")
        return f"{score.score}/100 · {len(score.top_fixes)} suchan"

    async def score_range():
        for text in [*TEXTS, "x" * 3000]:
            for platform in ("instagram", "facebook"):
                score = score_caption(
                    caption=text, hashtags=[], keywords=[], platform=platform
                )
                assert_that(0 <= score.score <= 100, f"score {score.score} range ni bahar")
        return None

    async def slots():
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        for category in ("fashion", "food", "beauty", "electronics", ""):
            found = best_post_times(category=category, count=4, start_from=now)
            assert_that(len(found) == 4, f"{category}: {len(found)} slot madya")
            for index, slot in enumerate(found):
                assert_that(slot["at"] > now, f"{category}: slot {index} bhutkal ma che")
                if index:
                    assert_that(
                        slot["at"] >= found[index - 1]["at"], f"{category}: kram ma nathi"
                    )
        return None

    async def spread():
        gap_hours = 20
        chosen = spread_schedule(5, category="fashion", min_gap_hours=gap_hours)
        assert_that(len(chosen) == 5, f"{len(chosen)} slot madya")
        for index in range(1, len(chosen)):
            gap = (chosen[index] - chosen[index - 1]).total_seconds() / 3600
            assert_that(gap >= gap_hours - 0.01, f"slot {index} nu antar fakt {gap:.1f} kalak")
        return f"5 slot, ochha ma ochhu {gap_hours}h antar"

    await test(f"[{round_no}] ranking: saru caption A/B grade lave", good_caption)
    await test(f"[{round_no}] ranking: kharab caption ne ochha marks", bad_caption)
    await test(f"[{round_no}] ranking: score hamesha 0-100 vachhe", score_range)
    await test(f"[{round_no}] scheduling: badha slot bhavishya ma ane kram ma", slots)
    await test(f"[{round_no}] scheduling: spread ma barabar antar", spread)


# ------------------------------------------------------------------ #
#  4. Music mood
# ------------------------------------------------------------------ #


async def test_reaper(round_no: int) -> None:
    """
    Taja job ne "atki gayo" ganvo NA joiye.

    Aa regression test che: MongoDB naive (timezone vagar) datetime pachu
    aape che, ane Python ma `naive.timestamp()` ene LOCAL time gane che.
    IST ma e 5.5 kalak no farak paade che — ane 2 minute juno job pan
    "25 minute thi atkelo" ganai jato hato. Bahu chidavnaru bug hato.
    """
    from bson import ObjectId

    from automarketing.db import close as _close  # noqa: F401
    from automarketing.db import connect, reel_jobs
    from automarketing.reels.jobs import now
    from automarketing.reels.runner import reap_stuck_jobs

    async def fresh_job_survives():
        await connect()
        job_id = ObjectId()
        await reel_jobs().insert_one(
            {
                "_id": job_id,
                "brand_id": "selftest",
                "status": "running",
                "steps": [],
                "created_at": now(),
                "updated_at": now(),  # ATYARE j — atkelo nathi
            }
        )
        try:
            await reap_stuck_jobs()
            after = await reel_jobs().find_one({"_id": job_id})
            assert_that(
                after and after.get("status") == "running",
                f"taja job ne khota ma 'failed' kari didho (status: "
                f"{after.get('status') if after else 'gum'})",
            )
            return "taja job bachi gayo"
        finally:
            await reel_jobs().delete_one({"_id": job_id})

    async def old_job_reaped():
        from datetime import timedelta

        await connect()
        job_id = ObjectId()
        old = now() - timedelta(hours=2)
        await reel_jobs().insert_one(
            {
                "_id": job_id,
                "brand_id": "selftest",
                "status": "running",
                "steps": [],
                "created_at": old,
                "updated_at": old,  # kharekhar atkelo
            }
        )
        try:
            await reap_stuck_jobs()
            after = await reel_jobs().find_one({"_id": job_id})
            assert_that(
                after and after.get("status") == "failed",
                "kharekhar atkela job ne saaf na karyo",
            )
            return "atkelo job saaf thayo"
        finally:
            await reel_jobs().delete_one({"_id": job_id})

    await test(f"[{round_no}] reaper: taja job ne haath na lagaave", fresh_job_survives)
    await test(f"[{round_no}] reaper: kharekhar atkela job ne saaf kare", old_job_reaped)


async def test_audio(round_no: int) -> None:
    async def moods():
        cases = [
            (dict(category="Apparel", style="festive ethnic saree"), "festive"),
            (dict(category="Jewellery", style="luxury gold diamond"), "luxury"),
            (dict(category="Footwear", style="urban streetwear sneaker"), "hiphop"),
            (dict(category="Home Decor", style="minimal candle"), "chill"),
            (dict(category="Electronics", style="tech gadget"), "cinematic"),
            (dict(category="Stationery", style=""), "upbeat"),
        ]
        for kwargs, expected in cases:
            mood = mood_for_product(**kwargs)
            assert_that(mood == expected, f"{kwargs} → {mood}, joitu {expected}")

            hint = instagram_audio_hints(mood)
            assert_that(hint["search_terms"], f"{mood} mate koi search term nathi")
            assert_that(len(hint["how_to"]) > 40, f"{mood} mate suchna adhuri")
        return f"{len(cases)} category"

    await test(f"[{round_no}] music: dareak product ne mood made che", moods)


# ------------------------------------------------------------------ #
#  5. Render
# ------------------------------------------------------------------ #


async def test_render(round_no: int) -> None:
    scene_count = 2 + (round_no % 6)
    image_count = 1 + (round_no % 3)

    images = [str(make_image(round_no, i)) for i in range(image_count)]

    scenes = []
    for index in range(scene_count):
        text = TEXTS[(round_no * 3 + index) % len(TEXTS)]
        overlays = (
            [
                TextOverlay(
                    text=text,
                    position=["top", "center", "bottom"][index % 3],
                    size=["hero", "large", "medium", "small"][index % 4],
                    style=["box", "outline", "shadow"][index % 3],
                    start_at=0.5 if index % 3 == 0 else 0.0,
                )
            ]
            if text
            else []
        )
        scenes.append(
            Scene(
                source=images[index % len(images)],
                duration=2 + ((round_no + index) % 4),
                motion=MOTIONS[(round_no + index) % len(MOTIONS)],
                transition=TRANSITIONS[(round_no + index) % len(TRANSITIONS)],
                overlays=overlays,
            )
        )

    expected = sum(s.duration for s in scenes)
    music = OUT / f"music-{round_no}.mp3"
    await run_ffmpeg(
        [
            "-f", "lavfi",
            "-i", f"sine=frequency={200 + round_no * 20}:duration={int(expected) + 5}",
            "-c:a", "libmp3lame", "-b:a", "128k",
            str(music),
        ]
    )

    language = ["en", "hi", "gu", "hinglish"][round_no % 4]

    async def render():
        output = OUT / f"reel-{round_no}.mp4"
        result = await render_reel(
            scenes=scenes,
            output_path=output,
            music_path=str(music),
            watermark="@testbrand" if round_no % 2 == 0 else "",
            script=script_for_language(language),
        )

        info = await probe(output)
        assert_that(info.width == 1080 and info.height == 1920, f"aakar {info.width}x{info.height}")
        assert_that(info.codec == "h264", f"codec {info.codec}")
        assert_that(info.has_audio, "audio track nathi")
        assert_that(abs(info.fps - 30) < 1.5, f"fps {info.fps}")
        assert_that(result.bytes > 10_000, f"file bahu nani ({result.bytes} bytes)")
        assert_that(result.bytes < 1024**3, "file 1GB thi moti — IG na le")

        # Transition dareak jod par lambai ghatade che, etle apeksha ganvi pade.
        from automarketing.video.ffmpeg import has_filter

        if has_filter("xfade"):
            shortest = min(s.duration for s in scenes)
            cut = min(0.45, shortest * 0.4)
            hard = max(2 / 30, 0.05)
            joins = scenes[1:]
            want = (
                expected
                - cut * sum(1 for s in joins if s.transition != "none")
                - hard * sum(1 for s in joins if s.transition == "none")
            )
            assert_that(
                abs(info.duration - want) < 1.5,
                f"lambai {info.duration:.2f}s, apekshit {want:.2f}s",
            )

        cover = Path(result.thumbnail_path)
        assert_that(cover.exists(), "cover image na bani")
        meta = imagelib.info(cover.read_bytes())
        assert_that(meta and meta.width == 1080, "cover no aakar khoto")

        return (
            f"{info.duration:.1f}s · {result.bytes / 1024 / 1024:.2f}MB · "
            f"{result.ms / 1000:.1f}s ma"
        )

    await test(
        f"[{round_no}] render: {scene_count} scene · {image_count} image · {language}", render
    )


async def test_render_edges(round_no: int) -> None:
    if round_no != 1:
        return  # ek j var — dhima test che

    image = str(make_image(99, 0))

    async def single():
        output = OUT / "edge-single.mp4"
        await render_reel(scenes=[Scene(source=image, duration=3.0)], output_path=output)
        info = await probe(output)
        assert_that(abs(info.duration - 3) < 0.6, f"lambai {info.duration}")
        assert_that(info.has_audio, "music vagar pan chup audio track hovo joiye")
        return None

    async def no_music():
        output = OUT / "edge-nomusic.mp4"
        await render_reel(
            scenes=[
                Scene(source=image, duration=2.5, overlays=[TextOverlay(text="No music")]),
                Scene(source=image, duration=2.5, transition="fade"),
            ],
            output_path=output,
        )
        info = await probe(output)
        assert_that(info.has_audio, "chup audio track na madyo")
        return None

    async def very_short():
        output = OUT / "edge-short.mp4"
        await render_reel(
            scenes=[Scene(source=image, duration=0.8, transition="fade") for _ in range(6)],
            output_path=output,
        )
        info = await probe(output)
        assert_that(info.duration > 1.5, f"lambai {info.duration} — bahu nani")
        return None

    async def layers():
        output = OUT / "edge-layers.mp4"
        await render_reel(
            scenes=[
                Scene(
                    source=image,
                    duration=4,
                    overlays=[
                        TextOverlay(text="Upar", position="top", size="medium"),
                        TextOverlay(
                            text="Vachhe: 100% & 'quoted'", position="center",
                            size="hero", style="outline",
                        ),
                        TextOverlay(
                            text="Niche", position="bottom", size="small",
                            start_at=2, end_at=4,
                        ),
                    ],
                )
            ],
            output_path=output,
            watermark="@brand",
        )
        info = await probe(output)
        assert_that(info.duration > 3.5, f"lambai {info.duration}")
        return None

    async def empty():
        try:
            await render_reel(scenes=[], output_path=OUT / "never.mp4")
        except Exception as error:  # noqa: BLE001
            assert_that("scene" in str(error).lower(), f"error samjay evo nathi: {error}")
            return None
        raise AssertionError("error aavvo joito hato")

    await test("[edge] render: ek j scene", single)
    await test("[edge] render: music vagar", no_music)
    await test("[edge] render: bahu tunka scene", very_short)
    await test("[edge] render: ek scene par 3 text layer", layers)
    await test("[edge] render: khali scene list par saaf error", empty)


# ------------------------------------------------------------------ #
#  6. AAKHO pipeline (pipeline mode)
# ------------------------------------------------------------------ #


async def test_full_pipeline() -> None:
    """
    Vision ne stub karie chie ane BAAKI badhu KHAREKHAR chalavie chie:
    script (AI) → images (Pollinations/Gemini) → music (ccMixter) →
    voiceover (edge-tts) → render (ffmpeg) → public URL (Catbox) → caption.

    Vision stub etle karie chie ke vision mate key joiye, ane e ek j
    step ne lidhe aakho rasto test na thay e barabar nathi.
    """
    from bson import ObjectId

    from automarketing.ai import vision as vision_module
    from automarketing.ai.vision import ProductIntelligence
    from automarketing.db import brands as brands_collection
    from automarketing.db import connect
    from automarketing.media.store import save_media
    from automarketing.pipeline.chain import ChainResult
    from automarketing.reels.generate import GenerateInput, generate_reel

    fake = ProductIntelligence(
        productName="Handblock Cotton Kurti",
        category="Apparel",
        subCategory="Cotton kurti",
        isApparel=True,
        apparelType="kurti",
        colors=["indigo", "off white"],
        materials=["cotton"],
        patterns=["handblock print"],
        style="festive ethnic",
        occasions=["festive", "office"],
        targetGender="women",
        targetAgeRange="22-35",
        targetAudience="Women who want breathable ethnic wear for daily and festive use",
        keyFeatures=["handblock print", "breathable cotton", "side pockets"],
        sellingPoints=["stays cool all day", "fits office and evening"],
        emotionalHooks=["look put together without trying"],
        objections=["will the colour bleed?"],
        searchKeywords=["cotton kurti", "handblock kurti", "festive kurti online"],
        seedHashtags=["cottonkurti", "handblockprint", "ethnicwear", "kurti", "indianwear"],
        language="en",
    )

    async def fake_vision(images, **kwargs):
        return ChainResult(data=fake, provider="stub", attempts=[], ms=1)

    original = vision_module.analyze_product_images
    vision_module.analyze_product_images = fake_vision

    # generate.py e symbol import karyu che, etle tya pan badalvu pade.
    from automarketing.reels import generate as generate_module

    original_ref = generate_module.analyze_product_images
    generate_module.analyze_product_images = fake_vision

    try:
        await connect()
        brand = await brands_collection().find_one({})
        if not brand:
            brand = {"_id": ObjectId(), "name": "Test Brand", "slug": "test-brand"}
            await brands_collection().insert_one(brand)

        asset_ids = []
        for index in range(2):
            path = make_image(50 + index, index)
            asset = await save_media(
                path.read_bytes(),
                mime_type="image/jpeg",
                filename=f"pipeline-{index}.jpg",
                role="product",
                brand_id=str(brand["_id"]),
                provider="selftest",
            )
            asset_ids.append(str(asset["_id"]))

        async def run_pipeline():
            job = await generate_reel(
                GenerateInput(
                    brand_id=str(brand["_id"]),
                    image_asset_ids=asset_ids,
                    mode="multi",
                    target_duration=20,   # test mate nanu
                    language="en",
                    voiceover=True,
                    hint="handblock cotton kurti, breathable, festive",
                )
            )

            assert_that(job.get("status") == "done", f"status {job.get('status')}: {job.get('error')}")
            assert_that(job.get("output_id"), "video asset na banyu")
            assert_that(job.get("duration", 0) > 5, f"lambai {job.get('duration')}")

            copy = job.get("copy") or {}
            for platform in ("instagram", "facebook"):
                item = copy.get(platform) or {}
                assert_that(len(item.get("caption", "")) > 30, f"{platform}: caption tunku")
                assert_that("#" not in item.get("caption", ""), f"{platform}: caption ma hashtag")

            assert_that(
                copy["instagram"]["caption"] != copy["facebook"]["caption"],
                "IG ane FB nu caption ekdum sarkhu che",
            )

            steps = {s["key"]: s for s in job.get("steps") or []}
            failed = [k for k, s in steps.items() if s.get("status") == "failed"]

            scenes = job.get("scenes") or []
            assert_that(len(scenes) >= 3, f"fakt {len(scenes)} scene")

            warnings = job.get("warnings") or []
            note = f"{len(scenes)} scene · {job['duration']:.1f}s · {job.get('ms', 0) / 1000:.0f}s ma"
            if failed:
                note += f" · fail thayela step: {','.join(failed)}"
            if warnings:
                note += f" · {len(warnings)} chetavni"
            return note

        await test("[pipeline] AAKHO reel banyo (vision stub, baki badhu sachu)", run_pipeline)

    finally:
        vision_module.analyze_product_images = original
        generate_module.analyze_product_images = original_ref


# ------------------------------------------------------------------ #
#  Main
# ------------------------------------------------------------------ #


async def main() -> int:
    args = sys.argv[1:]
    rounds = next((int(a) for a in args if a.isdigit()), 10)
    with_pipeline = "pipeline" in args

    print("\n╔══════════════════════════════════════════════════════════╗")
    print("║  Auto Marketing (Python) — self test                     ║")
    print("╚══════════════════════════════════════════════════════════╝\n")

    engine = engine_status()
    print(f"ffmpeg  : {'✓' if engine.get('ready') else '✗ ' + str(engine.get('error'))}")
    print(f"xfade   : {'✓' if engine.get('has_xfade') else '✗ (transition vagar chalse)'}")
    for font in font_status():
        print(f"font {font['script']:<11}: {'✓' if font['ok'] else '✗'}")
    print(f"Mode    : {'OFFLINE + PIPELINE' if with_pipeline else 'OFFLINE'}")
    print(f"Rounds  : {rounds}\n")

    if not engine.get("ready"):
        print("ffmpeg vagar test chalse nahi. `python scripts/fetch_ffmpeg.py` chalavo.")
        return 1

    import shutil

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    started = time.monotonic()

    for round_no in range(1, rounds + 1):
        print(f"\n── Round {round_no}/{rounds} " + "─" * 40)
        await test_chain(round_no)
        await test_text(round_no)
        await test_ranking(round_no)
        await test_reaper(round_no)
        await test_audio(round_no)
        await test_render(round_no)
        await test_render_edges(round_no)

    if with_pipeline:
        print(f"\n── Aakho pipeline " + "─" * 40)
        await test_full_pipeline()

    # ---- Report ----
    passed = sum(1 for r in results if r["ok"])
    failed = [r for r in results if not r["ok"]]
    elapsed = time.monotonic() - started

    print("\n╔══════════════════════════════════════════════════════════╗")
    print(f"║  {passed:>4} pass · {len(failed):>3} fail" + " " * 30 + "║")
    print(f"║  Kul samay: {elapsed:.1f}s" + " " * (41 - len(f"{elapsed:.1f}s")) + "║")
    print("╚══════════════════════════════════════════════════════════╝\n")

    if failed:
        print("FAIL thayela test:\n")
        # Ek j bhool 10 round ma 10 var dekhay — ekathi karine batavie chie.
        grouped: dict[str, dict] = {}
        for item in failed:
            import re

            key = re.sub(r"^\[\d+\]\s*", "", item["name"])
            key = re.sub(r"\d+ scene.*", "…", key)
            if key in grouped:
                grouped[key]["count"] += 1
            else:
                grouped[key] = {"count": 1, "error": item.get("error", "")}

        for name, info in grouped.items():
            print(f"  ✗ {name}  (×{info['count']})")
            for line in str(info["error"]).splitlines()[:6]:
                print(f"      {line[:180]}")
            print()

    slowest = sorted((r for r in results), key=lambda r: -r["ms"])[:3]
    if slowest and slowest[0]["ms"] > 1000:
        print("Sauthi dhima:")
        for item in slowest:
            print(f"  {item['ms'] / 1000:>5.1f}s  {item['name']}")
        print()

    report = OUT / "report.json"
    report.write_text(
        json.dumps(
            {"rounds": rounds, "pipeline": with_pipeline, "passed": passed,
             "failed": len(failed), "results": results},
            indent=2, ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"Puro report: {report}\n")

    from automarketing.db import close as close_db
    from automarketing.pipeline.http import close_client

    await close_client()
    await close_db()

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
