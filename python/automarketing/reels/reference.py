"""
"Aa jevi reel banavi aapo" — reference reel ne samajvanu.

Aapne reference video ne KOPY nathi karta (e copyright no bhang thay).
Aapne eni RACHNA sikhie chie: ketla shot che, ketli var e badlay che,
hook kevo che, text kai rite mukelo che, mood kevo che. E rachna pachi
TAMARA product ane TAMARI avatar sathe fari thi banave chie.

Kaam traan tabakke:
  1. ffmpeg thi scene-cut shodho → pacing ane shot count
  2. thoda frames kaadho → vision ne batavo
  3. AI e badhu jodine "style card" banave
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..ai.base import CompletionRequest, VisionRequest
from ..ai.registry import complete
from ..ai.schemas import FRAME_READING, REFERENCE_STYLE
from ..ai.vision import ask_vision
from ..errors import UserError
from ..video.ffmpeg import ffmpeg_path, probe, run_ffmpeg, temp_dir
from .plan import ReferenceStyle


@dataclass
class ReferenceAnalysis(ReferenceStyle):
    duration: float = 0.0
    cut_times: list[float] = field(default_factory=list)
    frame_descriptions: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ #
#  1. Scene cuts
# ------------------------------------------------------------------ #

_PTS_RE = re.compile(r"pts_time:([\d.]+)")


async def detect_cuts(video_path: str | Path) -> list[float]:
    """
    ffmpeg no `scene` detector — ek frame thi biju frame ketlu badlayu e
    mape che. 0.3 thi upar hoy etle "navo shot shuru thayo" ganie chie.
    """
    process = await asyncio.create_subprocess_exec(
        ffmpeg_path(),
        "-hide_banner", "-nostdin",
        "-i", str(video_path),
        "-filter:v", "select='gt(scene,0.3)',showinfo",
        "-f", "null", "-",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=300)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return []

    # showinfo no output stderr ma j aave che — exit code gme te hoy.
    stderr = (stderr_bytes or b"").decode("utf-8", errors="replace")
    times = sorted({float(m) for m in _PTS_RE.findall(stderr)})
    return times


# ------------------------------------------------------------------ #
#  2. Frames
# ------------------------------------------------------------------ #


async def extract_frames(
    video_path: str | Path, directory: Path, count: int, duration: float
) -> list[bytes]:
    """Aakha video ma sarkha antare frames — shuru ane ant ne chhodine."""
    step = duration / (count + 1)
    frames: list[bytes] = []

    for index in range(1, count + 1):
        at = step * index
        target = directory / f"frame-{index}.jpg"
        try:
            await run_ffmpeg(
                [
                    "-ss", f"{at:.2f}",
                    "-i", str(video_path),
                    "-frames:v", "1",
                    "-q:v", "4",
                    "-vf", "scale=720:-2",
                    str(target),
                ],
                timeout=90.0,
            )
        except Exception:  # noqa: BLE001 — ek frame na malyo to chalse
            continue

        if target.exists():
            frames.append(target.read_bytes())

    return frames


# ------------------------------------------------------------------ #
#  3. Style card
# ------------------------------------------------------------------ #


async def read_frames(frames: list[bytes]) -> dict:
    """Frames ne vision model ne batavo ane "su thai rahyu che" puchho."""
    result = await ask_vision(
        frames[:6],
        VisionRequest(
            system=" ".join(
                [
                    "You are a video editor studying frames from a short-form reel.",
                    "You describe technique — framing, lighting, camera work, text placement",
                    "— not brand names or the specific words on screen.",
                    "Be concise and factual.",
                ]
            ),
            prompt=(
                f"These {len(frames[:6])} frames are sampled evenly through one reel, in "
                "order. Describe each shot, then the overall look."
            ),
            schema=FRAME_READING,
            max_tokens=2000,
        ),
    )
    return result.data if isinstance(result.data, dict) else {}


async def analyze_reference(video_path: str | Path) -> ReferenceAnalysis:
    """Reference reel → style card je planner vapri shake."""
    info = await probe(video_path)
    if not info.has_video:
        raise UserError("Aa file ma video nathi")

    duration = info.duration or 30.0

    async with temp_dir("refframes") as directory:
        cuts, frames = await asyncio.gather(
            detect_cuts(video_path),
            extract_frames(video_path, directory, 6, duration),
            return_exceptions=True,
        )

        cuts = cuts if isinstance(cuts, list) else []
        frames = frames if isinstance(frames, list) else []

        # Cut na madya to sarerash 3 second no shot ganie chie.
        scene_count = max(2, len(cuts) + 1)
        average = duration / scene_count
        pacing = "fast" if average < 1.8 else "medium" if average < 3.5 else "slow"

        frame_descriptions: list[str] = []
        mood_guess = ""
        if frames:
            try:
                reading = await read_frames(frames)
                frame_descriptions = [
                    str(d).strip()
                    for d in (reading.get("descriptions") or [])
                    if str(d).strip()
                ][:8]
                mood_guess = str(reading.get("mood") or "")
            except Exception:  # noqa: BLE001 — fakt aankda thi pan kaam chale
                pass

        style = await _style_card(
            duration=duration,
            scene_count=scene_count,
            average=average,
            pacing=pacing,
            cuts=cuts,
            frame_descriptions=frame_descriptions,
            mood_guess=mood_guess,
        )

        return ReferenceAnalysis(
            scene_count=scene_count,
            average_scene_duration=average,
            pacing=pacing,
            shot_types=style["shot_types"],
            text_style=style["text_style"],
            hook_style=style["hook_style"],
            mood=style["mood"],
            summary=style["summary"],
            duration=duration,
            cut_times=cuts,
            frame_descriptions=frame_descriptions,
        )


async def _style_card(
    *,
    duration: float,
    scene_count: int,
    average: float,
    pacing: str,
    cuts: list[float],
    frame_descriptions: list[str],
    mood_guess: str,
) -> dict:
    lines = [
        f"A reel of {duration:.1f} seconds with about {scene_count} shots "
        f"(average {average:.1f}s per shot, {pacing} pacing).",
    ]
    if cuts:
        lines.append("Cuts happen at: " + "s, ".join(f"{c:.1f}" for c in cuts[:25]) + "s")

    if frame_descriptions:
        lines += [
            "",
            "Frames sampled through the reel, in order:",
            *[f"{i + 1}. {d}" for i, d in enumerate(frame_descriptions)],
        ]
    else:
        lines.append("No frames could be read — infer from the timing alone.")

    lines += [
        "",
        "Describe the reel's structure and technique so another creator could rebuild the "
        "same rhythm with a completely different product.",
    ]

    try:
        result = await complete(
            CompletionRequest(
                system=(
                    "You are a short-form video editor who reverse-engineers why a reel "
                    "works. You describe structure and technique, never the specific brand "
                    "or words used."
                ),
                prompt="\n".join(lines),
                schema=REFERENCE_STYLE,
                max_tokens=2000,
            )
        )
        data = result.data if isinstance(result.data, dict) else {}
    except Exception:  # noqa: BLE001
        data = {}

    structure = [str(s).strip() for s in (data.get("structure") or []) if str(s).strip()]
    summary = str(data.get("summary") or "").strip()

    return {
        "shot_types": [str(s).strip() for s in (data.get("shotTypes") or [])][:8]
        or ["product close-up", "lifestyle shot"],
        "text_style": str(data.get("textStyle") or "Short bold text, centred"),
        "hook_style": str(data.get("hookStyle") or "Fast visual reveal in the first shot"),
        "mood": str(data.get("mood") or mood_guess or "clean and modern"),
        "summary": (
            " · ".join(filter(None, [summary, *structure]))[:1200]
            or f"{pacing} paced reel with about {scene_count} shots."
        ),
    }


# ------------------------------------------------------------------ #
#  Reference video lavvo
# ------------------------------------------------------------------ #


DOWNLOAD_HELP = (
    "Link par thi video utarvani suvidha band che. Reel ne tamara phone ke "
    "computer ma download karo ane ahiya file UPLOAD karo — e sauthi saral "
    "ane surakshit rasto che.\n\n"
    "(Jankar hoy to: `pip install yt-dlp` karo ane .env ma YTDLP_ENABLED=true "
    "karo. Kaya video utarva e tamari jawabdari che — potani reel, ke jeni "
    "paravanagi hoy e j.)"
)


async def download_reference(url: str, target: Path) -> Path:
    """
    Instagram/TikTok ni LINK par thi video utarvu.

    ⚠️ Aa FAKT tyare chale che jyare tame jate `yt-dlp` install karyu hoy
    ane `.env` ma `YTDLP_ENABLED=true` karyu hoy.
    """
    from ..config import env_bool

    if not env_bool("YTDLP_ENABLED", False):
        raise UserError(DOWNLOAD_HELP)

    try:
        import yt_dlp  # type: ignore
    except ImportError as error:
        raise UserError(
            "yt-dlp install nathi. `pip install yt-dlp` chalavo, ke video jate "
            "download karine upload karo."
        ) from error

    def _download() -> None:
        options = {
            "format": "mp4/best",
            "outtmpl": str(target),
            "noplaylist": True,
            "quiet": True,
            "max_filesize": 200 * 1024 * 1024,
        }
        with yt_dlp.YoutubeDL(options) as downloader:
            downloader.download([url])

    await asyncio.to_thread(_download)

    if not target.exists():
        raise UserError("Video download na thayu")
    return target
