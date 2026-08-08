"""
Instagram ane Facebook par kharekhar post karvanu.

Post na prakar pramane alag alag rasto:
  image    → /media (IG) ke /photos (FB)
  reel     → REELS container (IG) ke video_reels (FB)
  carousel → 2-10 media, swipe thay evu (IG)
  story    → 24 kalak

IG video ne transcode karta 30 second thi 2 minute lage che, etle
container "FINISHED" thay tya sudhi raah jovi pade — nahi to
"Media ID is not available" aave che.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Callable, Optional

from ..errors import FatalError, UserError
from ..pipeline.http import get_client
from .graph import graph_request, require_public_url

Progress = Optional[Callable[[str], None]]


@dataclass
class PublishResult:
    external_id: str
    permalink: str = ""
    container_id: str = ""


def _say(on_progress: Progress, message: str) -> None:
    if on_progress:
        try:
            on_progress(message)
        except Exception:  # noqa: BLE001 — progress kadi crash na kare
            pass


# ------------------------------------------------------------------ #
#  Instagram
# ------------------------------------------------------------------ #


async def wait_for_container(
    *,
    container_id: str,
    access_token: str,
    timeout: float = 300.0,
    on_progress: Progress = None,
) -> None:
    """IG video container taiyar thay eni raah jue."""
    deadline = asyncio.get_running_loop().time() + timeout
    delay = 3.0

    while True:
        status = await graph_request(
            f"/{container_id}",
            {"fields": "status_code,status", "access_token": access_token},
            method="GET",
            timeout=60.0,
        )
        code = status.get("status_code")
        _say(on_progress, f"Instagram: {code}")

        if code in ("FINISHED", "PUBLISHED"):
            return

        if code == "ERROR":
            raise FatalError(
                f"Instagram e video na svikaryu: {status.get('status') or 'ERROR'}. "
                "Mota bhage aanu karan — video nu URL public nathi, ke format "
                "barabar nathi (mp4 / h264 / aac joiye)."
            )
        if code == "EXPIRED":
            raise FatalError("Instagram container ni muddat puri thai gai — fari try karo.")

        if asyncio.get_running_loop().time() > deadline:
            raise FatalError(
                f"Instagram e {int(timeout)}s ma video process na karyu. "
                "Nani/halki reel thi try karo."
            )

        await asyncio.sleep(delay)
        delay = min(delay * 1.4, 15.0)


async def _permalink(media_id: str, access_token: str) -> str:
    try:
        payload = await graph_request(
            f"/{media_id}",
            {"fields": "permalink", "access_token": access_token},
            method="GET",
            timeout=30.0,
        )
        return str(payload.get("permalink") or "")
    except Exception:  # noqa: BLE001 — permalink optional che
        return ""


async def publish_reel_instagram(
    *,
    ig_user_id: str,
    access_token: str,
    caption: str,
    video_url: str,
    cover_url: str = "",
    share_to_feed: bool = True,
    on_progress: Progress = None,
) -> PublishResult:
    """Instagram Reel — container → raah jovo → publish."""
    require_public_url(video_url, "Reel nu video")
    _say(on_progress, "Instagram par container banavie chie")

    params = {
        "media_type": "REELS",
        "video_url": video_url,
        "caption": caption[:2200],
        "share_to_feed": "true" if share_to_feed else "false",
        "access_token": access_token,
    }
    if cover_url.lower().startswith("https://"):
        params["cover_url"] = cover_url

    container = await graph_request(f"/{ig_user_id}/media", params)
    container_id = str(container.get("id") or "")
    if not container_id:
        raise FatalError("Instagram e container id na aapyu")

    _say(on_progress, "Instagram video process kari rahyu che")
    await wait_for_container(
        container_id=container_id, access_token=access_token, on_progress=on_progress
    )

    _say(on_progress, "Publish karie chie")
    published = await graph_request(
        f"/{ig_user_id}/media_publish",
        {"creation_id": container_id, "access_token": access_token},
    )
    media_id = str(published.get("id") or "")

    return PublishResult(
        external_id=media_id,
        permalink=await _permalink(media_id, access_token),
        container_id=container_id,
    )


async def publish_image_instagram(
    *,
    ig_user_id: str,
    access_token: str,
    caption: str,
    image_url: str,
) -> PublishResult:
    require_public_url(image_url, "Image")

    container = await graph_request(
        f"/{ig_user_id}/media",
        {"image_url": image_url, "caption": caption[:2200], "access_token": access_token},
    )
    container_id = str(container.get("id") or "")

    published = await graph_request(
        f"/{ig_user_id}/media_publish",
        {"creation_id": container_id, "access_token": access_token},
    )
    media_id = str(published.get("id") or "")

    return PublishResult(
        external_id=media_id,
        permalink=await _permalink(media_id, access_token),
        container_id=container_id,
    )


async def publish_carousel_instagram(
    *,
    ig_user_id: str,
    access_token: str,
    caption: str,
    items: list[dict],
    on_progress: Progress = None,
) -> PublishResult:
    """
    2 thi 10 media ek j post ma.

    Swipe ek majbut ranking signal che, etle ghana product hoy tyare
    carousel single image karta saro chale che.
    """
    if not 2 <= len(items) <= 10:
        raise UserError("Carousel ma 2 thi 10 vachhe item hova joiye")

    child_ids: list[str] = []
    for index, item in enumerate(items):
        _say(on_progress, f"Carousel item {index + 1}/{len(items)}")
        url = item["url"]
        require_public_url(url, f"Carousel item {index + 1}")

        params = {"is_carousel_item": "true", "access_token": access_token}
        if item.get("type") == "video":
            params["media_type"] = "VIDEO"
            params["video_url"] = url
        else:
            params["image_url"] = url

        child = await graph_request(f"/{ig_user_id}/media", params)
        child_id = str(child.get("id") or "")

        if item.get("type") == "video":
            await wait_for_container(container_id=child_id, access_token=access_token)
        child_ids.append(child_id)

    _say(on_progress, "Carousel jodie chie")
    container = await graph_request(
        f"/{ig_user_id}/media",
        {
            "media_type": "CAROUSEL",
            "children": ",".join(child_ids),
            "caption": caption[:2200],
            "access_token": access_token,
        },
    )
    container_id = str(container.get("id") or "")

    published = await graph_request(
        f"/{ig_user_id}/media_publish",
        {"creation_id": container_id, "access_token": access_token},
    )
    media_id = str(published.get("id") or "")

    return PublishResult(
        external_id=media_id,
        permalink=await _permalink(media_id, access_token),
        container_id=container_id,
    )


async def publish_story_instagram(
    *,
    ig_user_id: str,
    access_token: str,
    media_url: str,
    is_video: bool,
) -> PublishResult:
    require_public_url(media_url, "Story nu media")

    params = {"media_type": "STORIES", "access_token": access_token}
    params["video_url" if is_video else "image_url"] = media_url

    container = await graph_request(f"/{ig_user_id}/media", params)
    container_id = str(container.get("id") or "")

    if is_video:
        await wait_for_container(container_id=container_id, access_token=access_token)

    published = await graph_request(
        f"/{ig_user_id}/media_publish",
        {"creation_id": container_id, "access_token": access_token},
    )
    return PublishResult(external_id=str(published.get("id") or ""), container_id=container_id)


async def instagram_quota(*, ig_user_id: str, access_token: str) -> dict:
    """Chhella 24 kalak ma ketli post thai — IG ni limit 25 che."""
    payload = await graph_request(
        f"/{ig_user_id}/content_publishing_limit",
        {"fields": "quota_usage,config", "access_token": access_token},
        method="GET",
        timeout=30.0,
    )
    row = (payload.get("data") or [{}])[0]
    return {
        "used": int(row.get("quota_usage") or 0),
        "limit": int((row.get("config") or {}).get("quota_total") or 25),
    }


# ------------------------------------------------------------------ #
#  Facebook
# ------------------------------------------------------------------ #


async def publish_reel_facebook(
    *,
    page_id: str,
    access_token: str,
    description: str,
    video_url: str,
    on_progress: Progress = None,
) -> PublishResult:
    """
    Facebook Reel — traan tabakka:
      1. start  → video_id ane upload_url male
      2. upload → aapne fakt public URL aapie chie, FB potane utari le che
      3. finish → publish
    """
    require_public_url(video_url, "Reel nu video")

    _say(on_progress, "Facebook par upload session banavie chie")
    start = await graph_request(
        f"/{page_id}/video_reels",
        {"upload_phase": "start", "access_token": access_token},
    )
    video_id = str(start.get("video_id") or "")
    upload_url = str(start.get("upload_url") or "")
    if not video_id or not upload_url:
        raise FatalError("Facebook e upload session na aapyu")

    _say(on_progress, "Facebook video utari rahyu che")
    client = get_client()
    response = await client.post(
        upload_url,
        headers={"Authorization": f"OAuth {access_token}", "file_url": video_url},
        timeout=900.0,
    )
    if response.status_code >= 400:
        raise FatalError(f"Facebook upload fail: HTTP {response.status_code} {response.text[:200]}")

    _say(on_progress, "Facebook par publish karie chie")
    finish = await graph_request(
        f"/{page_id}/video_reels",
        {
            "video_id": video_id,
            "upload_phase": "finish",
            "video_state": "PUBLISHED",
            "description": description[:2200],
            "access_token": access_token,
        },
    )

    post_id = str(finish.get("post_id") or video_id)
    return PublishResult(
        external_id=post_id,
        permalink=f"https://www.facebook.com/reel/{video_id}",
        container_id=video_id,
    )


async def publish_video_facebook(
    *,
    page_id: str,
    access_token: str,
    description: str,
    video_url: str,
    title: str = "",
) -> PublishResult:
    """
    Facebook Page par sadho feed video.
    Reels API koi karan sar fail thay to aa backup rasto che.
    """
    require_public_url(video_url, "Video")

    params = {
        "file_url": video_url,
        "description": description[:2200],
        "access_token": access_token,
    }
    if title:
        params["title"] = title[:255]

    result = await graph_request(f"/{page_id}/videos", params)
    video_id = str(result.get("id") or "")
    return PublishResult(
        external_id=video_id,
        permalink=f"https://www.facebook.com/{video_id}",
    )


async def publish_image_facebook(
    *,
    page_id: str,
    access_token: str,
    message: str,
    image_url: str = "",
) -> PublishResult:
    if image_url:
        require_public_url(image_url, "Image")
        result = await graph_request(
            f"/{page_id}/photos",
            {"url": image_url, "caption": message[:2200], "access_token": access_token},
        )
        post_id = str(result.get("post_id") or result.get("id") or "")
    else:
        result = await graph_request(
            f"/{page_id}/feed",
            {"message": message[:2200], "access_token": access_token},
        )
        post_id = str(result.get("id") or "")

    return PublishResult(
        external_id=post_id,
        permalink=f"https://www.facebook.com/{post_id}",
    )


async def publish_story_facebook(
    *, page_id: str, access_token: str, video_url: str
) -> PublishResult:
    require_public_url(video_url, "Story nu video")

    start = await graph_request(
        f"/{page_id}/video_stories",
        {"upload_phase": "start", "access_token": access_token},
    )
    video_id = str(start.get("video_id") or "")

    client = get_client()
    response = await client.post(
        str(start.get("upload_url") or ""),
        headers={"Authorization": f"OAuth {access_token}", "file_url": video_url},
        timeout=900.0,
    )
    if response.status_code >= 400:
        raise FatalError(f"Facebook story upload fail: HTTP {response.status_code}")

    finish = await graph_request(
        f"/{page_id}/video_stories",
        {"video_id": video_id, "upload_phase": "finish", "access_token": access_token},
    )
    return PublishResult(
        external_id=str(finish.get("post_id") or video_id), container_id=video_id
    )


# ------------------------------------------------------------------ #
#  Comment
# ------------------------------------------------------------------ #


async def comment_on_post(*, media_id: str, access_token: str, message: str) -> str:
    """
    Post thaya pachi pehla comment ma hashtag mukvano.

    Instagram par aa saras practice che — caption saaf rahe che ane
    hashtag nu kaam pan thai jaay che.
    """
    result = await graph_request(
        f"/{media_id}/comments",
        {"message": message[:2200], "access_token": access_token},
    )
    return str(result.get("id") or "")
