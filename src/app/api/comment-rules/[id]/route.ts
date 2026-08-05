import { z } from "zod";
import { CommentRule } from "@/models/CommentRule";
import { fail, handle, ok, requireBrand } from "@/lib/api";
import { ruleMatches } from "@/lib/comment-engine";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  accounts: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  matchType: z.enum(["any", "all", "exact"]).optional(),
  caseSensitive: z.boolean().optional(),
  publicReply: z.boolean().optional(),
  publicReplyText: z.string().optional(),
  sendDm: z.boolean().optional(),
  dmText: z.string().optional(),
  dmLinkUrl: z.string().optional(),
  dmLinkTitle: z.string().optional(),
  product: z.string().optional(),
  useAi: z.boolean().optional(),
  aiInstruction: z.string().optional(),
  onlyOncePerUser: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = handle(async (request, { params }) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  const rule = await CommentRule.findOneAndUpdate(
    { _id: id, brand: ctx.brandId },
    body,
    { new: true },
  );
  if (!rule) return fail("Rule madyu nahi", 404);

  return ok({ id: String(rule._id) });
});

export const DELETE = handle(async (_request, { params }) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const rule = await CommentRule.findOneAndDelete({
    _id: id,
    brand: ctx.brandId,
  });
  if (!rule) return fail("Rule madyu nahi", 404);

  return ok({ deleted: true });
});

/**
 * Rule ne test karo — koi comment lakho ane jovo ke match thay che ke nahi.
 * Meta ne kai moklyu nathi jatu; fakt matching logic chale che.
 */
export const POST = handle(async (request, { params }) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const { comment } = z
    .object({ comment: z.string().min(1) })
    .parse(await request.json());

  const rule = await CommentRule.findOne({ _id: id, brand: ctx.brandId });
  if (!rule) return fail("Rule madyu nahi", 404);

  const matched = ruleMatches(rule, comment);

  return ok({
    matched,
    wouldPublicReply: matched && rule.publicReply,
    wouldSendDm: matched && rule.sendDm,
    publicReplyText: rule.publicReply ? rule.publicReplyText : undefined,
    dmText: rule.sendDm ? rule.dmText : undefined,
    usesAi: rule.useAi,
  });
});
