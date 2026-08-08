"""
HTTP helper — badha provider aa vaapre che.

Ek j jagya e:
  • ek j shared connection pool (dar vakhate navo client banavvo mongho che)
  • HTTP status ne saachi RetryableError / FatalError ma badalvu
  • browser jevu User-Agent (ghani site vagar block kare che)
  • Referer (hotlink protection valі site 403 aape che — dakhla: ccMixter)
"""

from __future__ import annotations

import json as jsonlib
import re
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx

from ..errors import FatalError, RetryableError

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_client: Optional[httpx.AsyncClient] = None


def get_client() -> httpx.AsyncClient:
    """Aakha app mate ek j client — connection fari fari vaparay che."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(60.0, connect=15.0),
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
            headers={"user-agent": BROWSER_UA},
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def _origin_of(url: str) -> str:
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return ""
    return f"{parts.scheme}://{parts.netloc}/"


_TAGS = re.compile(r"<[^>]+>")
_SPACES = re.compile(r"\s+")


def _short_body(response: httpx.Response) -> str:
    """
    Error message mate jawab no TUNKO ane VANCHVA LAYAK bhaag.

    Ghani site error par aakhu HTML page pachu aape che. Ene jem nu tem
    message ma naakhie to user ne `<!DOCTYPE html> <html lang="en"> <head>
    <meta charset=...` dekhay che — jema kai j kaam ni mahiti nathi ane
    asli karan dabai jaay che. Etle tags kaadhi ne fakt lakhan rakhie chie.
    """
    try:
        text = response.text
    except Exception:  # noqa: BLE001
        return ""

    if "<" in text[:200]:
        text = _TAGS.sub(" ", text)
    text = _SPACES.sub(" ", text).strip()
    return text[:160]


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """
    `Retry-After` header — server pote kahe che ke ketli var rah jovi.

    Be aakar ma aave che: second ni sankhya ("30"), ke HTTP date. Bija
    aakar ne aapne nathi vaparta (kadi j aavto nathi ane parse karvano
    khatro vadhare che) — tyare `None` aapie chie ane aapno andaj chale che.
    """
    raw = (response.headers.get("retry-after") or "").strip()
    if not raw:
        return None
    try:
        seconds = float(raw)
    except ValueError:
        return None
    # Site kyarek "3600" kahe che — etli var koi rah na jue. Had baandhie.
    return max(0.0, min(seconds, 120.0))


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code < 400:
        return

    status = response.status_code
    message = f"HTTP {status} {_short_body(response)}".strip()

    # 429 ane 5xx thodi var pachi chale che — retry karva jevu.
    if status == 429 or status >= 500:
        raise RetryableError(
            message, status=status, retry_after=_retry_after_seconds(response)
        )
    raise FatalError(message)


async def request_bytes(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[dict[str, str]] = None,
    timeout: Optional[float] = None,
    send_referer: bool = True,
    **kwargs: Any,
) -> bytes:
    """File download kare. 403 taalva Referer aapoaap moklie chie."""
    merged = dict(headers or {})
    if send_referer and "referer" not in {k.lower() for k in merged}:
        origin = _origin_of(url)
        if origin:
            merged["referer"] = origin

    client = get_client()
    try:
        response = await client.request(
            method, url, headers=merged, timeout=timeout, **kwargs
        )
    except httpx.HTTPError as error:
        raise RetryableError(f"network: {error}") from error

    _raise_for_status(response)
    return response.content


async def request_text(url: str, **kwargs: Any) -> str:
    data = await request_bytes(url, **kwargs)
    return data.decode("utf-8", errors="replace")


async def request_json(url: str, **kwargs: Any) -> Any:
    """JSON aape. Jawab JSON ma na hoy to samjay evo error."""
    text = await request_text(url, **kwargs)
    try:
        return jsonlib.loads(text)
    except jsonlib.JSONDecodeError as error:
        raise RetryableError(f"Jawab JSON ma nathi: {text[:200]}") from error


def parse_json_loose(text: str, *, label: str = "AI") -> Any:
    """
    Nana model kyarek ```json fence ke aagal-pachhal lakhan umeri de che.

    Sadho parse fail thay to pehla `{` thi chhella `}` sudhi kaadhi laiye —
    aa nana free models sathe bahu kaam aave che.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned
        cleaned = cleaned.removeprefix("json").strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()

    try:
        return jsonlib.loads(cleaned)
    except jsonlib.JSONDecodeError:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            return jsonlib.loads(cleaned[start : end + 1])
        except jsonlib.JSONDecodeError:
            pass

    # Array pan hoi shake.
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start >= 0 and end > start:
        try:
            return jsonlib.loads(cleaned[start : end + 1])
        except jsonlib.JSONDecodeError:
            pass

    raise RetryableError(f"{label} no jawab JSON ma nathi: {cleaned[:200]}")
