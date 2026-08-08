"""
Error na prakar.

Sauthi agatya no bhed: **retry karva jevi bhool** ane **kayami bhool**.

  RetryableError — rate limit, 5xx, network hedcho → fari try karvathi chale
  FatalError     — khoti key, khotu input → fari try karvano matlab j nathi

Aa bhed thi provider chain ne khabar pade che ke ubha rahi ne fari try karvu
ke turant bija provider par jaavu.

(`ChainError` `pipeline/chain.py` ma che — tya `Attempt` sathe j rahe che.)
"""

from __future__ import annotations


class AutoMarketingError(Exception):
    """Aapna badha error no baap."""


class RetryableError(AutoMarketingError):
    """Kaamchalau bhool — thodi var pachi chale evi shakyata che."""

    retryable = True

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        #: HTTP status (hoy to) — 429 ne khaas rite sambhalvu pade che.
        self.status = status
        #: Server e `Retry-After` ma ketli var kahi (second ma).
        #: Aa hoy tyare AAPNO andaj nahi, SERVER nu kahyu manvu — e j
        #: saacho aankdo che ane ena thi vahela javathi fari 429 j male.
        self.retry_after = retry_after


class FatalError(AutoMarketingError):
    """Kayami bhool — fari try karvathi kai nahi thay."""

    retryable = False


class NotConfigured(FatalError):
    """
    Key ke setting nathi.

    Message ma HAMESHA lakhvu ke e KYA thi levi — "GEMINI_API_KEY set nathi"
    karta "GEMINI_API_KEY set nathi. aistudio.google.com/apikey par thi FREE
    key lo." ghanu vadhu kaam nu che.
    """


class UserError(AutoMarketingError):
    """User e kaink khotu aapyu — API ma 400 tarike jaay che."""
