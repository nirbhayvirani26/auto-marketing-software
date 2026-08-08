"""
Reel banavvano AAKHO pipeline.

    upload kareli image
         ↓  vision  — aa su che, kona mate che
         ↓  trends  — atyare log su shodhe che
         ↓  script  — kaya shot, kayo text, ketli var
         ↓  images  — je scene mate joiye e AI banave (avatar + kapda sathe)
         ↓  music   — mood pramane Creative Commons track
         ↓  voice   — (marji nu) edge-tts voiceover
         ↓  render  — ffmpeg thi 1080x1920 mp4
         ↓  copy    — Instagram ane Facebook mate ALAG caption
         ↓  hosting — public URL (Meta ne download karva mate)

Dareak step job document ma lakhay che — kyare, ketli var, kayo provider,
ane fail thay to su. Etle UI ma live progress dekhay che ane bhool kya
thai e sidhu khabar pade che.

SAUTHI AGATYA NO NIYAM: AI nu koi pan pagalu fail thay to pipeline
ATKATU NATHI. Image na bani → tamari potani image vaparie. Music na madyu
→ chup reel. Voiceover na banyo → fakt music. Chhelle reel to bane j che.
"""

from __future__ import annotations

import asyncio
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from bson import ObjectId

from ..ai.vision import ProductIntelligence, analyze_product_images
from ..config import settings, work_dir
from ..db import avatars as avatars_collection
from ..db import brands as brands_collection
from ..db import connect
from ..errors import UserError
from ..media import images as imagelib
from ..media.imagegen import ReferenceImage, generate_image, virtual_try_on
from ..media.store import (
    ensure_local_path,
    ensure_public_url,
    get_asset,
    get_assets,
    read_bytes,
    save_media,
)
from ..seo.copy import generate_social_copy
from ..trends.audio import instagram_audio_hints, mood_for_product, pick_music
from ..trends.keywords import build_trend_pack
from ..video.aivideo import ai_video_configured, generate_video_clip
from ..video.ffmpeg import probe
from ..video.fonts import script_for_language
from ..video.render import Scene, TextOverlay, render_reel
from ..video.voiceover import generate_voiceover
from .jobs import create_job, get_job, initial_steps, now, set_step, update_job
from .plan import PlannedScene, ReelPlan, plan_reel
from .reference import analyze_reference


@dataclass
class GenerateInput:
    brand_id: str
    image_asset_ids: list[str]
    mode: Optional[str] = None
    avatar_id: Optional[str] = None
    reference_video_asset_id: Optional[str] = None
    target_duration: int = 40
    language: str = "en"
    tone: str = ""
    hint: str = ""
    price: str = ""
    product_url: str = ""
    #: Kayu product — auto-DM ne khabar pade ke aa post kaya product nu che.
    product_id: str = ""
    voiceover: Optional[bool] = None
    created_by: Optional[str] = None
    job_id: Optional[str] = None
    #: Reel taiyar thay ke turant jate publish karvu (automation vaapre che).
    auto_distribute: Optional[dict] = None


@dataclass
class SceneMedia:
    path: str
    asset_id: Optional[ObjectId] = None
    source: str = "uploaded"  # uploaded | generated | tryon
    #: ffmpeg ne image ane video alag rite khavdavva pade che.
    kind: str = "image"  # image | video
    #: Video hoy to eni asli lambai — scene aana thi lambo na hovo joiye.
    clip_duration: float = 0.0


# ------------------------------------------------------------------ #
#  Helpers
# ------------------------------------------------------------------ #


def avatar_prompt_description(avatar: Optional[dict]) -> str:
    """
    Avatar ne ek prompt-line ma badle.

    Dareak image generation ma AA J lakhan jaay che, etle chehro ane look
    badha scenes ma — ane badhi reels ma — sarkho rahe che.
    """
    if not avatar:
        return ""

    bits = [
        avatar.get("description"),
        avatar.get("gender") if avatar.get("gender") not in (None, "unspecified") else None,
        f"around {avatar['age_range']} years old" if avatar.get("age_range") else None,
        f"{avatar['skin_tone']} skin" if avatar.get("skin_tone") else None,
        f"{avatar['hair']} hair" if avatar.get("hair") else None,
        f"{avatar['body_type']} build" if avatar.get("body_type") else None,
    ]
    return ", ".join(b for b in bits if b)


