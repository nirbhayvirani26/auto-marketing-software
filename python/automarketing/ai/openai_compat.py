"""
OpenAI-format valaa provider (Groq, OpenRouter, ane biju ghana).

Aa badha ek j `/chat/completions` format vaapre che, etle ek j class thi
kaam thai jaay che. Navo provider umervo hoy to fakt base URL, model ane
key aapo — biju kai lakhvanu nathi.
"""

from __future__ import annotations

from typing import Any, Optional

from ..errors import FatalError, NotConfigured, RetryableError
from ..pipeline.http import get_client, parse_json_loose
from .base import (
    CompletionRequest,
    PreparedImage,
    TextProvider,
    VisionRequest,
    schema_to_prompt,
)


class OpenAiCompatProvider(TextProvider):
    """OpenAI na format valo koi pan provider."""

    def __init__(
        self,
        *,
        key: str,
        label: str,
        base_url: str,
        api_key: callable,
        model: callable,
        vision_model: Optional[callable] = None,
        hint: str,
        extra_headers: Optional[callable] = None,
        free: bool = True,
    ) -> None:
        self.key = key
        self.label = label
        self.free = free
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._vision_model = vision_model
        self._hint = hint
        self._extra_headers = extra_headers
        self.supports_vision = vision_model is not None

    @property
    def model(self) -> str:
        return self._model()

    def configured(self) -> bool:
        return bool(self._api_key())

    def missing_key_hint(self) -> str:
        return self._hint

    # ---------------------------------------------------------------- #

    def _headers(self) -> dict[str, str]:
        headers = {
            "content-type": "application/json",
            "authorization": f"Bearer {self._api_key()}",
        }
        if self._extra_headers:
            headers.update(self._extra_headers())
        return headers

    async def _chat(self, payload: dict[str, Any], *, timeout: float) -> str:
        if not self._api_key():
            raise NotConfigured(self._hint)

        client = get_client()
        response = await client.post(
            f"{self._base_url}/chat/completions",
            headers=self._headers(),
            json=payload,
            timeout=timeout,
        )

        if response.status_code >= 400:
            body = response.text[:500]

            if response.status_code == 429:
                raise RetryableError(
                    f"{self.label} ni rate limit lagi. Thodi var pachi apoaap "
                    f"fari try thashe. ({body[:160]})"
                )
            if response.status_code in (401, 403):
                raise FatalError(f"{self.label}: key khoti che ke band thai gai. ({body[:160]})")
            if response.status_code >= 500:
                raise RetryableError(f"{self.label}: server ni bhool ({response.status_code})")
            raise FatalError(f"{self.label}: HTTP {response.status_code} {body[:200]}")

        data = response.json()

        # Ketlak provider 200 sathe pan error andar mokle che.
        if isinstance(data, dict) and data.get("error"):
            message = str(data["error"].get("message") or data["error"])
            raise RetryableError(f"{self.label}: {message[:200]}")

        choices = (data or {}).get("choices") or []
        if not choices:
            raise RetryableError(f"{self.label} e khali jawab aapyo")

        content = (choices[0].get("message") or {}).get("content")
        if not content:
            raise RetryableError(f"{self.label} e khali jawab aapyo")

        return content

    # ---------------------------------------------------------------- #

    async def complete(self, request: CompletionRequest) -> Any:
        # Free model badha `json_schema` nathi samajta, etle schema prompt
        # ma j aapiye chie ane `json_object` mode maagie chie. Aa badhe
        # chale che ane jawab pan barabar aave che.
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": f"{request.system}\n\n{schema_to_prompt(request.schema)}"},
                {"role": "user", "content": request.prompt},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
        }
        text = await self._chat(payload, timeout=120.0)
        return parse_json_loose(text, label=self.label)

    async def see(self, images: list[PreparedImage], request: VisionRequest) -> Any:
        if not self._vision_model:
            raise NotImplementedError(f"{self.key} image nathi joi shakto")

        content: list[dict[str, Any]] = [
            {
                "type": "image_url",
                "image_url": {"url": f"data:{img.mime_type};base64,{img.base64}"},
            }
            for img in images
        ]
        content.append({"type": "text", "text": request.prompt})

        payload = {
            "model": self._vision_model(),
            "messages": [
                {"role": "system", "content": f"{request.system}\n\n{schema_to_prompt(request.schema)}"},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
        }
        text = await self._chat(payload, timeout=150.0)
        return parse_json_loose(text, label=self.label)
