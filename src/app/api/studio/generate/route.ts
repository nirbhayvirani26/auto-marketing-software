import { z } from "zod";
import { fail, handle, ok, requireBrand, requireLimit, requireModule } from "@/lib/api";
import { startReelJob, runnerStatus } from "@/lib/reels/runner";
import { MediaAsset } from "@/models/MediaAsset";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  /** Upload karela MediaAsset na id — jе kram ma aapo e j kram reel ma rahe. */
  imageAssetIds: z.array(z.string().min(1)).min(1).max(20),
  mode: z.enum(["single", "multi", "tryon", "reference"]).optional(),
  avatarId: z.string().optional(),
  referenceVideoAssetId: z.string().optional(),
  productId: z.string().optional(),
  /** 15 thi 90 second. */
  targetDuration: z.number().min(15).max(90).optional(),
  language: z.enum(["en", "hi", "gu", "hinglish"]).optional(),
  tone: z.string().max(200).optional(),
  hint: z.string().max(1000).optional(),
  price: z.string().max(60).optional(),
  productUrl: z.string().max(500).optional(),
  voiceover: z.boolean().optional(),
});

/**
 * Starts building a reel.
 *
 * This route returns IMMEDIATELY — the reel is built in the background.
 * Poll `GET /api/studio/jobs/<jobId>` for progress.
 */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const moduleBlock = requireModule(ctx.tenant, "reels");
  if (moduleBlock) return moduleBlock;

  const limitBlock = await requireLimit(ctx.tenant, "reelsPerMonth");
  if (limitBlock) return limitBlock;

  const body = schema.parse(await request.json());

  // Aapelі image kharekhar aa brand ni j che ne — bija brand nu media
  // vaparvanu shakya na hovu joiye.
  const owned = await MediaAsset.countDocuments({
    _id: { $in: body.imageAssetIds },
    brand: ctx.brandId,
    kind: "image",
  });
  if (owned !== body.imageAssetIds.length) {
    return fail(
      "Ketlik image madi nahi. Fari upload karo ane pachi Generate dabavo.",
      422,
    );
  }

  if (body.referenceVideoAssetId) {
    const reference = await MediaAsset.findOne({
      _id: body.referenceVideoAssetId,
      brand: ctx.brandId,
      kind: "video",
    });
    if (!reference) return fail("Reference video not found", 422);
  }

  const { jobId, queued } = await startReelJob({
    ...body,
    brandId: ctx.brandId,
    createdBy: ctx.session.sub,
  });

  await logActivity({
    action: "reel.queued",
    message: `Reel started — ${body.imageAssetIds.length} photo(s), ${body.targetDuration ?? 40}s`,
    actor: ctx.session.email,
    meta: { jobId },
  });

  return ok(
    {
      jobId,
      queued,
      runner: runnerStatus(),
      pollUrl: `/api/studio/jobs/${jobId}`,
      message: queued
        ? "Queued — it will start shortly"
        : "Your reel has started building",
    },
    202,
  );
});