async def renderable_image(asset: dict, directory: Path) -> str:
    """
    ffmpeg badha format nathi samajtu (HEIC, CMYK JPEG, moti PNG).
    Etle render pehla dareak image ne saado sRGB JPEG banavi daiye chie.
    """
    local = await ensure_local_path(asset)

    if local.suffix.lower() in (".jpg", ".jpeg"):
        meta = imagelib.info(local.read_bytes())
        if meta and meta.width <= 4000 and meta.height <= 4000:
            return str(local)

    target = directory / f"norm-{asset['_id']}.jpg"
    target.write_bytes(imagelib.normalise_upload(local.read_bytes(), max_side=2400))
    return str(target)


async def _timed(coro):
    started = time.monotonic()
    value = await coro
    return value, int((time.monotonic() - started) * 1000)


# ------------------------------------------------------------------ #
#  Mukhya function
# ------------------------------------------------------------------ #


async def generate_reel(payload: GenerateInput) -> dict:
    """Aakho pipeline chalave ane job document pacho aape."""
    await connect()
    started = time.monotonic()
    warnings: list[str] = []

    brand = await brands_collection().find_one({"_id": ObjectId(payload.brand_id)})
    if not brand:
        raise UserError("Brand madyu nahi")

    images = await get_assets(payload.image_asset_ids)
    images = [i for i in images if i.get("kind") == "image"]
    if not images:
        raise UserError("Ek pan image na madi — pehla product ni image upload karo")

    avatar = None
    if payload.avatar_id:
        avatar = await avatars_collection().find_one(
            {"_id": ObjectId(payload.avatar_id), "brand_id": payload.brand_id}
        )
    else:
        avatar = await avatars_collection().find_one(
            {"brand_id": payload.brand_id, "is_default": True, "active": True}
        )

    mode = payload.mode or (
        "reference"
        if payload.reference_video_asset_id
        else "multi"
        if len(images) > 1
        else "tryon"
        if avatar
        else "single"
    )

    # ---- Job document ----
    if payload.job_id:
        job = await get_job(payload.job_id)
        if not job:
            job = None
    else:
        job = None

    if job is None:
        job = await create_job(
            {
                "brand_id": payload.brand_id,
                "avatar_id": str(avatar["_id"]) if avatar else None,
                "source_image_ids": [str(i["_id"]) for i in images],
                "reference_video_id": payload.reference_video_asset_id,
                "mode": mode,
                "target_duration": payload.target_duration,
                "language": payload.language,
                "tone": payload.tone,
                "created_by": payload.created_by,
                "auto_distribute": payload.auto_distribute,
                "steps": initial_steps(
                    with_reference=bool(payload.reference_video_asset_id),
                    with_distribute=bool(payload.auto_distribute),
                ),
            }
        )

    job_id = job["_id"]
    await update_job(job_id, {"status": "running", "started_at": now()})

    directory = work_dir() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)

    try:
        # ============ 1. Vision ============
        await set_step(job_id, "vision", status="running")

        buffers = [await read_bytes(asset) for asset in images]
        vision, vision_ms = await _timed(
            analyze_product_images(buffers, hint=payload.hint, market=settings.market)
        )
        analysis: ProductIntelligence = vision.data

        await set_step(
            job_id, "vision",
            status="done", provider=vision.provider, ms=vision_ms,
            note=f"{analysis.productName} — {analysis.category}",
        )
        await update_job(job_id, {"analysis": analysis.to_dict()})

        if analysis.imageQualityScore < 5 and analysis.imageQualityIssues:
            warnings.append(
                "Image ni gunvatta ochhi lage che ("
                + ", ".join(analysis.imageQualityIssues)
                + ") — sari image thi result ghano sudhare."
            )

        # ============ 2. Trends ============
        await set_step(job_id, "trends", status="running")

        brand_tag = "".join(ch for ch in str(brand.get("name", "")).lower() if ch.isalnum())
        trends, trends_ms = await _timed(
            build_trend_pack(analysis, brand_tag=brand_tag, platform="instagram")
        )

        await set_step(
            job_id, "trends",
            status="done", ms=trends_ms, provider="+".join(trends.sources),
            note=f"{len(trends.hashtags)} hashtag, {len(trends.keywords)} keyword",
        )
        await update_job(job_id, {"trends": trends.to_dict()})

        # ============ 3. Reference (jo hoy to) ============
        reference = None
        if payload.reference_video_asset_id:
            await set_step(job_id, "reference", status="running")
            try:
                ref_asset = await get_asset(payload.reference_video_asset_id)
                if not ref_asset:
                    raise UserError("Reference video madyu nahi")
                ref_path = await ensure_local_path(ref_asset)
                reference, ref_ms = await _timed(analyze_reference(ref_path))
                await set_step(
                    job_id, "reference",
                    status="done", ms=ref_ms,
                    note=f"{reference.scene_count} shot, {reference.pacing} pacing",
                )
            except Exception as error:  # noqa: BLE001
                reference = None
                warnings.append(f"Reference reel vanchi na shakaya: {error}")
                await set_step(job_id, "reference", status="failed", error=str(error)[:400])

        # ============ 4. Script ============
        await set_step(job_id, "plan", status="running")

        plan, plan_ms = await _timed(
            plan_reel(
                product=analysis,
                trends=trends,
                uploaded_image_count=len(images),
                product_names=(
                    [f"product {i + 1}" for i in range(len(images))] if mode == "multi" else None
                ),
                mode=mode,  # type: ignore[arg-type]
                target_duration=payload.target_duration,
                language=payload.language or analysis.language,
                tone=payload.tone or str(brand.get("brand_voice") or ""),
                brand_name=str(brand.get("name") or ""),
                avatar_description=avatar_prompt_description(avatar),
                reference=reference,
                price=payload.price,
            )
        )

        await set_step(
            job_id, "plan",
            status="done", ms=plan_ms,
            note=f"{len(plan.scenes)} scene, {plan.total_duration}s — {plan.concept[:60]}",
        )

        # ============ 5. Scene ni images ============
        await set_step(job_id, "media", status="running")

        scene_media, media_ms = await _timed(
            build_scene_media(
                plan=plan,
                images=images,
                avatar=avatar,
                analysis=analysis,
                brand_id=payload.brand_id,
                directory=directory,
                warnings=warnings,
            )
        )
        generated_count = sum(1 for m in scene_media if m.source != "uploaded")
        clip_count = sum(1 for m in scene_media if m.kind == "video")

        await set_step(
            job_id, "media",
            status="done", ms=media_ms,
            note=" · ".join(
                filter(
                    None,
                    [
                        f"{len(scene_media)} scene",
                        f"{generated_count} AI e banaveli",
                        f"{clip_count} AI video clip" if clip_count else "",
                    ],
                )
            ),
        )

        # ============ 6. Music ============
        await set_step(job_id, "music", status="running")

        mood = plan.music_mood or mood_for_product(
            category=analysis.category,
            style=analysis.style,
            occasions=analysis.occasions,
            positioning=analysis.positioning,
        )
        music = await pick_music(
            mood=mood,
            min_duration=plan.total_duration + 2,
            brand_id=payload.brand_id,
        )

        music_path: Optional[str] = None
        if music:
            music_path = str(await ensure_local_path(music["asset"]))
            track = music["track"]
            await set_step(
                job_id, "music",
                status="done", provider=track.source,
                note=f"{track.title} — {track.artist}",
            )
        else:
            warnings.append(
                "Music na madyu — reel music vagar banse. Jamendo ni free key naakho "
                "(devportal.jamendo.com) athva potani mp3 storage/music/ ma mukho."
            )
            await set_step(job_id, "music", status="skipped", note="Koi track na madyo")

        # ============ 7. Voiceover ============
        voiceover_path: Optional[str] = None
        wants_voice = (
            payload.voiceover if payload.voiceover is not None else settings.voiceover_enabled
        )
        voice_text = " ".join(s.voice_line.strip() for s in plan.scenes if s.voice_line.strip())

        if wants_voice and len(voice_text) > 20:
            await set_step(job_id, "voiceover", status="running")
            try:
                voice, voice_ms = await _timed(
                    generate_voiceover(
                        text=voice_text,
                        language=payload.language or analysis.language,
                    )
                )
                target = directory / f"voice{voice.data.extension}"
                target.write_bytes(voice.data.data)
                voiceover_path = str(target)
                await set_step(
                    job_id, "voiceover",
                    status="done", provider=voice.data.provider, ms=voice_ms,
                )
            except Exception as error:  # noqa: BLE001
                voiceover_path = None
                warnings.append(f"Voiceover na banyu ({error}) — music thi j reel banse.")
                await set_step(job_id, "voiceover", status="failed", error=str(error)[:400])
        else:
            await set_step(job_id, "voiceover", status="skipped")

        # ============ 8. Render ============
        await set_step(job_id, "render", status="running")

        scenes = [
            Scene(
                source=scene_media[index].path,
                source_type=scene_media[index].kind,  # type: ignore[arg-type]
                # Video clip scene karta tunku aavyu hoy to scene ne j tunko
                # karo — nahi to chhelli frame thijeli dekhay che.
                duration=(
                    min(planned.duration, scene_media[index].clip_duration)
                    if scene_media[index].clip_duration
                    else planned.duration
                ),
                # AI video ma halchal andar j che — upar thi Ken Burns naakhie
                # to be halchal bhegi thai ne chakkar aave evu lage che.
                motion=(
                    "none" if scene_media[index].kind == "video" else planned.motion
                ),  # type: ignore[arg-type]
                transition=planned.transition,  # type: ignore[arg-type]
                overlays=(
                    [
                        TextOverlay(
                            text=planned.on_screen_text,
                            position=(
                                "center"
                                if planned.purpose == "hook"
                                else "bottom"
                                if index % 2 == 0
                                else "top"
                            ),
                            size=("hero" if planned.purpose in ("hook", "cta") else "large"),
                            style=("outline" if planned.purpose == "hook" else "box"),
                        )
                    ]
                    if planned.on_screen_text
                    else []
                ),
            )
            for index, planned in enumerate(plan.scenes)
        ]

        output_path = directory / "reel.mp4"
        language = payload.language or analysis.language or "en"

        loop = asyncio.get_running_loop()

        def progress(step: str, done: int, total: int) -> None:
            # Render sync callback ma che — async update ne schedule karo.
            loop.call_soon_threadsafe(
                lambda: asyncio.ensure_future(
                    set_step(job_id, "render", status="running", note=step)
                )
            )

        render = await render_reel(
            scenes=scenes,
            output_path=output_path,
            music_path=music_path,
            voiceover_path=voiceover_path,
            script=script_for_language(language),
            watermark=settings.reel_watermark,
            on_progress=progress,
        )

        await set_step(
            job_id, "render",
            status="done", ms=render.ms,
            note=f"{render.duration:.1f}s · {render.bytes / 1024 / 1024:.1f}MB",
        )

        # ============ 9. Save + public URL ============
        await set_step(job_id, "upload", status="running")

        video_asset = await save_media(
            Path(render.output_path).read_bytes(),
            mime_type="video/mp4",
            filename=f"reel-{job_id}.mp4",
            role="reel",
            brand_id=payload.brand_id,
            provider="ffmpeg",
            duration=render.duration,
            width=render.width,
            height=render.height,
        )
        thumbnail_asset = await save_media(
            Path(render.thumbnail_path).read_bytes(),
            mime_type="image/jpeg",
            filename=f"reel-{job_id}-cover.jpg",
            role="thumbnail",
            brand_id=payload.brand_id,
        )

        # Meta ne aapva mate public URL joiye j che.
        video_url = await ensure_public_url(video_asset)
        try:
            await ensure_public_url(thumbnail_asset)
        except Exception:  # noqa: BLE001 — cover optional che
            pass

        await set_step(
            job_id, "upload",
            status="done", provider=video_asset.get("host"), note=video_url[:90],
        )

        # ============ 10. Caption ============
        await set_step(job_id, "copy", status="running")

        copy_started = time.monotonic()
        instagram, facebook = await asyncio.gather(
            generate_social_copy(
                product=analysis, trends=trends, platform="instagram", fmt="reel",
                brand_name=str(brand.get("name") or ""),
                brand_voice=str(brand.get("brand_voice") or ""),
                language=payload.language or analysis.language,
                product_url=payload.product_url, price=payload.price,
            ),
            generate_social_copy(
                product=analysis, trends=trends, platform="facebook", fmt="reel",
                brand_name=str(brand.get("name") or ""),
                brand_voice=str(brand.get("brand_voice") or ""),
                language=payload.language or analysis.language,
                product_url=payload.product_url, price=payload.price,
            ),
        )
        copy_ms = int((time.monotonic() - copy_started) * 1000)

        await set_step(
            job_id, "copy",
            status="done", ms=copy_ms,
            note=(
                f"IG score {instagram.score.score}/100 · "
                f"FB score {facebook.score.score}/100"
            ),
        )

        # ============ Puru ============
        audio_info = {
            "track": (
                f"{music['track'].title} — {music['track'].artist} ({music['track'].license})"
                if music
                else None
            ),
            "mood": mood,
            "instagram_hint": instagram_audio_hints(mood),
        }

        await update_job(
            job_id,
            {
                "status": "done",
                "scenes": [
                    {
                        **planned.to_dict(),
                        "media_id": (
                            str(scene_media[i].asset_id) if scene_media[i].asset_id else None
                        ),
                        "image_source": scene_media[i].source,
                        # Still image halavi ke Omni e kharekhar video banavyu.
                        "media_kind": scene_media[i].kind,
                    }
                    for i, planned in enumerate(plan.scenes)
                ],
                "plan": plan.to_dict(),
                "copy": {"instagram": instagram.to_dict(), "facebook": facebook.to_dict()},
                "audio": audio_info,
                "output_id": video_asset["_id"],
                "thumbnail_id": thumbnail_asset["_id"],
                "duration": render.duration,
                "warnings": warnings,
                "finished_at": now(),
                "ms": int((time.monotonic() - started) * 1000),
            },
        )

        # Vachhe na temp file have jarur nathi — video ane keyframes
        # MediaAsset ma save thai gaya che. Aa na karie to disk bharai jaay.
        shutil.rmtree(directory, ignore_errors=True)

        return await get_job(job_id) or {}

    except Exception as error:  # noqa: BLE001
        await update_job(
            job_id,
            {
                "status": "failed",
                "error": str(error)[:1000],
                "warnings": warnings,
                "finished_at": now(),
                "ms": int((time.monotonic() - started) * 1000),
            },
        )
        raise


