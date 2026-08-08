"""
Social accounts — "Connect with Facebook", avatars, ane media serve.
"""

from __future__ import annotations

import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

from ..ai.base import VisionRequest
from ..ai.schemas import AVATAR_DESCRIPTION
from ..ai.vision import ask_vision
from ..db import accounts as accounts_collection
from ..db import avatars as avatars_collection
from ..db import connect
from ..db import media as media_collection
from ..logs import log_activity
from ..media.store import read_bytes
from ..social import oauth
from ..social.graph import debug_token
from .deps import current_brand, current_user, fail, ok

router = APIRouter(prefix="/api", tags=["accounts"])

#: OAuth state — CSRF thi rakshan. Server restart thay to khovai jaay,
#: pan e thodi j vaar nu hoy che.
_oauth_states: dict[str, float] = {}


# ------------------------------------------------------------------ #
#  Media serve — Meta ne aapva mate
# ------------------------------------------------------------------ #


@router.get("/media/{asset_id}")
@router.head("/media/{asset_id}")
async def serve_media(asset_id: str, request: Request):
    """
    Media bahar aapvanu route.

    ⚠️ Aa route JAANI JOINE public che (koi login nahi). Karan ke META NA
    SERVER aa file download kare che — emni pase aapnu cookie na hoy.
    Id random ObjectId che etle andaji ne kadhi shakay nahi.

    Range request support farjiyat che — video mate Meta ane browser
    banne partial request mokle che.
    """
    try:
        oid = ObjectId(asset_id)
    except Exception:  # noqa: BLE001
        return Response("Not found", status_code=404)

    await connect()
    asset = await media_collection().find_one({"_id": oid})
    if not asset:
        return Response("Not found", status_code=404)

    local = asset.get("local_path")
    if not local or not Path(local).exists():
        # Local file gum thai gai pan public URL che — tya moklo.
        if asset.get("public_url"):
            return RedirectResponse(asset["public_url"], status_code=302)
        return Response("Not found", status_code=404)

    media_type = asset.get("mime_type") or mimetypes.guess_type(local)[0] or "application/octet-stream"

    # FileResponse jate j Range, ETag ane Content-Length sambhale che.
    return FileResponse(
        local,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Accept-Ranges": "bytes",
        },
    )


# ------------------------------------------------------------------ #
#  Accounts
# ------------------------------------------------------------------ #


def _account_view(account: dict) -> dict:
    return {
        "id": str(account["_id"]),
        "platform": account.get("platform"),
        "display_name": account.get("display_name"),
        "username": account.get("username"),
        "avatar_url": account.get("avatar_url"),
        "status": account.get("status"),
        "page_id": account.get("page_id"),
        "ig_user_id": account.get("ig_user_id"),
        "last_error": account.get("last_error"),
        "connected_at": account.get("created_at"),
    }


@router.get("/accounts")
async def list_accounts(brand: dict = Depends(current_brand)):
    await connect()
    accounts = [
        doc
        async for doc in accounts_collection()
        .find({"brand_id": str(brand["_id"])})
        .sort("platform", 1)
    ]
    return ok([_account_view(a) for a in accounts])


@router.delete("/accounts/{account_id}")
async def remove_account(account_id: str, brand: dict = Depends(current_brand)):
    await connect()
    result = await accounts_collection().delete_one(
        {"_id": ObjectId(account_id), "brand_id": str(brand["_id"])}
    )
    if not result.deleted_count:
        return fail("Account madyu nahi", 404)
    return ok({"deleted": True})


@router.get("/accounts/{account_id}/check")
async def check_account(account_id: str, brand: dict = Depends(current_brand)):
    """Token hju chale che? Kyare puro thashe?"""
    await connect()
    account = await accounts_collection().find_one(
        {"_id": ObjectId(account_id), "brand_id": str(brand["_id"])}
    )
    if not account:
        return fail("Account madyu nahi", 404)

    try:
        info = await debug_token(account.get("access_token", ""))
        valid = bool(info.get("is_valid"))
        expires = info.get("expires_at")

        await accounts_collection().update_one(
            {"_id": account["_id"]},
            {
                "$set": {
                    "status": "connected" if valid else "error",
                    "last_error": None if valid else "Token kaam nathi karto",
                }
            },
        )

        return ok(
            {
                "valid": valid,
                "expires_at": (
                    datetime.fromtimestamp(expires, tz=timezone.utc).isoformat()
                    if expires
                    else "kadi nahi (page token)"
                ),
                "scopes": info.get("scopes") or [],
            }
        )
    except Exception as error:  # noqa: BLE001
        return fail(str(error), 502)


