/**
 * End-to-end test of the whole automation, against the real pipeline.
 *
 *   npm run test:e2e
 *
 * Nothing here is mocked. It uploads real product photos, runs the real reel
 * generator (vision -> trends -> script -> images -> music -> ffmpeg render ->
 * hosting -> captions), and then creates real Post records in the local
 * database — one for Instagram, one for Facebook, each with its own caption.
 *
 * What it does NOT do is publish to Meta. Publishing needs live, connected
 * accounts, and a test script should never post to someone's real audience.
 * Everything up to that final call is exercised for real.
 *
 * Every step reports which provider served it, so when an AI account is out of
 * credit you can see precisely where the pipeline fell back rather than
 * guessing.
 */

import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const ENV_FILE = path.join(process.cwd(), ".env");
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // Running without a .env is fine — the fallbacks take over.
  }
}

import { connectDB, databaseLocation, flushDatabase } from "../src/lib/db";
import { Brand } from "../src/models/Brand";
import { Post } from "../src/models/Post";
import { ReelJob } from "../src/models/ReelJob";
import { MediaAsset } from "../src/models/MediaAsset";
import { saveMedia } from "../src/lib/media/store";
import { generateReel } from "../src/lib/reels/generate";
import { videoEngineStatus, probe } from "../src/lib/video/ffmpeg";

const OUT_DIR = path.join(process.cwd(), "storage", "e2e");

/* ------------------------------------------------------------------ *
 *  Reporting
 * ------------------------------------------------------------------ */

const started = Date.now();

function heading(text: string): void {
  console.log(`\n${text}\n${"─".repeat(Math.max(text.length, 56))}`);
}

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

