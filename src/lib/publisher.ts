import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { logActivity } from "@/models/ActivityLog";
import { notifyN8n } from "./n8n";
import {
  composeCaption,
  publishToFacebook,
  publishToInstagram,
} from "./social";
import { env } from "./env";

/**
 * Ek post ne actually publish kare ane DB ma status update kare.
 * Aa j function manual "Publish now", cron dispatcher, ane n8n webhook —
 * traney jagya thi vaparay che, jethi behaviour ek j rahe.
 */
export async function publishPost(postId: string): Promise<{
  ok: boolean;
  externalPostId?: string;
  permalink?: string;
  error?: string;
}> {
  const post = await Post.findById(postId);
  if (!post) return { ok: false, error: "Post madyo nahi" };

  if (post.status === "published") {
    return {
      ok: true,
      externalPostId: post.externalPostId ?? undefined,
      permalink: post.permalink ?? undefined,
    };
  }

  const account = await SocialAccount.findById(post.account).select(
    "+accessToken",
  );
  if (!account) {
    post.status = "failed";
    post.error = "Social account madyu nahi";
    await post.save();
    return { ok: false, error: post.error };
  }

  const accessToken = account.accessToken || env.metaDefaultAccessToken;
  if (!accessToken) {
    post.status = "failed";
    post.error = `"${account.displayName}" mate access token set nathi`;
    await post.save();
    await logActivity({
      level: "error",
      action: "post.publish",
      message: post.error,
      post: post._id,
    });
    return { ok: false, error: post.error };
  }

  post.status = "publishing";
  post.attempts = (post.attempts ?? 0) + 1;
  await post.save();

  try {
    const message = composeCaption(post.caption, post.hashtags ?? []);
    const result =
      post.platform === "facebook"
        ? await publishToFacebook({
            pageId: account.pageId ?? "",
            accessToken,
            message,
            imageUrl: post.mediaUrl || undefined,
          })
        : await publishToInstagram({
            igUserId: account.igUserId ?? "",
            accessToken,
            caption: message,
            imageUrl: post.mediaUrl ?? "",
          });

    post.status = "published";
    post.publishedAt = new Date();
    post.externalPostId = result.externalPostId;
    post.permalink = result.permalink;
    post.error = undefined;
    await post.save();

    await logActivity({
      level: "success",
      action: "post.published",
      message: `${post.platform} par publish thayu → ${account.displayName}`,
      post: post._id,
      meta: { externalPostId: result.externalPostId },
    });

    await notifyN8n("post.published", {
      postId: String(post._id),
      platform: post.platform,
      account: account.displayName,
      externalPostId: result.externalPostId,
      permalink: result.permalink,
    });

    return {
      ok: true,
      externalPostId: result.externalPostId,
      permalink: result.permalink,
    };
  } catch (error) {
    const message = (error as Error).message;
    post.status = "failed";
    post.error = message;
    await post.save();

    await logActivity({
      level: "error",
      action: "post.failed",
      message: `Publish fail: ${message}`,
      post: post._id,
    });

    await notifyN8n("post.failed", {
      postId: String(post._id),
      platform: post.platform,
      error: message,
    });

    return { ok: false, error: message };
  }
}
