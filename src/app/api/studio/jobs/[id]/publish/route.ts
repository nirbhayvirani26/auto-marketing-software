import { z } from "zod";
import { fail, handle, ok, requireBrand, requireLimit } from "@/lib/api";
import { distributeReel, suggestedSlots } from "@/lib/reels/publish";
import { ReelJob } from "@/models/ReelJob";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const schema = z.object({
  /** Khali = brand na badha connected accounts (IG + FB banne). */
  accountIds: z.array(z.string()).optional(),
  when: z.enum(["now", "schedule", "auto", "draft"]).default("now"),
  scheduledAt: z.string().datetime().optional(),
  hashtagsInFirstComment: z.boolean().optional(),
});

/**
 * Banelu reel badha account par mokalo.
 * Instagram par je jaay e Facebook par pan jaay che — alag caption sathe.
 */
export const POST = handle(async (request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const limitBlock = await requireLimit(auth.tenant, "postsPerMonth");
  if (limitBlock) return limitBlock;

  const { id } = await ctx.params;
  const body = schema.parse(await request.json().catch(() => ({})));

  if (body.when === "schedule" && !body.scheduledAt) {
    return fail("Provide a time to schedule for (scheduledAt)", 422);
  }

  const result = await distributeReel({
    jobId: id,
    brandId: auth.brandId,
    accountIds: body.accountIds,
    when: body.when,
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    hashtagsInFirstComment: body.hashtagsInFirstComment,
    createdBy: auth.session.sub,
  });

  // Usage counting distributeReel() ni andar j thay che — be var na ganay.

  return ok(result, 201);
});

/** Publish pehla — kaya vakhate mukvu e suchav. */
export const GET = handle(async (_request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const job = await ReelJob.findOne({ _id: id, brand: auth.brandId })
    .select("analysis status")
    .lean();
  if (!job) return fail("Reel job not found", 404);

  const analysis = job.analysis as { category?: string } | undefined;

  return ok({
    ready: job.status === "done",
    slots: suggestedSlots(analysis?.category ?? "general", 4),
  });
});
