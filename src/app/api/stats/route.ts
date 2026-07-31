import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { Campaign } from "@/models/Campaign";
import { Automation } from "@/models/Automation";
import { ActivityLog } from "@/models/ActivityLog";
import { handle, ok, requireAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const [
    accounts,
    campaigns,
    automations,
    statusCounts,
    upcoming,
    recentLogs,
  ] = await Promise.all([
    SocialAccount.countDocuments(),
    Campaign.countDocuments({ status: "active" }),
    Automation.countDocuments({ enabled: true }),
    Post.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Post.find({ status: "scheduled", scheduledAt: { $gte: new Date() } })
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
    accounts,
    activeCampaigns: campaigns,
    activeAutomations: automations,
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
