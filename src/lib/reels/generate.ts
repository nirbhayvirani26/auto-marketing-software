/**
 * Reel banavvano aakho pipeline.
 *
 *   upload kareli image
 *        ↓  vision — aa su che, kona mate che
 *        ↓  trends — atyare log su shodhe che
 *        ↓  script — kaya shot, kayo text, ketli var
 *        ↓  images — je scene mate joiye e AI banave (avatar + kapda sathe)
 *        ↓  music  — mood pramane royalty-free track
 *        ↓  voice  — (marji nu) voiceover
 *        ↓  render — ffmpeg thi 1080x1920 mp4
 *        ↓  copy   — Instagram ane Facebook mate alag caption
 *        ↓  hosting— public URL (Meta ne download karva mate)
 *
 * Dareak step ReelJob ma lakhay che — kyare, ketli var, kayo provider,
 * ane fail thay to su. Etle UI ma live progress dekhay che ane bhool
 * kya thai e sidhu khabar pade che.
 */

import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";

import { connectDB } from "@/lib/db";
import { Brand, type BrandDoc } from "@/models/Brand";
import {
  Avatar,
  avatarPromptDescription,
  type AvatarDoc,
} from "@/models/Avatar";
import {
  MediaAsset,
  type MediaAssetDocument,
} from "@/models/MediaAsset";
import { ReelJob, setStep, type ReelJobDocument } from "@/models/ReelJob";
import { logActivity } from "@/models/ActivityLog";

import { analyzeProductImages, type ProductIntelligence } from "@/lib/ai/vision";
import { buildTrendPack, type TrendPack } from "@/lib/trends/keywords";
import { moodForProduct, pickMusic, instagramAudioHints, type MusicMood } from "@/lib/trends/audio";
import { generateSocialCopy, type SocialCopy } from "@/lib/seo/copy";
import {
  ensureLocalPath,
  ensurePublicUrl,
  mediaRoot,
  ensureDir,
  saveMedia,
} from "@/lib/media/store";
import { generateImage, virtualTryOn } from "@/lib/media/image-gen";
import {
  aiVideoConfigured,
  aiVideoMaxClips,
  generateVideoClip,
} from "@/lib/video/ai-video";
import { probe } from "@/lib/video/ffmpeg";
import { renderReel, type Scene } from "@/lib/video/render";
import { generateVoiceover, voiceoverEnabled } from "@/lib/video/voiceover";
import { scriptForLanguage } from "@/lib/video/fonts";
import { planReel, type PlannedScene, type ReelPlan } from "./plan";
import { analyzeReference, type ReferenceAnalysis } from "./reference";

export type GenerateReelInput = {
  brandId: string;
  /** Upload kareli images na MediaAsset id. */
  imageAssetIds: string[];
  mode?: "single" | "multi" | "tryon" | "reference";
  avatarId?: string;
  referenceVideoAssetId?: string;
  productId?: string;
  /** 15-90 second. Default 40. */
  targetDuration?: number;
  language?: string;
  tone?: string;
  /** User e product vishe kaink lakhyu hoy to. */
  hint?: string;
  price?: string;
  productUrl?: string;
  voiceover?: boolean;
  createdBy?: string;
  /** Ready job ma chalavvu hoy to (background worker). */
  jobId?: string;
};

export type GenerateReelResult = {
  jobId: string;
  videoUrl: string;
  videoAssetId: string;
  thumbnailUrl: string;
  duration: number;
  plan: ReelPlan;
  analysis: ProductIntelligence;
  trends: TrendPack;
  copy: { instagram: SocialCopy; facebook: SocialCopy };
  audio: {
    track: string | null;
    mood: MusicMood;
    instagramHint: ReturnType<typeof instagramAudioHints>;
  };
  warnings: string[];
};

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

/**
 * ffmpeg badha format nathi samajtu (HEIC, kyarek CMYK JPEG). Etle render
 * pehla dareak image ne saado sRGB JPEG banavi daiye chie.
 */
