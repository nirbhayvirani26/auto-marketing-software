import { z } from "zod";
import { Post } from "@/models/Post";
import { fail, handle, ok, requireAuth } from "@/lib/api";

const updateSchema = z.object({
  caption: z.string().min(1).optional(),
  hashtags: z.array(z.string()).optional(),
  mediaUrl: z.string().optional(),
  status: z.enum(["draft", "scheduled", "failed"]).optional(),
  scheduledAt: z.string().nullable().optional(),
});

export const GET = handle(async (_request, { params }) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const post = await Post.findById(id)
    .populate("account", "displayName platform")
    .populate("campaign", "name")
    .lean();
  if (!post) return fail("Post madyo nahi", 404);
  return ok(post);
});

export const PATCH = handle(async (request, { params }) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  const post = await Post.findById(id);
  if (!post) return fail("Post madyo nahi", 404);
  if (post.status === "published") {
    return fail("Publish thai gayela post ne edit na karay", 409);
  }

  if (body.caption !== undefined) post.caption = body.caption;
  if (body.hashtags !== undefined) post.hashtags = body.hashtags;
  if (body.mediaUrl !== undefined) {
    post.mediaUrl = body.mediaUrl;
    post.mediaType = body.mediaUrl ? "image" : "none";
  }
  if (body.status !== undefined) post.status = body.status;
  if (body.scheduledAt !== undefined) {
    post.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined;
  }

  await post.save();
  return ok({ id: String(post._id) });
});

export const DELETE = handle(async (_request, { params }) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const post = await Post.findByIdAndDelete(id);
  if (!post) return fail("Post madyo nahi", 404);
  return ok({ deleted: true });
});