# ------------------------------------------------------------------ #
#  Meta OAuth
# ------------------------------------------------------------------ #


@router.get("/oauth/meta/help")
async def oauth_help(user: dict = Depends(current_user)):
    """Meta app kai rite set karvo — step by step."""
    return ok(oauth.setup_help())


@router.get("/oauth/meta/start")
async def oauth_start(user: dict = Depends(current_user)):
    """User ne Facebook par mokalo."""
    import time

    state = oauth.new_state()
    _oauth_states[state] = time.time()

    # Juna state saaf karo (10 minute).
    for key, created in list(_oauth_states.items()):
        if time.time() - created > 600:
            _oauth_states.pop(key, None)

    return RedirectResponse(oauth.login_url(state), status_code=302)


@router.get("/oauth/meta/callback")
async def oauth_callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
):
    """
    Facebook par thi pacha aavya pachi — badha Page ane IG account save karo.

    Aa route login vagar chale che (Facebook ahiya redirect kare che),
    pan `state` thi khatri karie chie ke aa aapno j request che.
    """
    if error:
        return RedirectResponse(
            f"/?connected=error&message={error_description or error}", status_code=302
        )

    if not state or state not in _oauth_states:
        return RedirectResponse(
            "/?connected=error&message=Session%20juni%20thai%20gai%20—%20fari%20try%20karo",
            status_code=302,
        )
    _oauth_states.pop(state, None)

    if not code:
        return RedirectResponse("/?connected=error&message=Code%20na%20madyo", status_code=302)

    try:
        from .auth import default_brand

        brand = await default_brand()
        brand_id = str(brand["_id"])

        short = await oauth.exchange_code(code)
        long_lived = await oauth.long_lived_token(short)
        connected = await oauth.list_accounts(long_lived)

        if not connected:
            return RedirectResponse(
                "/?connected=error&message=" +
                "Ek%20pan%20Facebook%20Page%20na%20madyu.%20Page%20banavo%20ane%20"
                "Instagram%20ne%20Business%20account%20banavi%20ne%20e%20Page%20sathe%20jodo.",
                status_code=302,
            )

        await connect()
        saved = 0
        for account in connected:
            await accounts_collection().update_one(
                {"brand_id": brand_id, "external_id": account.external_id},
                {
                    "$set": {
                        "brand_id": brand_id,
                        "platform": account.platform,
                        "external_id": account.external_id,
                        "display_name": account.display_name,
                        "username": account.username,
                        "access_token": account.access_token,
                        "page_id": account.page_id,
                        "ig_user_id": account.ig_user_id,
                        "avatar_url": account.avatar_url,
                        "status": "connected",
                        "last_error": None,
                        "updated_at": datetime.now(timezone.utc),
                    },
                    "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
                },
                upsert=True,
            )
            saved += 1

            if account.platform == "facebook":
                await oauth.subscribe_webhooks(
                    page_id=account.page_id, access_token=account.access_token
                )

        await log_activity(
            level="success",
            action="account.connected",
            message=f"{saved} account jodaya",
            brand_id=brand_id,
        )

        return RedirectResponse(f"/?connected=ok&count={saved}", status_code=302)

    except Exception as err:  # noqa: BLE001
        from urllib.parse import quote

        return RedirectResponse(
            f"/?connected=error&message={quote(str(err)[:300])}", status_code=302
        )


# ------------------------------------------------------------------ #
#  Avatars
# ------------------------------------------------------------------ #


class AvatarBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    photo_ids: list[str] = Field(min_length=1, max_length=5)
    description: str = ""
    gender: str = "unspecified"
    age_range: str = ""
    skin_tone: str = ""
    hair: str = ""
    body_type: str = ""
    persona: str = "friendly, confident, warm"
    language: str = "en"
    wardrobe_notes: str = ""
    is_default: bool = False
    auto_describe: bool = True


def _avatar_view(avatar: dict) -> dict:
    return {
        "id": str(avatar["_id"]),
        "name": avatar.get("name"),
        "description": avatar.get("description"),
        "gender": avatar.get("gender"),
        "age_range": avatar.get("age_range"),
        "language": avatar.get("language"),
        "persona": avatar.get("persona"),
        "wardrobe_notes": avatar.get("wardrobe_notes"),
        "is_default": avatar.get("is_default", False),
        "photo_urls": [f"/api/media/{p}" for p in (avatar.get("photo_ids") or [])],
        "primary_photo_url": (
            f"/api/media/{avatar['primary_photo_id']}" if avatar.get("primary_photo_id") else None
        ),
    }


