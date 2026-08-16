import { fail, handle, ok, requireBrand } from "@/lib/api";
import { ContentJob } from "@/models/ContentJob";
import { failStuckContentJobs } from "@/lib/content/runner";
import { MediaAsset } from "@/models/MediaAsset";

export const dynamic = "force-dynamic";

/**
 * How much of the run each step represents.
 *
 * Weighted by real elapsed time, not by step count — the video is most of the
 * wait, and a bar that sits at 60% for four minutes feels broken.
 */
const WEIGHT: Record<string, number> = {
  understand: 6,
  trends: 4,
  script: 6,
  image: 14,
  copy: 6,
  video: 48,
  assemble: 12,
  save: 4,
};

/** The full state of one Create New run. Polled every few seconds. */
export const GET = handle(async (_request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  // A job orphaned by a server restart would otherwise poll forever at
  // whatever percentage it died on. Sweep those before answering.
  await failStuckContentJobs();

  const { id } = await ctx.params;
  const job = await ContentJob.findOne({ _id: id, brand: auth.brandId }).lean();
  if (!job) return fail("That job could not be found", 404);

  const [image, reel, cover] = await Promise.all([
    job.postImage ? MediaAsset.findById(job.postImage).lean() : null,
    job.reelVideo ? MediaAsset.findById(job.reelVideo).lean() : null,
    job.reelThumbnail ? MediaAsset.findById(job.reelThumbnail).lean() : null,
  ]);

  let earned = 0;
  let total = 0;
  for (const step of job.steps ?? []) {
    const weight = WEIGHT[step.key] ?? 5;
    total += weight;
    if (step.status === "done" || step.status === "skipped") earned += weight;
    else if (step.status === "failed") earned += weight;
    else if (step.status === "running") earned += weight * 0.35;
  }

  const progress =
    job.status === "done" || job.status === "failed"
      ? 100
      : total > 0
        ? Math.round((earned / total) * 100)
        : 0;

  const current = (job.steps ?? []).find((step) => step.status === "running");

  return ok({
    id: String(job._id),
    status: job.status,
    progress,
    currentStep: current
      ? { key: current.key, label: current.label, note: current.note }
      : null,
    steps: (job.steps ?? []).map((step) => ({
      key: step.key,
      label: step.label,
      detail: step.detail,
      status: step.status,
      provider: step.provider,
      ms: step.ms,
      note: step.note,
      error: step.error,
      output: step.output,
    })),
    error: job.error,
    warnings: job.warnings ?? [],

    postImageUrl: image ? (image.publicUrl ?? `/api/media/${image._id}`) : null,
    reelUrl: reel ? (reel.publicUrl ?? `/api/media/${reel._id}`) : null,
    reelPreviewUrl: reel ? `/api/media/${reel._id}` : null,
    reelThumbnailUrl: cover ? `/api/media/${cover._id}` : null,
    reelDuration: job.reelDuration,

    postIds: (job.posts ?? []).map(String),
    ms: job.ms,
  });
});
