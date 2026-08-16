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
import { fetchProductImages } from "./product-images";
import { analyzeReference } from "@/lib/reels/reference";
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

/* ------------------------------------------------------------------ *
 *  Guards against a job that never finishes
 * ------------------------------------------------------------------ */

/**
 * A single step may not run longer than this.
 *
 * Each provider already has its own timeout, but a chain of four providers
 * each retried once can still add up to a quarter of an hour, and the person
 * watching the progress bar has no idea whether anything is happening. A hard
 * cap turns "stuck forever" into "this step failed, here is why".
 */
const STEP_LIMITS: Partial<Record<string, number>> = {
  understand: 4 * 60_000,
  trends: 2 * 60_000,
  script: 3 * 60_000,
  image: 4 * 60_000,
  copy: 4 * 60_000,
  assemble: 10 * 60_000,
};

/**
 * After this long with no step update at all, a job is presumed dead.
 *
 * Every step either finishes inside its own cap or writes a progress note as
 * it goes — the video step updates on each clip — so ten minutes of complete
 * silence means the run is gone, not slow.
 */
const STUCK_AFTER_MS = 10 * 60_000;

class StepTimeout extends Error {
  constructor(label: string, ms: number) {
    super(`${label} gave up after ${Math.round(ms / 1000)}s`);
    this.name = "StepTimeout";
  }
}

/** Runs a step, failing loudly rather than hanging. */
function withLimit<T>(key: string, label: string, fn: () => Promise<T>): Promise<T> {
  const limit = STEP_LIMITS[key];
  if (!limit) return fn();

  return Promise.race([
    fn(),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new StepTimeout(label, limit)), limit).unref?.(),
    ),
  ]);
}

/**
 * Marks abandoned jobs as failed.
 *
 * A job dies without warning if the process restarts mid-run — which in
 * development happens on every code change. Without this, the panel sits at
 * 21% forever and there is no way to tell a slow render from a dead one.
 */
