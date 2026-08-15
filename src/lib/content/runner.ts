/**
 * The "Create New" pipeline.
 *
 *   your photo
 *      ↓  understand  — what the product is, and who buys it
 *      ↓  trends      — what people search for, and the hashtag ladder
 *      ↓  script      — the angle, the image prompt, one prompt per clip
 *      ↓  image       — Nano Banana renders the feed image from your photo
 *      ↓  copy        — caption and hashtags, scored and rewritten
 *      ↓  video       — Veo renders one clip per beat, from that image
 *      ↓  assemble    — ffmpeg joins them with music into a 1080x1920 reel
 *      ↓  save        — an image post and a reel post, on the Posts page
 *
 * Every step is written to the ContentJob as it happens, which is what the
 * progress panel reads. A step that fails is recorded and the run continues
 * wherever it sensibly can — losing the video should never cost you the post.
 */

import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";

import { connectDB } from "@/lib/db";
import { Brand } from "@/models/Brand";
import { Avatar, avatarPromptDescription } from "@/models/Avatar";
import { MediaAsset } from "@/models/MediaAsset";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { logActivity } from "@/models/ActivityLog";
import {
  ContentJob,
  CONTENT_STEPS,
  setContentStep,
  type ContentJobDocument,
} from "@/models/ContentJob";

import {
  analyzeProductImages,
  briefFromText,
  productLabel,
  type ProductIntelligence,
} from "@/lib/ai/vision";
import { buildTrendPack } from "@/lib/trends/keywords";
import { writeContentScript } from "./script";
import { generateSocialCopy } from "@/lib/seo/copy";
import { composeImage, generateImage } from "@/lib/media/image-gen";
import { CLIP_SECONDS, clipsForDuration, generateVeoClip } from "@/lib/video/veo";
import {
  pickMusic,
  instagramAudioHints,
  type MusicMood,
} from "@/lib/trends/audio";
import { renderReel, type Scene } from "@/lib/video/render";
import {
  ensureDir,
  ensureLocalPath,
  ensurePublicUrl,
  mediaRoot,
  saveMedia,
} from "@/lib/media/store";

/* ------------------------------------------------------------------ *
 *  Concurrency — a render eats the CPU, so only a couple at a time
 * ------------------------------------------------------------------ */

const globalForRunner = globalThis as unknown as { _contentRunning?: Set<string> };
const running: Set<string> = globalForRunner._contentRunning ?? new Set();
globalForRunner._contentRunning = running;

function maxConcurrent(): number {
  return Math.max(1, Number(process.env.CONTENT_MAX_CONCURRENT || 2));
}

export function contentRunnerStatus() {
  return { running: running.size, maxConcurrent: maxConcurrent() };
}

/* ------------------------------------------------------------------ */

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  return { value: await fn(), ms: Date.now() - started };
}

/**
 * Starts a job and returns immediately. The caller polls the job for progress.
 */
export async function startContentJob(input: {
  brandId: string;
  imageAssetIds: string[];
  productName?: string;
  productUrl?: string;
  price?: string;
  notes?: string;
  avatarId?: string;
  language?: string;
  tone?: string;
  videoSeconds?: number;
  wantVideo?: boolean;
  accountIds?: string[];
  platforms?: string[];
  createdBy?: string;
}): Promise<{ jobId: string }> {
  await connectDB();

  const job = await ContentJob.create({
    brand: input.brandId,
    sourceImages: input.imageAssetIds,
    productName: input.productName,
    productUrl: input.productUrl,
    price: input.price,
    notes: input.notes,
    avatar: input.avatarId,
    language: input.language ?? "en",
    tone: input.tone,
    videoSeconds: input.videoSeconds ?? 30,
    wantVideo: input.wantVideo !== false,
    accountIds: input.accountIds ?? [],
    platforms: input.platforms ?? [],
    status: "queued",
    createdBy: input.createdBy,
    steps: CONTENT_STEPS.filter(
      (step) => step.key !== "video" || input.wantVideo !== false,
    )
      .filter((step) => step.key !== "assemble" || input.wantVideo !== false)
      .map((step) => ({ ...step, status: "pending" as const })),
  });

  const jobId = String(job._id);

  // Detached on purpose — the HTTP response must not wait for a render.
  void runContentJob(jobId).catch((error) => {
    console.error("[content] job crashed", error);
  });

  return { jobId };
}

