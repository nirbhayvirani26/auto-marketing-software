import { Automation, type AutomationDoc } from "@/models/Automation";
import { Campaign } from "@/models/Campaign";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { logActivity } from "@/models/ActivityLog";
import { generatePosts } from "./ai";
import { publishPost } from "./publisher";
import { notifyN8n } from "./n8n";

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
};

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
    result.errors.push("Automation madyu nahi");
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
