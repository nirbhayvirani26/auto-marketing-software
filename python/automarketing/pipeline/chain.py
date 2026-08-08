"""
Multi-API pipeline runner.

Aakha app ma jya pan bahar ni service par aadhaar rakhvo pade — AI, vision,
image, video, TTS, trends, hosting — tya aa j runner vaparie chie. Ek
provider ni free limit lage, key khute, ke service down thay to biju
provider apoaap try thay che. Etle kaam kyarey atkatu nathi.

Traney rakshan sathe aave che:
  • timeout        — hang thayelo provider aakhu kaam roki na shake
  • retry+backoff  — kaamchalau error (429 / 5xx / network) par fari try
  • circuit breaker— vaar vaar fail thato provider thodo vakhat skip thay
"""

from __future__ import annotations

import asyncio
import random
import re
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Generic, Optional, TypeVar

from ..errors import AutoMarketingError, FatalError, RetryableError

T = TypeVar("T")


# ------------------------------------------------------------------ #
#  Types
# ------------------------------------------------------------------ #


@dataclass
class Attempt:
    """Ek provider par ek prayatna no hisab."""

    provider: str
    ok: bool
    ms: int
    error: Optional[str] = None
    #: "circuit-open" | "not-configured" — try j na karyu hoy to
    skipped: Optional[str] = None


@dataclass
class ChainResult(Generic[T]):
    data: T
    provider: str
    attempts: list[Attempt]
    ms: int


@dataclass
class Candidate(Generic[T]):
    """Chain ma ek provider."""

    #: Log ma dekhaay evu tunku naam, dakhla tarike "gemini".
    name: str
    #: Kaam karnaru async function.
    run: Callable[[], Awaitable[T]]
    #: UI ma dekhaay evu naam.
    label: str = ""
    #: Free service che? Free ne pehli pasandgi apay che.
    free: bool = True
    #: Key/config hajar che? False hoy to chhodine aagal vadhay che.
    configured: Callable[[], bool] = field(default=lambda: True)
    #: Aa provider mate alag timeout joito hoy to (seconds).
    timeout: Optional[float] = None
    #: Aa provider mate alag retry count.
    retries: Optional[int] = None


class ChainError(AutoMarketingError):
    """
    Chain na BADHA provider fail thaya.

    `attempts` ma dareak provider e su kahyu e hoy che — user ne e j
    batavvanu che, "kaink khotu thayu" nahi.
    """

    def __init__(self, message: str, attempts: list[Attempt]) -> None:
        super().__init__(message)
        self.attempts = attempts

    @property
    def summary(self) -> str:
        lines = []
        for attempt in self.attempts:
            if attempt.ok:
                continue
            lines.append(f"• {attempt.provider}: {attempt.skipped or attempt.error or 'fail'}")
        return "\n".join(lines)


# ------------------------------------------------------------------ #
#  Circuit breaker
# ------------------------------------------------------------------ #

_BREAKER_THRESHOLD = 3
_BREAKER_COOLDOWN = 60.0  # seconds

#: provider naam → (kul fail, kyaa sudhi band)
_breakers: dict[str, tuple[int, float]] = {}


def _breaker_open(name: str) -> bool:
    state = _breakers.get(name)
    if not state:
        return False
    failures, open_until = state
    if open_until > time.time():
        return True
    if open_until:
        # Cooldown puro — fari ek mauko aapo.
        _breakers[name] = (0, 0.0)
    return False


def _breaker_record(name: str, ok: bool) -> None:
    if ok:
        _breakers.pop(name, None)
        return
    failures, _ = _breakers.get(name, (0, 0.0))
    failures += 1
    open_until = time.time() + _BREAKER_COOLDOWN if failures >= _BREAKER_THRESHOLD else 0.0
    _breakers[name] = (failures, open_until)


def reset_breakers() -> None:
    """Test / admin mate — badha breaker saaf karo."""
    _breakers.clear()


def breaker_status() -> list[dict]:
    """Atyare kaya provider skip thai rahya che — admin panel mate."""
    now = time.time()
    return [
        {
            "provider": name,
            "failures": failures,
            "open_for_seconds": max(0.0, round(open_until - now, 1)),
        }
        for name, (failures, open_until) in _breakers.items()
    ]


# ------------------------------------------------------------------ #
#  Retry nakki karvu
# ------------------------------------------------------------------ #