function elapsed(): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`;
}

/* ------------------------------------------------------------------ *
 *  Test product photos
 * ------------------------------------------------------------------ */

/**
 * Builds two product photos locally rather than downloading any, so the test
 * is deterministic and runs with no network at all up to this point.
 */
async function makeProductPhotos(): Promise<Buffer[]> {
  const swatches: Array<{ bg: [number, number, number]; fg: [number, number, number] }> = [
    { bg: [242, 238, 230], fg: [38, 74, 120] },
    { bg: [230, 236, 242], fg: [150, 60, 70] },
  ];

  const photos: Buffer[] = [];

  for (const { bg, fg } of swatches) {
    const canvas = sharp({
      create: {
        width: 1400,
        height: 1750,
        channels: 3,
        background: { r: bg[0], g: bg[1], b: bg[2] },
      },
    });

    // A simple garment-like shape, so vision and the renderer both receive a
    // real photograph-shaped image rather than a flat colour field.
    const shape = Buffer.from(
      `<svg width="1400" height="1750">
         <rect x="330" y="300" width="740" height="1080" rx="90"
               fill="rgb(${fg[0]},${fg[1]},${fg[2]})" />
         <rect x="330" y="300" width="740" height="180" rx="90"
               fill="rgb(${Math.min(255, fg[0] + 40)},${Math.min(255, fg[1] + 40)},${Math.min(255, fg[2] + 40)})" />
         <circle cx="700" cy="640" r="70" fill="rgba(255,255,255,0.35)" />
         <circle cx="700" cy="900" r="70" fill="rgba(255,255,255,0.35)" />
       </svg>`,
    );

    photos.push(
      await canvas
        .composite([{ input: shape, top: 0, left: 0 }])
        .jpeg({ quality: 92 })
        .toBuffer(),
    );
  }

  return photos;
}

/* ------------------------------------------------------------------ *
 *  The run
 * ------------------------------------------------------------------ */

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  End-to-end test — reel generation and marketing posts   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  await mkdir(OUT_DIR, { recursive: true });

  /* ---- 1. Environment ---- */
  heading("1. Environment");

  const engine = videoEngineStatus();
  if (!engine.ready) {
    throw new Error(`ffmpeg is not available: ${engine.error ?? "unknown"}`);
  }
  line("Video engine", "ffmpeg ready");

  await connectDB();
  line("Database", databaseLocation());

  const brand = await Brand.findOne({ active: true }).sort({ createdAt: 1 });
  if (!brand) {
    throw new Error("No brand found. Run `npm run seed` first.");
  }
  line("Brand", `${brand.name} (${brand._id})`);

  /* ---- 2. Upload the product photos ---- */
  heading("2. Product photos");

  const photos = await makeProductPhotos();
  const assets = [];

  for (const [index, photo] of photos.entries()) {
    const asset = await saveMedia({
      data: photo,
      filename: `e2e-product-${index + 1}.jpg`,
      mimeType: "image/jpeg",
      role: "product",
      brand: String(brand._id),
      // Skip the public upload here: these placeholders never reach Meta, and
      // the reel itself is hosted properly further down.
      makePublic: false,
    });
    assets.push(asset);
    line(`Photo ${index + 1}`, `${asset.filename} · ${(asset.bytes / 1024).toFixed(0)} KB`);
  }

  /* ---- 3. Generate the reel ---- */
  heading("3. Reel generation");
  console.log("  This runs the real pipeline and takes a few minutes.\n");

  const result = await generateReel({
    brandId: String(brand._id),
    imageAssetIds: assets.map((asset) => String(asset._id)),
    mode: photos.length > 1 ? "multi" : "single",
    targetDuration: 25,
    language: "en",
    tone: "friendly, confident",
    hint: process.env.E2E_HINT ?? "Navy blue cotton kurta with a relaxed fit, for everyday summer wear",
    price: "₹1,299",
    voiceover: false,
  });

  const job = await ReelJob.findById(result.jobId);
  if (!job) throw new Error("The reel job disappeared from the database.");

  console.log("  Steps:");
  for (const step of job.steps) {
    const marks: Record<string, string> = {
      done: "ok",
      failed: "FAILED",
      skipped: "skipped",
      pending: "pending",
      running: "running",
    };
    const mark = marks[step.status] ?? step.status;
    const detail = [
      step.provider ? `via ${step.provider}` : "",
      step.ms ? `${(step.ms / 1000).toFixed(1)}s` : "",
      step.error ? `— ${step.error.slice(0, 80)}` : "",
      step.note ? `— ${step.note.slice(0, 80)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`    ${mark.padEnd(8)} ${step.label.padEnd(30)} ${detail}`);
  }

  /* ---- 4. Inspect the video that was produced ---- */
  heading("4. The video");

  const output = await MediaAsset.findById(result.videoAssetId);
  if (!output?.localPath) throw new Error("No rendered video was stored.");

  const info = await probe(output.localPath);
  line("File", output.localPath);
  line("Size", `${(output.bytes / 1024 / 1024).toFixed(2)} MB`);
  line("Duration", `${info?.duration?.toFixed(1) ?? "?"}s`);
  line("Resolution", `${info?.width ?? "?"}x${info?.height ?? "?"}`);
  line("Public URL", result.videoUrl || "(not hosted)");
  line("Scenes", String(job.scenes.length));

  const failures: string[] = [];
  if (!info?.duration || info.duration < 5) failures.push("the video is shorter than 5 seconds");
  if (info?.width !== 1080 || info?.height !== 1920) {
    failures.push(`the video is ${info?.width}x${info?.height}, expected 1080x1920`);
  }
  if (output.bytes < 100_000) failures.push("the video file is suspiciously small");

  /* ---- 5. Marketing copy ---- */
  heading("5. Marketing copy");

  for (const platform of ["instagram", "facebook"] as const) {
    const copy = result.copy[platform];
    console.log(`\n  ── ${platform.toUpperCase()} ──`);
    console.log(`  Score       ${copy.score.score}/100 (${copy.score.grade})`);
    console.log(`  Source      ${copy.fromTemplate ? "template fallback — no AI provider" : "written by AI"}`);
    console.log(`  Rewrites    ${copy.revisions}`);
    console.log(`  Hashtags    ${copy.hashtags.length}`);
    console.log("");
    for (const captionLine of copy.caption.split("\n")) {
      console.log(`      ${captionLine}`);
    }
    if (copy.firstComment) {
      console.log(`\n      First comment: ${copy.firstComment.slice(0, 150)}`);
    }

    if (!copy.caption.trim()) failures.push(`the ${platform} caption is empty`);
  }

  /* ---- 6. Create the posts ---- */
  heading("6. Marketing posts in the database");

  const created = [];
  for (const platform of ["instagram", "facebook"] as const) {
    const copy = result.copy[platform];

    // A real account is not required to prepare the post; publishing is what
    // needs one, and this test deliberately stops short of that.
    const post = await Post.create({
      brand: brand._id,
      account: brand._id, // placeholder — replaced when a real account publishes
      platform,
      postType: "reel",
      caption: copy.caption,
      hashtags: copy.hashtags,
      mediaUrl: result.videoUrl,
      mediaType: "video",
      thumbnailUrl: result.thumbnailUrl,
      firstComment: copy.firstComment,
      reelJob: result.jobId,
      mediaAsset: result.videoAssetId,
      seo: copy.score,
      audio: result.audio,
      status: "draft",
      generatedByAI: !copy.fromTemplate,
      source: "ai",
      prompt: "End-to-end test run",
    });

    created.push(post);
    line(platform, `post ${post._id} · ${post.caption.length} characters · ${post.status}`);
  }

  /* ---- 7. Confirm it all persisted ---- */
  heading("7. Persistence check");

  flushDatabase();

  const reloadedJob = await ReelJob.findById(result.jobId).lean();
  const reloadedPosts = await Post.find({ reelJob: result.jobId }).lean();

  line("Reel job", `${reloadedJob?.status} · ${reloadedJob?.steps.length} steps`);
  line("Posts stored", String(reloadedPosts.length));
  line("Collections", `${databaseLocation()}`);

  if (reloadedJob?.status !== "done") failures.push(`the reel job ended as "${reloadedJob?.status}"`);
  if (reloadedPosts.length !== 2) failures.push("both posts were not stored");

  /* ---- 8. Save a report ---- */
  const report = {
    ranAt: new Date().toISOString(),
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    jobId: result.jobId,
    video: {
      path: output.localPath,
      publicUrl: result.videoUrl,
      bytes: output.bytes,
      duration: info?.duration,
      width: info?.width,
      height: info?.height,
      scenes: job.scenes.length,
    },
    steps: job.steps.map((step) => ({
      key: step.key,
      status: step.status,
      provider: step.provider,
      ms: step.ms,
      error: step.error,
    })),
    analysis: {
      productName: result.analysis.productName,
      category: result.analysis.category,
      colors: result.analysis.colors,
    },
    copy: {
      instagram: {
        score: result.copy.instagram.score.score,
        fromTemplate: result.copy.instagram.fromTemplate,
        caption: result.copy.instagram.caption,
        hashtags: result.copy.instagram.hashtags,
      },
      facebook: {
        score: result.copy.facebook.score.score,
        fromTemplate: result.copy.facebook.fromTemplate,
        caption: result.copy.facebook.caption,
        hashtags: result.copy.facebook.hashtags,
      },
    },
    posts: created.map((post) => ({ id: String(post._id), platform: post.platform })),
    warnings: result.warnings,
    failures,
  };

  const reportPath = path.join(OUT_DIR, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  /* ---- Result ---- */
  console.log(`\n${"═".repeat(60)}`);
  if (result.warnings.length) {
    console.log("\n  Warnings:");
    for (const warning of result.warnings) console.log(`    • ${warning}`);
  }

  if (failures.length === 0) {
    console.log(`\n  PASSED in ${elapsed()}`);
    console.log(`  Video   ${output.localPath}`);
    console.log(`  Report  ${reportPath}\n`);
  } else {
    console.log(`\n  FAILED in ${elapsed()}\n`);
    for (const failure of failures) console.log(`    ✗ ${failure}`);
    console.log(`\n  Report  ${reportPath}\n`);
  }

  return failures.length;
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((error) => {
    console.error("\n  The end-to-end run failed:\n");
    console.error(`  ${error.message}\n`);
    if (process.env.DEBUG) console.error(error);
    process.exit(1);
  });
