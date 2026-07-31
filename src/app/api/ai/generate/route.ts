import { z } from "zod";
import { generatePosts } from "@/lib/ai";
import { Campaign } from "@/models/Campaign";
import { handle, ok, requireAuth } from "@/lib/api";
import { logActivity } from "@/models/ActivityLog";

const schema = z.object({
  topic: z.string().min(3),
  platform: z.enum(["facebook", "instagram"]),
  tone: z.string().optional(),
  campaignId: z.string().optional(),
  variants: z.number().int().min(1).max(5).optional(),
});

export const POST = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const body = schema.parse(await request.json());

  // Campaign hoy to brand context AI ne aape.
  const campaign = body.campaignId
    ? await Campaign.findById(body.campaignId).lean()
    : null;

  const posts = await generatePosts({
    topic: body.topic,
    platform: body.platform,
    tone: body.tone,
    variants: body.variants ?? 1,
    brandVoice: campaign?.brandVoice ?? undefined,
    targetAudience: campaign?.targetAudience ?? undefined,
    keywords: campaign?.keywords ?? [],
    callToAction: campaign?.callToAction ?? undefined,
  });

  await logActivity({
    action: "ai.generate",
    message: `${posts.length} ${body.platform} post generate thaya — "${body.topic}"`,
    actor: auth.session.email,
  });

  return ok({ posts });
});
