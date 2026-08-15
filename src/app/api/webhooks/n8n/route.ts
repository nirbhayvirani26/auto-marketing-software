import { z } from "zod";
import { connectDB } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { verifyN8nSecret } from "@/lib/n8n";
import { generatePosts } from "@/lib/ai";
import { publishPost } from "@/lib/publisher";
import { runAutomation } from "@/lib/automation-runner";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("automation.run"),
    automationId: z.string(),
  }),
  z.object({
    event: z.literal("post.publish"),
    postId: z.string(),
  }),
  z.object({
    // n8n mathi sidhu "aa topic par post banavo ane mokli do"
    event: z.literal("post.generate"),
    accountId: z.string(),
    topic: z.string().min(3),
    tone: z.string().optional(),
    mediaUrl: z.string().optional(),
    publish: z.boolean().optional(),
  }),
]);

/**
 * n8n aa endpoint ne call kare che (HTTP Request node).
 * Header ma `x-n8n-secret: <N8N_WEBHOOK_SECRET>` hovu joiye.
 */
export const POST = handle(async (request) => {
  if (!verifyN8nSecret(request)) {
    return fail("Invalid n8n secret", 401);
  }

  await connectDB();
  const body = schema.parse(await request.json());

  await logActivity({
    action: "n8n.webhook",
    message: `n8n event madyu: ${body.event}`,
    meta: body,
    actor: "n8n",
  });

  switch (body.event) {
    case "automation.run": {
      const result = await runAutomation(body.automationId);
      return ok(result);
    }

    case "post.publish": {
      const result = await publishPost(body.postId);
      if (!result.ok) return fail(result.error ?? "Publish fail thayu", 502);
      return ok(result);
    }

    case "post.generate": {
      const account = await SocialAccount.findById(body.accountId);
      if (!account) return fail("Social account not found", 404);

      const [generated] = await generatePosts({
        topic: body.topic,
        platform: account.platform as "facebook" | "instagram",
        tone: body.tone,
        variants: 1,
      });

      const post = await Post.create({
        account: account._id,
        platform: account.platform,
        prompt: body.topic,
        caption: generated.caption,
        hashtags: generated.hashtags,
        mediaUrl: body.mediaUrl,
        mediaType: body.mediaUrl ? "image" : "none",
        status: "draft",
        generatedByAI: true,
        source: "n8n",
      });

      if (body.publish) {
        const result = await publishPost(String(post._id));
        return ok({ postId: String(post._id), published: result });
      }

      return ok({
        postId: String(post._id),
        caption: generated.caption,
        hashtags: generated.hashtags,
        imagePrompt: generated.imagePrompt,
      });
    }
  }
});