# ------------------------------------------------------------------ #
#  Scene dith image
# ------------------------------------------------------------------ #


async def build_scene_media(
    *,
    plan: ReelPlan,
    images: list[dict],
    avatar: Optional[dict],
    analysis: ProductIntelligence,
    brand_id: str,
    directory: Path,
    warnings: list[str],
) -> list[SceneMedia]:
    """
    Dareak scene mate image taiyar kare.

    SAUTHI AGATYA NO NIYAM: AI ni image FAIL thay to upload kareli image
    vaparie chie — reel kyarey atkatu nathi. Ek scene ni image na male e
    karane aakhu kaam bagade e barabar nathi.
    """
    normalised: dict[str, str] = {}
    for asset in images:
        normalised[str(asset["_id"])] = await renderable_image(asset, directory)

    def fallback(index: int) -> SceneMedia:
        asset = images[index % len(images)]
        return SceneMedia(
            path=normalised[str(asset["_id"])],
            asset_id=asset["_id"],
            source="uploaded",
        )

    avatar_photo = None
    if avatar:
        photo_id = avatar.get("primary_photo_id") or (avatar.get("photo_ids") or [None])[0]
        if photo_id:
            avatar_photo = await get_asset(photo_id)

    results: list[Optional[SceneMedia]] = [None] * len(plan.scenes)

    # AI image fail thay to karan ekathi karie chie (niche ek j chetavni).
    failed_scenes: list[int] = []
    image_errors: set[str] = set()

    # AI video fail thay to karan ekathi karie chie (niche ek j chetavni).
    failed_clips: list[int] = []
    clip_errors: set[str] = set()

    # AI image generation dhimu che — sathe sathe chalavie chie, pan free
    # tier ni rate limit na lage etle ek saathe fakt 2.
    limit = asyncio.Semaphore(2)
    # Video ghanu vadhu bhaare che — ek saathe fakt 2 j.
    video_limit = asyncio.Semaphore(2)

    async def save_generated(
        data: bytes, provider: str, prompt: str, source: str, index: int
    ) -> SceneMedia:
        asset = await save_media(
            data,
            mime_type="image/jpeg",
            filename=f"scene-{index}.jpg",
            role="keyframe",
            brand_id=brand_id,
            provider=provider,
            prompt=prompt,
        )
        path = directory / f"scene-{index}.jpg"
        path.write_bytes(data)
        return SceneMedia(path=str(path), asset_id=asset["_id"], source=source, kind="image")

    async def animate(still: SceneMedia, scene: PlannedScene, index: int) -> SceneMedia:
        """
        Still image → Omni → kharekhar halto video.

        Image ne reference tarike aapvi e ahiya sauthi agatya ni vaat che:
        prompt ma fakt HALCHAL nu varnan jaay che, product nu nahi. Etle Omni
        product ne potani rite kalpi nathi sakto — e j kapdu, e j rang, e j
        chehro rahe che.
        """
        async with video_limit:
            clip = await generate_video_clip(
                _video_prompt(scene, analysis),
                image=Path(still.path).read_bytes(),
                aspect="9:16",
                duration=scene.duration,
            )

        path = directory / f"scene-{index}.mp4"
        path.write_bytes(clip.data.data)

        # Omni ketlu lambu video aape e nakki nathi — asli lambai maapi laiye,
        # jethi scene ni lambai ena thi vadhare na rahi jaay (nahi to chhello
        # bhaag thijeli frame jevo dekhay che).
        try:
            info = await probe(path)
            clip_duration, width, height = info.duration, info.width, info.height
        except Exception:  # noqa: BLE001 — maap na madyu to pan clip vaparva jevo che
            clip_duration, width, height = 0.0, 0, 0

        asset = await save_media(
            clip.data.data,
            mime_type=clip.data.mime_type,
            filename=f"scene-{index}.mp4",
            role="clip",
            brand_id=brand_id,
            provider=clip.data.provider,
            prompt=scene.video_prompt,
            duration=clip_duration or None,
            width=width or None,
            height=height or None,
        )

        return SceneMedia(
            path=str(path),
            asset_id=asset["_id"],
            source=still.source,
            kind="video",
            clip_duration=clip_duration,
        )

    async def build_one(index: int, scene: PlannedScene) -> SceneMedia:
        """
        Ek scene nu media — hamesha be tabakke.

          1. STILL image taiyar karo (upload kareli, AI e banaveli, ke try-on)
          2. Plan ma "video" lakhyu hoy to E J IMAGE ne Omni thi halavo

        Bijo tabakko fail thay to pehla tabakka ni image j vaparie chie —
        video na banvathi reel kyarey atkatu nathi.
        """
        still = await build_still(index, scene)

        if scene.motion_strategy != "video" or not ai_video_configured():
            return still

        try:
            return await animate(still, scene, index)
        except Exception as error:  # noqa: BLE001
            failed_clips.append(index + 1)
            clip_errors.add(str(error).splitlines()[0][:160])
            return still

    async def build_still(index: int, scene: PlannedScene) -> SceneMedia:
        async with limit:
            if scene.image_strategy == "uploaded" or not images:
                return fallback(
                    scene.uploaded_image_index if scene.uploaded_image_index >= 0 else index
                )

            try:
                product_asset = images[max(0, scene.uploaded_image_index) % len(images)]

                if scene.image_strategy == "tryon" and avatar_photo:
                    result = await virtual_try_on(
                        person=await read_bytes(avatar_photo),
                        garment=await read_bytes(product_asset),
                        description=", ".join(
                            filter(
                                None,
                                [
                                    analysis.productName,
                                    " ".join(analysis.colors),
                                    " ".join(analysis.materials),
                                    scene.image_prompt,
                                ],
                            )
                        )[:400],
                    )
                    return await save_generated(
                        result.data.data, result.data.provider, scene.image_prompt, "tryon", index
                    )

                # "generate" — product ne reference tarike aapie chie jethi
                # AI product ne badli na naakhe, fakt aajubaju nu drashya banave.
                references = [
                    ReferenceImage(data=await read_bytes(product_asset), role="product")
                ]
                if avatar_photo:
                    references.append(
                        ReferenceImage(data=await read_bytes(avatar_photo), role="person")
                    )

                result = await generate_image(
                    _scene_prompt(scene, analysis, avatar),
                    references=references,
                    aspect="9:16",
                )
                return await save_generated(
                    result.data.data, result.data.provider, scene.image_prompt, "generated", index
                )

            except Exception as error:  # noqa: BLE001
                # Ek j karan thi 7 scene fail thay to 7 sarkhi chetavni
                # aapvi bekaar che — ek j var, ketla scene e sathe.
                failed_scenes.append(index + 1)
                image_errors.add(str(error).splitlines()[0][:160])
                return fallback(index)

    built = await asyncio.gather(
        *(build_one(i, s) for i, s in enumerate(plan.scenes))
    )
    for index, item in enumerate(built):
        results[index] = item

    if failed_scenes:
        warnings.append(
            f"Scene {', '.join(map(str, failed_scenes))} ni AI image na bani — "
            f"tamari potani image vapari che (reel to barabar j banyu che). "
            f"Karan: {' | '.join(sorted(image_errors))}"
        )

    if failed_clips:
        warnings.append(
            f"Scene {', '.join(map(str, sorted(failed_clips)))} nu AI video na banyu — "
            f"e j image ne halavi ne vapari che (reel to barabar j banyu che). "
            f"Karan: {' | '.join(sorted(clip_errors))}"
        )

    return [item or fallback(i) for i, item in enumerate(results)]


