"""
Badha AI provider ne ek j interface.

Uper no code ne kadi khabar nathi hoti ke kayo provider chale che — etle
navo provider umervo hoy to fakt aa class banavvi, biju kai badalvu nahi.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class CompletionRequest:
    """AI ne su puchvu che."""

    system: str
    prompt: str
    #: JSON Schema — jawab barabar aa shape ma j aavvo joiye.
    schema: dict[str, Any]
    max_tokens: int = 4000
    temperature: float = 0.8


@dataclass
class VisionRequest:
    """Image sathe AI ne su puchvu che."""

    system: str
    prompt: str
    schema: dict[str, Any]
    max_tokens: int = 8000
    temperature: float = 0.4


@dataclass
class PreparedImage:
    """Vision ne aapva layak taiyar image."""

    base64: str
    mime_type: str = "image/jpeg"


class TextProvider(ABC):
    """Lakhan lakhi aape evo provider."""

    #: Tunku naam — "groq", "gemini"...
    key: str = ""
    #: UI ma dekhaay evu naam.
    label: str = ""
    #: Free tier che? (Aapne fakt free j vaparie chie, pan flag rakhyo che.)
    free: bool = True

    @property
    @abstractmethod
    def model(self) -> str:
        """Atyare kayo model vaparay che."""

    @abstractmethod
    def configured(self) -> bool:
        """Key/host set che ke nahi."""

    @abstractmethod
    async def complete(self, request: CompletionRequest) -> Any:
        """Schema pramane structured jawab aape."""

    #: Aa provider image joi shake che?
    supports_vision: bool = False

    async def see(self, images: list[PreparedImage], request: VisionRequest) -> Any:
        """Image jou ne structured jawab aape."""
        raise NotImplementedError(f"{self.key} image nathi joi shakto")

    def missing_key_hint(self) -> str:
        """Key na hoy tyare user ne su kehvu — KYA thi levi e sathe."""
        return f"{self.label} configure nathi."

    def status(self) -> dict:
        """Setup page mate."""
        return {
            "key": self.key,
            "label": self.label,
            "free": self.free,
            "configured": self.configured(),
            "model": self.model if self.configured() else "",
            "vision": self.supports_vision,
            "hint": self.missing_key_hint(),
        }


def schema_to_prompt(schema: dict[str, Any]) -> str:
    """
    Model ne schema prompt ma batavvu pade tyare (nana free model
    `response_format: json_schema` nathi samajta).
    """
    import json

    return (
        "Reply with ONLY a JSON object matching this JSON Schema. "
        "No markdown fence, no commentary, no explanation:\n"
        + json.dumps(schema, separators=(",", ":"))
    )
