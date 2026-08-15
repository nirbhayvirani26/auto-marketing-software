/**
 * Banelu reel badha account par mokalvanu.
 *
 * "Instagram ma je jaay e Facebook ma pan jaay" — aa file e j kare che.
 * Ek j reel, pan dareak platform mate ALAG caption ane ALAG hashtag count,
 * karan ke Instagram ane Facebook ni ranking sav judi che.
 *
 * Dareak account no potano Post record bane che, etle ek account fail thay
 * to bija atkata nathi — ane fari fakt e j account retry thai shake che.
 */

import { randomUUID } from "node:crypto";

import { connectDB } from "@/lib/db";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { ReelJob } from "@/models/ReelJob";
import { MediaAsset } from "@/models/MediaAsset";
import { logActivity } from "@/models/ActivityLog";
import { Brand } from "@/models/Brand";
import { ensurePublicUrl } from "@/lib/media/store";
import { incrementPostUsage } from "@/lib/tenant";
import { publishPost } from "@/lib/publisher";
import { bestPostTimes, spreadSchedule } from "@/lib/seo/ranking";
import type { SocialCopy } from "@/lib/seo/copy";

export type DistributeOptions = {
  jobId: string;
  brandId: string;
  /** Khali = brand na badha connected accounts. */
  accountIds?: string[];
  /**
   * now      — atyare j publish karo
   * schedule — aapelo vakhat
   * auto     — sauthi saara vakhate apoaap goothvo
   * draft    — fakt draft banavo
   */
  when?: "now" | "schedule" | "auto" | "draft";
  scheduledAt?: Date;
  /** Hashtag caption ma nahi, pehla comment ma (IG mate saru). */
  hashtagsInFirstComment?: boolean;
  createdBy?: string;
};

export type DistributeResult = {
  batchId: string;
  created: Array<{
    postId: string;
    account: string;
    platform: string;
    status: string;
    scheduledAt?: Date;
    permalink?: string;
    error?: string;
  }>;
  skipped: Array<{ account: string; reason: string }>;
  instagramAudioHint?: unknown;
};

export async function distributeReel(
  options: DistributeOptions,
): Promise<DistributeResult> {
  await connectDB();

  const job = await ReelJob.findOne({ _id: options.jobId, brand: options.brandId });
  if (!job) throw new Error("Reel job not found");
  if (job.status !== "done") {
    throw new Error(`Reel hju taiyar nathi (status: ${job.status})`);
  }
  if (!job.output) throw new Error("The reel's video could not be found");

  const videoAsset = await MediaAsset.findById(job.output);
  if (!videoAsset) throw new Error("The reel's video file could not be found");

  // Meta ne download karva mate public URL joiye j che. Juno URL puro thai
  // gayo hoy (tmpfiles jeva host) to navo banavi laiye.
  const videoUrl = await ensurePublicUrl(videoAsset);

  let thumbnailUrl: string | undefined;
  if (job.thumbnail) {
    const thumb = await MediaAsset.findById(job.thumbnail);
    if (thumb) thumbnailUrl = await ensurePublicUrl(thumb).catch(() => undefined);
  }

  const filter: Record<string, unknown> = {
    brand: options.brandId,
    status: "connected",
  };
  if (options.accountIds?.length) filter._id = { $in: options.accountIds };

  const accounts = await SocialAccount.find(filter);
  if (accounts.length === 0) {
    throw new Error(
      "Ek pan connected account nathi — pehla Accounts page ma Instagram/Facebook jodo.",
    );
  }

  const copy = (job.copy ?? {}) as { instagram?: SocialCopy; facebook?: SocialCopy };
  const analysis = (job.analysis ?? {}) as { category?: string; productName?: string };

  const batchId = randomUUID();
  const result: DistributeResult = {
    batchId,
    created: [],
    skipped: [],
    instagramAudioHint: (job.audio as { instagramHint?: unknown })?.instagramHint,
  };

  /* ---- Kaya vakhate ---- */
  const when = options.when ?? "now";
  let slots: Date[] = [];

  if (when === "auto") {
    // Badha account ek j sekande post na kare — IG ne e game nahi.
    slots = spreadSchedule(accounts.length, {
      category: analysis.category ?? "general",
      minGapHours: accounts.length > 2 ? 6 : 20,
    });
  } else if (when === "schedule" && options.scheduledAt) {
    slots = accounts.map((_, i) => new Date(options.scheduledAt!.getTime() + i * 90_000));
  }

  /* ---- Dareak account mate post ---- */
  for (const [index, account] of accounts.entries()) {
    const platformCopy =
      account.platform === "instagram" ? copy.instagram : copy.facebook;

    if (!platformCopy) {
      result.skipped.push({
        account: account.displayName,
        reason: `${account.platform} mate caption madyu nahi — reel fari banavo`,
      });
      continue;
    }

    const useFirstComment =
      (options.hashtagsInFirstComment ?? true) && account.platform === "instagram";

    const scheduledAt = slots[index];
    const status =
      when === "draft" ? "draft" : when === "now" ? "scheduled" : "scheduled";

    const post = await Post.create({
      brand: options.brandId,
      account: account._id,
      platform: account.platform,
      postType: "reel",
      prompt: `Reel: ${analysis.productName ?? "product"}`,
      caption: platformCopy.caption,
      hashtags: platformCopy.hashtags,
      firstComment: useFirstComment ? platformCopy.firstComment : undefined,
      mediaUrl: videoUrl,
      mediaType: "video",
      thumbnailUrl,
      mediaAsset: videoAsset._id,
      reelJob: job._id,
      seo: platformCopy.score,
      audio: job.audio,
      status,
      scheduledAt,
      batchId,
      generatedByAI: true,
      source: "ai",
      createdBy: options.createdBy,
    });

    const entry: DistributeResult["created"][number] = {
      postId: String(post._id),
      account: account.displayName,
      platform: account.platform,
      status: post.status,
      scheduledAt,
    };

    if (when === "now") {
      const published = await publishPost(String(post._id));
      entry.status = published.ok ? "published" : "failed";
      entry.permalink = published.permalink;
      entry.error = published.error;
    }

    result.created.push(entry);
    job.posts.push(post._id);
  }

  await job.save();

  // Plan ni monthly limit ma ganvu. Aa ahiya karie chie (API route ma nahi)
  // jethi automation e banavela posts pan ganay — ane be var na ganay.
  if (when !== "draft" && result.created.length > 0) {
    const brand = await Brand.findById(options.brandId).select("organization").lean();
    if (brand?.organization) {
      await incrementPostUsage(brand.organization, result.created.length).catch(
        () => undefined,
      );
    }
  }

  await logActivity({
    level: result.created.some((c) => c.error) ? "warning" : "success",
    action: "reel.distributed",
    message: `Reel ${result.created.length} account par gayu (${when})`,
    meta: { jobId: String(job._id), batchId },
  });

  return result;
}

/**
 * "Aavti kale kaya vakhate mukvu?" — UI ne batavva mate.
 */
export function suggestedSlots(category: string, count = 3) {
  return bestPostTimes({ category, count }).map((slot) => ({
    at: slot.at.toISOString(),
    label: slot.label,
    strength: slot.strength,
  }));
}
