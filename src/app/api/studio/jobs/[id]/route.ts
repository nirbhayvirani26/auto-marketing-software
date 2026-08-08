import { fail, handle, ok, requireBrand } from "@/lib/api";
import { ReelJob } from "@/models/ReelJob";
import { MediaAsset } from "@/models/MediaAsset";

export const dynamic = "force-dynamic";

const STEP_WEIGHT: Record<string, number> = {
  vision: 8,
  trends: 8,
  reference: 6,
  plan: 10,
  media: 28,
  music: 4,
  voiceover: 6,
  render: 22,
  upload: 6,
  copy: 8,
};

/** Ek reel job ni puri halat — UI dar 3 second e aa puche che. */
export const GET = handle(async (_request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const job = await ReelJob.findOne({ _id: id, brand: auth.brandId }).lean();
  if (!job) return fail("Reel job madyo nahi", 404);

  const [output, thumbnail] = await Promise.all([
    job.output ? MediaAsset.findById(job.output).lean() : null,
    job.thumbnail ? MediaAsset.findById(job.thumbnail).lean() : null,
  ]);

  // Progress — step na vajan pramane, jethi bar sachi rite aagal vadhe.
  let earned = 0;
  let total = 0;
  for (const step of job.steps ?? []) {
    const weight = STEP_WEIGHT[step.key] ?? 5;
    total += weight;
    if (step.status === "done" || step.status === "skipped") earned += weight;
    else if (step.status === "running") earned += weight * 0.4;
  }
  const progress =
    job.status === "done" ? 100 : total > 0 ? Math.round((earned / total) * 100) : 0;

  const currentStep = (job.steps ?? []).find((s) => s.status === "running");

  return ok({
    id: String(job._id),
    status: job.status,
    mode: job.mode,
    progress,
    currentStep: currentStep
      ? { key: currentStep.key, label: currentStep.label, note: currentStep.note }
      : null,
    steps: (job.steps ?? []).map((step) => ({
      key: step.key,
      label: step.label,
      status: step.status,
      provider: step.provider,
      ms: step.ms,
      note: step.note,
      error: step.error,
    })),
    error: job.error,

    duration: job.duration,
    videoUrl: output?.publicUrl ?? (output ? `/api/media/${output._id}` : null),
    previewUrl: output ? `/api/media/${output._id}` : null,
    thumbnailUrl: thumbnail ? `/api/media/${thumbnail._id}` : null,

    scenes: job.scenes ?? [],
    analysis: job.analysis ?? null,
    trends: job.trends ?? null,
    copy: job.copy ?? null,
    audio: job.audio ?? null,

    posts: (job.posts ?? []).map(String),
    ms: job.ms,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  });
});

/** Job kaadhi naakho (media rahe che). */
export const DELETE = handle(async (_request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const job = await ReelJob.findOneAndDelete({ _id: id, brand: auth.brandId });
  if (!job) return fail("Reel job madyo nahi", 404);

  return ok({ deleted: true });
});
