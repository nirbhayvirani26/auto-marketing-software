"""
Reel renderer — scenes andar, 1080x1920 mp4 bahar.

Kaam be tabakke thay che, JAANI JOINE:

  1. Dareak scene ne alag nani clip tarike render karo
  2. Badhi clips ne transition sathe jodo + music/voiceover naakho

Ek j motu filter_complex banavvu shakya che, pan e debug karvu asakya
thai jaay che ane ek scene ma bhool hoy to AAKHU fail thay. Alag alag
karvathi bhool KAYA scene ma che e sidhu khabar pade che, ane scenes
sathe sathe render pan thai shake che.

Output Instagram Reels ni spec pramane j:
  1080x1920 (9:16) · 30fps · H.264 High · yuv420p · AAC 128k 44.1kHz stereo
  + faststart (jethi Meta ne aakhi file utarya vagar j shuru thai jaay)
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal, Optional

from ..config import settings
from ..errors import UserError
from .ffmpeg import escape_filter_path, has_filter, probe, run_ffmpeg, temp_dir
from .fonts import resolve_font

Motion = Literal["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none"]
Transition = Literal[
    "fade", "slideleft", "slideright", "slideup", "wipeleft",
    "circleopen", "dissolve", "smoothleft", "none",
]
TextPosition = Literal["top", "center", "bottom"]
TextSize = Literal["hero", "large", "medium", "small"]
TextStyle = Literal["box", "outline", "shadow"]

MOTIONS: tuple[Motion, ...] = (
    "zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none",
)


@dataclass
class TextOverlay:
    text: str
    position: TextPosition = "bottom"
    size: TextSize = "large"
    style: TextStyle = "box"
    color: str = "white"
    box_color: str = "black@0.55"
    #: Scene ni andar kyare dekhay (seconds). None = aakha scene bhar.
    start_at: float = 0.0
    end_at: Optional[float] = None


@dataclass
class Scene:
    #: Local file nu path — image ke video.
    source: str
    duration: float
    source_type: Literal["image", "video"] = "image"
    motion: Motion = "zoom-in"
    transition: Transition = "fade"
    overlays: list[TextOverlay] = field(default_factory=list)
    #: Video source hoy to kya thi kaapvu.
    trim_start: float = 0.0


@dataclass
class RenderResult:
    output_path: str
    thumbnail_path: str
    duration: float
    width: int
    height: int
    bytes: int
    scene_count: int
    ms: int


FONT_SIZES: dict[str, int] = {"hero": 96, "large": 70, "medium": 52, "small": 38}


# ------------------------------------------------------------------ #
#  Text
# ------------------------------------------------------------------ #


def wrap_text(text: str, font_size: int, max_width: int) -> str:
    """
    drawtext jate line break nathi karto — aapne j karvu pade.

    Bold sans font ni sarerash akshar-pahodai fontSize na ~0.52 gani hoy che.
    """
    per_char = font_size * 0.52
    max_chars = max(8, int(max_width / per_char))

    lines: list[str] = []
    for paragraph in text.split("\n"):
        current = ""
        for word in paragraph.split():
            if not current:
                current = word
            elif len(current) + 1 + len(word) <= max_chars:
                current = f"{current} {word}"
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)

    # Reel ma 4 line thi vadhu koi vanchtu nathi.
    return "\n".join(lines[:4])


def _motion_filter(motion: Motion, frames: int, width: int, height: int) -> str:
    last = max(1, frames - 1)
    center_x = "iw/2-(iw/zoom/2)"
    center_y = "ih/2-(ih/zoom/2)"

    # Dhime dhime — jhatko na lage. Aakha scene ma 8% zoom.
    speed = f"{0.08 / last:.6f}"

    z, x, y = "1", center_x, center_y

    if motion == "zoom-in":
        z = f"min(1+{speed}*on,1.08)"
    elif motion == "zoom-out":
        z = f"max(1.08-{speed}*on,1.0)"
    elif motion == "pan-left":
        z, x = "1.08", f"(iw-iw/zoom)*(1-on/{last})"
    elif motion == "pan-right":
        z, x = "1.08", f"(iw-iw/zoom)*on/{last}"
    elif motion == "pan-up":
        z, y = "1.08", f"(ih-ih/zoom)*(1-on/{last})"
    elif motion == "pan-down":
        z, y = "1.08", f"(ih-ih/zoom)*on/{last}"

    return f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={width}x{height}"


def _overlay_filters(
    overlays: list[TextOverlay],
    *,
    directory: Path,
    scene_index: int,
    width: int,
    height: int,
    duration: float,
    font_file: str,
) -> list[str]:
    filters: list[str] = []

    for index, overlay in enumerate(overlays):
        text = (overlay.text or "").strip()
        if not text:
            continue

        size = FONT_SIZES.get(overlay.size, FONT_SIZES["large"])
        wrapped = wrap_text(text, size, int(width * 0.84))

        # Text ne FILE ma lakhie chie — filter string ma escaping ni jhanjhat
        # (quote, colon, emoji, newline, Gujarati akshar) sav nikli jaay che.
        text_file = directory / f"text-{scene_index}-{index}.txt"
        text_file.write_text(wrapped, encoding="utf-8")

        if overlay.position == "top":
            y = str(round(height * 0.11))
        elif overlay.position == "center":
            y = "(h-text_h)/2"
        else:
            y = f"h-text_h-{round(height * 0.22)}"

        start = max(0.0, overlay.start_at)
        end = min(duration, overlay.end_at if overlay.end_at is not None else duration)

        # Halke thi aave — jhatko na lage.
        fade_in = 0.25
        alpha = (
            f"if(lt(t,{start:.2f}),0,"
            f"if(lt(t,{start + fade_in:.2f}),(t-{start:.2f})/{fade_in},1))"
        )

        if overlay.style == "box":
            decoration = (
                f"box=1:boxcolor={overlay.box_color}:boxborderw={round(size * 0.35)}"
            )
            # Box style ma line_spacing dareak line na box vachhe faat paade.
            spacing = round(size * 0.08)
        elif overlay.style == "outline":
            decoration = f"borderw={max(3, round(size * 0.07))}:bordercolor=black@0.85"
            spacing = round(size * 0.2)
        else:
            decoration = "shadowcolor=black@0.7:shadowx=3:shadowy=4"
            spacing = round(size * 0.2)

        filters.append(
            ":".join(
                [
                    f"drawtext=fontfile='{escape_filter_path(font_file)}'",
                    f"textfile='{escape_filter_path(text_file)}'",
                    f"fontsize={size}",
                    f"fontcolor={overlay.color}",
                    f"line_spacing={spacing}",
                    "x=(w-text_w)/2",
                    f"y={y}",
                    decoration,
                    f"alpha='{alpha}'",
                    f"enable='between(t,{start:.2f},{end:.2f})'",
                ]
            )
        )

    return filters


# ------------------------------------------------------------------ #
#  Scene render
# ------------------------------------------------------------------ #


async def _render_scene(
    scene: Scene,
    index: int,
    *,
    directory: Path,
    width: int,
    height: int,
    fps: int,
    font_file: str,
    watermark: str,
    crf: int,
    preset: str,
) -> Path:
    """Ek scene ni nani mp4 clip (audio vagar)."""
    output = directory / f"scene-{index:03d}.mp4"
    duration = max(0.5, scene.duration)
    frames = round(duration * fps)

    chain: list[str] = []
    inputs: list[str] = []

    if scene.source_type == "image":
        inputs += ["-loop", "1", "-t", f"{duration:.3f}", "-i", scene.source]

        # Ken Burns ma jhatko na aave e mate pehla MOTHU karie chie —
        # zoompan na x/y purnank hoy che, etle nani image par jhatko dekhay.
        big_w, big_h = round(width * 1.5), round(height * 1.5)

        # Product ni image mota bhage chorasa hoy che ane reel ubhi —
        # etle pachhal e j image ne blur karine mukiye chie. Aa
        # "professional" lage che ane product no koi bhaag kapato nathi.
        chain += [
            (
                f"[0:v]scale={big_w}:{big_h}:force_original_aspect_ratio=increase,"
                f"crop={big_w}:{big_h},"
                f"boxblur=luma_radius={round(big_w / 28)}:luma_power=2,"
                f"eq=brightness=-0.10:saturation=0.85[bg]"
            ),
            (
                f"[0:v]scale={round(big_w * 0.94)}:{round(big_h * 0.7)}:"
                f"force_original_aspect_ratio=decrease:flags=lanczos[fg]"
            ),
            "[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto[comp]",
            (
                f"[comp]fps={fps},"
                f"{_motion_filter(scene.motion, frames, width, height)},setsar=1[base]"
            ),
        ]
    else:
        if scene.trim_start > 0:
            inputs += ["-ss", f"{scene.trim_start:.3f}"]
        inputs += ["-t", f"{duration:.3f}", "-i", scene.source]
        chain.append(
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase:"
            f"flags=lanczos,crop={width}:{height},fps={fps},setsar=1[base]"
        )

    draw = _overlay_filters(
        scene.overlays,
        directory=directory,
        scene_index=index,
        width=width,
        height=height,
        duration=duration,
        font_file=font_file,
    )

    if watermark:
        mark_file = directory / f"mark-{index}.txt"
        mark_file.write_text(watermark.strip(), encoding="utf-8")
        draw.append(
            ":".join(
                [
                    f"drawtext=fontfile='{escape_filter_path(font_file)}'",
                    f"textfile='{escape_filter_path(mark_file)}'",
                    "fontsize=30",
                    "fontcolor=white@0.72",
                    "x=(w-text_w)/2",
                    f"y={round(height * 0.055)}",
                    "shadowcolor=black@0.6:shadowx=2:shadowy=2",
                ]
            )
        )

    if draw:
        # ⚠️ `scale=out_range=tv` jaani joine.
        # JPEG image FULL-RANGE hoy che (0-255). Fakt `format=yuv420p`
        # lakhie to ffmpeg ene `yuvj420p` tarike tag kare che, ane
        # ketlak phone/player par rang DHOVAYELA ke bahu BHADAK dekhaay.
        # Video mate LIMITED range (16-235) joiye — aa e badle che.
        chain.append(
            "[base]" + ",".join(draw) + ",scale=out_range=tv,format=yuv420p[vout]"
        )
    else:
        chain.append("[base]scale=out_range=tv,format=yuv420p[vout]")

    await run_ffmpeg(
        [
            *inputs,
            "-filter_complex", ";".join(chain),
            "-map", "[vout]",
            "-an",
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", str(crf),
            "-profile:v", "high",
            "-pix_fmt", "yuv420p",
            "-color_range", "tv",
            "-r", str(fps),
            "-t", f"{duration:.3f}",
            str(output),
        ],
        timeout=420.0,
    )

    return output


# ------------------------------------------------------------------ #
#  Jodvanu
# ------------------------------------------------------------------ #


def _transition_graph(
    clip_count: int,
    transitions: list[Transition],
    durations: list[float],
    transition_duration: float,
    fps: int,
) -> tuple[str, str, float]:
    """
    Badhi clip ne ek video stream ma jode.

    xfade hoy to smooth transition; na hoy (junu ffmpeg) to saadho concat.
    Banne rite reel bane j che.

    Return: (filter, chhello label, kul lambai)
    """
    if clip_count == 1:
        return "", "0:v", durations[0]

    if not has_filter("xfade"):
        # Junu ffmpeg — transition vagar sidha jodi daiye.
        inputs = "".join(f"[{i}:v]" for i in range(clip_count))
        return (
            f"{inputs}concat=n={clip_count}:v=1:a=0[vjoined]",
            "vjoined",
            sum(durations),
        )

    # "none" mate pan xfade j vaparie chie — fakt BE FRAME nu.
    #
    # Pehla `concat` filter vaparto hato, pan concat ane xfade ne ek j
    # chain ma bhelvi na shakay: concat dareak segment par filters fari
    # shuru kare che ane xfade no timebase alag hoy che, etle ffmpeg
    # "Error reinitializing filters" aapine mari jaay che. Be frame nu
    # xfade aankh ne hard-cut jevu j lage che ane graph ek j prakar no
    # rahe che — etle e kayam chale che.
    cut = max(2 / fps, 0.05)

    parts: list[str] = []
    current = "0:v"
    accumulated = durations[0]

    for index in range(1, clip_count):
        transition = transitions[index]
        is_cut = transition == "none"
        kind = "fade" if is_cut else transition
        length = cut if is_cut else transition_duration
        label = f"x{index}"

        offset = max(0.0, accumulated - length)
        parts.append(
            f"[{current}][{index}:v]xfade=transition={kind}:"
            f"duration={length:.3f}:offset={offset:.3f}[{label}]"
        )
        accumulated += durations[index] - length
        current = label

    return ";".join(parts), current, accumulated


def _audio_graph(
    *,
    music_index: Optional[int],
    voice_index: Optional[int],
    total_duration: float,
    music_volume: float,
) -> Optional[tuple[str, str]]:
    if music_index is None and voice_index is None:
        return None

    parts: list[str] = []
    fade_out_start = max(0.0, total_duration - 1.5)

    # Voiceover hoy to music ne pachhal dhakeli daiye — nahi to shabdo
    # sambhalay nahi. (Sidhu volume ghatadie chie: sauthi bharoso layak.)
    volume = min(music_volume, 0.14) if voice_index is not None else music_volume

    if music_index is not None:
        parts.append(
            f"[{music_index}:a]atrim=0:{total_duration:.3f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d=0.8,"
            f"afade=t=out:st={fade_out_start:.3f}:d=1.5,"
            f"volume={volume:.2f},"
            "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[amusic]"
        )

    if voice_index is not None:
        parts.append(
            f"[{voice_index}:a]atrim=0:{total_duration:.3f},asetpts=PTS-STARTPTS,"
            "volume=1.6,"
            "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[avoice]"
        )

    if music_index is not None and voice_index is not None:
        parts.append(
            "[amusic][avoice]amix=inputs=2:duration=first:"
            "dropout_transition=0:normalize=0[aout]"
        )
        return ";".join(parts), "aout"

    return ";".join(parts), ("amusic" if music_index is not None else "avoice")


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #


async def render_reel(
    *,
    scenes: list[Scene],
    output_path: str | Path,
    width: int = 1080,
    height: int = 1920,
    fps: int = 30,
    music_path: Optional[str] = None,
    music_volume: float = 0.38,
    voiceover_path: Optional[str] = None,
    transition_duration: float = 0.45,
    script: str = "latin",
    watermark: str = "",
    crf: int = 23,
    preset: str = "veryfast",
    on_progress: Optional[Callable[[str, int, int], None]] = None,
) -> RenderResult:
    """Scenes → Instagram-ready 1080x1920 mp4 (+ cover image)."""
    started = time.monotonic()

    usable = [s for s in scenes if s.source and s.duration > 0]
    if not usable:
        raise UserError("Reel banavva mate ek pan scene nathi")

    font_file = resolve_font(script)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    async with temp_dir("reel") as directory:
        # ---- 1. Dareak scene ni clip (sathe sathe) ----
        clips: list[Optional[Path]] = [None] * len(usable)
        done = 0
        limit = asyncio.Semaphore(settings.render_concurrency)

        async def build(index: int, scene: Scene) -> None:
            nonlocal done
            async with limit:
                clips[index] = await _render_scene(
                    scene,
                    index,
                    directory=directory,
                    width=width,
                    height=height,
                    fps=fps,
                    font_file=font_file,
                    watermark=watermark,
                    crf=crf,
                    preset=preset,
                )
                done += 1
                if on_progress:
                    on_progress(
                        f"Scene {done}/{len(usable)} taiyar", done, len(usable) + 1
                    )

        await asyncio.gather(*(build(i, s) for i, s in enumerate(usable)))

        if on_progress:
            on_progress("Badhu jodie chie ane music naakhie chie", len(usable), len(usable) + 1)

        # ---- 2. Jodo + audio + final encode ----
        durations = [max(0.5, s.duration) for s in usable]
        transitions: list[Transition] = [
            "none" if i == 0 else s.transition for i, s in enumerate(usable)
        ]

        # Transition scene karta lambo na hovo joiye, nahi to xfade fail thay.
        safe_transition = min(transition_duration, min(durations) * 0.4)

        inputs: list[str] = []
        for clip in clips:
            inputs += ["-i", str(clip)]

        video_filter, video_label, total = _transition_graph(
            len(clips), transitions, durations, safe_transition, fps
        )

        music_index: Optional[int] = None
        voice_index: Optional[int] = None

        if music_path:
            # Track tunko hoy to fari fari vagse — reel adhuri chup na rahe.
            inputs += ["-stream_loop", "-1", "-i", music_path]
            music_index = len(clips)
        if voiceover_path:
            inputs += ["-i", voiceover_path]
            voice_index = len(clips) + (1 if music_index is not None else 0)

        audio = _audio_graph(
            music_index=music_index,
            voice_index=voice_index,
            total_duration=total,
            music_volume=music_volume,
        )

        graph = [part for part in (video_filter, audio[0] if audio else "") if part]

        # Chhelli var pan range nakki karo — vachhe na koi filter e badli
        # naakhyu hoy to pan output barabar rahe.
        graph.append(
            f"[{video_label}]scale=out_range=tv,format=yuv420p,fps={fps}[vfinal]"
        )

        # Music/voiceover ek pan na hoy to pan audio track hovo j joiye —
        # Instagram ane ghana player audio vagar ni file par nakhra kare che.
        # anullsrc ne filter ni andar j banavie chie, jethi input list ma
        # vadharano `-i` umervo na pade (e ordering ma bhool ubhi kare che).
        audio_label = audio[1] if audio else "asilent"
        if not audio:
            graph.append(
                "anullsrc=channel_layout=stereo:sample_rate=44100:"
                f"d={total:.3f}[asilent]"
            )

        await run_ffmpeg(
            [
                *inputs,
                "-filter_complex", ";".join(graph),
                "-map", "[vfinal]",
                "-map", f"[{audio_label}]",
                "-c:a", "aac",
                "-b:a", "128k" if audio else "64k",
                "-ar", "44100",
                "-ac", "2",
                "-c:v", "libx264",
                "-preset", preset,
                "-crf", str(crf),
                "-profile:v", "high",
                "-level", "4.1",
                "-pix_fmt", "yuv420p",
                "-color_range", "tv",
                "-r", str(fps),
                "-g", str(fps * 2),
                "-movflags", "+faststart",
                "-t", f"{total:.3f}",
                str(output_path),
            ],
            timeout=1200.0,
        )

        # ---- 3. Cover image ----
        thumbnail = output_path.with_name(output_path.stem + "-cover.jpg")
        await run_ffmpeg(
            [
                "-ss", f"{min(1.2, total / 3):.2f}",
                "-i", str(output_path),
                "-frames:v", "1",
                "-q:v", "3",
                str(thumbnail),
            ],
            timeout=120.0,
        )

        info = await probe(output_path)

        return RenderResult(
            output_path=str(output_path),
            thumbnail_path=str(thumbnail),
            duration=info.duration or total,
            width=info.width or width,
            height=info.height or height,
            bytes=output_path.stat().st_size,
            scene_count=len(usable),
            ms=int((time.monotonic() - started) * 1000),
        )
