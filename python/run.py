#!/usr/bin/env python
"""
App chalu karo:

    python run.py

Pachi browser ma kholo: http://localhost:8000
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Windows na cp1252 console par UnicodeEncodeError na aave etle.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

import uvicorn  # noqa: E402

from automarketing.config import settings  # noqa: E402


def lan_ip() -> str:
    """
    Aa computer nu network par nu IP.

    Aa kaam nu che — phone par thi pan app kholi shakay, ane Instagram ni
    reel phone par j joie shakay che.
    """
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))  # kai moklatu nathi — fakt route jue che
        ip = probe.getsockname()[0]
        probe.close()
        return ip
    except Exception:  # noqa: BLE001
        return ""


def port_busy(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1.5)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def main() -> None:
    host = settings.host
    port = settings.port

    # Port pehla thi vaparay che? To saaf message aapo — uvicorn no
    # "[Errno 10048]" koi ne samjatu nathi.
    if port_busy(host, port):
        print()
        print(f"  ⚠  Port {port} pehla thi vaparay che.")
        print()
        print("  App pehla thi chalu che — browser ma aa kholo:")
        print(f"      http://localhost:{port}")
        print()
        print("  Athva juno band karo:")
        print(f"      Windows :  npx kill-port {port}")
        print(f"      ke       :  netstat -ano | findstr :{port}")
        print("                  taskkill /F /PID <PID>")
        print()
        sys.exit(1)

    print()
    print("  ╔══════════════════════════════════════════════════╗")
    print("  ║  🎬  Auto Marketing Software                     ║")
    print("  ╚══════════════════════════════════════════════════╝")
    print()
    print("  Browser ma AA KHOLO:")
    print(f"      http://localhost:{port}")

    ip = lan_ip()
    if ip and host == "0.0.0.0":  # noqa: S104 — jaani joine
        print()
        print("  Phone par thi (e j wifi par):")
        print(f"      http://{ip}:{port}")

    print()
    print(f"  Login : {settings.seed_email}")
    print(f"  Pass  : {settings.seed_password}")
    print()
    print("  (Band karva Ctrl+C dabavo)")
    print()

    uvicorn.run(
        "automarketing.api.app:app",
        host=host,
        port=port,
        reload=settings.debug,
        log_level="info" if settings.debug else "warning",
    )


if __name__ == "__main__":
    main()
