import { handle, ok, requireBrand } from "@/lib/api";
import { ReelJob } from "@/models/ReelJob";
import { MediaAsset } from "@/models/MediaAsset";
import { runnerStatus } from "@/lib/reels/runner";

export const dynamic = "force-dynamic";

/** Brand na badha reels — Studio na "Mari reels" tab mate. */
export const GET = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get("limit") ?? 30), 100);
  const status = params.get("status");

  const filter: Record<string, unknown> = { brand: ctx.brandId };
  if (status) filter.status = status;

  const jobs = await ReelJob.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const thumbIds = jobs.map((j) => j.thumbnail).filter(Boolean);
  const thumbs = await MediaAsset.find({ _id: { $in: thumbIds } })
    .select("_id")
    .lean();
  const thumbSet = new Set(thumbs.map((t) => String(t._id)));

  return ok({
    runner: runnerStatus(),
    jobs: jobs.map((job) => {
      const analysis = job.analysis as { productName?: string } | undefined;
      return {
        id: String(job._id),
        status: job.status,
        mode: job.mode,
        productName: analysis?.productName ?? "—",
        duration: job.duration,
        sceneCount: (job.scenes ?? []).length,
        postCount: (job.posts ?? []).length,
        thumbnailUrl:
          job.thumbnail && thumbSet.has(String(job.thumbnail))
            ? `/api/media/${job.thumbnail}`
            : null,
        previewUrl: job.output ? `/api/media/${job.output}` : null,
        error: job.error,
        createdAt: job.createdAt,
        ms: job.ms,
      };
    }),
  });
});
