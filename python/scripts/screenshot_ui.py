#!/usr/bin/env python
"""
GUI kharekhar DEKHAY che ke nahi e tapase — headless browser thi.

    python scripts/screenshot_ui.py

Screenshots `storage/shots/` ma jashe. Aa "HTTP 200 aavyu" karta ghanu
vadhare che — aa kharekhar page RENDER karine batave che, etle CSS/JS ni
bhool pan pakdai jaay che.
"""

from __future__ import annotations

import html
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

from automarketing.config import settings  # noqa: E402

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

SHOTS = Path(__file__).resolve().parent.parent / "storage" / "shots"


def find_browser() -> str | None:
    from shutil import which

    for path in BROWSERS:
        if os.path.exists(path):
            return path
    return which("chrome") or which("chromium") or which("msedge")


def shot(browser: str, url: str, name: str, wait_ms: int = 9000) -> bool:
    target = SHOTS / name
    target.unlink(missing_ok=True)

    subprocess.run(
        [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            # Ek j profile — login ni cookie badha shot vachhe rahe che.
            f"--user-data-dir={SHOTS / '_profile'}",
            # Console ni bhool pan dekhaay — khali page nu asal karan
            # mota bhage JS error j hoy che.
            "--enable-logging=stderr",
            "--v=0",
            "--window-size=1500,1250",
            # JS ane redirect pura thay eni raah — aa vagar khali page aave.
            f"--virtual-time-budget={wait_ms}",
            f"--screenshot={target}",
            url,
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )

    ok = target.exists() and target.stat().st_size > 5000
    size = f"{target.stat().st_size // 1024} KB" if target.exists() else "—"
    print(f"  {'✓' if ok else '✗'} {name:<22} {size}")
    return ok


def _login_form(base: str, next_path: str = "/") -> str:
    """Jate submit thato login form — headless ne login karavva mate."""
    return (
        "<!doctype html><html><body>"
        f'<form id="f" method="post" action="{base}/login">'
        f'<input name="email" value="{html.escape(settings.seed_email)}">'
        f'<input name="password" value="{html.escape(settings.seed_password)}">'
        f'<input name="next" value="{html.escape(next_path)}">'
        "</form><script>document.getElementById('f').submit()</script>"
        "</body></html>"
    )


def main() -> None:
    browser = find_browser()
    if not browser:
        print("\n  Chrome/Edge madyu nahi — screenshot na lai shakaya.")
        print("  Vandho nahi: browser ma jate kholo → http://localhost:8000\n")
        return

    SHOTS.mkdir(parents=True, exist_ok=True)
    base = f"http://localhost:{settings.port}"
    print(f"\n  browser: {Path(browser).name}")
    print(f"  app    : {base}\n")

    ok = shot(browser, f"{base}/login", "1-login.png", wait_ms=6000)

    # Login pachi nu page joie to cookie joiye. Headless ne cookie aapvi
    # aughri che, etle ek nano auto-submit form vaparie chie — browser
    # jate login karine mukhya page par pahonchi jashe.
    form = SHOTS / "_login.html"
    form.write_text(_login_form(base, next_path="/"), encoding="utf-8")
    ok &= shot(browser, form.as_uri(), "2-studio.png", wait_ms=14000)
    form.unlink(missing_ok=True)

    # Baki na tabs. Headless browser exit vakhate cookie disk par lakhtu
    # nathi, etle DAREAK shot mate fari login karie chie ane `next` thi
    # sidha e tab par pahonchi jaie chie.
    for tab, name in (
        ("products", "3-products.png"),
        ("autodm", "4-autodm.png"),
        ("setup", "5-setup.png"),
    ):
        page = SHOTS / f"_{tab}.html"
        page.write_text(_login_form(base, next_path=f"/#{tab}"), encoding="utf-8")
        ok &= shot(browser, page.as_uri(), name, wait_ms=13000)
        page.unlink(missing_ok=True)

    print(f"\n  {'Badhu barabar dekhay che.' if ok else 'Kaink khoti vaat che.'}")
    print(f"  Screenshots: {SHOTS}\n")


if __name__ == "__main__":
    main()
