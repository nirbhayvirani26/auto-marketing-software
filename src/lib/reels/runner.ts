/**
 * Runs reel jobs in the background.
 *
 * A reel takes one to five minutes to build (AI plus rendering), which is far
 * longer than an HTTP request can wait — the browser or a proxy would time out
 * first. So the work is detached:
 *
 *   POST /api/studio/generate  -> returns a jobId immediately
 *   GET  /api/studio/jobs/:id  -> poll every few seconds for progress
 *
 * The number of reels rendering at once is capped, otherwise ffmpeg takes the
 * whole CPU and the server crawls.
 */

import { connectDB } from "@/lib/db";
import { ReelJob, setStep } from "@/models/ReelJob";
import { logActivity } from "@/models/ActivityLog";
import { generateReel, type GenerateReelInput } from "./generate";

type Running = { jobId: string; startedAt: number };

const globalForRunner = globalThis as unknown as {
  _reelRunning?: Map<string, Running>;
  _reelQueue?: GenerateReelInput[];
};

const running: Map<string, Running> =
  globalForRunner._reelRunning ?? new Map();
globalForRunner._reelRunning = running;

const queue: GenerateReelInput[] = globalForRunner._reelQueue ?? [];
globalForRunner._reelQueue = queue;

function maxConcurrent(): number {
  return Math.max(1, Number(process.env.REEL_MAX_CONCURRENT || 2));
}

/** After this long a job counts as stuck and may be retried. */
const STUCK_AFTER_MS = 25 * 60_000;

/**
 * The pipeline, in order. Every job starts with all of these pending and the
 * Studio page renders them as a progress list.
 */
const REEL_STEPS = [
  { key: "vision", label: "Understanding the image" },
  { key: "trends", label: "Finding trending keywords" },
  { key: "plan", label: "Writing the reel script" },
  { key: "media", label: "Preparing the scene images" },
  { key: "music", label: "Choosing the music" },
  { key: "render", label: "Rendering the video" },
  { key: "upload", label: "Publishing to a public URL" },
  { key: "copy", label: "Writing captions and hashtags" },
  { key: "distribute", label: "Posting automatically" },
] as const;

/** Creates a job and starts it in the background; the jobId comes back at once. */
export type StartReelJobOptions = {
  /**
   * Publish as soon as the reel is ready. Automations rely on this, because
   * the scheduler cannot sit and wait four minutes for a render.
   */
  autoDistribute?: {
    accountIds?: string[];
    when?: "now" | "auto" | "draft";
    hashtagsInFirstComment?: boolean;
    automationId?: string;
  };
};

export async function startReelJob(
  input: GenerateReelInput,
  options: StartReelJobOptions = {},
): Promise<{ jobId: string; queued: boolean }> {
  await connectDB();

  const job = await ReelJob.create({
    autoDistribute: options.autoDistribute
      ? {
          enabled: true,
          accountIds: options.autoDistribute.accountIds ?? [],
          when: options.autoDistribute.when ?? "now",
          hashtagsInFirstComment:
            options.autoDistribute.hashtagsInFirstComment ?? true,
          automation: options.autoDistribute.automationId,
        }
      : { enabled: false },
    brand: input.brandId,
    avatar: input.avatarId,
    product: input.productId,
    sourceImages: input.imageAssetIds,
    referenceVideo: input.referenceVideoAssetId,
    mode: input.mode ?? "single",
    targetDuration: input.targetDuration ?? 40,
    language: input.language ?? "en",
    tone: input.tone,
    status: "queued",
    createdBy: input.createdBy,
    steps: REEL_STEPS.filter(
      (step) => step.key !== "distribute" || Boolean(options.autoDistribute),
    ).map((step) => ({ ...step, status: "pending" as const })),
  });

  const withJobId: GenerateReelInput = { ...input, jobId: String(job._id) };

  if (running.size >= maxConcurrent()) {
    queue.push(withJobId);
    await setStep(job._id, "vision", {
      status: "pending",
      note: `Line ma ${queue.length} number — thodi var ma shuru thashe`,
    });
    return { jobId: String(job._id), queued: true };
  }

  void runNow(withJobId);
  return { jobId: String(job._id), queued: false };
}

async function runNow(input: GenerateReelInput): Promise<void> {
  const jobId = input.jobId!;
  running.set(jobId, { jobId, startedAt: Date.now() });

  try {
    await generateReel(input);
  } catch (error) {
    // generateReel() jate job ne "failed" kari de che — ahiya fakt log.
    await logActivity({
      level: "error",
      action: "reel.runner",
      message: `Reel job fail: ${(error as Error).message}`,
      meta: { jobId },
    }).catch(() => undefined);
  } finally {
    running.delete(jobId);

    const next = queue.shift();
    if (next) void runNow(next);
  }
}

/** Atyare ketla chali rahya che — UI ne batavva mate. */
export function runnerStatus(): {
  running: number;
  queued: number;
  maxConcurrent: number;
} {
  return {
    running: running.size,
    queued: queue.length,
    maxConcurrent: maxConcurrent(),
  };
}

/**
 * Server restart thay to "running" ma atkela job kaayam tya j rahi jaay.
 * Cron dar minute aane call kare che ane e job ne "failed" kari de che,
 * jethi user ne khabar pade ane fari try kari shake.
 */
export async function reapStuckJobs(): Promise<number> {
  await connectDB();

  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = await ReelJob.find({
    status: "running",
    $or: [{ startedAt: { $lt: cutoff } }, { updatedAt: { $lt: cutoff } }],
  }).select("_id");

  let reaped = 0;
  for (const job of stuck) {
    if (running.has(String(job._id))) continue; // aa server par hju chalu che

    await ReelJob.updateOne(
      { _id: job._id },
      {
        status: "failed",
        error:
          "Reel banavtaa vachhe atki gayu (server restart thayo hase). Fari 'Generate' dabavo — juna step fari nathi karvana padta.",
        finishedAt: new Date(),
      },
    );
    reaped += 1;
  }

  // Queue ma padela job pan chalu karo (server restart pachi).
  await connectDB();
  const queued = await ReelJob.find({ status: "queued" })
    .sort({ createdAt: 1 })
    .limit(maxConcurrent())
    .lean();

  for (const job of queued) {
    const jobId = String(job._id);
    if (running.has(jobId) || queue.some((q) => q.jobId === jobId)) continue;
    if (running.size >= maxConcurrent()) break;

    void runNow({
      brandId: String(job.brand),
      imageAssetIds: (job.sourceImages ?? []).map(String),
      mode: job.mode as GenerateReelInput["mode"],
      avatarId: job.avatar ? String(job.avatar) : undefined,
      referenceVideoAssetId: job.referenceVideo ? String(job.referenceVideo) : undefined,
      productId: job.product ? String(job.product) : undefined,
      targetDuration: job.targetDuration ?? undefined,
      language: job.language ?? undefined,
      tone: job.tone ?? undefined,
      createdBy: job.createdBy ? String(job.createdBy) : undefined,
      jobId,
    });
  }

  return reaped;
}
