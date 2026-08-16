import { z } from "zod";

import { fail, handle, ok, requireBrand } from "@/lib/api";
import { logActivity } from "@/models/ActivityLog";
import { contentRunnerStatus, startContentJob } from "@/lib/content/runner";

export const dynamic = "force-dynamic";

const schema = z.object({
  imageAssetIds: z.array(z.string()).default([]),
  /** Photographs that steer the look, beyond the product itself. */
  referenceImageIds: z.array(z.string()).default([]),
  /** A reel whose style should be matched. */
  referenceVideoId: z.string().optional(),
  productName: z.string().max(200).optional(),
  productUrl: z.string().max(500).optional(),
  /** A known image for the product — the thumbnail from a connected store. */
  productImageUrl: z.string().max(500).optional(),
  price: z.string().max(60).optional(),
  notes: z.string().max(1000).optional(),

  /** Optional. Without one, the product photo carries the post. */
  avatarId: z.string().optional(),

  language: z.string().max(20).optional(),
  tone: z.string().max(120).optional(),

  /** What to produce: everything, images only, or a reel only. */
  outputMode: z.enum(["all", "image", "video"]).default("all"),

  /** Image-only settings. */
  imageCount: z.number().min(1).max(6).optional(),
  imageQuality: z.enum(["standard", "high"]).optional(),
  imageAspect: z.enum(["1:1", "4:5", "9:16"]).optional(),

  /** Video settings. Veo renders 8-second clips, so 32s means four of them. */
  videoCount: z.number().min(1).max(3).optional(),
  videoSeconds: z.number().min(8).max(48).optional(),
  videoAspect: z.enum(["9:16", "1:1", "16:9"]).optional(),

  /** Both optional — a draft is useful before any account is connected. */
  accountIds: z.array(z.string()).default([]),
  platforms: z.array(z.enum(["instagram", "facebook"])).default([]),
});

/**
 * Starts a Create New run.
 *
 * Returns immediately with a job id; the work happens in the background and
 * the client polls `GET /api/create/job/<id>` for live progress.
 */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const body = schema.parse(await request.json());

  if (body.imageAssetIds.length === 0 && !body.productUrl?.trim() && !body.productName?.trim()) {
    return fail("Add a photo, or a product name and link", 422);
  }

  const { jobId } = await startContentJob({
    brandId: ctx.brandId,
    imageAssetIds: body.imageAssetIds,
    referenceImageIds: body.referenceImageIds,
    referenceVideoId: body.referenceVideoId,
    productName: body.productName,
    productUrl: body.productUrl,
    productImageUrl: body.productImageUrl,
    price: body.price,
    notes: body.notes,
    avatarId: body.avatarId,
    language: body.language,
    tone: body.tone,
    outputMode: body.outputMode,
    imageCount: body.imageCount,
    imageQuality: body.imageQuality,
    imageAspect: body.imageAspect,
    videoCount: body.videoCount,
    videoSeconds: body.videoSeconds,
    videoAspect: body.videoAspect,
    accountIds: body.accountIds,
    platforms: body.platforms,
    createdBy: ctx.session.sub,
  });

  await logActivity({
    action: "content.queued",
    message: `Create New started — ${body.productName ?? "untitled"}`,
    actor: ctx.session.email,
    meta: { jobId },
  });

  return ok(
    {
      jobId,
      pollUrl: `/api/create/job/${jobId}`,
      runner: contentRunnerStatus(),
    },
    202,
  );
});