@router.get("/avatars")
async def list_avatars(brand: dict = Depends(current_brand)):
    await connect()
    rows = [
        doc
        async for doc in avatars_collection()
        .find({"brand_id": str(brand["_id"]), "active": True})
        .sort([("is_default", -1), ("created_at", -1)])
    ]
    return ok([_avatar_view(a) for a in rows])


@router.post("/avatars")
async def create_avatar(
    body: AvatarBody,
    user: dict = Depends(current_user),
    brand: dict = Depends(current_brand),
):
    """
    Avatar banavo.

    `auto_describe` chalu hoy to photo joine AI j varnan bhari de che —
    user e fakt naam ane photo aapvana. Aa varnan pachi DAREAK reel ni
    image generation ma jaay che, etle chehro badhi reels ma sarkho rahe.
    """
    await connect()
    brand_id = str(brand["_id"])

    photos = [
        doc
        async for doc in media_collection().find(
            {
                "_id": {"$in": [ObjectId(p) for p in body.photo_ids]},
                "brand_id": brand_id,
                "kind": "image",
            }
        )
    ]
    if not photos:
        return fail("Avatar mate ochha ma ochho ek photo joiye", 422)

    described: dict[str, Any] = {}
    describe_error = ""

    if body.auto_describe and not body.description:
        try:
            buffers = [await read_bytes(p) for p in photos[:3]]
            result = await ask_vision(
                buffers,
                VisionRequest(
                    system=(
                        "You describe a person's appearance so an image model can recreate "
                        "them consistently. Be factual and neutral. Never guess a name, "
                        "ethnicity label, or anything not visible."
                    ),
                    prompt=(
                        "Describe the person in these photos so they can be redrawn "
                        "consistently across many images."
                    ),
                    schema=AVATAR_DESCRIPTION,
                    max_tokens=1200,
                ),
            )
            described = result.data if isinstance(result.data, dict) else {}
        except Exception as error:  # noqa: BLE001
            describe_error = str(error)[:400]

    if body.is_default:
        await avatars_collection().update_many(
            {"brand_id": brand_id}, {"$set": {"is_default": False}}
        )

    existing_count = await avatars_collection().count_documents({"brand_id": brand_id})

    document = {
        "_id": ObjectId(),
        "brand_id": brand_id,
        "name": body.name,
        "description": body.description or described.get("description", ""),
        "photo_ids": [p["_id"] for p in photos],
        "primary_photo_id": photos[0]["_id"],
        "gender": body.gender if body.gender != "unspecified" else described.get("gender", "unspecified"),
        "age_range": body.age_range or described.get("ageRange", ""),
        "skin_tone": body.skin_tone or described.get("skinTone", ""),
        "hair": body.hair or described.get("hair", ""),
        "body_type": body.body_type or described.get("bodyType", ""),
        "persona": body.persona,
        "language": body.language,
        "wardrobe_notes": body.wardrobe_notes,
        # Pehlo avatar apoaap default bane che.
        "is_default": body.is_default or existing_count == 0,
        "active": True,
        "created_by": str(user["_id"]),
        "created_at": datetime.now(timezone.utc),
    }
    await avatars_collection().insert_one(document)

    return ok({"avatar": _avatar_view(document), "describe_error": describe_error}, 201)


@router.post("/avatars/{avatar_id}/default")
async def make_default(avatar_id: str, brand: dict = Depends(current_brand)):
    await connect()
    brand_id = str(brand["_id"])
    await avatars_collection().update_many({"brand_id": brand_id}, {"$set": {"is_default": False}})
    result = await avatars_collection().update_one(
        {"_id": ObjectId(avatar_id), "brand_id": brand_id}, {"$set": {"is_default": True}}
    )
    if not result.matched_count:
        return fail("Avatar madyo nahi", 404)
    return ok({"updated": True})


@router.delete("/avatars/{avatar_id}")
async def delete_avatar(avatar_id: str, brand: dict = Depends(current_brand)):
    await connect()
    result = await avatars_collection().update_one(
        {"_id": ObjectId(avatar_id), "brand_id": str(brand["_id"])},
        {"$set": {"active": False, "is_default": False}},
    )
    if not result.matched_count:
        return fail("Avatar madyo nahi", 404)
    return ok({"deleted": True})
