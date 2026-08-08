#!/usr/bin/env python
"""
Modern ffmpeg download kare — FREE, koi account nahi.

    python scripts/fetch_ffmpeg.py

KEM JOIYE CHE:
`imageio-ffmpeg` sathe je ffmpeg aave che e 4.2.2 che, ane ema `xfade`
(scene vachhe smooth transition) filter NATHI. Reel to ena vagar pan bane
che, pan transition sathe ghani saari lage che.

Aa script tamara computer mate saacho static build utari ne
`python/vendor/ffmpeg/` ma muke che. Kai install nathi thatu, PATH ma kai
umerbanu nathi — fakt ek folder.

Badha build BSD/LGPL/GPL licence na che ane muft che.
"""

from __future__ import annotations

# Windows na cp1252 console par UnicodeEncodeError na aave etle.
import _console  # noqa: F401

import io
import os
import platform
import shutil
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent.parent
VENDOR = PYTHON_DIR / "vendor" / "ffmpeg"


def pick_url() -> tuple[str, str]:
    """(url, archive_type) — aa computer mate."""
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        return (
            "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip",
            "zip",
        )

    if system == "darwin":
        # evermeet fakt ffmpeg aape che (ffprobe alag) — aapne banne joiye,
        # etle ek j zip ma aavtu build vaparie chie.
        if "arm" in machine or "aarch64" in machine:
            return ("https://www.osxexperts.net/ffmpeg711arm.zip", "zip")
        return ("https://www.osxexperts.net/ffmpeg711intel.zip", "zip")

    # Linux
    if "aarch64" in machine or "arm64" in machine:
        return (
            "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz",
            "tar",
        )
    return (
        "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
        "tar",
    )


def download(url: str) -> bytes:
    print(f"  Download: {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "auto-marketing/1.0"})
    with urllib.request.urlopen(request, timeout=300) as response:
        total = int(response.headers.get("content-length") or 0)
        chunks = []
        read = 0
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            chunks.append(chunk)
            read += len(chunk)
            # Progress fakt kharekhar na terminal ma — log file ma spam thay.
            if total and _console.is_tty():
                percent = read * 100 // total
                print(f"\r  {percent}%  ({read // 1024 // 1024} MB)", end="", flush=True)
        print(f"\r  {read // 1024 // 1024} MB utaryu" + " " * 20)
        return b"".join(chunks)


def extract_binaries(data: bytes, archive_type: str) -> list[str]:
    """Archive mathi fakt ffmpeg ane ffprobe kaadhe."""
    VENDOR.mkdir(parents=True, exist_ok=True)
    wanted = {"ffmpeg", "ffmpeg.exe", "ffprobe", "ffprobe.exe"}
    written: list[str] = []

    if archive_type == "zip":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name in archive.namelist():
                base = Path(name).name
                if base.lower() in wanted:
                    target = VENDOR / base
                    target.write_bytes(archive.read(name))
                    written.append(base)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:xz") as archive:
            for member in archive.getmembers():
                base = Path(member.name).name
                if member.isfile() and base.lower() in wanted:
                    extracted = archive.extractfile(member)
                    if extracted:
                        target = VENDOR / base
                        target.write_bytes(extracted.read())
                        written.append(base)

    # Linux/Mac par chalavva layak banavvu pade.
    if os.name != "nt":
        for name in written:
            (VENDOR / name).chmod(0o755)

    return written


def check() -> bool:
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    path = VENDOR / exe
    if not path.exists():
        return False

    import subprocess

    try:
        out = subprocess.run(
            [str(path), "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            timeout=60,
        ).stdout
        version = subprocess.run(
            [str(path), "-version"], capture_output=True, text=True, timeout=30
        ).stdout.splitlines()[0]
    except Exception as error:  # noqa: BLE001
        print(f"  ✗ Chalavi na shakayu: {error}")
        return False

    print(f"\n  {version}")
    for name in ("xfade", "zoompan", "drawtext", "amix"):
        mark = "✓" if f" {name} " in out else "✗"
        print(f"  {mark} {name}")

    return " xfade " in out


def main() -> int:
    print("\n=== ffmpeg download (free) ===\n")

    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    if (VENDOR / exe).exists():
        print(f"  Pehle thi che: {VENDOR / exe}")
        if check():
            print("\n✅ Badhu barabar che.\n")
            return 0
        print("  ...pan barabar nathi, fari download karie chie.\n")
        shutil.rmtree(VENDOR, ignore_errors=True)

    url, archive_type = pick_url()

    try:
        data = download(url)
        written = extract_binaries(data, archive_type)
    except Exception as error:  # noqa: BLE001
        print(f"\n  ✗ Download fail: {error}")
        print(
            "\n  Vandho nahi — reel to `imageio-ffmpeg` na junaa ffmpeg thi pan\n"
            "  banse (fakt scene vachhe transition nahi hoy).\n"
            "\n  Jate karvu hoy to: ffmpeg.org par thi static build utaro ane\n"
            f"  ffmpeg + ffprobe ne aa folder ma mukho:\n    {VENDOR}\n"
        )
        return 0  # Aa optional step che — install atkavvo nathi.

    if not written:
        print("  ✗ Archive ma ffmpeg na madyu")
        return 0

    print(f"  Kadhya: {', '.join(sorted(set(written)))}")
    print(f"  Jagya : {VENDOR}")

    if check():
        print("\n✅ Taiyar — have transition sathe reel banse.\n")
    else:
        print("\n⚠ ffmpeg to made pan xfade nathi. Reel banse, transition vagar.\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
