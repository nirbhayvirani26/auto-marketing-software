"""
"Connect with Facebook" — account jodvanu.

User ek j var Facebook par login kare che, ane aapne emna badha Page ane
enathi jodayela Instagram Business account lai laiye chie. Pachi dareak
Page no LONG-LIVED token (60 divas) sachvie chie.

⚠️ Meta app ma aa EXACT redirect URI nakhvu pade:
     <APP_URL>/api/oauth/meta/callback
   (dakhla tarike: http://localhost:8000/api/oauth/meta/callback)
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

from ..config import settings
from ..errors import UserError
from .graph import graph_request

#: Reel + post + comment + DM — badhu karva mate joiti permission.
SCOPES = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "pages_manage_engagement",
    "business_management",
    "instagram_basic",
    "instagram_content_publish",
    "instagram_manage_comments",
    "instagram_manage_insights",
]


@dataclass
class ConnectedAccount:
    platform: str  # "facebook" | "instagram"
    external_id: str
    display_name: str
    access_token: str
    page_id: str = ""
    ig_user_id: str = ""
    avatar_url: str = ""
    username: str = ""


def login_url(state: str) -> str:
    """User ne Facebook par mokalvano URL."""
    if not settings.meta_app_id:
        raise UserError(
            "META_APP_ID set nathi. developers.facebook.com/apps par app banavo "
            "(free) ane .env ma META_APP_ID + META_APP_SECRET nakho."
        )

    query = urlencode(
        {
            "client_id": settings.meta_app_id,
            "redirect_uri": settings.meta_redirect_uri,
            "state": state,
            "scope": ",".join(SCOPES),
            "response_type": "code",
        }
    )
    return f"https://www.facebook.com/{settings.meta_graph_version}/dialog/oauth?{query}"


def new_state() -> str:
    return secrets.token_urlsafe(24)


async def exchange_code(code: str) -> str:
    """Callback no code → short-lived user token."""
    payload = await graph_request(
        "/oauth/access_token",
        {
            "client_id": settings.meta_app_id,
            "client_secret": settings.meta_app_secret,
            "redirect_uri": settings.meta_redirect_uri,
            "code": code,
        },
        method="GET",
        timeout=60.0,
    )
    token = payload.get("access_token")
    if not token:
        raise UserError("Facebook e token na aapyu — fari try karo.")
    return str(token)


async def long_lived_token(short_token: str) -> str:
    """Short-lived (1 kalak) → long-lived (60 divas)."""
    payload = await graph_request(
        "/oauth/access_token",
        {
            "grant_type": "fb_exchange_token",
            "client_id": settings.meta_app_id,
            "client_secret": settings.meta_app_secret,
            "fb_exchange_token": short_token,
        },
        method="GET",
        timeout=60.0,
    )
    return str(payload.get("access_token") or short_token)


async def list_accounts(user_token: str) -> list[ConnectedAccount]:
    """
    User na badha Page ane emna Instagram Business account.

    Page no token pan sathe j aave che — e j token thi post thay che ane
    e expire NATHI thato (jya sudhi user permission na kaadhe).
    """
    payload = await graph_request(
        "/me/accounts",
        {
            "fields": (
                "id,name,access_token,picture{url},"
                "instagram_business_account{id,username,name,profile_picture_url}"
            ),
            "limit": "100",
            "access_token": user_token,
        },
        method="GET",
        timeout=60.0,
    )

    accounts: list[ConnectedAccount] = []

    for page in payload.get("data") or []:
        page_id = str(page.get("id") or "")
        page_token = str(page.get("access_token") or "")
        if not page_id or not page_token:
            continue

        accounts.append(
            ConnectedAccount(
                platform="facebook",
                external_id=page_id,
                display_name=str(page.get("name") or f"Page {page_id}"),
                access_token=page_token,
                page_id=page_id,
                avatar_url=str(((page.get("picture") or {}).get("data") or {}).get("url") or ""),
            )
        )

        ig = page.get("instagram_business_account") or {}
        ig_id = str(ig.get("id") or "")
        if ig_id:
            accounts.append(
                ConnectedAccount(
                    platform="instagram",
                    external_id=ig_id,
                    display_name=str(ig.get("username") or ig.get("name") or f"IG {ig_id}"),
                    # IG pan PAGE na token thi j chale che.
                    access_token=page_token,
                    page_id=page_id,
                    ig_user_id=ig_id,
                    username=str(ig.get("username") or ""),
                    avatar_url=str(ig.get("profile_picture_url") or ""),
                )
            )

    return accounts


async def subscribe_webhooks(*, page_id: str, access_token: str) -> bool:
    """
    Meta ne kaho ke aa Page na comment/message na updates aapna webhook
    par moklo. Ek j vaar karvanu hoy che (account connect thay tyare).
    """
    try:
        result = await graph_request(
            f"/{page_id}/subscribed_apps",
            {
                "subscribed_fields": "feed,mention,messages,messaging_postbacks",
                "access_token": access_token,
            },
        )
        return bool(result.get("success"))
    except Exception:  # noqa: BLE001 — webhook optional che
        return False


def setup_help() -> dict:
    """Setup page mate — su karvanu che e step by step."""
    return {
        "redirect_uri": settings.meta_redirect_uri,
        "scopes": SCOPES,
        "steps": [
            "developers.facebook.com/apps par javo ane 'Create App' → 'Business' pasand karo (free).",
            "App ma 'Facebook Login' product add karo.",
            "Facebook Login → Settings → 'Valid OAuth Redirect URIs' ma AA EXACT URL nakho: "
            + settings.meta_redirect_uri,
            "App ma 'Instagram Graph API' product pan add karo.",
            "Settings → Basic ma thi App ID ane App Secret copy karine .env ma nakho.",
            "Tamaru Instagram account BUSINESS ke CREATOR hovu joiye, ane ek Facebook Page "
            "sathe jodayelu hovu joiye. (Instagram app → Settings → Account type)",
            "App 'Development' mode ma hoy to fakt tame (app na admin/tester) j vapri shako "
            "— tamari potani brand mate e puratu che.",
        ],
    }
