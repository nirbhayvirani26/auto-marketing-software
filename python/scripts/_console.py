"""
Console ne UTF-8 par lai aave.

Windows nu terminal moti bhage `cp1252` ma chale che, ane tya `✓`, `→`,
`—` ke Gujarati akshar lakhvathi script CRASH thai jaay che
(`UnicodeEncodeError`). Aa bahu chidavnaru che — kaam to thai gayu hoy
ane fakt chhapva ma bhool aave.

Etle dareak script sauthi pehla `import _console` kare che.
"""

from __future__ import annotations

import sys


def enable_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            # Python 3.7+ — encoding badli shakay che.
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            pass


enable_utf8()


def is_tty() -> bool:
    """Progress bar fakt kharekhar na terminal ma j batavvo."""
    try:
        return bool(sys.stdout.isatty())
    except Exception:  # noqa: BLE001
        return False


#: Terminal UTF-8 na kare to pan kaam chale evaa nishan.
TICK = "✓"
CROSS = "✗"
DASH = "–"
WARN = "⚠"
