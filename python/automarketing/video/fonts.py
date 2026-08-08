"""
Font shodhvano.

ffmpeg na `drawtext` ne font FILE nu path joiye che — "Arial" jevu naam
nahi chale. Ane Gujarati/Hindi lakhvu hoy to e lipi ne support karto font
joiye, nahi to badha akshar chorasa (□□□) dekhay che.

Shodhvano kram:
  1. .env nu FONT_PATH (tamari pasandgi)
  2. python/assets/fonts (`python scripts/fetch_fonts.py` thi bhare che)
  3. system na fonts — lipi pramane saacho font
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

from ..config import PROJECT_ROOT, fonts_dir, settings
from ..errors import AutoMarketingError

Script = str  # "latin" | "devanagari" | "gujarati"


def script_for_language(language: str) -> Script:
    """Language code par thi kai lipi joiye."""
    value = (language or "").strip().lower()

    # Hinglish = Hindi na shabdo pan LATIN akshar ma ("kaise ho").
    # "hi" thi shodhie to Devanagari font aavi jaay ane akshar khota
    # dekhay — etle aa check pehla joiye.
    if value.startswith(("hinglish", "gujlish")):
        return "latin"

    code = value[:2]
    if code in ("hi", "mr", "ne", "sa"):
        return "devanagari"
    if code == "gu":
        return "gujarati"
    return "latin"


def _system_font_dirs() -> list[Path]:
    dirs: list[Path] = []

    if sys.platform == "win32":
        windir = os.environ.get("WINDIR", "C:\\Windows")
        dirs.append(Path(windir) / "Fonts")
        local = os.environ.get("LOCALAPPDATA")
        if local:
            dirs.append(Path(local) / "Microsoft" / "Windows" / "Fonts")
    elif sys.platform == "darwin":
        dirs += [
            Path("/System/Library/Fonts"),
            Path("/System/Library/Fonts/Supplemental"),
            Path("/Library/Fonts"),
        ]
        home = os.environ.get("HOME")
        if home:
            dirs.append(Path(home) / "Library" / "Fonts")
    else:
        dirs += [
            Path("/usr/share/fonts"),
            Path("/usr/local/share/fonts"),
        ]
        home = os.environ.get("HOME")
        if home:
            dirs.append(Path(home) / ".fonts")

    return [d for d in dirs if d.exists()]


#: Kayo file-naam kai lipi mate chale. Bold pehla — reel ma patlo font
#: vanchay j nahi.
CANDIDATES: dict[Script, list[str]] = {
    "latin": [
        # Aapne jate download karela (sauthi saara dekhay)
        "Poppins-Bold.ttf", "Poppins-SemiBold.ttf", "Inter-Bold.ttf",
        "Montserrat-Bold.ttf", "Anton-Regular.ttf",
        # Windows
        "seguibl.ttf", "segoeuib.ttf", "arialbd.ttf", "impact.ttf",
        "calibrib.ttf", "verdanab.ttf", "segoeui.ttf", "arial.ttf",
        # Mac
        "Arial Bold.ttf", "Arial.ttf", "Helvetica.ttc",
        # Linux
        "DejaVuSans-Bold.ttf", "NotoSans-Bold.ttf", "LiberationSans-Bold.ttf",
        "DejaVuSans.ttf", "NotoSans-Regular.ttf",
    ],
    "devanagari": [
        "NotoSansDevanagari-Bold.ttf", "NotoSansDevanagari-Regular.ttf",
        "Poppins-Bold.ttf",  # Poppins ma Devanagari pan che
        # Windows — Nirmala UI Hindi ane Gujarati banne kare che.
        # Windows 10/11 par e `.ttc` (collection) tarike aave che.
        "NirmalaB.ttf", "Nirmala.ttf", "Nirmala.ttc", "NirmalaB.ttc",
        "mangalb.ttf", "mangal.ttf", "mangal.ttc",
        # Linux
        "Lohit-Devanagari.ttf", "gargi.ttf", "Sarai.ttf",
        # Mac
        "DevanagariMT.ttc", "Kohinoor.ttc",
    ],
    "gujarati": [
        "NotoSansGujarati-Bold.ttf", "NotoSansGujarati-Regular.ttf",
        # Windows (Nirmala UI Gujarati pan kare che)
        "NirmalaB.ttf", "Nirmala.ttf", "Nirmala.ttc", "NirmalaB.ttc",
        "shrutib.ttf", "shruti.ttf", "shruti.ttc",
        # Linux
        "Lohit-Gujarati.ttf", "Rekha.ttf", "aakar-medium.ttf",
        # Mac
        "GujaratiMT.ttc", "GujaratiSangamMN.ttc",
    ],
}

_cache: dict[Script, str] = {}


def _find_in(directory: Path, filename: str) -> Optional[Path]:
    direct = directory / filename
    if direct.exists():
        return direct

    # Linux ma fonts sub-folder ma hoy che — ek level andar joi laiye.
    try:
        for child in directory.iterdir():
            if child.is_dir():
                nested = child / filename
                if nested.exists():
                    return nested
    except OSError:
        pass
    return None


def resolve_font(script: Script = "latin") -> str:
    """
    Aapelі lipi mate chale evo font file path aape.

    Kai j na made to Error — video banavya pachi text gum thai jaay ena
    karta pehla j kahi devu saru.
    """
    if settings.font_path and Path(settings.font_path).exists():
        return settings.font_path

    cached = _cache.get(script)
    if cached and Path(cached).exists():
        return cached

    # Node (TypeScript) version ma pehle thi fonts download thaya hoy to
    # e pan vaparie chie — be var download karvani jarur nathi.
    directories = [fonts_dir(), PROJECT_ROOT / "assets" / "fonts", *_system_font_dirs()]

    # Pehla aa lipi na khaas font, pachi latin (chhelle kaink to made).
    wanted = list(CANDIDATES.get(script, [])) + (
        [] if script == "latin" else CANDIDATES["latin"]
    )

    for filename in wanted:
        for directory in directories:
            found = _find_in(directory, filename)
            if found:
                _cache[script] = str(found)
                return str(found)

    # Koi naam na malyu. Latin mate je made e chalse; pan Hindi/Gujarati
    # mate latin font aapvathi chorasa (□□□) dekhay che — etle tya
    # saaf error aapvo j saaro.
    for directory in (directories if script == "latin" else []):
        try:
            for path in sorted(directory.iterdir()):
                if path.suffix.lower() in (".ttf", ".otf"):
                    _cache[script] = str(path)
                    return str(path)
        except OSError:
            continue

    raise AutoMarketingError(
        f"Reel ma text lakhva mate font madyo nahi ({script}). "
        f"`python scripts/fetch_fonts.py` chalavo — e Google Fonts par thi free "
        f"font {fonts_dir()} ma muki deshe. Athva .env ma FONT_PATH set karo."
    )


def font_status() -> list[dict]:
    """Setup page mate."""
    out = []
    for script in ("latin", "devanagari", "gujarati"):
        try:
            out.append({"script": script, "ok": True, "path": resolve_font(script)})
        except AutoMarketingError as error:
            out.append({"script": script, "ok": False, "error": str(error)})
    return out
