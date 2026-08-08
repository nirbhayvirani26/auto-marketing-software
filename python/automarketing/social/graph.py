"""
Meta Graph API no paayo.

Instagram ane Facebook banne ek j Graph API par chale che. Ahiya fakt
request/error handle karie chie — actual publishing `publish.py` ma che.

⚠️ BE VAAT JE KHABAR HOVI JOIYE:

1. Meta na server TAMARA URL par thi media DOWNLOAD kare che. Etle
   `localhost` KYAREY nahi chale — public https URL joiye j. Aapno media
   store aa aapoaap sambhale che (Catbox / Cloudinary / tunnel).

2. Instagram nu trending SONG aa API thi lagavi shakatu nathi. Meta e
   music catalog API ma kholyu j nathi. Video ni andar bake karelu music
   j jaay che.
"""

from __future__ import annotations

from typing import Any

from ..config import settings
from ..errors import FatalError, RetryableError, UserError
from ..pipeline.http import get_client


def graph_url(path: str) -> str:
    return f"https://graph.facebook.com/{settings.meta_graph_version}{path}"


def _explain(error: dict, status: int) -> str:
    """
    Meta na error ne samjay evi bhasha ma badle.

    `error_user_msg` hoy to e sauthi saru hoy che — Meta e j user mate
    lakhelu hoy che.
    """
    message = (
        error.get("error_user_msg")
        or error.get("message")
        or f"HTTP {status}"
    )
    code = error.get("code")
    subcode = error.get("error_subcode")

    hints = {
        190: "Access token khota ke expire thai gaya che — Accounts page ma fari connect karo.",
        200: "Aa kaam mate paravanagi (permission) nathi. Meta app ma joiti permission add karo.",
        100: "Request ma kaink khotu che — mota bhage media URL public nathi hotu.",
        4: "Meta ni rate limit lagi gai. Thodi var pachi try karo.",
        613: "Meta ni rate limit lagi gai. Thodi var pachi try karo.",
        368: "Aa account par temporary block che — thoda divas pachi try karo.",
    }
    hint = hints.get(code, "")

    parts = [f"Meta: {message}"]
    if hint:
        parts.append(hint)
    if code:
        parts.append(f"(code {code}{f'/{subcode}' if subcode else ''})")
    return " ".join(parts)


async def graph_request(
    path: str,
    params: dict[str, Any],
    *,
    method: str = "POST",
    timeout: float = 120.0,
) -> dict:
    """Graph API call. Error ne samjay evi bhasha ma badle che."""
    url = graph_url(path)
    client = get_client()

    clean = {k: str(v) for k, v in params.items() if v is not None and v != ""}

    if method.upper() == "GET":
        response = await client.get(url, params=clean, timeout=timeout)
    else:
        response = await client.post(url, data=clean, timeout=timeout)

    try:
        payload = response.json()
    except Exception:  # noqa: BLE001
        payload = {}

    error = (payload or {}).get("error")
    if response.status_code >= 400 or error:
        message = _explain(error or {}, response.status_code)
        code = (error or {}).get("code")

        # Rate limit ane server ni bhool — retry karva jevu.
        if response.status_code == 429 or response.status_code >= 500 or code in (4, 613, 17, 32):
            raise RetryableError(message)
        raise FatalError(message)

    return payload or {}


def require_public_url(url: str, what: str = "Media") -> None:
    """
    Meta ne public https URL joiye j — aa check pehla karvo saru che,
    nahi to Meta 10 minute pachi ek gothvai jaay evo error aape che.
    """
    if not url or not url.lower().startswith("https://"):
        raise UserError(
            f"{what} nu public https URL nathi.\n\n"
            "Meta na server tamari file DOWNLOAD kare che — etle localhost "
            "kyarey nahi chale.\n"
            "Upay (banne free):\n"
            "  • `ngrok http 8000` chalavo ane e https URL .env ma "
            "PUBLIC_MEDIA_BASE_URL ma nakho, athva\n"
            "  • kai j na karo — app Catbox par jate upload kari deshe "
            "(MEDIA_ALLOW_ANON_HOSTS=true hovu joiye)."
        )


