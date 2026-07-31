import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { fail, handle, ok, requireAuth } from "@/lib/api";
import { notifyN8n } from "@/lib/n8n";
import { logActivity } from "@/models/ActivityLog";

const createSchema = z
  .object({
    // Ek account (juno format) ke ghana accounts (bulk) — banne chale che.
    account: z.string().optional(),
    accounts: z.array(z.string()).optional(),
    campaign: z.string().optional(),
    caption: z.string().min(1),
    hashtags: z.array(z.string()).optional(),
    mediaUrl: z.string().optional(),
    prompt: z.string().optional(),
    status: z.enum(["draft", "scheduled"]).optional(),
    scheduledAt: z.string().optional(),
    generatedByAI: z.boolean().optional(),
  })
  .refine((value) => value.account || value.accounts?.length, {
    message: "Ochha ma ochho ek account select karo",
    path: ["accounts"],
  });

export const GET = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const platform = url.searchParams.get("platform");
  const batchId = url.searchParams.get("batchId");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 300);

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (platform) filter.platform = platform;
  if (batchId) filter.batchId = batchId;

  const posts = await Post.find(filter)
    .populate("account", "displayName platform")
    .populate("campaign", "name")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return ok(posts);
});

/**
 * Ek j caption ne ek ke ghana accounts par post kare.
 * Dareak account mate alag Post document bane che (potano status/permalink),
 * pan badha ek `batchId` thi jodayela rahe che.
 *
 * Ek account fail thay (dakhla tarike IG ne image nathi malyu) to baki na
 * accounts atkata nathi — response ma per-account result pacho aave che.
 */
export const POST = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const body = createSchema.parse(await request.json());

  const requestedIds = Array.from(
    new Set([...(body.accounts ?? []), ...(body.account ? [body.account] : [])]),
  );

  const accounts = await SocialAccount.find({ _id: { $in: requestedIds } });
  if (accounts.length === 0) {
    return fail("Ek pan valid social account madyu nahi", 404);
  }

  const status = body.status ?? "draft";
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined;
  const batchId = accounts.length > 1 ? randomUUID() : undefined;

  const created: Array<{ id: string; account: string; platform: string }> = [];
  const skipped: Array<{ account: string; reason: string }> = [];

  for (const account of accounts) {
    // Instagram Content Publishing API ne image farjiyat joiye che.
    if (account.platform === "instagram" && !body.mediaUrl) {
      skipped.push({
        account: account.displayName,
        reason: "Instagram mate public image URL farjiyat che",
      });
      continue;
    }

    const post = await Post.create({
      account: account._id,
      campaign: body.campaign || undefined,
      platform: account.platform,
      caption: body.caption,
      hashtags: body.hashtags ?? [],
      mediaUrl: body.mediaUrl || undefined,
      mediaType: body.mediaUrl ? "image" : "none",
      prompt: body.prompt,
      status,
      scheduledAt,
      batchId,
      source: body.generatedByAI ? "ai" : "manual",
      createdBy: auth.session.sub,
    });

    created.push({
      id: String(post._id),
      account: account.displayName,
      platform: account.platform,
    });
  }

  if (created.length === 0) {
    return fail(
      skipped.map((entry) => `${entry.account}: ${entry.reason}`).join(" | "),
      422,
    );
  }

  await logActivity({
    level: skipped.length ? "warning" : "success",
    action: "post.created",
    message: `${created.length} post banya (${created
      .map((entry) => entry.account)
      .join(", ")})${skipped.length ? ` · ${skipped.length} skip thaya` : ""}`,
    actor: auth.session.email,
    meta: { batchId, created, skipped },
  });

  await notifyN8n(status === "scheduled" ? "post.scheduled" : "post.created", {
    batchId,
    count: created.length,
    posts: created,
    scheduledAt,
  });

  return ok({ batchId, created, skipped }, 201);
});
