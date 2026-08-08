"""
FastAPI dependencies ane error handling.

Ek j jagya e: "login thayelu che?", "kayu brand?", ane error ne samjay
evi bhasha ma badalvu.
"""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from ..config import settings
from ..errors import AutoMarketingError, NotConfigured, UserError
from ..pipeline.chain import ChainError
from .auth import COOKIE_NAME, default_brand, first_user, get_user, read_token


async def current_user(request: Request) -> dict:
    """
    Login thayelu na hoy to 401.

    BE RITE login thai shakay:
      1. Browser — `am_session` cookie (UI aa vaapre che)
      2. Machine — `X-API-Key` header (n8n, cron, tamari potani script)

    Machine mate cookie kaam na aave, ane n8n ne dar vakhate login
    karavvu bekaar che — etle saral API key rakhi che.
    """
    api_key = request.headers.get("x-api-key", "")
    if api_key:
        expected = settings.api_key
        if not expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=(
                    "X-API-Key aavyu pan server par PY_API_KEY set nathi. "
                    "`.env` ma PY_API_KEY=<koi lambo random string> nakho."
                ),
            )
        # `compare_digest` — timing attack thi rakshan.
        if not secrets.compare_digest(api_key, expected):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="API key khoti che"
            )

        user = await first_user()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Ek pan user nathi — pehla UI ma ek var login karo",
            )
        return user

    token = request.cookies.get(COOKIE_NAME, "")
    payload = read_token(token) if token else None
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Pehla login karo"
        )

    user = await get_user(payload.get("sub"))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User madyo nahi"
        )
    return user


async def current_brand(user: dict = Depends(current_user)) -> dict:
    return await default_brand()


def ok(data: Any = None, status_code: int = 200) -> JSONResponse:
    return JSONResponse({"ok": True, "data": jsonable(data)}, status_code=status_code)


def fail(message: str, status_code: int = 400, extra: Any = None) -> JSONResponse:
    return JSONResponse(
        {"ok": False, "error": message, "extra": jsonable(extra)},
        status_code=status_code,
    )


def jsonable(value: Any) -> Any:
    """
    Mongo na ObjectId ane datetime ne JSON ma badle.

    Aa na karie to `Object of type ObjectId is not JSON serializable`
    aave che — Python ma aa sauthi common bhool che.
    """
    from datetime import date, datetime

    from bson import ObjectId

    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(v) for v in value]
    if hasattr(value, "to_dict"):
        return jsonable(value.to_dict())
    if hasattr(value, "__dict__"):
        return jsonable(vars(value))
    return str(value)


def error_message(error: BaseException) -> tuple[str, int]:
    """
    Error ne user-friendly message ane HTTP status ma badle.

    Chain fail thay to DAREAK provider e su kahyu e batavie chie — "kaink
    khotu thayu" karta "gemini: key nathi, groq: rate limit" ghanu vadhu
    kaam nu che.
    """
    if isinstance(error, ChainError):
        return f"{error}", 502
    if isinstance(error, NotConfigured):
        return str(error), 400
    if isinstance(error, UserError):
        return str(error), 400
    if isinstance(error, AutoMarketingError):
        return str(error), 500
    if isinstance(error, HTTPException):
        return str(error.detail), error.status_code
    return f"{type(error).__name__}: {error}", 500
