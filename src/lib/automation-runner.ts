import { Automation, type AutomationDoc } from "@/models/Automation";
import { Campaign } from "@/models/Campaign";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { logActivity } from "@/models/ActivityLog";
import { MediaAsset } from "@/models/MediaAsset";
import { generatePosts } from "./ai";
import { publishPost } from "./publisher";
import { notifyN8n } from "./n8n";
import { startReelJob } from "./reels/runner";

/** Frequency pramane next run kyare thay e nakki kare. */
export function computeNextRun(
  automation: Pick<AutomationDoc, "frequency" | "timeOfDay" | "dayOfWeek">,
  from = new Date(),
): Date {
  const [hourStr, minuteStr] = (automation.timeOfDay || "09:30").split(":");
  const hour = Number(hourStr) || 0;
  const minute = Number(minuteStr) || 0;

  const next = new Date(from);

  if (automation.frequency === "hourly") {
    next.setMinutes(minute, 0, 0);
    if (next <= from) next.setHours(next.getHours() + 1);
    return next;
  }

  next.setHours(hour, minute, 0, 0);

  if (automation.frequency === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // weekly
  const target = automation.dayOfWeek ?? 1;
  let delta = (target - next.getDay() + 7) % 7;
  if (delta === 0 && next <= from) delta = 7;
  next.setDate(next.getDate() + delta);
  return next;
}

export type AutomationRunResult = {
  automationId: string;
  created: number;
  published: number;
  errors: string[];
  /** Reel mode ma — background ma chalu thayelo job. */
  reelJobId?: string;
};

/**
 * Reel automation — "dar divase ek product ni reel banavi ne muki do".
 *
 * Reel banta 2-4 minute lage che, etle cron ni request ma raah na jovay.
 * Ahiya fakt job shuru karie chie; taiyar thay tyare background worker j
 * ene Instagram + Facebook par muki de che (jovo: ReelJob.autoDistribute).
 */
async function startReelAutomation(
  automation: AutomationDoc,
  accounts: Array<{ _id: unknown; displayName: string }>,
): Promise<{ jobId: string; imageCount: number }> {
  const count = Math.max(1, Math.min(automation.reelProductCount ?? 1, 10));

  let imageIds: string[];

  if (automation.reelSource === "fixed" && automation.reelImages?.length) {
    imageIds = automation.reelImages.map(String).slice(0, count);
  } else {
    // Library — brand ni upload kareli product images ma thi vaari fari,
    // jethi dareak product ne vaaro male ane ek j product roj na jaay.
    const library = await MediaAsset.find({
      brand: automation.brand,
      kind: "image",
      role: "product",
    })
      .sort({ createdAt: 1 })
      .select("_id")
      .lean();

    if (library.length === 0) {
      throw new Error(
        "Aa brand ma ek pan product image nathi. Reel Studio ma image upload karo, pachi aa automation apoaap emathi reel banavse.",
      );
    }

    const cursor = (automation.reelCursor ?? 0) % library.length;
    imageIds = Array.from({ length: Math.min(count, library.length) }, (_, i) =>
      String(library[(cursor + i) % library.length]._id),
    );

    automation.reelCursor = (cursor + imageIds.length) % library.length;
  }

  const { jobId } = await startReelJob(
    {
      brandId: String(automation.brand),
      imageAssetIds: imageIds,
      mode: imageIds.length > 1 ? "multi" : automation.reelAvatar ? "tryon" : "single",
      avatarId: automation.reelAvatar ? String(automation.reelAvatar) : undefined,
      targetDuration: automation.reelDuration ?? 40,
      language: automation.reelLanguage ?? "en",
      tone: automation.tone ?? undefined,
      hint: automation.topic,
      voiceover: automation.reelVoiceover ?? false,
      createdBy: automation.createdBy ? String(automation.createdBy) : undefined,
    },
    {
      autoDistribute: {
        accountIds: accounts.map((a) => String(a._id)),
        when: automation.autoPublish ? "now" : "draft",
        automationId: String(automation._id),
      },
    },
  );

  return { jobId, imageCount: imageIds.length };
}

/**
 * Ek automation chalave: AI thi caption banave, dareak selected account mate
 * post banave, ane autoPublish hoy to sidhu publish kare.
 */
export async function runAutomation(
  automationId: string,
): Promise<AutomationRunResult> {
  const result: AutomationRunResult = {
    automationId,
    created: 0,
    published: 0,
    errors: [],
  };

  const automation = await Automation.findById(automationId);
  if (!automation) {
    result.errors.push("Automation not found");
    return result;
  }

  const campaign = automation.campaign
    ? await Campaign.findById(automation.campaign)
    : null;

  const accountIds = automation.accounts?.length
    ? automation.accounts
    : (campaign?.accounts ?? []);

  const accounts = await SocialAccount.find({
    _id: { $in: accountIds },
    status: "connected",
  });

  if (accounts.length === 0) {
    result.errors.push("Koi connected account nathi");
    automation.lastError = result.errors[0];
    automation.lastRunAt = new Date();
    automation.nextRunAt = computeNextRun(automation);
    await automation.save();
    return result;
  }

  /* ---------------- Reel mode ---------------- */
  if (automation.mode === "reel") {
    try {
      const started = await startReelAutomation(automation, accounts);
      result.created = started.imageCount;
      result.reelJobId = started.jobId;
    } catch (error) {
      result.errors.push((error as Error).message);
    }

    automation.lastRunAt = new Date();
    automation.runCount = (automation.runCount ?? 0) + 1;
    automation.nextRunAt = computeNextRun(automation);
    automation.lastError = result.errors.length ? result.errors.join(" | ") : undefined;
    await automation.save();

    await logActivity({
      level: result.errors.length ? "warning" : "success",
      action: "automation.run",
      message: result.errors.length
        ? `"${automation.name}" — the reel could not be started`
        : `"${automation.name}" — reel started (${result.created} photo(s))`,
      automation: automation._id,
      meta: result,
    });

    await notifyN8n("automation.completed", { ...result, name: automation.name });
    return result;
  }

  /* ---------------- Post mode (juno vartav) ---------------- */
  for (const account of accounts) {
    try {
      const [generated] = await generatePosts({
        topic: automation.topic,
        platform: account.platform as "facebook" | "instagram",
        tone: automation.tone ?? undefined,
        brandVoice: campaign?.brandVoice ?? undefined,
        targetAudience: campaign?.targetAudience ?? undefined,
        keywords: campaign?.keywords ?? [],
        callToAction: campaign?.callToAction ?? undefined,
        variants: 1,
      });

      const hashtags = Array.from(
        new Set([...(generated.hashtags ?? []), ...(campaign?.hashtags ?? [])]),
      );

      const post = await Post.create({
        brand: automation.brand,
        campaign: campaign?._id,
        account: account._id,
        platform: account.platform,
        prompt: automation.topic,
        caption: generated.caption,
        hashtags,
        mediaType: "none",
        status: automation.autoPublish ? "scheduled" : "draft",
        scheduledAt: automation.autoPublish ? new Date() : undefined,
        generatedByAI: true,
        source: "automation",
      });
      result.created += 1;

      if (automation.autoPublish) {
        // Instagram ne image farjiyat che — media vagar publish attempt na karo.
        if (account.platform === "instagram" && !post.mediaUrl) {
          post.status = "draft";
          post.error =
            "Instagram mate image URL joiye — draft ma rakhyu che, image add karine publish karo.";
          await post.save();
          result.errors.push(`${account.displayName}: ${post.error}`);
        } else {
          const published = await publishPost(String(post._id));
          if (published.ok) result.published += 1;
          else result.errors.push(`${account.displayName}: ${published.error}`);
        }
      }
    } catch (error) {
      result.errors.push(`${account.displayName}: ${(error as Error).message}`);
    }
  }

  automation.lastRunAt = new Date();
  automation.runCount = (automation.runCount ?? 0) + 1;
  automation.nextRunAt = computeNextRun(automation);
  automation.lastError = result.errors.length ? result.errors.join(" | ") : undefined;
  await automation.save();

  await logActivity({
    level: result.errors.length ? "warning" : "success",
    action: "automation.run",
    message: `"${automation.name}" chalyu — ${result.created} post banya, ${result.published} publish thaya`,
    automation: automation._id,
    meta: result,
  });

  await notifyN8n("automation.completed", {
    ...result,
    name: automation.name,
  });

  return result;
}
