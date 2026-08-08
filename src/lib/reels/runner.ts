/**
 * Reel job ne background ma chalavvanu.
 *
 * Ek reel banta 1 thi 5 minute lage che (AI + render). Etle HTTP request
 * ma raah jovay nahi — browser ke proxy vachhe j timeout kari de. Etle:
 *
 *   POST /api/studio/generate  → jobId turant pacho male
 *   GET  /api/studio/jobs/:id  → dar 3 second e progress puchtaa raho
 *
 * Ek j vakhate ketla reel banse e limit rakhi che, nahi to ffmpeg aakhu
 * CPU khai jaay ane server dhimo padi jaay.
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

/** Job atki gayo ganvano samay — aa pachi retry thai shake. */
const STUCK_AFTER_MS = 25 * 60_000;

/**
 * Job banavo ane background ma chalu karo. jobId turant pacho male che.
 */
export type StartReelJobOptions = {
  /**
   * Reel taiyar thay ke turant jate j publish kari devu.
   * Automation aa vaapre che — cron ma 4 minute raah na jovay.
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
    steps: [
      { key: "vision", label: "Image samajie chie", status: "pending" },
      { key: "trends", label: "Trending keywords shodhie chie", status: "pending" },
      { key: "plan", label: "Reel no script lakhie chie", status: "pending" },
      { key: "media", label: "Scene ni images taiyar karie chie", status: "pending" },
      { key: "music", label: "Music pasand karie chie", status: "pending" },
      { key: "render", label: "Video render karie chie", status: "pending" },
      { key: "upload", label: "Public URL banavie chie", status: "pending" },
      { key: "copy", label: "Caption ane hashtags lakhie chie", status: "pending" },
      ...(options.autoDistribute
        ? [{ key: "distribute", label: "Jate publish karie chie", status: "pending" }]
        : []),
    ],
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
