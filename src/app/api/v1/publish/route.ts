import { z } from "zod";
import { fail, handle, ok } from "@/lib/api";
import { requireApiToken, resolveBrand } from "@/lib/api-auth";
import { Post } from "@/models/Post";
import { publishPost } from "@/lib/publisher";
import { Automation } from "@/models/Automation";
import { runAutomation } from "@/lib/automation-runner";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** Ek post, ke ek batch na badha posts. */
  postId: z.string().optional(),
  batchId: z.string().optional(),
  brandSlug: z.string().optional(),
});

/**
 * POST /api/v1/publish
 * Draft/scheduled post(s) ne turant publish kare.
 */
export const POST = handle(async (request) => {
  const auth = await requireApiToken(request, "posts:publish");
  if ("response" in auth) return auth.response;

  const body = schema.parse(await request.json());
  if (!body.postId && !body.batchId) {
    return fail("Provide either `postId` or `batchId`", 422);
  }

  const brand = await resolveBrand(auth.ctx, body);
  if (!brand) return fail("Brand not found", 404);

  // Fakt aa organization na j posts — biji org no post publish na thai jay.
  const posts = await Post.find({
    brand: brand._id,
    ...(body.postId ? { _id: body.postId } : { batchId: body.batchId }),
  }).select("_id");

  if (posts.length === 0) return fail("Post not found", 404);

  const results = [];
  for (const post of posts) {
    const result = await publishPost(String(post._id));
    results.push({ postId: String(post._id), ...result });
  }

  return ok({
    published: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});

const runSchema = z.object({
  automationId: z.string().optional(),
  automationName: z.string().optional(),
  brandSlug: z.string().optional(),
});

/**
 * PUT /api/v1/publish
 * Koi automation ne turant chalave (schedule ni raah joya vagar).
 */
export const PUT = handle(async (request) => {
  const auth = await requireApiToken(request, "automations:run");
  if ("response" in auth) return auth.response;

  const body = runSchema.parse(await request.json());
  const brand = await resolveBrand(auth.ctx, body);
  if (!brand) return fail("Brand not found", 404);

  const automation = await Automation.findOne({
    brand: brand._id,
    ...(body.automationId
      ? { _id: body.automationId }
      : body.automationName
        ? { name: body.automationName }
        : {}),
  });

  if (!automation) return fail("Automation not found", 404);

  const result = await runAutomation(String(automation._id));
  return ok(result);
});
