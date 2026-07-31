import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { Campaign } from "@/models/Campaign";
import { Automation } from "@/models/Automation";
import { ActivityLog } from "@/models/ActivityLog";
import { CommentRule, CommentEvent } from "@/models/CommentRule";
import { handle, ok, requireBrand } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const scope = { brand: ctx.brandId };

  const [
    accounts,
    campaigns,
    automations,
    dmRules,
    dmSent,
    statusCounts,
    upcoming,
    recentLogs,
  ] = await Promise.all([
    SocialAccount.countDocuments(scope),
    Campaign.countDocuments({ ...scope, status: "active" }),
    Automation.countDocuments({ ...scope, enabled: true }),
    CommentRule.countDocuments({ ...scope, enabled: true }),
    CommentEvent.countDocuments({ ...scope, dmSent: true }),
    Post.aggregate<{ _id: string; count: number }>([
      { $match: { brand: ctx.brand._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Post.find({ ...scope, status: "scheduled", scheduledAt: { $gte: new Date() } })
      .populate("account", "displayName platform")
      .sort({ scheduledAt: 1 })
      .limit(5)
      .lean(),
    ActivityLog.find().sort({ createdAt: -1 }).limit(8).lean(),
  ]);

  const byStatus = Object.fromEntries(
    statusCounts.map((entry) => [entry._id, entry.count]),
  ) as Record<string, number>;

  return ok({
    brand: { id: String(ctx.brand._id), name: ctx.brand.name },
    accounts,
    activeCampaigns: campaigns,
    activeAutomations: automations,
    dmRules,
    dmSent,
    posts: {
      total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      draft: byStatus.draft ?? 0,
      scheduled: byStatus.scheduled ?? 0,
      published: byStatus.published ?? 0,
      failed: byStatus.failed ?? 0,
    },
    upcoming,
    recentLogs,
  });
});