#: Motion preset → camera ni bhasha, Omni samje evi.
_CAMERA_WORDS = {
    "zoom-in": "the camera pushes in slowly",
    "zoom-out": "the camera pulls back slowly",
    "pan-left": "the camera drifts slowly to the left",
    "pan-right": "the camera drifts slowly to the right",
    "pan-up": "the camera tilts slowly upward",
    "pan-down": "the camera tilts slowly downward",
    "none": "the camera stays locked off",
}


def _video_prompt(scene: PlannedScene, analysis: ProductIntelligence) -> str:
    """
    Omni ne aapvano prompt.

    Ahiya PRODUCT nu varnan jaani joine NATHI — e reference image ma j che.
    Lakhie to Omni be vaat vachhe gothvai jaay che ane product badlai jaay
    che. Fakt "su hale che" ane "camera kem fare" — bas etlu j.
    """
    camera = _CAMERA_WORDS.get(scene.motion, "slow gentle camera movement")

    return "\n".join(
        [
            "Animate the reference image into live footage.",
            scene.video_prompt
            or (
                f"Subtle, believable motion for a {analysis.category.lower()} product "
                f"shot — {camera}."
            ),
            f"Camera: {camera}.",
            "Realistic physics — fabric, hair and light move naturally. No morphing, "
            "no warping, no extra limbs.",
            "Keep the same framing, the same background and the same colour grade as "
            "the reference image.",
        ]
    )


def _scene_prompt(
    scene: PlannedScene, analysis: ProductIntelligence, avatar: Optional[dict]
) -> str:
    lines = [
        scene.image_prompt
        or (
            f"A lifestyle shot for {analysis.productName} in a "
            f"{analysis.occasions[0] if analysis.occasions else 'everyday'} setting"
        ),
        "",
        f"The product is: {analysis.productName} — {', '.join(analysis.colors)} "
        f"{', '.join(analysis.materials)}. Keep it exactly as shown in the product "
        "reference image.",
    ]

    description = avatar_prompt_description(avatar)
    if description:
        lines.append(f"The person is: {description}. Keep their face unchanged.")

    lines += [
        "",
        "Vertical 9:16 composition, photorealistic, sharp focus on the product, natural "
        "lighting, shallow depth of field.",
        "No text, no logos, no watermarks, no borders anywhere in the image.",
    ]
    return "\n".join(filter(None, lines))
