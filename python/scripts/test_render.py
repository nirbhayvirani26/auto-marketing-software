#!/usr/bin/env python
"""
Renderer no ekalo test — DB, API key ke internet vagar.

    python scripts/test_render.py

Aa nakli product images banave che ane emathi ek aakhi reel render kare
che: Ken Burns, transitions, text overlay (Gujarati/Hindi sathe),
watermark, music, cover image. ffmpeg ni koi pan filter ma bhool hoy to
ahiya j pakdai jashe.
"""

from __future__ import annotations

import _console  # noqa: F401  (Windows console UTF-8)

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from automarketing.config import storage_dir  # noqa: E402
from automarketing.media import images as imagelib  # noqa: E402
from automarketing.video.ffmpeg import engine_status, probe, run_ffmpeg  # noqa: E402
from automarketing.video.fonts import font_status, script_for_language  # noqa: E402
from automarketing.video.render import Scene, TextOverlay, render_reel  # noqa: E402

OUT = storage_dir() / "test"

SWATCHES = [(26, 26, 46), (15, 52, 96), (45, 19, 44), (61, 90, 128)]
SIZES = [(1200, 1200), (1600, 900), (900, 1600), (2000, 1400)]


def make_test_image(index: int, target: Path) -> None:
    """Nakli product photo — alag alag aspect ratio, jethi crop logic pan test thay."""
    from PIL import Image, ImageDraw

    width, height = SIZES[index % len(SIZES)]
    background = SWATCHES[index % len(SWATCHES)]
    accent = tuple(min(255, c + 120) for c in reversed(background))

    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)

    radius = int(min(width, height) * 0.3)
    draw.ellipse(
        [
            width // 2 - radius,
            height // 2 - radius,
            width // 2 + radius,
            height // 2 + radius,
        ],
        fill=accent,
    )
    draw.rectangle(
        [int(width * 0.1), int(height * 0.78), int(width * 0.9), int(height * 0.84)],
        fill=(255, 255, 255),
    )

    target.write_bytes(imagelib.encode_jpeg(image, quality=90))


async def main() -> int:
    print("\n=== Reel renderer test ===\n")

    engine = engine_status()
    if not engine.get("ready"):
        print(f"✗ ffmpeg: {engine.get('error')}")
        return 1

    print(f"ffmpeg  : {engine['version']}")
    print(f"xfade   : {'✓' if engine['has_xfade'] else '✗ (transition vagar chalse)'}")
    for font in font_status():
        mark = "✓" if font["ok"] else "✗"
        print(f"font {font['script']:<11}: {mark} {font.get('path') or font.get('error')}")
    print()

    OUT.mkdir(parents=True, exist_ok=True)

    images = []
    for index in range(4):
        path = OUT / f"product-{index}.jpg"
        make_test_image(index, path)
        images.append(str(path))
    print(f"{len(images)} test image banya")

    # Chup nahi — sacho tone track, jethi audio pipeline pan test thay.
    music = OUT / "test-tone.mp3"
    await run_ffmpeg(
        [
            "-f", "lavfi",
            "-i", "sine=frequency=220:duration=40",
            "-c:a", "libmp3lame", "-b:a", "128k",
            str(music),
        ]
    )
    print("test music banyu\n")

    scenes = [
        Scene(
            source=images[0],
            duration=3.2,
            motion="zoom-in",
            transition="none",
            overlays=[
                TextOverlay(
                    text="Aa ek lambo hook che je aapoaap be line ma vahenchai javo joiye",
                    position="top",
                    size="large",
                    style="box",
                )
            ],
        ),
        Scene(
            source=images[1],
            duration=3.5,
            motion="pan-right",
            transition="slideleft",
            overlays=[TextOverlay(text="100% cotton", position="bottom", size="hero", style="outline")],
        ),
        Scene(
            source=images[2],
            duration=3.5,
            motion="zoom-out",
            transition="fade",
            overlays=[
                TextOverlay(
                    text="Text: with colon, 'quotes' & 100% special chars",
                    position="center",
                    size="medium",
                    style="shadow",
                ),
                TextOverlay(text="Bije aavelu biju text", position="bottom", size="small", start_at=1.5),
            ],
        ),
        Scene(
            source=images[3],
            duration=3.0,
            motion="pan-up",
            transition="circleopen",
            overlays=[
                TextOverlay(text="Link in bio 🔗", position="center", size="hero", style="box", color="#ffe066")
            ],
        ),
    ]

    output = OUT / "reel.mp4"
    result = await render_reel(
        scenes=scenes,
        output_path=output,
        music_path=str(music),
        watermark="@mybrand",
        script="latin",
        on_progress=lambda step, done, total: print(f"  [{done}/{total}] {step}"),
    )

    print("\n--- Result ---")
    print(f"file      : {result.output_path}")
    print(f"cover     : {result.thumbnail_path}")
    print(f"duration  : {result.duration:.2f} s")
    print(f"size      : {result.width} x {result.height}")
    print(f"bytes     : {result.bytes / 1024 / 1024:.2f} MB")
    print(f"render ma : {result.ms / 1000:.1f} s")

    info = await probe(output)
    print("\n--- Instagram Reels spec check ---")
    checks = [
        ("9:16 aspect", abs(info.width / max(1, info.height) - 9 / 16) < 0.01, f"{info.width}x{info.height}"),
        ("h264 codec", info.codec == "h264", info.codec),
        ("audio track che", info.has_audio, str(info.has_audio)),
        ("30fps", abs(info.fps - 30) < 1.5, f"{info.fps:.2f}"),
        ("3-90 second", 3 <= info.duration <= 90, f"{info.duration:.1f}"),
        ("1GB thi nani", result.bytes < 1024**3, f"{result.bytes / 1024 / 1024:.1f}MB"),
    ]

    failed = 0
    for label, passed, value in checks:
        print(f"  {'✓' if passed else '✗'} {label:<20} {value}")
        if not passed:
            failed += 1

    # Gujarati / Hindi text pan test karie — font barabar lage che ke nahi.
    print("\n--- Gujarati + Hindi text test ---")
    for language, text in (("gu", "તહેવારનું નવું કલેક્શન"), ("hi", "उत्सव का नया कलेक्शन")):
        target = OUT / f"reel-{language}.mp4"
        try:
            await render_reel(
                scenes=[
                    Scene(
                        source=images[0],
                        duration=2.5,
                        overlays=[TextOverlay(text=text, position="center", size="hero")],
                    )
                ],
                output_path=target,
                script=script_for_language(language),
            )
            print(f"  ✓ {language}: {target.name}")
        except Exception as error:  # noqa: BLE001
            print(f"  ✗ {language}: {error}")
            failed += 1

    print("\n✅ Badhu barabar\n" if failed == 0 else f"\n❌ {failed} check fail\n")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
