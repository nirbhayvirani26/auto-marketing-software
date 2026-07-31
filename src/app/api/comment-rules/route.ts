import { z } from "zod";
import { CommentRule, CommentEvent } from "@/models/CommentRule";
import { handle, ok, requireBrand, requireLimit, requireModule } from "@/lib/api";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  accounts: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  matchType: z.enum(["any", "all", "exact"]).default("any"),
  caseSensitive: z.boolean().default(false),
  publicReply: z.boolean().default(true),
  publicReplyText: z.string().optional(),
  sendDm: z.boolean().default(true),
  dmText: z.string().optional(),
  dmLinkUrl: z.string().optional(),
  dmLinkTitle: z.string().optional(),
  useAi: z.boolean().default(false),
  aiInstruction: z.string().optional(),
  onlyOncePerUser: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

export const GET = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const gated = requireModule(ctx.tenant, "autoDm");
  if (gated) return gated;

  const [rules, recentEvents] = await Promise.all([
    CommentRule.find({ brand: ctx.brandId })
      .populate("accounts", "displayName platform")
      .sort({ createdAt: -1 })
      .lean(),
    CommentEvent.find({ brand: ctx.brandId })
      .populate("account", "displayName platform")
      .sort({ createdAt: -1 })
      .limit(25)
      .lean(),
  ]);

  return ok({ rules, recentEvents });
});

export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const gated = requireModule(ctx.tenant, "autoDm");
  if (gated) return gated;

  const limited = await requireLimit(ctx.tenant, "commentRules");
  if (limited) return limited;

  const body = createSchema.parse(await request.json());

  const rule = await CommentRule.create({
    ...body,
    keywords: (body.keywords ?? [])
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    brand: ctx.brandId,
    createdBy: ctx.session.sub,
  });

  return ok({ id: String(rule._id) }, 201);
});
