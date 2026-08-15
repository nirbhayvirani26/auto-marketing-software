import { Post, type PostDocument } from "@/models/Post";
import {
  SocialAccount,
  type SocialAccountDocument,
} from "@/models/SocialAccount";
import { logActivity } from "@/models/ActivityLog";
import { notifyN8n } from "./n8n";
import {
  composeCaption,
  publishToFacebook,
  publishToInstagram,
} from "./social";
import {
  commentOnPost,
  publishCarouselToInstagram,
  publishReelToFacebook,
  publishReelToInstagram,
  publishStoryToFacebook,
  publishStoryToInstagram,
  publishVideoToFacebook,
  type VideoPublishResult,
} from "./social-video";
import { env } from "./env";

/**
 * Ek post ne actually publish kare ane DB ma status update kare.
 *
 * Aa j function manual "Publish now", cron dispatcher, reel studio ane
 * n8n webhook — badhi jagya thi vaparay che, jethi behaviour ek j rahe.
 *
 * Post no `postType` nakki kare che ke kaya Meta API par javanu:
 *   image → /media (IG) ke /photos (FB)
 *   reel  → REELS container (IG) ke video_reels (FB)
 *   carousel / story — potpotana endpoint
 */
export async function publishPost(
  postId: string,
  options: { onProgress?: (step: string) => void } = {},
): Promise<{
  ok: boolean;
  externalPostId?: string;
  permalink?: string;
  error?: string;
}> {
  const post = await Post.findById(postId);
  if (!post) return { ok: false, error: "Post not found" };

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
    // A draft created before any account was connected has nothing to publish
    // to. That is not a failure of the draft — leave it as a draft so it can
    // be published once an account exists.
    const reason = post.account
      ? "That social account no longer exists. Reconnect it, or pick another."
      : "This draft has no account yet. Connect Instagram or Facebook, then choose one.";
    post.error = reason;
    await post.save();
    return { ok: false, error: reason };
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
  post.error = undefined;
  await post.save();

  const progress = (step: string) => {
    options.onProgress?.(step);
  };

  try {
    // Caption: hashtag pehla comment ma jata hoy to caption ma na naakho.
    const message = post.firstComment
      ? post.caption
      : composeCaption(post.caption, post.hashtags ?? []);

    const result = await publishByType({
      post,
      account,
      accessToken,
      message,
      onProgress: progress,
    });

    post.status = "published";
    post.publishedAt = new Date();
    post.externalPostId = result.externalPostId;
    post.permalink = result.permalink;
    post.error = undefined;

    // Pehlo comment — hashtag block. Aa fail thay to post to gayo j che,
    // etle aakhu fail nathi ganta.
    if (post.firstComment && result.externalPostId) {
      try {
        const comment = await commentOnPost({
          mediaId: result.externalPostId,
          accessToken,
          message: post.firstComment,
        });
        post.firstCommentId = comment.id;
      } catch (error) {
        await logActivity({
          level: "warning",
          action: "post.first_comment",
          message: `Pehlo comment na thayo: ${(error as Error).message}`,
          post: post._id,
        });
      }
    }

    await post.save();

    await logActivity({
      level: "success",
      action: "post.published",
      message: `${post.platform} par ${post.postType ?? "post"} publish thayu → ${account.displayName}`,
      post: post._id,
      meta: { externalPostId: result.externalPostId, permalink: result.permalink },
    });

    await notifyN8n("post.published", {
      postId: String(post._id),
      platform: post.platform,
      postType: post.postType,
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
      message: `Publish fail (${post.platform}/${post.postType}): ${message}`,
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

/* ------------------------------------------------------------------ *
 *  Post type dith rasto
 * ------------------------------------------------------------------ */

async function publishByType(opts: {
  post: PostDocument;
  account: SocialAccountDocument;
  accessToken: string;
  message: string;
  onProgress: (step: string) => void;
}): Promise<VideoPublishResult> {
  const { post, account, accessToken, message, onProgress } = opts;
  const type = post.postType ?? "image";
  const isInstagram = post.platform === "instagram";

  const igUserId = account.igUserId ?? "";
  const pageId = account.pageId ?? "";

  if (isInstagram && !igUserId) {
    throw new Error(
      `"${account.displayName}" nu Instagram Business account id nathi — Accounts page ma fari connect karo.`,
    );
  }
  if (!isInstagram && !pageId) {
    throw new Error(`"${account.displayName}" nu Facebook Page id nathi.`);
  }

  switch (type) {
    case "reel": {
      const videoUrl = post.mediaUrl ?? "";
      if (!videoUrl) throw new Error("The reel has no video URL");

      if (isInstagram) {
        return publishReelToInstagram({
          igUserId,
          accessToken,
          caption: message,
          videoUrl,
          coverUrl: post.thumbnailUrl ?? undefined,
          shareToFeed: true,
          onProgress,
        });
      }

      // Facebook: pehla Reels API, e na chale to sadho feed video.
      try {
        return await publishReelToFacebook({
          pageId,
          accessToken,
          description: message,
          videoUrl,
          onProgress,
        });
      } catch (error) {
        onProgress(`Facebook Reels na chalyu (${(error as Error).message}) — feed video thi try karie chie`);
        return publishVideoToFacebook({
          pageId,
          accessToken,
          description: message,
          videoUrl,
        });
      }
    }

    case "carousel": {
      const urls = (post.mediaUrls ?? []).filter(Boolean);
      if (urls.length < 2) throw new Error("A carousel needs at least 2 images");

      if (isInstagram) {
        return publishCarouselToInstagram({
          igUserId,
          accessToken,
          caption: message,
          items: urls.map((url) => ({
            url,
            type: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? ("video" as const) : ("image" as const),
          })),
          onProgress,
        });
      }

      // Facebook par carousel ek j API call ma nathi — pehli image + caption
      // mukiye chie, ane baki ni image e j post ma joda vagar alag rahe che.
      return publishToFacebook({
        pageId,
        accessToken,
        message,
        imageUrl: urls[0],
      });
    }

    case "story": {
      const mediaUrl = post.mediaUrl ?? "";
      if (!mediaUrl) throw new Error("The story has no media URL");
      const isVideo = post.mediaType === "video";

      return isInstagram
        ? publishStoryToInstagram({
            igUserId,
            accessToken,
            mediaUrl,
            mediaType: isVideo ? "video" : "image",
          })
        : isVideo
          ? publishStoryToFacebook({ pageId, accessToken, videoUrl: mediaUrl })
          : Promise.reject(
              new Error("A Facebook Story needs a video — image stories are not available through the API"),
            );
    }

    default: {
      // image ke text
      if (isInstagram) {
        return publishToInstagram({
          igUserId,
          accessToken,
          caption: message,
          imageUrl: post.mediaUrl ?? "",
        });
      }
      return publishToFacebook({
        pageId,
        accessToken,
        message,
        imageUrl: post.mediaUrl || undefined,
      });
    }
  }
}