async function renderableImage(asset: MediaAssetDocument, dir: string): Promise<string> {
  const localPath = await ensureLocalPath(asset);

  if (/\.(jpe?g|png)$/i.test(localPath)) {
    try {
      const meta = await sharp(localPath).metadata();
      if (meta.space !== "cmyk" && meta.width && meta.width <= 4000) return localPath;
    } catch {
      /* niche convert karie chie */
    }
  }

  const target = path.join(dir, `norm-${asset._id}.jpg`);
  await sharp(await readFile(localPath))
    .rotate()
    .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
    .toColorspace("srgb")
    .jpeg({ quality: 92 })
    .toFile(target);

  return target;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

/* ------------------------------------------------------------------ *
 *  Mukhya function
 * ------------------------------------------------------------------ */

export async function generateReel(
  input: GenerateReelInput,
): Promise<GenerateReelResult> {
  await connectDB();
  const started = Date.now();
  const warnings: string[] = [];

  const brand = await Brand.findById(input.brandId);
  if (!brand) throw new Error("Brand madyu nahi");

  const images = await MediaAsset.find({
    _id: { $in: input.imageAssetIds },
    kind: "image",
  });
  if (images.length === 0) {
    throw new Error("Ek pan image na madi — pehla product ni image upload karo");
  }
  // User e je kram ma aapyu e j kram sachvo.
  images.sort(
    (a, b) =>
      input.imageAssetIds.indexOf(String(a._id)) -
      input.imageAssetIds.indexOf(String(b._id)),
  );

  const avatar = input.avatarId
    ? await Avatar.findOne({ _id: input.avatarId, brand: brand._id })
    : await Avatar.findOne({ brand: brand._id, isDefault: true, active: true });

  const mode =
    input.mode ??
    (input.referenceVideoAssetId
      ? "reference"
      : images.length > 1
        ? "multi"
        : avatar
          ? "tryon"
          : "single");

  /* ---- Job document ---- */
  const newJob = (): Promise<ReelJobDocument> =>
    ReelJob.create({
      brand: brand._id,
      avatar: avatar?._id,
      product: input.productId,
      sourceImages: images.map((i) => i._id),
      referenceVideo: input.referenceVideoAssetId,
      mode,
      targetDuration: input.targetDuration ?? 40,
      language: input.language ?? "en",
      tone: input.tone,
      status: "running",
      startedAt: new Date(),
      createdBy: input.createdBy,
    });

  const job: ReelJobDocument = input.jobId
    ? ((await ReelJob.findById(input.jobId)) ?? (await newJob()))
    : await newJob();

  job.status = "running";
  job.startedAt = job.startedAt ?? new Date();
  await job.save();

  const workDir = path.join(mediaRoot(), "..", "work", String(job._id));
  await ensureDir(workDir);

  try {
    /* ================= 1. Vision ================= */
    await setStep(job._id, "vision", { label: "Image samajie chie", status: "running" });

    const buffers = await Promise.all(
      images.map(async (asset) => ({
        data: await readFile(await ensureLocalPath(asset)),
        mimeType: asset.mimeType,
      })),
    );

    const visionResult = await analyzeProductImages(buffers, {
      hint: input.hint,
      market: process.env.DEFAULT_MARKET || "India",
    });
    const analysis = visionResult.data;

    await setStep(job._id, "vision", {
      status: "done",
      provider: visionResult.provider,
      ms: visionResult.ms,
      note: `${analysis.productName} — ${analysis.category}`,
    });

    job.analysis = analysis;
    await job.save();

    if (analysis.imageQuality.score < 5 && analysis.imageQuality.issues.length) {
      warnings.push(
        `Image ni gunvatta ochhi lage che (${analysis.imageQuality.issues.join(", ")}) — sari image thi result ghano sudhare.`,
      );
    }

    /* ================= 2. Trends ================= */
    await setStep(job._id, "trends", { label: "Trending keywords shodhie chie", status: "running" });

    const trendsRun = await timed(() =>
      buildTrendPack({
        product: analysis,
        brandTag: brand.name.replace(/\s+/g, "").toLowerCase(),
        platform: "instagram",
      }),
    );
    const trends = trendsRun.value;

    await setStep(job._id, "trends", {
      status: "done",
      ms: trendsRun.ms,
      provider: trends.sources.join("+"),
      note: `${trends.hashtags.length} hashtag, ${trends.keywords.length} keyword`,
    });

    job.trends = trends;
    await job.save();

    /* ================= 3. Reference (jo hoy to) ================= */
    let referenceStyle: ReferenceAnalysis | undefined;
    if (input.referenceVideoAssetId) {
      await setStep(job._id, "reference", {
        label: "Reference reel ni style samajie chie",
        status: "running",
      });
      try {
        const refAsset = await MediaAsset.findById(input.referenceVideoAssetId);
        if (!refAsset) throw new Error("Reference video madyo nahi");

        const refPath = await ensureLocalPath(refAsset);
        const refRun = await timed(() => analyzeReference(refPath));
        referenceStyle = refRun.value;

        await setStep(job._id, "reference", {
          status: "done",
          ms: refRun.ms,
          note: `${referenceStyle.sceneCount} shot, ${referenceStyle.pacing} pacing`,
        });
      } catch (error) {
        warnings.push(`Reference reel vanchi na shakaya: ${(error as Error).message}`);
        await setStep(job._id, "reference", {
          status: "failed",
          error: (error as Error).message,
        });
      }
    }

    /* ================= 4. Script ================= */
    await setStep(job._id, "plan", { label: "Reel no script lakhie chie", status: "running" });

    const planRun = await timed(() =>
      planReel({
        product: analysis,
        trends,
        uploadedImageCount: images.length,
        productNames: mode === "multi" ? images.map((_, i) => `product ${i + 1}`) : undefined,
        mode,
        targetDuration: input.targetDuration ?? 40,
        language: input.language ?? analysis.language,
        tone: input.tone ?? brand.brandVoice ?? undefined,
        brandName: brand.name,
        avatarDescription: avatar ? avatarPromptDescription(avatar) : undefined,
        referenceStyle: referenceStyle
          ? {
              sceneCount: referenceStyle.sceneCount,
              averageSceneDuration: referenceStyle.averageSceneDuration,
              pacing: referenceStyle.pacing,
              shotTypes: referenceStyle.shotTypes,
              textStyle: referenceStyle.textStyle,
              hookStyle: referenceStyle.hookStyle,
              mood: referenceStyle.mood,
              summary: referenceStyle.summary,
            }
          : undefined,
        price: input.price,
        aiVideo: { enabled: aiVideoConfigured(), maxClips: aiVideoMaxClips() },
      }),
    );
    const plan = planRun.value;

    await setStep(job._id, "plan", {
      status: "done",
      ms: planRun.ms,
      note: `${plan.scenes.length} scene, ${plan.totalDuration}s — ${plan.concept}`,
    });

    /* ================= 5. Scene ni images ================= */
    await setStep(job._id, "media", { label: "Scene ni images taiyar karie chie", status: "running" });

    const mediaRun = await timed(() =>
      buildSceneMedia({
        plan,
        images,
        avatar,
        analysis,
        brandId: String(brand._id),
        workDir,
        warnings,
      }),
    );
    const sceneMedia = mediaRun.value;

    const generatedCount = sceneMedia.filter((s) => s.source !== "uploaded").length;
    const clipCount = sceneMedia.filter((s) => s.kind === "video").length;
    await setStep(job._id, "media", {
      status: "done",
      ms: mediaRun.ms,
      note: [
        `${sceneMedia.length} scene`,
        `${generatedCount} AI e banaveli`,
        clipCount ? `${clipCount} AI video clip` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });

    /* ================= 6. Music ================= */
    await setStep(job._id, "music", { label: "Music pasand karie chie", status: "running" });

    const mood = (plan.musicMood as MusicMood) || moodForProduct(analysis);
    const music = await pickMusic({
      mood,
      minDuration: plan.totalDuration + 2,
      brand: String(brand._id),
    });

    let musicPath: string | undefined;
    if (music) {
      musicPath = await ensureLocalPath(music.asset);
      await setStep(job._id, "music", {
        status: "done",
        provider: music.track.source,
        note: `${music.track.title} — ${music.track.artist}`,
      });
    } else {
      warnings.push(
        "Music na madyu — reel music vagar banse. Jamendo ni free key naakho (devportal.jamendo.com) athva potani mp3 upload karo.",
      );
      await setStep(job._id, "music", { status: "skipped", note: "Koi track na madyo" });
    }

    /* ================= 7. Voiceover ================= */
    let voiceoverPath: string | undefined;
    const wantsVoiceover = input.voiceover ?? voiceoverEnabled();
    const voiceText = plan.scenes
      .map((s) => s.voiceLine.trim())
      .filter(Boolean)
      .join(" ");

    if (wantsVoiceover && voiceText.length > 20) {
      await setStep(job._id, "voiceover", { label: "Voiceover banavie chie", status: "running" });
      try {
        const voice = await generateVoiceover({
          text: voiceText,
          language: input.language ?? analysis.language,
        });
        voiceoverPath = path.join(workDir, `voice${voice.data.extension}`);
        await writeFile(voiceoverPath, voice.data.data);

        await setStep(job._id, "voiceover", {
          status: "done",
          provider: voice.provider,
          ms: voice.ms,
        });
      } catch (error) {
        voiceoverPath = undefined;
        warnings.push(`Voiceover na banyu (${(error as Error).message}) — music thi j reel banse.`);
        await setStep(job._id, "voiceover", {
          status: "failed",
          error: (error as Error).message,
        });
      }
    } else {
      await setStep(job._id, "voiceover", { label: "Voiceover", status: "skipped" });
    }

    /* ================= 8. Render ================= */
    await setStep(job._id, "render", { label: "Video render karie chie", status: "running" });

    const scenes: Scene[] = plan.scenes.map((planned, index) => ({
      source: sceneMedia[index].path,
      sourceType: sceneMedia[index].kind,
      // Video clip scene karta tunku aavyu hoy to scene ne j tunko karo —
      // nahi to chhelli frame thijeli dekhay che.
      duration: sceneMedia[index].clipDuration
        ? Math.min(planned.duration, sceneMedia[index].clipDuration!)
        : planned.duration,
      // AI video ma halchal andar j che — upar thi Ken Burns naakhie to
      // be halchal bhegi thai ne chakkar aave evu lage che.
      motion: sceneMedia[index].kind === "video" ? "none" : planned.motion,
      transition: planned.transition,
      overlays: planned.onScreenText
        ? [
            {
              text: planned.onScreenText,
              position: planned.purpose === "hook" ? "center" : index % 2 === 0 ? "bottom" : "top",
              size: planned.purpose === "hook" || planned.purpose === "cta" ? "hero" : "large",
              style: planned.purpose === "hook" ? "outline" : "box",
            },
          ]
        : [],
    }));

    const outputPath = path.join(workDir, "reel.mp4");
    const language = input.language ?? analysis.language ?? "en";

    const render = await renderReel({
      scenes,
      outputPath,
      musicPath,
      voiceoverPath,
      script: scriptForLanguage(language),
      watermark: process.env.REEL_WATERMARK || undefined,
      onProgress: (p) => {
        void setStep(job._id, "render", { status: "running", note: p.step });
      },
    });

    await setStep(job._id, "render", {
      status: "done",
      ms: render.ms,
      note: `${render.duration.toFixed(1)}s · ${(render.bytes / 1024 / 1024).toFixed(1)}MB`,
    });

    /* ================= 9. Save + public URL ================= */
    await setStep(job._id, "upload", { label: "Public URL banavie chie", status: "running" });

    const videoAsset = await saveMedia({
      data: await readFile(render.outputPath),
      filename: `reel-${job._id}.mp4`,
      mimeType: "video/mp4",
      role: "reel",
      brand: String(brand._id),
      createdBy: input.createdBy,
      duration: render.duration,
      width: render.width,
      height: render.height,
      provider: "ffmpeg",
    });

    const thumbnailAsset = await saveMedia({
      data: await readFile(render.thumbnailPath),
      filename: `reel-${job._id}-cover.jpg`,
      mimeType: "image/jpeg",
      role: "thumbnail",
      brand: String(brand._id),
      createdBy: input.createdBy,
    });

    // Meta ne aapva mate public URL joiye j che.
    const videoUrl = await ensurePublicUrl(videoAsset);
    const thumbnailUrl = await ensurePublicUrl(thumbnailAsset).catch(() => "");

    await setStep(job._id, "upload", {
      status: "done",
      provider: videoAsset.host,
      note: videoUrl.slice(0, 90),
    });

    /* ================= 10. Caption ================= */
    await setStep(job._id, "copy", { label: "Caption ane hashtags lakhie chie", status: "running" });

    const copyRun = await timed(async () => {
      const [instagram, facebook] = await Promise.all([
        generateSocialCopy({
          product: analysis,
          trends,
          platform: "instagram",
          format: "reel",
          brandName: brand.name,
          brandVoice: brand.brandVoice ?? undefined,
          language: input.language ?? analysis.language,
          productUrl: input.productUrl,
          price: input.price,
        }),
        generateSocialCopy({
          product: analysis,
          trends,
          platform: "facebook",
          format: "reel",
          brandName: brand.name,
          brandVoice: brand.brandVoice ?? undefined,
          language: input.language ?? analysis.language,
          productUrl: input.productUrl,
          price: input.price,
        }),
      ]);
      return { instagram, facebook };
    });

    await setStep(job._id, "copy", {
      status: "done",
      ms: copyRun.ms,
      note: `IG score ${copyRun.value.instagram.score.score}/100 · FB score ${copyRun.value.facebook.score.score}/100`,
    });

    /* ================= Puru ================= */
    const audioInfo = {
      track: music ? `${music.track.title} — ${music.track.artist} (${music.track.license})` : null,
      mood,
      instagramHint: instagramAudioHints(mood),
    };

    job.scenes = plan.scenes.map((planned, index) => ({
      index,
      purpose: planned.purpose,
      duration: planned.duration,
      motion: planned.motion,
      transition: planned.transition,
      onScreenText: planned.onScreenText,
      voiceLine: planned.voiceLine,
      media: sceneMedia[index].assetId,
      imagePrompt: planned.imagePrompt,
      imageSource: sceneMedia[index].source,
      mediaKind: sceneMedia[index].kind,
      videoPrompt: sceneMedia[index].kind === "video" ? planned.videoPrompt : "",
    })) as never;

    job.copy = copyRun.value;
    job.audio = audioInfo;
    job.output = videoAsset._id;
    job.thumbnail = thumbnailAsset._id;
    job.duration = render.duration;
    job.status = "done";
    job.finishedAt = new Date();
    job.ms = Date.now() - started;
    await job.save();

    // Vachhe na temp file (scene clips, normalise kareli image, voiceover)
    // have jarur nathi — video ane keyframes MediaAsset ma save thai gaya che.
    // Aa na karie to disk dhime dhime bharai jaay.
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);

    /* ---- Automation e kahyu hoy to jate j publish pan kari do ---- */
    if (job.autoDistribute?.enabled) {
      await setStep(job._id, "distribute", {
        label: "Jate publish karie chie",
        status: "running",
      });
      try {
        // Dynamic import — publish.ts pachho aa file ne import na kare etle
        // cycle no dar nathi, pan Next na bundling mate aa safe rasto che.
        const { distributeReel } = await import("./publish");
        const distributed = await distributeReel({
          jobId: String(job._id),
          brandId: String(brand._id),
          accountIds: job.autoDistribute.accountIds?.length
            ? job.autoDistribute.accountIds
            : undefined,
          when: (job.autoDistribute.when ?? "now") as "now" | "auto" | "draft",
          hashtagsInFirstComment: job.autoDistribute.hashtagsInFirstComment ?? true,
          createdBy: input.createdBy,
        });

        job.autoDistribute.result = {
          created: distributed.created.length,
          failed: distributed.created.filter((c) => c.error).length,
          skipped: distributed.skipped.length,
        };
        await job.save();

        await setStep(job._id, "distribute", {
          status: "done",
          note: `${distributed.created.length} post`,
        });
      } catch (error) {
        job.autoDistribute.error = (error as Error).message;
        await job.save();
        warnings.push(`Jate publish na thayu: ${(error as Error).message}`);
        await setStep(job._id, "distribute", {
          status: "failed",
          error: (error as Error).message,
        });
      }
    }

    await logActivity({
      level: warnings.length ? "warning" : "success",
      action: "reel.generated",
      message: `Reel banyu: ${analysis.productName} (${render.duration.toFixed(0)}s, ${plan.scenes.length} scene)`,
      meta: { jobId: String(job._id), warnings },
    });

    return {
      jobId: String(job._id),
      videoUrl,
      videoAssetId: String(videoAsset._id),
      thumbnailUrl,
      duration: render.duration,
      plan,
      analysis,
      trends,
      copy: copyRun.value,
      audio: audioInfo,
      warnings,
    };
  } catch (error) {
    job.status = "failed";
    job.error = (error as Error).message;
    job.finishedAt = new Date();
    job.ms = Date.now() - started;
    await job.save();

    await logActivity({
      level: "error",
      action: "reel.failed",
      message: `Reel fail: ${(error as Error).message}`,
      meta: { jobId: String(job._id) },
    });

    throw error;
  }
}

/* ------------------------------------------------------------------ *
 *  Scene dith image
 * ------------------------------------------------------------------ */

type SceneMedia = {
  path: string;
  assetId?: import("mongoose").Types.ObjectId;
  source: "uploaded" | "generated" | "tryon";
  /** ffmpeg ne image ane video alag rite khavdavva pade che. */
  kind: "image" | "video";
  /** Video hoy to eni asli lambai — scene aana thi lambo na hovo joiye. */
  clipDuration?: number;
};

/**
 * Dareak scene mate image taiyar kare.
 *
 * Sauthi agatya no niyam: AI ni image FAIL thay to upload kareli image
 * vaparie chie — reel kyarey atkatu nathi. Ek scene ni image na male e
 * karane aakhu kaam bagade e barabar nathi.
 */
async function buildSceneMedia(opts: {
  plan: ReelPlan;
  images: MediaAssetDocument[];
  avatar: AvatarDoc | null;
  analysis: ProductIntelligence;
  brandId: string;
  workDir: string;
  warnings: string[];
}): Promise<SceneMedia[]> {
  const { plan, images, avatar, analysis, workDir } = opts;

  // Upload kareli badhi image ne ek var normalise kari laiye.
  const normalised = new Map<string, string>();
  for (const asset of images) {
    normalised.set(String(asset._id), await renderableImage(asset, workDir));
  }

  const fallbackFor = (index: number): SceneMedia => {
    const asset = images[index % images.length];
    return {
      path: normalised.get(String(asset._id))!,
      assetId: asset._id,
      source: "uploaded",
      kind: "image",
    };
  };

  const avatarPhoto = avatar?.primaryPhoto
    ? await MediaAsset.findById(avatar.primaryPhoto)
    : avatar?.referencePhotos?.length
      ? await MediaAsset.findById(avatar.referencePhotos[0])
      : null;

  const results = new Array<SceneMedia>(plan.scenes.length);

  // AI image generation dhimu che — sathe sathe chalavie chie, pan free
  // tier ni rate limit na lage etle ek saathe fakt 2.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= plan.scenes.length) return;

      results[index] = await buildOneScene(plan.scenes[index], index);
    }
  };

  /**
   * Ek scene nu media — hamesha be tabakke.
   *
   *   1. STILL image taiyar karo (upload kareli, AI e banaveli, ke try-on)
   *   2. Plan ma "video" lakhyu hoy to E J IMAGE ne Omni thi halavo
   *
   * Bijo tabakko fail thay to pehla tabakka ni image j vaparie chie — video
   * na banvathi reel kyarey atkatu nathi.
   */
  async function buildOneScene(scene: PlannedScene, index: number): Promise<SceneMedia> {
    const still = await buildStill(scene, index);

    if (scene.motionStrategy !== "video" || !aiVideoConfigured()) return still;

    try {
      return await animate(still, scene, index);
    } catch (error) {
      opts.warnings.push(
        `Scene ${index + 1} nu AI video na banyu (${(error as Error).message}) — e j image ne halavi ne vaparie chie.`,
      );
      return still;
    }
  }

  async function buildStill(scene: PlannedScene, index: number): Promise<SceneMedia> {
    if (scene.imageStrategy === "uploaded" || images.length === 0) {
      return fallbackFor(scene.uploadedImageIndex >= 0 ? scene.uploadedImageIndex : index);
    }

    try {
      if (scene.imageStrategy === "tryon" && avatarPhoto) {
        const productAsset = images[Math.max(0, scene.uploadedImageIndex)] ?? images[0];
        const result = await virtualTryOn({
          person: await readFile(await ensureLocalPath(avatarPhoto)),
          garment: await readFile(await ensureLocalPath(productAsset)),
          category: tryOnCategory(analysis.apparelType),
          description: [
            analysis.productName,
            analysis.colors.join(" "),
            analysis.materials.join(" "),
            scene.imagePrompt,
          ]
            .filter(Boolean)
            .join(", ")
            .slice(0, 400),
          aspectRatio: "9:16",
        });

        return saveGenerated(result.data.data, result.data.provider, scene.imagePrompt, "tryon", index);
      }

      // "generate" — product ne reference tarike aapie chie jethi AI product
      // ne badli na naakhe, fakt aajubaju nu drashya banave.
      const productAsset = images[Math.max(0, scene.uploadedImageIndex)] ?? images[0];
      const result = await generateImage({
        prompt: buildScenePrompt(scene, analysis, avatar),
        references: [
          {
            data: await readFile(await ensureLocalPath(productAsset)),
            mimeType: productAsset.mimeType,
            role: "product",
          },
          ...(avatarPhoto
            ? [
                {
                  data: await readFile(await ensureLocalPath(avatarPhoto)),
                  mimeType: avatarPhoto.mimeType,
                  role: "person" as const,
                },
              ]
            : []),
        ],
        aspectRatio: "9:16",
      });

      return saveGenerated(result.data.data, result.data.provider, scene.imagePrompt, "generated", index);
    } catch (error) {
      opts.warnings.push(
        `Scene ${index + 1} ni AI image na bani (${(error as Error).message}) — tamari potani image vaparie chie.`,
      );
      return fallbackFor(index);
    }
  }

  async function saveGenerated(
    data: Buffer,
    provider: string,
    prompt: string,
    source: "generated" | "tryon",
    index: number,
  ): Promise<SceneMedia> {
    const asset = await saveMedia({
      data,
      filename: `scene-${index}.jpg`,
      mimeType: "image/jpeg",
      role: "keyframe",
      brand: opts.brandId,
      provider,
      prompt,
    });

    const filePath = path.join(workDir, `scene-${index}.jpg`);
    await writeFile(filePath, data);

    return { path: filePath, assetId: asset._id, source, kind: "image" };
  }

  /**
   * Still image → Omni → kharekhar halto video.
   *
   * Image ne reference tarike aapvi e ahiya sauthi agatya ni vaat che: prompt
   * ma fakt HALCHAL nu varnan jaay che, product nu nahi. Etle Omni product ne
   * potani rite kalpi nathi sakto — e j kapdu, e j rang, e j chehro rahe che.
   */
  async function animate(
    still: SceneMedia,
    scene: PlannedScene,
    index: number,
  ): Promise<SceneMedia> {
    const clip = await generateVideoClip({
      prompt: buildVideoPrompt(scene, analysis),
      image: { data: await readFile(still.path), mimeType: "image/jpeg" },
      aspectRatio: "9:16",
      durationSeconds: scene.duration,
    });

    const filePath = path.join(workDir, `scene-${index}.mp4`);
    await writeFile(filePath, clip.data.data);

    // Omni ketlu lambu video aape e nakki nathi — asli lambai maapi laiye,
    // jethi scene ni lambai ena thi vadhare na rahi jaay (nahi to chhello
    // bhaag thijeli frame jevo dekhay che).
    const info = await probe(filePath).catch(() => null);

    const asset = await saveMedia({
      data: clip.data.data,
      filename: `scene-${index}.mp4`,
      mimeType: clip.data.mimeType,
      role: "clip",
      brand: opts.brandId,
      provider: clip.data.provider,
      prompt: scene.videoPrompt,
      duration: info?.duration,
      width: info?.width,
      height: info?.height,
    });

    return {
      path: filePath,
      assetId: asset._id,
      source: still.source,
      kind: "video",
      clipDuration: info?.duration,
    };
  }

  await Promise.all(
    Array.from({ length: Math.min(2, plan.scenes.length) }, worker),
  );

  return results;
}