/* ------------------------------------------------------------------ *
 *  The pipeline
 * ------------------------------------------------------------------ */

export async function runContentJob(jobId: string): Promise<void> {
  await connectDB();

  const job = await ContentJob.findById(jobId);
  if (!job) return;

  running.add(jobId);
  const started = Date.now();
  const warnings: string[] = [];

  job.status = "running";
  job.startedAt = new Date();
  await job.save();

  const workDir = path.join(mediaRoot(), "..", "work", `content-${jobId}`);
  await ensureDir(workDir);

  try {
    const brand = await Brand.findById(job.brand);
    if (!brand) throw new Error("Brand not found");

    const avatar = job.avatar ? await Avatar.findById(job.avatar).lean() : null;

    /* ============ 1. Understand ============ */
    await setContentStep(jobId, "understand", { status: "running" });

    const images = await MediaAsset.find({
      _id: { $in: job.sourceImages },
      kind: "image",
    });

    let analysis: ProductIntelligence;
    let visionProvider = "typed description";

    if (images.length > 0) {
      const buffers = await Promise.all(
        images.map(async (asset) => ({
          data: await readFile(await ensureLocalPath(asset)),
          mimeType: asset.mimeType,
        })),
      );
      const result = await analyzeProductImages(buffers, {
        hint: [job.productName, job.notes].filter(Boolean).join(". ") || undefined,
        market: process.env.DEFAULT_MARKET || "India",
        fallbackName: job.productName || brand.name,
      });
      analysis = result.data;
      visionProvider = result.provider;
    } else {
      analysis = briefFromText({ name: job.productName, notes: job.notes });

      // Photos were asked for but none resolved. Silently degrading here would
      // leave someone wondering why their photo had no effect.
      if (job.sourceImages.length > 0) {
        warnings.push(
          "The photos could not be loaded, so the post was written from the name and notes alone. Try uploading them again.",
        );
      }
    }

    if (job.productName?.trim()) analysis.productName = job.productName.trim();

    const label = productLabel(analysis, brand.name);
    job.analysis = analysis;
    await job.save();

    if (analysis.degraded) {
      warnings.push(
        "No AI could read the photo, so the post was built from what you typed. Adding a product name improves everything downstream.",
      );
    }

    await setContentStep(jobId, "understand", {
      status: analysis.degraded ? "skipped" : "done",
      provider: visionProvider,
      note: `${label}${analysis.category ? ` — ${analysis.category}` : ""}`,
      output: {
        productName: label,
        category: analysis.category,
        colors: analysis.colors,
        materials: analysis.materials,
        audience: analysis.targetAudience,
        sellingPoints: analysis.sellingPoints?.slice(0, 4),
      },
    });

    /* ============ 2. Trends ============ */
    await setContentStep(jobId, "trends", { status: "running" });

    const trendsRun = await timed(() =>
      buildTrendPack({ product: analysis, brandTag: brand.name }),
    );
    const trends = trendsRun.value;
    job.trends = trends;
    await job.save();

    await setContentStep(jobId, "trends", {
      status: "done",
      ms: trendsRun.ms,
      provider: trends.sources.join(", ").slice(0, 80),
      note: `${trends.hashtags.length} hashtags, ${trends.keywords.length} keywords`,
      output: {
        keywords: trends.keywords.slice(0, 12),
        hashtags: trends.hashtags.slice(0, 30).map((tag) => tag.tag),
        rising: trends.risingTopics,
      },
    });

    /* ============ 3. Script and prompts ============ */
    await setContentStep(jobId, "script", { status: "running" });

    const beatCount = job.wantVideo ? clipsForDuration(job.videoSeconds) : 0;

    const scriptRun = await timed(() =>
      writeContentScript({
        product: analysis,
        trends,
        brandName: brand.name,
        brandVoice: brand.brandVoice,
        language: job.language,
        price: job.price,
        tone: job.tone,
        beatCount: Math.max(beatCount, 1),
        clipSeconds: CLIP_SECONDS,
        avatarDescription: avatar ? avatarPromptDescription(avatar) : undefined,
      }),
    );
    const script = scriptRun.value;
    job.script = script;
    await job.save();

    if (script.fromTemplate) {
      warnings.push("The script used the built-in template because no AI provider answered.");
    }

    await setContentStep(jobId, "script", {
      status: "done",
      ms: scriptRun.ms,
      provider: script.fromTemplate ? "template" : "ai",
      note: `${script.beats.length} shots — ${script.concept.slice(0, 60)}`,
      output: {
        concept: script.concept,
        imagePrompt: script.imagePrompt,
        coverText: script.coverText,
        storyText: script.storyText,
        musicMood: script.musicMood,
        beats: script.beats,
      },
    });

    /* ============ 4. The post image (Nano Banana) ============ */
    await setContentStep(jobId, "image", { status: "running" });

    let postImageAsset = images[0] ?? null;
    let postImageBuffer: Buffer | null = null;

    try {
      const sourceBuffer = images[0]
        ? await readFile(await ensureLocalPath(images[0]))
        : null;

      const imageRun = await timed(() =>
        sourceBuffer
          ? composeImage({
              prompt: script.imagePrompt,
              references: [
                { data: sourceBuffer, mimeType: "image/jpeg", role: "product" },
                ...(avatar?.primaryPhoto
                  ? []
                  : ([] as { data: Buffer; mimeType: string; role: "person" }[])),
              ],
              aspectRatio: "4:5",
            })
          : generateImage({ prompt: script.imagePrompt, aspectRatio: "4:5" }),
      );

      postImageBuffer = imageRun.value.data.data;
      postImageAsset = await saveMedia({
        data: postImageBuffer,
        filename: `post-${label.slice(0, 40)}.jpg`,
        mimeType: imageRun.value.data.mimeType,
        role: "generated",
        brand: String(brand._id),
        createdBy: job.createdBy ? String(job.createdBy) : undefined,
        provider: imageRun.value.provider,
        prompt: script.imagePrompt,
        makePublic: true,
      });

      job.postImage = postImageAsset._id;
      await job.save();

      await setContentStep(jobId, "image", {
        status: "done",
        ms: imageRun.ms,
        provider: imageRun.value.provider,
        note: `${(postImageBuffer.length / 1024).toFixed(0)} KB`,
        output: { url: `/api/media/${postImageAsset._id}`, prompt: script.imagePrompt },
      });
    } catch (error) {
      // Fall back to the seller's own photo — it is a real product shot, which
      // is never a bad outcome.
      warnings.push(
        `The marketing image could not be generated (${(error as Error).message.slice(0, 120)}). Your original photo is used instead.`,
      );
      if (images[0]) {
        postImageAsset = images[0];
        postImageBuffer = await readFile(await ensureLocalPath(images[0]));
        job.postImage = images[0]._id;
        await job.save();
      }
      await setContentStep(jobId, "image", {
        status: "failed",
        error: (error as Error).message.slice(0, 200),
        note: images[0] ? "Using your original photo" : "No image available",
      });
    }

    /* ============ 5. Caption and hashtags ============ */
    await setContentStep(jobId, "copy", { status: "running" });

    const platforms: Array<"instagram" | "facebook"> = job.platforms.length
      ? (job.platforms as Array<"instagram" | "facebook">)
      : ["instagram", "facebook"];

    const copyRun = await timed(async () => {
      const out: Record<string, Awaited<ReturnType<typeof generateSocialCopy>>> = {};
      for (const platform of platforms) {
        out[platform] = await generateSocialCopy({
          product: analysis,
          trends,
          platform,
          format: job.wantVideo ? "reel" : "image",
          brandName: brand.name,
          brandVoice: brand.brandVoice,
          language: job.language,
          productUrl: job.productUrl,
          price: job.price,
        });
      }
      return out;
    });

    const copy = copyRun.value;
    job.copy = copy;
    await job.save();

    const scores = platforms.map((platform) => `${platform} ${copy[platform].score.score}/100`);
    if (platforms.some((platform) => copy[platform].fromTemplate)) {
      warnings.push("The caption used the built-in template because no AI provider answered.");
    }

    await setContentStep(jobId, "copy", {
      status: "done",
      ms: copyRun.ms,
      note: scores.join(" · "),
      output: Object.fromEntries(
        platforms.map((platform) => [
          platform,
          {
            caption: copy[platform].caption,
            description: copy[platform].description,
            hashtags: copy[platform].hashtags,
            firstComment: copy[platform].firstComment,
            score: copy[platform].score.score,
            grade: copy[platform].score.grade,
            suggestions: copy[platform].score.checks
              .filter((check) => !check.passed)
              .map((check) => check.label),
          },
        ]),
      ),
    });

    /* ============ 6 + 7. The reel ============ */
    let reelAsset: Awaited<ReturnType<typeof saveMedia>> | null = null;
    let thumbnailAsset: Awaited<ReturnType<typeof saveMedia>> | null = null;

    if (job.wantVideo && script.beats.length > 0) {
      await setContentStep(jobId, "video", { status: "running" });

      const clipPaths: Array<{ file: string; seconds: number; text: string }> = [];
      const clipAssets: string[] = [];
      const videoStarted = Date.now();
      let clipProvider = "";

      for (const beat of script.beats) {
        await setContentStep(jobId, "video", {
          status: "running",
          note: `Clip ${beat.index + 1} of ${script.beats.length}`,
        });

        try {
          const clip = await generateVeoClip({
            prompt: beat.prompt,
            aspectRatio: "9:16",
            // The first frame is the real product, so Veo animates it rather
            // than inventing its own version.
            image: postImageBuffer ?? undefined,
          });

          const file = path.join(workDir, `clip-${beat.index}.mp4`);
          await writeFile(file, clip.data.data);
          clipPaths.push({
            file,
            seconds: clip.data.seconds,
            text: beat.onScreenText,
          });
          clipProvider = clip.provider;

          const asset = await saveMedia({
            data: clip.data.data,
            filename: `clip-${beat.index}.mp4`,
            mimeType: "video/mp4",
            role: "clip",
            brand: String(brand._id),
            provider: clip.provider,
            prompt: beat.prompt,
            makePublic: false,
          });
          clipAssets.push(String(asset._id));
        } catch (error) {
          warnings.push(
            `Clip ${beat.index + 1} failed (${(error as Error).message.slice(0, 100)}).`,
          );
        }
      }

      job.clips = clipAssets as never;
      await job.save();

      /* ---- Fall back to animated stills ---- */
      //
      // Veo is paid and rate limited, so "no clips" is a normal outcome rather
      // than an exceptional one. Losing the entire reel over it would be the
      // wrong trade: ffmpeg can pan and zoom across the generated image and
      // the seller's own photos and produce a real, publishable reel of the
      // requested length. Less impressive than generated motion, but it ships.
      if (clipPaths.length === 0) {
        const stills: string[] = [];
        if (postImageBuffer) {
          const file = path.join(workDir, "still-post.jpg");
          await writeFile(file, postImageBuffer);
          stills.push(file);
        }
        for (const [index, asset] of images.entries()) {
          stills.push(await ensureLocalPath(asset));
          if (index >= 3) break;
        }

        if (stills.length > 0) {
          const perStill = Math.max(
            3,
            Math.round((job.videoSeconds / stills.length) * 10) / 10,
          );
          for (const [index, file] of stills.entries()) {
            clipPaths.push({
              file,
              seconds: perStill,
              text: script.beats[index]?.onScreenText ?? "",
            });
          }
          clipProvider = "ffmpeg (animated stills)";
          warnings.push(
            "The AI video model was unavailable, so the reel was built by animating your product images instead.",
          );
        }
      }

      if (clipPaths.length === 0) {
        await setContentStep(jobId, "video", {
          status: "failed",
          error: "No clip could be generated and there was no image to animate",
          note: "The reel was skipped; your image post is still ready",
        });
        await setContentStep(jobId, "assemble", { status: "skipped" });
      } else {
        await setContentStep(jobId, "video", {
          status: "done",
          ms: Date.now() - videoStarted,
          provider: clipProvider,
          note: `${clipPaths.length} of ${script.beats.length} clips · ${clipPaths.reduce((sum, clip) => sum + clip.seconds, 0)}s`,
          output: {
            clips: script.beats.map((beat) => ({
              index: beat.index,
              purpose: beat.purpose,
              prompt: beat.prompt,
            })),
          },
        });

        /* ---- Assemble ---- */
        await setContentStep(jobId, "assemble", { status: "running" });

        try {
          // The schema constrains this, but a model can still surprise us.
          const moods: MusicMood[] = [
            "upbeat", "chill", "cinematic", "luxury",
            "festive", "energetic", "romantic", "hiphop",
          ];
          const mood: MusicMood = moods.includes(script.musicMood as MusicMood)
            ? (script.musicMood as MusicMood)
            : "upbeat";

          const music = await pickMusic({
            mood,
            minDuration: clipPaths.reduce((sum, clip) => sum + clip.seconds, 0),
          });

          // A clip may be generated video or, on the fallback path, a still.
          const motions = ["zoom-in", "pan-right", "zoom-out", "pan-left"] as const;

          const scenes: Scene[] = clipPaths.map((clip, index) => ({
            source: clip.file,
            sourceType: /.(mp4|mov|webm)$/i.test(clip.file)
              ? ("video" as const)
              : ("image" as const),
            duration: clip.seconds,
            motion: /.(mp4|mov|webm)$/i.test(clip.file)
              ? undefined
              : motions[index % motions.length],
            transition: index === 0 ? ("none" as const) : ("fade" as const),
            overlays: clip.text
              ? [
                  {
                    text: clip.text,
                    position: "bottom" as const,
                    size: "large" as const,
                    style: "shadow" as const,
                  },
                ]
              : [],
          }));

          const outputPath = path.join(workDir, "reel.mp4");
          const musicPath = music ? await ensureLocalPath(music.asset) : undefined;

          const assembleRun = await timed(() =>
            renderReel({
              scenes,
              outputPath,
              musicPath,
              watermark: process.env.REEL_WATERMARK || undefined,
            }),
          );
          const render = assembleRun.value;

          reelAsset = await saveMedia({
            data: await readFile(render.outputPath),
            filename: `reel-${label.slice(0, 40)}.mp4`,
            mimeType: "video/mp4",
            role: "reel",
            brand: String(brand._id),
            duration: render.duration,
            width: render.width,
            height: render.height,
            makePublic: true,
          });

          thumbnailAsset = await saveMedia({
            data: await readFile(render.thumbnailPath),
            filename: `reel-cover-${label.slice(0, 40)}.jpg`,
            mimeType: "image/jpeg",
            role: "thumbnail",
            brand: String(brand._id),
            makePublic: true,
          });

          job.reelVideo = reelAsset._id;
          job.reelThumbnail = thumbnailAsset._id;
          job.reelDuration = render.duration;
          await job.save();

          await setContentStep(jobId, "assemble", {
            status: "done",
            ms: assembleRun.ms,
            note: `${render.duration.toFixed(1)}s · ${(render.bytes / 1024 / 1024).toFixed(1)}MB · ${render.width}x${render.height}`,
            output: {
              url: `/api/media/${reelAsset._id}`,
              music: music?.track.title ?? null,
              instagramAudio: instagramAudioHints(mood),
            },
          });
        } catch (error) {
          warnings.push(`The reel could not be assembled: ${(error as Error).message.slice(0, 150)}`);
          await setContentStep(jobId, "assemble", {
            status: "failed",
            error: (error as Error).message.slice(0, 200),
          });
        }
      }
    }

    /* ============ 8. Save the posts ============ */
    await setContentStep(jobId, "save", { status: "running" });

    const accounts = job.accountIds.length
      ? await SocialAccount.find({
          _id: { $in: job.accountIds },
          brand: brand._id,
          status: "connected",
        })
      : [];

    const imageUrl = postImageAsset ? await ensurePublicUrl(postImageAsset).catch(() => undefined) : undefined;
    const reelUrl = reelAsset ? await ensurePublicUrl(reelAsset).catch(() => undefined) : undefined;
    const coverUrl = thumbnailAsset
      ? await ensurePublicUrl(thumbnailAsset).catch(() => undefined)
      : undefined;

    const postIds: string[] = [];

    for (const platform of platforms) {
      const platformCopy = copy[platform];
      const targets = accounts.filter((account) => account.platform === platform);
      const rows = targets.length > 0 ? targets : [null];

      for (const account of rows) {
        // The image post.
        const imagePost = await Post.create({
          brand: brand._id,
          account: account?._id,
          platform,
          postType: "image",
          caption: platformCopy.caption,
          hashtags: platformCopy.hashtags,
          mediaUrl: imageUrl,
          mediaType: imageUrl ? "image" : "none",
          mediaAsset: postImageAsset?._id,
          firstComment: platformCopy.firstComment,
          seo: platformCopy.score,
          prompt: script.concept,
          status: "draft",
          generatedByAI: !platformCopy.fromTemplate,
          source: "ai",
          createdBy: job.createdBy,
        });
        postIds.push(String(imagePost._id));

        // The reel, when there is one.
        if (reelUrl) {
          const reelPost = await Post.create({
            brand: brand._id,
            account: account?._id,
            platform,
            postType: "reel",
            caption: platformCopy.caption,
            hashtags: platformCopy.hashtags,
            mediaUrl: reelUrl,
            mediaType: "video",
            thumbnailUrl: coverUrl,
            mediaAsset: reelAsset?._id,
            firstComment: platformCopy.firstComment,
            seo: platformCopy.score,
            prompt: script.concept,
            status: "draft",
            generatedByAI: !platformCopy.fromTemplate,
            source: "ai",
            createdBy: job.createdBy,
          });
          postIds.push(String(reelPost._id));
        }
      }
    }

    job.posts = postIds as never;
    await job.save();

    if (accounts.length === 0) {
      warnings.push(
        "No account was selected, so these are drafts. Connect Instagram or Facebook to publish them.",
      );
    }

    await setContentStep(jobId, "save", {
      status: "done",
      note: `${postIds.length} post${postIds.length === 1 ? "" : "s"} saved as drafts`,
      output: { postIds },
    });

    /* ---- Done ---- */
    job.status = "done";
    job.warnings = warnings;
    job.finishedAt = new Date();
    job.ms = Date.now() - started;
    await job.save();

    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);

    await logActivity({
      level: "success",
      action: "content.created",
      message: `"${label}" — ${postIds.length} posts${reelUrl ? " and a reel" : ""}`,
      meta: { jobId },
    });
  } catch (error) {
    job.status = "failed";
    job.error = (error as Error).message;
    job.warnings = warnings;
    job.finishedAt = new Date();
    job.ms = Date.now() - started;
    await job.save();

    await logActivity({
      level: "error",
      action: "content.failed",
      message: `Create New failed: ${(error as Error).message}`,
      meta: { jobId },
    });
  } finally {
    running.delete(jobId);
  }
}
