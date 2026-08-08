"""
ffmpeg no wrapper.

⚠️ EK AGATYA NI VAAT:
`imageio-ffmpeg` sathe je ffmpeg aave che e JUNU (4.2.2) che ane ema
`xfade` transition filter NATHI. Etle ahiya ffmpeg ne aa kram ma shodhie
chie ane KAYO FILTER MADE CHE e pan tapasie chie — junu ffmpeg made to
renderer jate j saral rite (transition vagar) jodi de che.

Shodhvano kram:
  1. .env nu FFMPEG_PATH
  2. python/vendor/ffmpeg/     (`python scripts/fetch_ffmpeg.py` thi aave)
  3. system no `ffmpeg` (PATH ma)
  4. bajuma na Node project nu ffmpeg-static (hoy to)
  5. imageio-ffmpeg nu bundled (chhelli aasha)
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

from ..config import PROJECT_ROOT, settings, vendor_dir
from ..errors import AutoMarketingError


class FfmpegError(AutoMarketingError):
    def __init__(self, message: str, args_used: list[str], stderr: str) -> None:
        super().__init__(message)
        self.args_used = args_used
        self.stderr = stderr


# ------------------------------------------------------------------ #
#  Binary shodhvi
# ------------------------------------------------------------------ #


def _candidates() -> list[Path]:
    found: list[Path] = []

    if settings.ffmpeg_path:
        found.append(Path(settings.ffmpeg_path))

    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    found.append(vendor_dir() / "ffmpeg" / exe)
    found.append(vendor_dir() / "ffmpeg" / "bin" / exe)

    system = shutil.which("ffmpeg")
    if system:
        found.append(Path(system))

    # Bajuma no Node project — ffmpeg-static 6.x aape che (xfade sathe).
    found.append(PROJECT_ROOT / "node_modules" / "ffmpeg-static" / exe)

    try:
        import imageio_ffmpeg

        found.append(Path(imageio_ffmpeg.get_ffmpeg_exe()))
    except Exception:  # noqa: BLE001
        pass

    return found


@lru_cache(maxsize=1)
def ffmpeg_path() -> str:
    for candidate in _candidates():
        if candidate and candidate.exists():
            return str(candidate)

    raise FfmpegError(
        "ffmpeg madyu nahi. `python scripts/fetch_ffmpeg.py` chalavo — e free "
        "ffmpeg download kari deshe. Athva .env ma FFMPEG_PATH set karo.",
        [],
        "",
    )


@lru_cache(maxsize=1)
def ffprobe_path() -> Optional[str]:
    """ffprobe hoy to saru — na hoy to ffmpeg thi j kaam chalavi laiye."""
    exe = "ffprobe.exe" if os.name == "nt" else "ffprobe"

    guess = Path(ffmpeg_path()).parent / exe
    if guess.exists():
        return str(guess)

    system = shutil.which("ffprobe")
    if system:
        return system

    node = PROJECT_ROOT / "node_modules" / "ffprobe-static" / "bin"
    if node.exists():
        for path in node.rglob(exe):
            return str(path)

    return None


@lru_cache(maxsize=1)
def ffmpeg_version() -> str:
    try:
        out = subprocess.run(
            [ffmpeg_path(), "-version"],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
        return out.splitlines()[0] if out else "unknown"
    except Exception as error:  # noqa: BLE001
        return f"unknown ({error})"


@lru_cache(maxsize=1)
def available_filters() -> frozenset[str]:
    """
    Aa ffmpeg ma kaya filter che.

    Renderer aa jovine nakki kare che ke xfade transition vaparvu ke
    saadho concat. Etle junu ffmpeg hoy to pan reel bane j che.
    """
    try:
        out = subprocess.run(
            [ffmpeg_path(), "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            timeout=60,
        ).stdout
    except Exception:  # noqa: BLE001
        return frozenset()

    names: set[str] = set()
    for line in out.splitlines():
        parts = line.split()
        # Format: " T.. name  in->out  description"
        if len(parts) >= 2 and not line.startswith("Filters:"):
            names.add(parts[1])
    return frozenset(names)


def has_filter(name: str) -> bool:
    filters = available_filters()
    # Filter list na vanchay to "che" ganie chie — nahi to badhu band thai jaay.
    return (not filters) or (name in filters)


def engine_status() -> dict:
    """Setup page mate — video banavi shakash ke nahi."""
    try:
        path = ffmpeg_path()
    except FfmpegError as error:
        return {"ready": False, "error": str(error)}

    return {
        "ready": True,
        "ffmpeg": path,
        "ffprobe": ffprobe_path(),
        "version": ffmpeg_version(),
        "has_xfade": has_filter("xfade"),
        "has_zoompan": has_filter("zoompan"),
        "has_drawtext": has_filter("drawtext"),
        "note": (
            ""
            if has_filter("xfade")
            else (
                "Aa ffmpeg junu che — transition (xfade) nathi. Reel to banse j, "
                "pan scene vachhe smooth transition nahi hoy. Saru joitu hoy to "
                "`python scripts/fetch_ffmpeg.py` chalavo."
            )
        ),
    }


# ------------------------------------------------------------------ #
#  Chalavvanu
# ------------------------------------------------------------------ #


def _useful_error(stderr: str) -> str:
    """ffmpeg no stderr bahu lambo hoy che — kaam ni line j kadho."""
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    keywords = (
        "error", "invalid", "no such file", "not found", "failed",
        "unable", "cannot", "does not", "unrecognized",
    )
    useful = [line for line in lines if any(k in line.lower() for k in keywords)]
    picked = useful[-3:] if useful else lines[-3:]
    return " | ".join(picked)[:600]


async def run_ffmpeg(args: list[str], *, timeout: float = 900.0) -> str:
    """
    ffmpeg chalave. stderr pacho aape (progress tya j hoy che).

    `-nostdin` vagar ffmpeg kyarek input ni raah jue ane hang thai jaay che.
    """
    full = [ffmpeg_path(), "-hide_banner", "-nostdin", "-y", *args]

    process = await asyncio.create_subprocess_exec(
        *full,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        _, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise FfmpegError(
            f"ffmpeg ne bahu var lagi ({int(timeout)}s) — reel nani karo ke "
            "ochha scene rakho.",
            full,
            "",
        ) from None

    stderr = (stderr_bytes or b"").decode("utf-8", errors="replace")

    if process.returncode != 0:
        raise FfmpegError(f"ffmpeg fail: {_useful_error(stderr)}", full, stderr)

    return stderr


# ------------------------------------------------------------------ #
#  Probe
# ------------------------------------------------------------------ #


@dataclass
class MediaInfo:
    duration: float = 0.0
    width: int = 0
    height: int = 0
    fps: float = 30.0
    has_audio: bool = False
    has_video: bool = False
    codec: str = ""


async def probe(path: str | Path) -> MediaInfo:
    """File ni vigat. ffprobe hoy to e, nahi to ffmpeg na output par thi."""
    path = str(path)
    if not Path(path).exists():
        raise FfmpegError(f"File nathi: {path}", [], "")

    probe_bin = ffprobe_path()
    if probe_bin:
        process = await asyncio.create_subprocess_exec(
            probe_bin,
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=120)
        try:
            return _parse_probe(json.loads(stdout.decode("utf-8", errors="replace")))
        except Exception:  # noqa: BLE001
            pass

    return await _probe_with_ffmpeg(path)


def _parse_probe(payload: dict) -> MediaInfo:
    streams = payload.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    fps = 30.0
    if video and video.get("r_frame_rate"):
        try:
            num, den = str(video["r_frame_rate"]).split("/")
            if float(den):
                fps = float(num) / float(den)
        except (ValueError, ZeroDivisionError):
            pass

    duration = 0.0
    for source in ((payload.get("format") or {}), video or {}):
        try:
            duration = float(source.get("duration") or 0)
        except (TypeError, ValueError):
            duration = 0.0
        if duration:
            break

    return MediaInfo(
        duration=duration,
        width=int((video or {}).get("width") or 0),
        height=int((video or {}).get("height") or 0),
        fps=fps if fps > 0 else 30.0,
        has_audio=audio is not None,
        has_video=video is not None,
        codec=str((video or audio or {}).get("codec_name") or ""),
    )


async def _probe_with_ffmpeg(path: str) -> MediaInfo:
    """ffprobe na hoy to ffmpeg na stderr par thi vigat kaadhie chie."""
    import re

    process = await asyncio.create_subprocess_exec(
        ffmpeg_path(), "-hide_banner", "-i", path,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr_bytes = await process.communicate()
    stderr = (stderr_bytes or b"").decode("utf-8", errors="replace")

    info = MediaInfo()

    match = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", stderr)
    if match:
        h, m, s = match.groups()
        info.duration = int(h) * 3600 + int(m) * 60 + float(s)

    match = re.search(r"Video:\s*(\w+).*?(\d{2,5})x(\d{2,5})", stderr, re.DOTALL)
    if match:
        info.has_video = True
        info.codec = match.group(1)
        info.width = int(match.group(2))
        info.height = int(match.group(3))

    match = re.search(r"(\d+(?:\.\d+)?)\s*fps", stderr)
    if match:
        info.fps = float(match.group(1))

    info.has_audio = "Audio:" in stderr
    return info


# ------------------------------------------------------------------ #
#  Temp folder
# ------------------------------------------------------------------ #


@asynccontextmanager
async def temp_dir(prefix: str = "reel"):
    directory = Path(tempfile.mkdtemp(prefix=f"{prefix}-"))
    try:
        yield directory
    finally:
        shutil.rmtree(directory, ignore_errors=True)


# ------------------------------------------------------------------ #
#  Filter graph ma path naakhva mate escaping
# ------------------------------------------------------------------ #


def escape_filter_path(path: str | Path) -> str:
    """
    ffmpeg na filter argument ma path naakhvo hoy tyare Windows nu `C:\\`
    ane `:` `'` `\\` `,` `[` `]` badha escape karva pade — nahi to filter
    parse j na thay.
    """
    text = str(path).replace("\\", "/")
    for char in (":", "'", ",", "[", "]", ";"):
        text = text.replace(char, f"\\{char}")
    return text