_RETRY_HINTS = re.compile(
    r"\b(429|500|502|503|504)\b"
    r"|rate.?limit|quota|overload|unavailable|timed? out|timeout"
    r"|temporarily|try again|connection|econnreset|network",
    re.IGNORECASE,
)


def _is_retryable(error: BaseException) -> bool:
    if isinstance(error, FatalError):
        return False
    if isinstance(error, RetryableError):
        return True
    if isinstance(error, (asyncio.TimeoutError, TimeoutError, ConnectionError, OSError)):
        return True
    return bool(_RETRY_HINTS.search(str(error)))


def _clean_error(error: BaseException) -> str:
    if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    text = str(error).strip() or error.__class__.__name__
    return text[:400]


# ------------------------------------------------------------------ #
#  Runner
# ------------------------------------------------------------------ #


def _order(
    candidates: list[Candidate[T]],
    prefer: str = "",
    prefer_free: bool = True,
) -> list[Candidate[T]]:
    ordered = list(candidates)

    if prefer_free:
        # Python no sort sthir che — etle free/paid vachhe no kram sachvay che.
        ordered.sort(key=lambda c: 0 if c.free else 1)

    if prefer:
        wanted = prefer.lower()
        for index, candidate in enumerate(ordered):
            if candidate.name.lower() == wanted:
                ordered.insert(0, ordered.pop(index))
                break

    return ordered


async def run_chain(
    candidates: list[Candidate[T]],
    *,
    label: str,
    timeout: float = 60.0,
    retries: int = 1,
    backoff: float = 0.7,
    prefer: str = "",
    prefer_free: bool = True,
) -> ChainResult[T]:
    """
    Candidates ne kram ma try kare. Pehlo je safal thay e no jawab.

    Badha fail thay to `ChainError` — jema dareak provider e su kahyu e hoy
    che, jethi user ne khabar pade ke KAI key nakhvi.
    """
    started = time.monotonic()
    attempts: list[Attempt] = []

    ordered = _order(candidates, prefer=prefer, prefer_free=prefer_free)
    if not ordered:
        raise ChainError(
            f"{label}: ek pan provider configure nathi. Setup page ma javo ane key nakho.",
            attempts,
        )

    for candidate in ordered:
        try:
            is_configured = candidate.configured()
        except Exception:  # noqa: BLE001 — configured() kadi crash na kare
            is_configured = False

        if not is_configured:
            attempts.append(Attempt(candidate.name, ok=False, ms=0, skipped="not-configured"))
            continue

        if _breaker_open(candidate.name):
            attempts.append(Attempt(candidate.name, ok=False, ms=0, skipped="circuit-open"))
            continue

        tries = candidate.retries if candidate.retries is not None else retries
        limit = candidate.timeout if candidate.timeout is not None else timeout

        for attempt_index in range(tries + 1):
            attempt_started = time.monotonic()
            try:
                data = await asyncio.wait_for(candidate.run(), timeout=limit)
            except Exception as error:  # noqa: BLE001 — badhu pakadvu j che
                elapsed = int((time.monotonic() - attempt_started) * 1000)
                attempts.append(
                    Attempt(candidate.name, ok=False, ms=elapsed, error=_clean_error(error))
                )

                can_retry = attempt_index < tries and _is_retryable(error)
                if not can_retry:
                    _breaker_record(candidate.name, ok=False)
                    break

                # Exponential backoff + jitter — badha client ek saathe
                # pacha na aave.
                wait = backoff * (2**attempt_index) + random.uniform(0, 0.25)
                await asyncio.sleep(wait)
            else:
                elapsed = int((time.monotonic() - attempt_started) * 1000)
                attempts.append(Attempt(candidate.name, ok=True, ms=elapsed))
                _breaker_record(candidate.name, ok=True)
                return ChainResult(
                    data=data,
                    provider=candidate.name,
                    attempts=attempts,
                    ms=int((time.monotonic() - started) * 1000),
                )

    detail = "\n".join(
        f"• {a.provider}: {a.skipped or a.error or 'fail'}" for a in attempts
    )
    raise ChainError(f"{label} — koi pan provider chalyo nahi.\n{detail}", attempts)


async def run_chain_soft(
    candidates: list[Candidate[T]],
    **kwargs,
) -> Optional[ChainResult[T]]:
    """
    `run_chain` no "fail thay to None" variant.

    Optional step mate — jem ke voiceover ke trend lookup — jya kaam
    atakvu na joiye.
    """
    try:
        return await run_chain(candidates, **kwargs)
    except ChainError:
        return None
