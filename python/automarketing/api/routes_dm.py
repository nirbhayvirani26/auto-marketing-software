"""
Auto DM na routes + Meta no webhook.

Do bhaag:
  1. `/api/dm-rules` — kaya comment par su karvu e rules (UI mate)
  2. `/api/webhooks/meta` — Meta ahiya comment ni khabar mokle che

⚠️ Webhook ne PUBLIC https URL joiye che. `localhost` par Meta pahonchi
   shakatu nathi. `ngrok http 8000` chalavo ane e URL Meta na app ma
   nakho — `/api/webhooks/meta`.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..config import env, settings
from ..db import accounts as accounts_collection
from ..db import connect
from ..logs import log_activity
from ..social.autodm import (
    DEFAULT_RULE,
    delete_rule,
    ensure_indexes,
    handle_comment,
    list_rules,
    save_rule,
)
from .deps import current_brand, fail, ok

router = APIRouter(prefix="/api", tags=["auto-dm"])


# ------------------------------------------------------------------ #
#  Rules (UI)
# ------------------------------------------------------------------ #


class RuleBody(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    #: Comment ma aa shabd hoy to rule chale. Khali = BADHA comment par.
    keywords: Optional[list[str]] = None
    product_id: Optional[str] = None
    reply_publicly: Optional[bool] = None
    send_dm: Optional[bool] = None
    instruction: Optional[str] = None
    language: Optional[str] = None


@router.get("/dm-rules")
async def get_rules(brand: dict = Depends(current_brand)):
    await ensure_indexes()
    rules = await list_rules(str(brand["_id"]))
    return ok({"rules": rules, "defaults": DEFAULT_RULE})


@router.post("/dm-rules")
async def create_rule(body: RuleBody, brand: dict = Depends(current_brand)):
    await ensure_indexes()
    return ok(await save_rule(str(brand["_id"]), body.model_dump()), 201)


@router.patch("/dm-rules/{rule_id}")
async def update_rule(rule_id: str, body: RuleBody, brand: dict = Depends(current_brand)):
    return ok(await save_rule(str(brand["_id"]), body.model_dump(), rule_id=rule_id))


@router.delete("/dm-rules/{rule_id}")
async def remove_rule(rule_id: str, brand: dict = Depends(current_brand)):
    if not await delete_rule(str(brand["_id"]), rule_id):
        return fail("Rule madyu nahi", 404)
    return ok({"deleted": True})


# ------------------------------------------------------------------ #
#  Meta webhook
# ------------------------------------------------------------------ #


@router.get("/webhooks/meta")
async def verify_webhook(request: Request):
    """
    Meta pehli var webhook set karo tyare aa GET mokle che.

    `hub.challenge` ne jem nu tem pachu moklvanu — nahi to Meta webhook
    save j nahi kare.
    """
    params = request.query_params
    expected = env("META_WEBHOOK_VERIFY_TOKEN")

    if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == expected:
        return PlainTextResponse(params.get("hub.challenge", ""))

    return PlainTextResponse("Verify token khoto che", status_code=403)


def _signature_ok(body: bytes, header: str) -> bool:
    """
    Aa request kharekhar Meta e mokli che?

    App Secret thi signature check karie chie. Aa vagar koi pan aapna
    webhook par nakli comment mokli ne aapna AI na tokens vaapri shake.
    """
    secret = settings.meta_app_secret
    if not secret or not header:
        return False

    algorithm, _, provided = header.partition("=")
    if algorithm != "sha256" or not provided:
        return False

    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


def _extract_comments(payload: dict) -> list[dict]:
    """
    Meta na webhook mathi comment kaadhe.

    Instagram ane Facebook nu format ALAG che, etle banne sambhalie chie.
    """
    found: list[dict] = []

    for entry in payload.get("entry") or []:
        entry_id = str(entry.get("id") or "")

        # ---- Instagram ----
        for change in entry.get("changes") or []:
            field = change.get("field")
            value = change.get("value") or {}

            if field == "comments":
                found.append(
                    {
                        "platform": "instagram",
                        "account_external_id": entry_id,
                        "comment_id": str(value.get("id") or ""),
                        "text": str(value.get("text") or ""),
                        "username": str((value.get("from") or {}).get("username") or ""),
                        "post_id": str((value.get("media") or {}).get("id") or ""),
                    }
                )

            # ---- Facebook Page feed ----
            elif field == "feed" and value.get("item") == "comment":
                # `verb: add` sivay (edit/remove) ne chhodi daiye chie.
                if value.get("verb") != "add":
                    continue
                found.append(
                    {
                        "platform": "facebook",
                        "account_external_id": entry_id,
                        "comment_id": str(value.get("comment_id") or ""),
                        "text": str(value.get("message") or ""),
                        "username": str((value.get("from") or {}).get("name") or ""),
                        "post_id": str(value.get("post_id") or ""),
                    }
                )

    # Khali comment (fakt sticker/photo) ne chhodi do — AI ne aapva jevu
    # kai j nathi.
    return [c for c in found if c["comment_id"] and c["text"].strip()]


@router.post("/webhooks/meta")
async def receive_webhook(request: Request):
    """
    Meta ahiya comment ni khabar mokle che.

    ⚠️ HAMESHA 200 pachu aapvu. Error aapie to Meta vaar var e j event
    fari mokle che, ane ghana prayatna pachi webhook BAND kari de che.
    Etle andar ni bhool log ma jaay che, response ma nahi.
    """
    body = await request.body()
    signature = request.headers.get("x-hub-signature-256", "")

    if not _signature_ok(body, signature):
        await log_activity(
            level="warning",
            action="webhook.meta",
            message="Khoti signature vali webhook request aavi — chhodi didhi",
        )
        return ok({"ignored": "signature"})

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return ok({"ignored": "json nathi"})

    comments = _extract_comments(payload)
    if not comments:
        return ok({"comments": 0})

    await connect()
    results = []

    for comment in comments:
        try:
            # Kayu account? Meta `entry.id` ma page/IG account id aape che.
            account = await accounts_collection().find_one(
                {"external_id": comment["account_external_id"]}
            )
            if not account:
                results.append({"comment_id": comment["comment_id"], "skipped": "account madyu nahi"})
                continue

            # Potana j comment par jawab na aapo — nahi to lup thai jaay.
            if comment["username"] and comment["username"].lower() in (
                str(account.get("username") or "").lower(),
                str(account.get("display_name") or "").lower(),
            ):
                results.append({"comment_id": comment["comment_id"], "skipped": "potano comment"})
                continue

            results.append(
                await handle_comment(
                    brand_id=str(account["brand_id"]),
                    comment_id=comment["comment_id"],
                    comment=comment["text"],
                    username=comment["username"],
                    platform=comment["platform"],
                    account=account,
                    post_id=comment["post_id"],
                )
            )
        except Exception as error:  # noqa: BLE001 — ek fail thay to bija atke nahi
            await log_activity(
                level="error",
                action="webhook.meta",
                message=f"Comment sambhali na shakaya: {error}",
            )
            results.append({"comment_id": comment.get("comment_id"), "error": str(error)[:200]})

    return ok({"comments": len(comments), "results": results})


# ------------------------------------------------------------------ #
#  Test — webhook vagar
# ------------------------------------------------------------------ #


class TestBody(BaseModel):
    comment: str
    username: str = "test_user"
    platform: str = "instagram"
    #: true = kharekhar DM moklo. false = fakt jawab batavo (default).
    send: bool = False


@router.post("/dm-rules/test")
async def test_rule(body: TestBody, brand: dict = Depends(current_brand)):
    """
    Rule barabar chale che ke nahi — SACHU DM moklya vagar tapaso.

    Aa bahu kaam nu che: Instagram par sachu test karvu hoy to koi e
    kharekhar comment karvo pade, ane ek comment par ek j DM jaay che.
    Etle ahiya "sukku" test kari laiye chie.
    """
    from ..products.store import get_product, products as products_collection
    from ..social.autodm import find_rule, write_reply

    brand_id = str(brand["_id"])
    rule = await find_rule(brand_id, body.comment)

    if not rule:
        return ok(
            {
                "matched": False,
                "message": (
                    "Aa comment koi rule sathe na besyo — kai nahi thay.\n"
                    "Rule na keywords ma aa shabd umero, ke keywords khali "
                    "rakho (etle BADHA comment par chale)."
                ),
            }
        )

    product = None
    if rule.get("product_id"):
        product = await get_product(rule["product_id"], brand_id)
    if not product:
        await connect()
        product = await products_collection().find_one(
            {"brand_id": brand_id}, sort=[("created_at", -1)]
        )

    written = await write_reply(
        comment=body.comment,
        username=body.username,
        platform=body.platform,
        product=product,
        instruction=rule.get("instruction", ""),
        language=rule.get("language", "en"),
    )

    link = (product or {}).get("url", "")
    dm = written["dm"]
    if link and link not in dm:
        dm = f"{dm}\n\n🔗 {link}".strip()

    return ok(
        {
            "matched": True,
            "rule": rule.get("name"),
            "product": (product or {}).get("title"),
            "public_reply": written["public_reply"] if rule.get("reply_publicly") else "",
            "dm": dm if rule.get("send_dm") else "",
            "note": "Aa fakt tapas che — kai kharekhar moklayu nathi.",
        }
    )
