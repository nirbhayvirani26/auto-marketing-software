import { z } from "zod";

import { fail, handle, ok, requireBrand } from "@/lib/api";
import { logActivity } from "@/models/ActivityLog";
import { contentRunnerStatus, startContentJob } from "@/lib/content/runner";

export const dynamic = "force-dynamic";

const schema = z.object({
  imageAssetIds: z.array(z.string()).default([]),
  productName: z.string().max(200).optional(),
  productUrl: z.string().max(500).optional(),
  price: z.string().max(60).optional(),
  notes: z.string().max(1000).optional(),

  /** Optional. Without one, the product photo carries the post. */
  avatarId: z.string().optional(),

  language: z.string().max(20).optional(),
  tone: z.string().max(120).optional(),

  /** Reel length. Veo renders 8-second clips, so 30s means four of them. */
  videoSeconds: z.number().min(8).max(48).optional(),
  wantVideo: z.boolean().optional(),

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
    productName: body.productName,
    productUrl: body.productUrl,
    price: body.price,
    notes: body.notes,
    avatarId: body.avatarId,
    language: body.language,
    tone: body.tone,
    videoSeconds: body.videoSeconds,
    wantVideo: body.wantVideo,
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
