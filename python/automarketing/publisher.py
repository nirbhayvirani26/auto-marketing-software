"""
Ek post ne kharekhar publish karvanu.

Aa J function badhi jagya thi vaparay che — "atyare publish karo" button,
scheduler, reel studio ane automation — jethi behaviour badhe ek j rahe.

Post no `post_type` nakki kare che ke kaya Meta API par javanu.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Optional

from bson import ObjectId

from .db import accounts as accounts_collection
from .db import connect
from .db import posts as posts_collection
from .logs import log_activity
from .social.publish import (
    PublishResult,
    comment_on_post,
    publish_carousel_instagram,
    publish_image_facebook,
    publish_image_instagram,
    publish_reel_facebook,
    publish_reel_instagram,
    publish_story_facebook,
    publish_story_instagram,
    publish_video_facebook,
)

Progress = Optional[Callable[[str], None]]


def now() -> datetime:
    return datetime.now(timezone.utc)


def compose_caption(caption: str, hashtags: list[str]) -> str:
    """Caption + hashtags ne ek publishable string ma jode."""
    if not hashtags:
        return caption
    tags = " ".join(tag if tag.startswith("#") else f"#{tag}" for tag in hashtags)
    return f"{caption}\n\n{tags}"


async def publish_post(post_id: Any, *, on_progress: Progress = None) -> dict:
    """Ek post publish kare ane DB ma status update kare."""
    await connect()

    post = await posts_collection().find_one({"_id": ObjectId(str(post_id))})
    if not post:
        return {"ok": False, "error": "Post madyo nahi"}

    if post.get("status") == "published":
        return {
            "ok": True,
            "external_id": post.get("external_id"),
            "permalink": post.get("permalink"),
        }

    account = await accounts_collection().find_one({"_id": ObjectId(str(post["account_id"]))})
    if not account:
        await posts_collection().update_one(
            {"_id": post["_id"]},
            {"$set": {"status": "failed", "error": "Social account madyu nahi"}},
        )
        return {"ok": False, "error": "Social account madyu nahi"}

    token = account.get("access_token") or ""
    if not token:
        error = f"\"{account.get('display_name')}\" mate access token nathi"
        await posts_collection().update_one(
            {"_id": post["_id"]}, {"$set": {"status": "failed", "error": error}}
        )
        await log_activity(level="error", action="post.publish", message=error)
        return {"ok": False, "error": error}

    await posts_collection().update_one(
        {"_id": post["_id"]},
        {
            "$set": {"status": "publishing", "error": None, "updated_at": now()},
            "$inc": {"attempts": 1},
        },
    )

    try:
        # Hashtag pehla comment ma jata hoy to caption ma na naakho.
        message = (
            post.get("caption", "")
            if post.get("first_comment")
            else compose_caption(post.get("caption", ""), post.get("hashtags") or [])
        )

        result = await _publish_by_type(
            post=post, account=account, token=token, message=message, on_progress=on_progress
        )

        changes: dict[str, Any] = {
            "status": "published",
            "published_at": now(),
            "external_id": result.external_id,
            "permalink": result.permalink,
            "error": None,
            "updated_at": now(),
        }

        # Pehlo comment — hashtag block. Aa fail thay to post to gayo j che,
        # etle aakhu fail nathi ganta.
        if post.get("first_comment") and result.external_id:
            try:
                changes["first_comment_id"] = await comment_on_post(
                    media_id=result.external_id,
                    access_token=token,
                    message=post["first_comment"],
                )
            except Exception as error:  # noqa: BLE001
                await log_activity(
                    level="warning",
                    action="post.first_comment",
                    message=f"Pehlo comment na thayo: {error}",
                )

        await posts_collection().update_one({"_id": post["_id"]}, {"$set": changes})

        await log_activity(
            level="success",
            action="post.published",
            message=(
                f"{post.get('platform')} par {post.get('post_type', 'post')} publish "
                f"thayu → {account.get('display_name')}"
            ),
            meta={"post_id": str(post["_id"]), "permalink": result.permalink},
        )

        return {
            "ok": True,
            "external_id": result.external_id,
            "permalink": result.permalink,
        }

    except Exception as error:  # noqa: BLE001
        message = str(error)[:800]
        await posts_collection().update_one(
            {"_id": post["_id"]},
            {"$set": {"status": "failed", "error": message, "updated_at": now()}},
        )
        await log_activity(
            level="error",
            action="post.failed",
            message=f"Publish fail ({post.get('platform')}/{post.get('post_type')}): {message}",
            meta={"post_id": str(post["_id"])},
        )
        return {"ok": False, "error": message}


async def _publish_by_type(
    *, post: dict, account: dict, token: str, message: str, on_progress: Progress
) -> PublishResult:
    post_type = post.get("post_type") or "image"
    is_instagram = post.get("platform") == "instagram"

    ig_user_id = str(account.get("ig_user_id") or "")
    page_id = str(account.get("page_id") or "")

    if is_instagram and not ig_user_id:
        raise ValueError(
            f"\"{account.get('display_name')}\" nu Instagram Business account id nathi — "
            "Accounts page ma fari connect karo."
        )
    if not is_instagram and not page_id:
        raise ValueError(f"\"{account.get('display_name')}\" nu Facebook Page id nathi.")

    media_url = str(post.get("media_url") or "")

    if post_type == "reel":
        if not media_url:
            raise ValueError("Reel nu video URL nathi")

        if is_instagram:
            return await publish_reel_instagram(
                ig_user_id=ig_user_id,
                access_token=token,
                caption=message,
                video_url=media_url,
                cover_url=str(post.get("thumbnail_url") or ""),
                share_to_feed=True,
                on_progress=on_progress,
            )

        # Facebook: pehla Reels API, e na chale to sadho feed video.
        try:
            return await publish_reel_facebook(
                page_id=page_id,
                access_token=token,
                description=message,
                video_url=media_url,
                on_progress=on_progress,
            )
        except Exception as error:  # noqa: BLE001
            if on_progress:
                on_progress(f"Facebook Reels na chalyu ({error}) — feed video thi try karie chie")
            return await publish_video_facebook(
                page_id=page_id, access_token=token, description=message, video_url=media_url
            )

    if post_type == "carousel":
        urls = [u for u in (post.get("media_urls") or []) if u]
        if len(urls) < 2:
            raise ValueError("Carousel mate ochha ma ochhi 2 image joiye")

        if is_instagram:
            return await publish_carousel_instagram(
                ig_user_id=ig_user_id,
                access_token=token,
                caption=message,
                items=[
                    {
                        "url": url,
                        "type": "video" if url.lower().split("?")[0].endswith((".mp4", ".mov", ".webm")) else "image",
                    }
                    for url in urls
                ],
                on_progress=on_progress,
            )

        # Facebook par carousel ek j API call ma nathi — pehli image mukiye chie.
        return await publish_image_facebook(
            page_id=page_id, access_token=token, message=message, image_url=urls[0]
        )

    if post_type == "story":
        if not media_url:
            raise ValueError("Story nu media URL nathi")
        is_video = post.get("media_type") == "video"

        if is_instagram:
            return await publish_story_instagram(
                ig_user_id=ig_user_id,
                access_token=token,
                media_url=media_url,
                is_video=is_video,
            )
        if not is_video:
            raise ValueError("Facebook Story mate video joiye — image story API thi nathi thati")
        return await publish_story_facebook(
            page_id=page_id, access_token=token, video_url=media_url
        )

    # image ke text
    if is_instagram:
        return await publish_image_instagram(
            ig_user_id=ig_user_id,
            access_token=token,
            caption=message,
            image_url=media_url,
        )
    return await publish_image_facebook(
        page_id=page_id, access_token=token, message=message, image_url=media_url
    )