export async function failStuckContentJobs(): Promise<number> {
  await connectDB();

  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stale = await ContentJob.find({
    status: { $in: ["queued", "running"] },
    updatedAt: { $lt: cutoff },
  });

  for (const job of stale) {
    if (running.has(String(job._id))) continue; // genuinely still working

    for (const step of job.steps) {
      if (step.status === "running" || step.status === "pending") {
        step.status = "failed";
        step.error = "The run was interrupted";
      }
    }
    job.status = "failed";
    job.error =
      "This run was interrupted before it finished — most likely the server restarted. Start it again.";
    job.finishedAt = new Date();
    await job.save();
  }

  return stale.length;
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
  referenceImageIds?: string[];
  referenceVideoId?: string;
  productName?: string;
  productUrl?: string;
  productImageUrl?: string;
  price?: string;
  notes?: string;
  avatarId?: string;
  language?: string;
  tone?: string;
  outputMode?: "all" | "image" | "video";
  imageCount?: number;
  imageQuality?: "standard" | "high";
  imageAspect?: "1:1" | "4:5" | "9:16";
  videoCount?: number;
  videoSeconds?: number;
  videoAspect?: "9:16" | "1:1" | "16:9";
  accountIds?: string[];
  platforms?: string[];
  createdBy?: string;
}): Promise<{ jobId: string }> {
  await connectDB();

  const job = await ContentJob.create({
    brand: input.brandId,
    sourceImages: input.imageAssetIds,
    referenceImages: input.referenceImageIds ?? [],
    referenceVideo: input.referenceVideoId,
    productName: input.productName,
    productUrl: input.productUrl,
    productImageUrl: input.productImageUrl,
    price: input.price,
    notes: input.notes,
    avatar: input.avatarId,
    language: input.language ?? "en",
    tone: input.tone,
    outputMode: input.outputMode ?? "all",
    imageCount: input.imageCount ?? 1,
    imageQuality: input.imageQuality ?? "high",
    imageAspect: input.imageAspect ?? "4:5",
    videoCount: input.videoCount ?? 1,
    videoSeconds: input.videoSeconds ?? 30,
    videoAspect: input.videoAspect ?? "9:16",
    // Derived once here so every later check is a single boolean.
    wantVideo: (input.outputMode ?? "all") !== "image",
    accountIds: input.accountIds ?? [],
    platforms: input.platforms ?? [],
    status: "queued",
    createdBy: input.createdBy,
    steps: CONTENT_STEPS.filter((step) => {
      const mode = input.outputMode ?? "all";
      if (mode === "image" && (step.key === "video" || step.key === "assemble")) {
        return false;
      }
      return true;
    })
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

    /* ---- Nothing uploaded? Fetch the product's own photographs ---- */
    //
    // This is the difference between an advert for YOUR product and an advert
    // for something the model imagined. Without a real photograph to work
    // from, image generation invents the product: wrong stone, wrong fabric,
    // wrong colour. So a link is turned into pictures before anything else
    // happens, and those pictures become the reference everywhere downstream.
    if (images.length === 0 && job.productUrl?.trim()) {
      await setContentStep(jobId, "understand", {
        status: "running",
        note: "Fetching your product photos from the link",
      });

      const fetched = await fetchProductImages(job.productUrl.trim(), {
        limit: 5,
        extraUrls: job.productImageUrl ? [job.productImageUrl] : [],
      });

      for (const photo of fetched.photos) {
        const asset = await saveMedia({
          data: photo.data,
          filename: `product-${images.length + 1}.jpg`,
          mimeType: photo.mimeType,
          role: "product",
          brand: String(brand._id),
          createdBy: job.createdBy ? String(job.createdBy) : undefined,
          provider: "product page",
          prompt: photo.url,
          makePublic: false,
        });
        images.push(asset);
      }

      if (images.length > 0) {
        job.sourceImages = images.map((asset) => asset._id) as never;
        await job.save();
      } else {
        warnings.push(
          fetched.error
            ? `No photos could be read from that product link (${fetched.error}). The post was written from the name alone, and the image is a fresh one rather than your product.`
            : "No photos were found on that product link, so the generated image will not show your actual product. Upload a photo for an accurate result.",
        );
      }
    }

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
      withLimit("trends", "Finding trending keywords", () =>
        buildTrendPack({ product: analysis, brandTag: brand.name }),
      ),
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

    /* ---- A reel to copy the style of ---- */
    //
    // ffmpeg measures how the reference actually cuts — shot count, average
    // shot length, pacing — and the frames are described so the shot language
    // carries across. Only the craft transfers; the words and claims never do.
    let referenceStyle: Awaited<ReturnType<typeof analyzeReference>> | undefined;

    if (job.referenceVideo) {
      try {
        await setContentStep(jobId, "script", {
          status: "running",
          note: "Studying the reel you picked",
        });
        const referenceAsset = await MediaAsset.findById(job.referenceVideo);
        if (referenceAsset) {
          referenceStyle = await analyzeReference(await ensureLocalPath(referenceAsset));
        }
      } catch (error) {
        warnings.push(
          `The reference reel could not be read (${(error as Error).message.slice(0, 100)}), so its style was not copied.`,
        );
      }
    }

    const scriptRun = await timed(() =>
      withLimit("script", "Writing the script", () =>
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
        referenceStyle,
      }),
      ),
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

    // Every product photo we have, not just the first. More angles give the
    // model more of the real object to hold on to. Declared out here because
    // the video step needs them too, for the per-beat keyframes.
    const productRefs = await Promise.all(
      images.slice(0, 4).map(async (asset) => ({
        data: await readFile(await ensureLocalPath(asset)),
        mimeType: "image/jpeg",
        role: "product" as const,
      })),
    );

    /**
     * Extra photographs chosen to steer the look.
     *
     * Tagged "style" rather than "product" on purpose — they say how the shot
     * should feel, not what the item is. Labelling them as products would
     * invite the model to blend two different objects into one.
     */
    const styleAssets = job.referenceImages?.length
      ? await MediaAsset.find({ _id: { $in: job.referenceImages }, kind: "image" })
      : [];

    const styleRefs = await Promise.all(
      styleAssets.slice(0, 3).map(async (asset) => ({
        data: await readFile(await ensureLocalPath(asset)),
        mimeType: "image/jpeg",
        role: "style" as const,
      })),
    );

    /**
     * The chosen model's photographs.
     *
     * Generated views come first when they exist — a full-body and a face
     * close-up pin the person down far more firmly than a single upload, which
     * is what keeps her recognisably the same across every shot in the reel.
     */
    const avatarPhotoIds = [
      ...(avatar?.generatedViews ?? [])
        .filter((view) => ["face-focus", "full-body"].includes(view.key))
        .map((view) => view.media),
      avatar?.primaryPhoto,
      ...(avatar?.referencePhotos ?? []),
    ].filter(Boolean);

    const uniqueAvatarIds = [...new Map(avatarPhotoIds.map((id) => [String(id), id])).values()];

    const avatarAssets = uniqueAvatarIds.length
      ? await MediaAsset.find({ _id: { $in: uniqueAvatarIds.slice(0, 3) } })
      : [];

    const avatarRefs = await Promise.all(
      avatarAssets.map(async (asset) => ({
        data: await readFile(await ensureLocalPath(asset)),
        mimeType: "image/jpeg",
        role: "person" as const,
      })),
    );

    try {
      /**
       * The rules that keep it YOUR product.
       *
       * Without these the model treats the reference as inspiration and
       * "improves" the item — a different stone, a different weave, a colour
       * that photographs better. That is the single most damaging thing an
       * advert can do, so the instruction is explicit and repeated.
       */
      const preserveProduct = [
        "",
        "ABSOLUTE REQUIREMENT — this must be the EXACT product in the reference photograph.",
        "Reproduce it pixel-faithfully: same shape, same colour, same material, same texture,",
        "same pattern, same stitching, same stones, same hardware, same proportions, same finish.",
        "You are restaging and relighting a real product for an advert — you are NOT designing a new one.",
        "Do not beautify it, do not simplify it, do not substitute a similar item, do not change the angle of the product itself.",
        "Change only the surroundings: background, surface, props, lighting and camera framing.",
        "No text, no logos, no watermarks anywhere in the image.",
      ].join("\n");

      const imagePrompt = `${script.imagePrompt}${preserveProduct}`;

      const aspect = job.imageAspect ?? "4:5";
      const wanted = Math.max(1, Math.min(6, job.imageCount ?? 1));

      /**
       * Ask for several images by varying the staging, not the product.
       *
       * Generating the identical prompt N times returns near-identical
       * pictures, which is no use to anyone. Each pass gets a different
       * setting and camera instead, so you end up with a usable set to choose
       * from — while the product itself stays fixed by the reference photos.
       */
      const variations = [
        "",
        " Restage it on a different surface, with a different prop, from a slightly lower angle.",
        " Restage it outdoors in soft natural daylight, with a simple everyday backdrop.",
        " Restage it as a close macro detail shot, very shallow depth of field.",
        " Restage it as a flat lay from directly above, with generous negative space.",
        " Restage it in a warm evening light with a soft shadow falling across the frame.",
      ];

      const quality = job.imageQuality ?? "high";

      const generateOne = (index: number) => {
        const prompt = `${imagePrompt}${variations[index % variations.length]}${
          quality === "high"
            ? "\nUltra sharp, high resolution, magazine-quality product photography."
            : ""
        }`;

        return productRefs.length > 0
          ? composeImage({
              prompt,
              references: [...productRefs, ...avatarRefs, ...styleRefs],
              aspectRatio: aspect,
            })
          : // Nothing real to work from. Said loudly in the step note rather
            // than quietly shipping an invented product.
            generateImage({ prompt, aspectRatio: aspect });
      };

      const imageRun = await timed(() =>
        withLimit("image", "Generating the post image", () => generateOne(0)),
      );

      if (productRefs.length === 0) {
        warnings.push(
          "The image was generated from the description only, so it is not a photograph of your actual product. Upload a photo, or use a product link that has images.",
        );
      }

      postImageBuffer = imageRun.value.data.data;
      postImageAsset = await saveMedia({
        data: postImageBuffer,
        filename: `post-${label.slice(0, 40)}.jpg`,
        mimeType: imageRun.value.data.mimeType,
        role: "generated",
        brand: String(brand._id),
        createdBy: job.createdBy ? String(job.createdBy) : undefined,
        provider: imageRun.value.provider,
        prompt: imagePrompt,
        makePublic: true,
      });

      job.postImage = postImageAsset._id;
      const producedImages = [postImageAsset._id];

      /* ---- The rest of the set ---- */
      for (let index = 1; index < wanted; index += 1) {
        await setContentStep(jobId, "image", {
          status: "running",
          note: `Image ${index + 1} of ${wanted}`,
        });
        try {
          const extra = await withLimit("image", "Generating an image", () =>
            generateOne(index),
          );
          const asset = await saveMedia({
            data: extra.data.data,
            filename: `post-${label.slice(0, 30)}-${index + 1}.jpg`,
            mimeType: extra.data.mimeType,
            role: "generated",
            brand: String(brand._id),
            createdBy: job.createdBy ? String(job.createdBy) : undefined,
            provider: extra.provider,
            prompt: imagePrompt,
            makePublic: true,
          });
          producedImages.push(asset._id);
        } catch (error) {
          warnings.push(
            `Image ${index + 1} could not be generated (${(error as Error).message.slice(0, 90)}).`,
          );
        }
      }

      job.postImages = producedImages as never;
      await job.save();

      await setContentStep(jobId, "image", {
        status: "done",
        ms: imageRun.ms,
        provider: imageRun.value.provider,
        note:
          producedImages.length > 1
            ? `${producedImages.length} images · ${aspect} · ${quality}`
            : `${(postImageBuffer.length / 1024).toFixed(0)} KB · ${aspect}`,
        output: {
          url: `/api/media/${postImageAsset._id}`,
          urls: producedImages.map((id) => `/api/media/${id}`),
          prompt: script.imagePrompt,
        },
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
          /* ---- The frame this clip starts from ---- */
          //
          // With a presenter, each beat gets its own still first: her holding
          // the box, putting it on, turning to look. Both she and the product
          // are supplied as reference photographs, so neither changes from one
          // shot to the next — which is the whole reason the reel reads as one
          // continuous person rather than five different people.
          //
          // Veo then only has to add movement to a frame that is already
          // correct, which it does far more reliably than inventing a scene.
          let firstFrame = postImageBuffer ?? undefined;

          if (avatarRefs.length > 0 && beat.keyframePrompt) {
            try {
              await setContentStep(jobId, "video", {
                status: "running",
                note: `Clip ${beat.index + 1} of ${script.beats.length} — staging the shot`,
              });

              const keyframe = await composeImage({
                prompt: [
                  beat.keyframePrompt,
                  "",
                  "The person must be the EXACT person in the reference photographs — same face, same bone structure, same skin tone, same hair. Do not restyle or beautify her.",
                  "The product must be the EXACT product in the reference photographs — same shape, colour, material and detail. Do not redesign it.",
                  "Photorealistic, shot on a phone in natural light, vertical 9:16 framing.",
                  "No text, no logos, no watermarks.",
                ].join("\n"),
                references: [...avatarRefs, ...productRefs],
                aspectRatio: (job.videoAspect ?? "9:16") as "9:16" | "1:1",
              });

              firstFrame = keyframe.data.data;

              await saveMedia({
                data: keyframe.data.data,
                filename: `keyframe-${beat.index}.jpg`,
                mimeType: keyframe.data.mimeType,
                role: "keyframe",
                brand: String(brand._id),
                provider: keyframe.provider,
                prompt: beat.keyframePrompt,
                makePublic: false,
              });
            } catch (error) {
              // A missing keyframe is not fatal — fall back to the product
              // shot so the beat still renders.
              warnings.push(
                `The staged shot for clip ${beat.index + 1} could not be made (${(error as Error).message.slice(0, 90)}).`,
              );
            }
          }

          const clip = await generateVeoClip({
            prompt: [
              beat.prompt,
              beat.spokenLine
                ? `She is speaking to the camera, saying: "${beat.spokenLine}"`
                : "",
              "Keep the person and the product exactly as they appear in the first frame.",
            ]
              .filter(Boolean)
              .join(" "),
            aspectRatio: (job.videoAspect ?? "9:16") as "9:16" | "16:9",
            image: firstFrame,
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
        // One post per generated image, so a set of six is six drafts to
        // pick from rather than one plus five orphaned files.
        const imageIds = (job.postImages?.length ? job.postImages : [postImageAsset?._id]).filter(Boolean);

        for (const [imageIndex, imageId] of imageIds.entries()) {
        const imageAsset = imageIndex === 0 ? postImageAsset : await MediaAsset.findById(imageId);
        const thisImageUrl = imageAsset
          ? await ensurePublicUrl(imageAsset).catch(() => imageUrl)
          : imageUrl;

        const imagePost = await Post.create({
          brand: brand._id,
          account: account?._id,
          platform,
          postType: "image",
          caption: platformCopy.caption,
          hashtags: platformCopy.hashtags,
          mediaUrl: thisImageUrl,
          mediaType: thisImageUrl ? "image" : "none",
          mediaAsset: imageId,
          firstComment: platformCopy.firstComment,
          seo: platformCopy.score,
          prompt: script.concept,
          status: "draft",
          generatedByAI: !platformCopy.fromTemplate,
          source: "ai",
          createdBy: job.createdBy,
        });
        postIds.push(String(imagePost._id));
        }

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
