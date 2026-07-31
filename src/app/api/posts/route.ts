import { z } from "zod";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { fail, handle, ok, requireAuth } from "@/lib/api";
import { notifyN8n } from "@/lib/n8n";

const createSchema = z.object({
  account: z.string().min(1),
  campaign: z.string().optional(),
  caption: z.string().min(1),
  hashtags: z.array(z.string()).optional(),
  mediaUrl: z.string().optional(),
  prompt: z.string().optional(),
  status: z.enum(["draft", "scheduled"]).optional(),
  scheduledAt: z.string().optional(),
  generatedByAI: z.boolean().optional(),
});

export const GET = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const platform = url.searchParams.get("platform");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 300);

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (platform) filter.platform = platform;

  const posts = await Post.find(filter)
    .populate("account", "displayName platform")
    .populate("campaign", "name")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return ok(posts);
});

export const POST = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const body = createSchema.parse(await request.json());

  const account = await SocialAccount.findById(body.account);
  if (!account) return fail("Social account madyu nahi", 404);

  if (account.platform === "instagram" && !body.mediaUrl) {
    return fail(
      "Instagram post mate public image URL farjiyat che.",
      422,
    );
  }

  const post = await Post.create({
    ...body,
    platform: account.platform,
    mediaType: body.mediaUrl ? "image" : "none",
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    status: body.status ?? "draft",
    source: body.generatedByAI ? "ai" : "manual",
    createdBy: auth.session.sub,
  });

  await notifyN8n(post.status === "scheduled" ? "post.scheduled" : "post.created", {
    postId: String(post._id),
    platform: post.platform,
    scheduledAt: post.scheduledAt,
  });

  return ok({ id: String(post._id) }, 201);
});