function tryOnCategory(apparelType: string): string {
  const type = apparelType.toLowerCase();
  if (/dress|saree|lehenga|gown|jumpsuit|kurti|anarkali/.test(type)) return "dresses";
  if (/jean|trouser|pant|skirt|short|legging|palazzo/.test(type)) return "lower_body";
  return "upper_body";
}

/**
 * Omni ne aapvano prompt.
 *
 * Ahiya PRODUCT nu varnan jaani joine nathi — e reference image ma j che.
 * Lakhie to Omni be vaat vachhe gothvai jaay che ane product badlai jaay che.
 * Fakt "su hale che" ane "camera kem fare" — bas etlu j.
 */
function buildVideoPrompt(scene: PlannedScene, analysis: ProductIntelligence): string {
  const cameraFallback: Record<string, string> = {
    "zoom-in": "the camera pushes in slowly",
    "zoom-out": "the camera pulls back slowly",
    "pan-left": "the camera drifts slowly to the left",
    "pan-right": "the camera drifts slowly to the right",
    "pan-up": "the camera tilts slowly upward",
    "pan-down": "the camera tilts slowly downward",
    none: "the camera stays locked off",
  };

  return [
    "Animate the reference image into live footage.",
    scene.videoPrompt ||
      `Subtle, believable motion for a ${analysis.category.toLowerCase()} product shot — ${cameraFallback[scene.motion] ?? "slow gentle camera movement"}.`,
    `Camera: ${cameraFallback[scene.motion] ?? "slow gentle movement"}.`,
    "Realistic physics — fabric, hair and light move naturally. No morphing, no warping, no extra limbs.",
    "Keep the same framing, the same background and the same colour grade as the reference image.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildScenePrompt(
  scene: PlannedScene,
  analysis: ProductIntelligence,
  avatar: AvatarDoc | null,
): string {
  return [
    scene.imagePrompt ||
      `A lifestyle shot for ${analysis.productName} in a ${analysis.occasions[0] ?? "everyday"} setting`,
    "",
    `The product is: ${analysis.productName} — ${analysis.colors.join(", ")} ${analysis.materials.join(", ")}. Keep it exactly as shown in the product reference image.`,
    avatar ? `The person is: ${avatarPromptDescription(avatar)}. Keep their face unchanged.` : "",
    "",
    "Vertical 9:16 composition, photorealistic, sharp focus on the product, natural lighting, shallow depth of field.",
    "No text, no logos, no watermarks, no borders anywhere in the image.",
  ]
    .filter(Boolean)
    .join("\n");
}
