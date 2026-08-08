"""
Auto DM — koi comment kare etle apoaap jawab ane product ni LINK nu DM.

Aa sauthi vadhu vechan aapto rasto che: koi "price?" ke "link" lakhe,
ane 5 second ma ene DM ma product ni link mali jaay. Manas jate karvа
jaay to 2 kalak thai jaay, ane tya sudhi kharidnaru jato rahe.

KAI RITE CHALE CHE:
  1. Meta webhook mokle che ke koi e comment karyu
  2. Aapne jouie chie ke aa comment koi rule sathe bese che ke nahi
  3. AI jawab lakhe che (comment vanchi ne — "kitla nu?" ane "size?" na
     jawab alag hoy)
  4. Public reply + DM ma product ni link

⚠️ META NI BE MOTI LIMIT (aa aapna code ni nahi, Meta ni che):
   • Facebook: EK comment par FAKT EK private reply, ane comment thaya
     na 7 divas ni andar.
   • Instagram: DM mokalva `instagram_manage_messages` permission joiye,
     ane comment na 7 divas ni andar j.
   Etle dareak comment no hisab rakhie chie — be var DM na jaay.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from ..ai import CompletionRequest, complete
from ..db import connect, get_db
from ..logs import log_activity

RULES = "dm_rules"
HANDLED = "dm_handled"


def rules():
    return get_db()[RULES]


def handled():
    return get_db()[HANDLED]


def now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ #
#  Rules
# ------------------------------------------------------------------ #

DEFAULT_RULE = {
    "name": "Link magnara ne DM",
    "enabled": True,
    #: Comment ma aa ma thi koi shabd hoy to rule chale. Khali = BADHA
    #: comment par chale.
    "keywords": ["price", "link", "cost", "buy", "order", "dm", "kitna", "kitla", "bhav"],
    #: Kayo product ni link moklvi. Khali = post sathe jodayelo product.
    "product_id": "",
    "reply_publicly": True,
    "send_dm": True,
    #: AI ne vadharani suchna.
    "instruction": "",
}


async def list_rules(brand_id: str) -> list[dict]:
    await connect()
    return [
        {**doc, "_id": str(doc["_id"])}
        async for doc in rules().find({"brand_id": brand_id}).sort("created_at", -1)
    ]


async def save_rule(brand_id: str, data: dict, rule_id: Optional[str] = None) -> dict:
    await connect()
    from bson import ObjectId

    document = {**DEFAULT_RULE, **{k: v for k, v in data.items() if v is not None}}
    document["brand_id"] = brand_id
    document["keywords"] = [
        str(k).strip().lower() for k in (document.get("keywords") or []) if str(k).strip()
    ]
    document["updated_at"] = now()
    document.pop("_id", None)

    if rule_id:
        await rules().update_one(
            {"_id": ObjectId(rule_id), "brand_id": brand_id}, {"$set": document}
        )
        saved = await rules().find_one({"_id": ObjectId(rule_id)})
    else:
        document["created_at"] = now()
        result = await rules().insert_one(document)
        saved = await rules().find_one({"_id": result.inserted_id})

    return {**saved, "_id": str(saved["_id"])}


async def delete_rule(brand_id: str, rule_id: str) -> bool:
    await connect()
    from bson import ObjectId

    result = await rules().delete_one({"_id": ObjectId(rule_id), "brand_id": brand_id})
    return result.deleted_count > 0


def _matches(rule: dict, comment: str) -> bool:
    keywords = rule.get("keywords") or []
    if not keywords:
        return True  # khali = badha comment par
    text = comment.lower()
    # Shabd ni andar na male — "price" ne "priceless" ma na gano.
    return any(re.search(rf"\b{re.escape(k)}", text) for k in keywords)


async def find_rule(brand_id: str, comment: str) -> Optional[dict]:
    for rule in await list_rules(brand_id):
        if rule.get("enabled") and _matches(rule, comment):
            return rule
    return None


# ------------------------------------------------------------------ #
#  Jawab lakhvo
# ------------------------------------------------------------------ #

REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "public_reply": {
            "type": "string",
            "description": "Short public reply under the comment. One or two sentences. Warm and specific to what they asked. No hashtags. Empty string if not needed.",
        },
        "dm": {
            "type": "string",
            "description": "Direct message to send privately. Friendly and specific. The product link is appended automatically — do NOT write the URL yourself. No hashtags.",
        },
    },
    "required": ["public_reply", "dm"],
}


async def write_reply(
    *,
    comment: str,
    username: str = "",
    platform: str = "instagram",
    product: Optional[dict] = None,
    instruction: str = "",
    language: str = "en",
) -> dict:
    """AI pase comment no jawab lakhavo."""
    language_rule = {
        "en": "Write in clear, simple English.",
        "hi": "Write in Hindi (Devanagari script).",
        "gu": "Write in Gujarati script.",
        "hinglish": "Write in Hinglish — Hindi words in Latin script mixed with English.",
    }.get(language, "Write in clear, simple English.")

    system = " ".join(
        [
            "You reply to comments on a brand's social media posts.",
            "Write like a real person on the brand's social team — warm, brief,",
            "and specific to what the commenter actually said.",
            language_rule,
            "Never invent prices, stock levels, delivery dates, discounts or policies",
            "you were not told.",
            "If the comment is hostile or a complaint, stay calm, do not argue, and",
            "offer to help privately.",
            "No hashtags. No emoji spam. Do not repeat their words back verbatim.",
        ]
    )

    lines = [
        f"Platform: {platform}",
        f"Commenter: {username}" if username else "",
        f'Comment: "{comment}"',
        "",
    ]

    if product:
        lines += [
            "The DM will promote this product. Use ONLY these facts:",
            f"• Product: {product.get('title')}",
            f"• Price: {product.get('price_text')}" if product.get("price_text") else "",
            f"• Details: {(product.get('description') or '')[:400]}"
            if product.get("description")
            else "",
            "",
            "The product link is appended automatically after your text — do not write the URL.",
        ]

    if instruction:
        lines.append(f"Brand instruction: {instruction}")

    result = await complete(
        CompletionRequest(
            system=system,
            prompt="\n".join(line for line in lines if line),
            schema=REPLY_SCHEMA,
            max_tokens=800,
        )
    )

    data = result.data if isinstance(result.data, dict) else {}
    return {
        "public_reply": str(data.get("public_reply") or "").strip(),
        "dm": str(data.get("dm") or "").strip(),
    }


# ------------------------------------------------------------------ #
#  Ek comment sambhalvo
# ------------------------------------------------------------------ #


async def already_handled(comment_id: str) -> bool:
    """
    Aa comment pehla sambhali lidho che?

    Meta EK J webhook ne be-traan var mokle che (retry). Guard vagar
    user ne be-traan DM jaay — ane Facebook to bija DM par error j aape.
    """
    await connect()
    return await handled().find_one({"comment_id": comment_id}) is not None


async def mark_handled(comment_id: str, meta: Optional[dict] = None) -> None:
    await connect()
    await handled().update_one(
        {"comment_id": comment_id},
        {"$set": {"comment_id": comment_id, "at": now(), **(meta or {})}},
        upsert=True,
    )


async def handle_comment(
    *,
    brand_id: str,
    comment_id: str,
    comment: str,
    username: str,
    platform: str,
    account: dict,
    post_id: str = "",
) -> dict:
    """
    Ek comment par: rule shodho → jawab lakho → reply + DM moklo.

    Koi pan pagle fail thay to BAKI NU atkatu nathi — public reply na
    jaay to pan DM to jaay j.
    """
    from ..products.store import get_product, products as products_collection

    result: dict[str, Any] = {"comment_id": comment_id, "actions": [], "skipped": None}

    if await already_handled(comment_id):
        result["skipped"] = "pehla thi sambhali lidho"
        return result

    rule = await find_rule(brand_id, comment)
    if not rule:
        result["skipped"] = "koi rule na besyo"
        await mark_handled(comment_id, {"skipped": "no-rule"})
        return result

    # ---- Kayo product ----
    product = None
    if rule.get("product_id"):
        product = await get_product(rule["product_id"], brand_id)
    if not product and post_id:
        # Post sathe jodayelo product shodho.
        post = await get_db()["posts"].find_one({"external_post_id": post_id})
        if post and post.get("product_id"):
            product = await get_product(post["product_id"], brand_id)
    if not product:
        # Chhelli aasha — sauthi navu product.
        await connect()
        product = await products_collection().find_one(
            {"brand_id": brand_id}, sort=[("created_at", -1)]
        )

    # ---- Jawab lakho ----
    try:
        written = await write_reply(
            comment=comment,
            username=username,
            platform=platform,
            product=product,
            instruction=rule.get("instruction", ""),
            language=rule.get("language", "en"),
        )
    except Exception as error:  # noqa: BLE001
        await log_activity(
            level="error",
            action="autodm.write",
            message=f"Jawab na lakhi shakaya: {error}",
            brand_id=brand_id,
        )
        result["skipped"] = f"AI e jawab na aapyo: {error}"
        return result

    link = (product or {}).get("url", "")
    dm_text = written["dm"]
    if link and link not in dm_text:
        dm_text = f"{dm_text}\n\n🔗 {link}".strip()

    # ---- Moklo ----
    from .graph import reply_to_comment, send_instagram_dm, send_facebook_private_reply

    token = account.get("access_token", "")

    if rule.get("reply_publicly") and written["public_reply"]:
        try:
            await reply_to_comment(
                comment_id=comment_id, access_token=token, message=written["public_reply"]
            )
            result["actions"].append("public-reply")
        except Exception as error:  # noqa: BLE001
            result["actions"].append(f"public-reply-fail: {str(error)[:120]}")

    if rule.get("send_dm") and dm_text:
        try:
            if platform == "instagram":
                await send_instagram_dm(
                    ig_user_id=account.get("external_id", ""),
                    access_token=token,
                    comment_id=comment_id,
                    message=dm_text,
                )
            else:
                await send_facebook_private_reply(
                    comment_id=comment_id, access_token=token, message=dm_text
                )
            result["actions"].append("dm")
        except Exception as error:  # noqa: BLE001
            result["actions"].append(f"dm-fail: {str(error)[:150]}")

    await mark_handled(comment_id, {"actions": result["actions"], "brand_id": brand_id})

    await log_activity(
        level="success" if "dm" in result["actions"] else "warning",
        action="autodm.handled",
        message=f'"{comment[:50]}" → {", ".join(result["actions"]) or "kai na thayu"}',
        brand_id=brand_id,
    )

    return result


async def ensure_indexes() -> None:
    await connect()
    await rules().create_index([("brand_id", 1), ("created_at", -1)])
    await handled().create_index("comment_id", unique=True)
    # Juno hisab 30 divas pachi jaate saaf — Meta ni limit pan 7 divas ni che.
    await handled().create_index("at", expireAfterSeconds=30 * 24 * 3600)
