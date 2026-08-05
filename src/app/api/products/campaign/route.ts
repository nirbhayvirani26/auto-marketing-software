import { z } from "zod";
import { fail, handle, ok, requireBrand, requireModule } from "@/lib/api";
import { runProductCampaign } from "@/lib/product-campaign";
import { incrementPostUsage } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  productId: z.string(),
  accountIds: z.array(z.string()).optional(),
  tone: z.string().optional(),
  publish: z.boolean().optional(),
  scheduledAt: z.string().optional(),
  imageMode: z.string().optional(),
});

/**
 * POST /api/products/campaign
 * Product ni link parthi: AI caption + image + Facebook/Instagram post,
 * ane caption ma product ni link.
 */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const gated = requireModule(ctx.tenant, "aiGeneration");
  if (gated) return gated;

  const body = schema.parse(await request.json());

  try {
    const result = await runProductCampaign({
      productId: body.productId,
      brand: ctx.brand,
      accountIds: body.accountIds,
      tone: body.tone,
      publish: body.publish,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      imageMode: body.imageMode,
      createdBy: ctx.session.sub,
    });

    if (result.created.length > 0) {
      await incrementPostUsage(ctx.orgId, result.created.length);
    }

    return ok(result, 201);
  } catch (error) {
    return fail((error as Error).message, 422);
  }
});