async def app_access_token() -> str:
    """
    App ID + Secret barabar che ke nahi — aa j saacho test che.

    (`debug_token` kyarek "Cannot get application info due to a system
    error" aape che, e khoto sanket che.)
    """
    if not settings.meta_app_id or not settings.meta_app_secret:
        raise UserError(
            "META_APP_ID / META_APP_SECRET set nathi. "
            "developers.facebook.com/apps par app banavo (free) ane .env ma nakho."
        )

    payload = await graph_request(
        "/oauth/access_token",
        {
            "client_id": settings.meta_app_id,
            "client_secret": settings.meta_app_secret,
            "grant_type": "client_credentials",
        },
        method="GET",
        timeout=30.0,
    )

    token = payload.get("access_token")
    if not token:
        raise UserError("META_APP_ID ke META_APP_SECRET khoto che")
    return str(token)


async def debug_token(token: str) -> dict:
    """Token kona mate che, kyare puro thay che, kai permission che."""
    app_token = await app_access_token()
    payload = await graph_request(
        "/debug_token",
        {"input_token": token, "access_token": app_token},
        method="GET",
        timeout=30.0,
    )
    return payload.get("data") or {}


# ------------------------------------------------------------------ #
#  Comment ane DM
# ------------------------------------------------------------------ #


async def reply_to_comment(
    *,
    comment_id: str,
    access_token: str,
    message: str,
) -> dict:
    """
    Comment ni niche JAHER MA jawab aape.

    Instagram ane Facebook — banne mate ek j endpoint chale che.
    """
    return await graph_request(
        f"/{comment_id}/replies",
        {"message": message[:2200], "access_token": access_token},
    )


async def send_facebook_private_reply(
    *,
    comment_id: str,
    access_token: str,
    message: str,
) -> dict:
    """
    Facebook: comment karnar ne Messenger ma KHANGI jawab.

    ⚠️ META NI LIMIT: ek comment par FAKT EK private reply, ane comment
    thaya na 7 divas ni andar. Bija prayatne Meta error aape che — etle
    `autodm.py` dareak comment no hisab rakhe che.
    """
    return await graph_request(
        f"/{comment_id}/private_replies",
        {"message": message[:2000], "access_token": access_token},
    )


async def send_instagram_dm(
    *,
    ig_user_id: str,
    access_token: str,
    comment_id: str,
    message: str,
) -> dict:
    """
    Instagram: comment karnar ne DM.

    ⚠️ Aa endpoint JSON mange che (form-data nahi), etle `graph_request`
    nathi vaparta. `instagram_manage_messages` permission joiye che.
    """
    import json as jsonlib

    client = get_client()
    response = await client.post(
        graph_url(f"/{ig_user_id}/messages"),
        headers={"content-type": "application/json"},
        content=jsonlib.dumps(
            {
                "recipient": {"comment_id": comment_id},
                "message": {"text": message[:1000]},
                "access_token": access_token,
            }
        ),
        timeout=60.0,
    )

    try:
        payload = response.json()
    except Exception:  # noqa: BLE001
        payload = {}

    error = (payload or {}).get("error")
    if response.status_code >= 400 or error:
        message_text = _explain(error or {}, response.status_code)
        if response.status_code == 429 or response.status_code >= 500:
            raise RetryableError(message_text)
        raise FatalError(message_text)

    return payload or {}


async def subscribe_page_webhooks(*, page_id: str, access_token: str) -> dict:
    """
    Meta ne kaho ke aa Page na comments/messages na updates aapna webhook
    par moklo. Aa EK J VAAR karvanu hoy che (account jodo tyare).

    Aa vagar auto-DM kadi nahi chale — Meta ne khabar j nahi pade ke
    aapne updates joie chie.
    """
    return await graph_request(
        f"/{page_id}/subscribed_apps",
        {
            "subscribed_fields": "feed,mention,messages,messaging_postbacks,comments",
            "access_token": access_token,
        },
    )
