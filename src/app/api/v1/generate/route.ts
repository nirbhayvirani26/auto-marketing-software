import { z } from "zod";
import { fail, handle, ok } from "@/lib/api";
import { requireApiToken, resolveBrand } from "@/lib/api-auth";
import { generatePosts, generateCommentReply } from "@/lib/ai";
import { moduleEnabled } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const schema = z.object({
  brandSlug: z.string().optional(),
  brandId: z.string().optional(),
  topic: z.string().min(3),
  platform: z.enum(["facebook", "instagram"]).default("facebook"),
  tone: z.string().optional(),
  variants: z.number().int().min(1).max(5).optional(),
});

/**
 * POST /api/v1/generate
 * Fakt AI content banave — kai save nathi thatu. n8n ma caption levo hoy
 * ane pachi potanu kai karvu hoy tyare kaam lage.
 */
export const POST = handle(async (request) => {
  const auth = await requireApiToken(request, "ai:generate");
  if ("response" in auth) return auth.response;

  if (!moduleEnabled(auth.ctx.tenant, "aiGeneration")) {
    return fail("AI generation tamara plan ma nathi", 402);
  }

  const body = schema.parse(await request.json());
  const brand = await resolveBrand(auth.ctx, body);

  const posts = await generatePosts({
    topic: body.topic,
    platform: body.platform,
    tone: body.tone,
    brandVoice: brand?.brandVoice ?? undefined,
    targetAudience: brand?.targetAudience ?? undefined,
    variants: body.variants ?? 1,
  });

  return ok({ posts });
});

const replySchema = z.object({
  comment: z.string().min(1),
  username: z.string().optional(),
  platform: z.enum(["facebook", "instagram"]).default("instagram"),
  instruction: z.string().optional(),
});

/**
 * PUT /api/v1/generate
 * Comment no AI jawab banave (public reply + DM). n8n potanu comment
 * handling karvu hoy tyare.
 */
export const PUT = handle(async (request) => {
  const auth = await requireApiToken(request, "ai:generate");
  if ("response" in auth) return auth.response;

  if (!moduleEnabled(auth.ctx.tenant, "aiGeneration")) {
    return fail("AI generation tamara plan ma nathi", 402);
  }

  const body = replySchema.parse(await request.json());

  const reply = await generateCommentReply({
    comment: body.comment,
    username: body.username,
    platform: body.platform,
    instruction: body.instruction,
    needsPublicReply: true,
    needsDm: true,
  });

  return ok(reply);
});
