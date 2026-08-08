#!/usr/bin/env python
"""
Reel na text mate FREE fonts download kare che.

    python scripts/fetch_fonts.py

Aa farjiyat NATHI — system na fonts thi pan kaam chale che. Pan aa fonts
reel ma ghana saara lage che, ane Hindi/Gujarati mate khatri thai jaay che
ke akshar chorasa (□□□) nahi dekhay.

Badha fonts Open Font License na che — commercial vaparash pan free che.
"""

from __future__ import annotations

import _console  # noqa: F401  (Windows console UTF-8)

import sys
import urllib.request
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent.parent
OUT = PYTHON_DIR / "assets" / "fonts"

FONTS = [
    (
        "Poppins-Bold.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf",
        "Reel na headline mate — English",
    ),
    (
        "Poppins-SemiBold.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-SemiBold.ttf",
        "Nana text mate",
    ),
    (
        "Anton-Regular.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
        "Moto bold hook — dhyan khenche che",
    ),
    (
        "NotoSansDevanagari-Bold.ttf",
        "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/"
        "NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Bold.ttf",
        "Hindi text",
    ),
    (
        "NotoSansGujarati-Bold.ttf",
        "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/"
        "NotoSansGujarati/hinted/ttf/NotoSansGujarati-Bold.ttf",
        "Gujarati text",
    ),
]


def download(name: str, url: str, why: str) -> bool:
    target = OUT / name

    if target.exists() and target.stat().st_size > 10_000:
        print(f"  ✓ {name} (pehle thi che)")
        return True

    try:
        request = urllib.request.Request(url, headers={"User-Agent": "auto-marketing/1.0"})
        with urllib.request.urlopen(request, timeout=90) as response:
            data = response.read()

        if len(data) < 10_000:
            raise ValueError("file bahu nani — kharab lage che")

        target.write_bytes(data)
        print(f"  ✓ {name}  ({len(data) // 1024} KB) — {why}")
        return True
    except Exception as error:  # noqa: BLE001
        print(f"  ✗ {name} — {error}")
        return False


def main() -> int:
    print(f"\nFonts ahiya jashe: {OUT}\n")
    OUT.mkdir(parents=True, exist_ok=True)

    results = [download(name, url, why) for name, url, why in FONTS]
    ok = sum(results)
    print(f"\n{ok}/{len(FONTS)} fonts taiyar.")

    if ok == 0:
        print(
            "\nEk pan download na thayo — vandho nahi, system na fonts vaparashe.\n"
            "Internet aave tyare fari `python scripts/fetch_fonts.py` chalavo."
        )

    # Aa optional step che — install kadi atkavvo nahi.
    return 0


if __name__ == "__main__":
    sys.exit(main())
