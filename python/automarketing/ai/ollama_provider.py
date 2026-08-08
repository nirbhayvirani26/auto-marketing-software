"""
Ollama — 100% free, tamara potana computer par chale che.

Koi key nathi, koi limit nathi, internet pan nathi joitu. Fakt thodu
dhimu chale che (computer par aadhar).

Setup:
  1. https://ollama.com par thi install karo
  2. `ollama pull llama3.2`          (lakhan mate)
  3. `ollama pull llava`             (image jova mate — marji nu)
  4. .env ma: OLLAMA_MODEL=llama3.2
"""

from __future__ import annotations

from typing import Any

from ..config import settings
from ..errors import NotConfigured, RetryableError
from ..pipeline.http import get_client, parse_json_loose
from .base import (
    CompletionRequest,
    PreparedImage,
    TextProvider,
    VisionRequest,
    schema_to_prompt,
)

HINT = (
    "Ollama set nathi. 100% free ane offline joitu hoy to: ollama.com par thi "
    "install karo → `ollama pull llama3.2` → .env ma OLLAMA_MODEL=llama3.2"
)

#: Aa models image pan joi shake che.
VISION_MODELS = ("llava", "bakllava", "llama3.2-vision", "moondream", "minicpm-v", "gemma3")


class OllamaProvider(TextProvider):
    key = "ollama"
    label = "Ollama (local, 100% free)"
    free = True

    @property
    def model(self) -> str:
        return settings.ollama_model

    @property
    def supports_vision(self) -> bool:  # type: ignore[override]
        model = self.model.lower()
        return any(name in model for name in VISION_MODELS)

    def configured(self) -> bool:
        return bool(settings.ollama_model and settings.ollama_host)

    def missing_key_hint(self) -> str:
        return HINT

    # ---------------------------------------------------------------- #

    async def _chat(
        self,
        *,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        images: list[str] | None,
        max_tokens: int,
        temperature: float,
    ) -> Any:
        if not self.configured():
            raise NotConfigured(HINT)

        user_message: dict[str, Any] = {"role": "user", "content": prompt}
        if images:
            user_message["images"] = images

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": f"{system}\n\n{schema_to_prompt(schema)}"},
                user_message,
            ],
            "stream": False,
            "format": "json",
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }

        client = get_client()
        try:
            response = await client.post(
                f"{settings.ollama_host.rstrip('/')}/api/chat",
                json=payload,
                timeout=300.0,  # local model dhima hoy che
            )
        except Exception as error:  # noqa: BLE001
            raise RetryableError(
                f"Ollama sudhi pahonchi na shakaya ({settings.ollama_host}). "
                f"Chalu che? `ollama serve` chalavo. [{error}]"
            ) from error

        if response.status_code >= 400:
            raise RetryableError(f"Ollama: HTTP {response.status_code} {response.text[:200]}")

        data = response.json()
        content = ((data or {}).get("message") or {}).get("content")
        if not content:
            raise RetryableError("Ollama e khali jawab aapyo")

        return parse_json_loose(content, label="Ollama")

    # ---------------------------------------------------------------- #

    async def complete(self, request: CompletionRequest) -> Any:
        return await self._chat(
            system=request.system,
            prompt=request.prompt,
            schema=request.schema,
            images=None,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
        )

    async def see(self, images: list[PreparedImage], request: VisionRequest) -> Any:
        if not self.supports_vision:
            raise NotImplementedError(
                f"Ollama no '{self.model}' model image nathi joi shakto. "
                "`ollama pull llava` chalavo ane OLLAMA_MODEL=llava karo."
            )
        return await self._chat(
            system=request.system,
            prompt=request.prompt,
            schema=request.schema,
            images=[img.base64 for img in images],
            max_tokens=request.max_tokens,
            temperature=request.temperature,
        )


async def ollama_ping() -> dict:
    """Ollama chalu che? Kaya model che? — Setup page mate."""
    try:
        client = get_client()
        response = await client.get(
            f"{settings.ollama_host.rstrip('/')}/api/tags", timeout=5.0
        )
        response.raise_for_status()
        models = [m.get("name", "") for m in (response.json() or {}).get("models", [])]
        return {"up": True, "models": models}
    except Exception as error:  # noqa: BLE001
        return {"up": False, "models": [], "error": str(error)[:200]}
