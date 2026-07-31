import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { Organization } from "@/models/Organization";
import { User } from "@/models/User";
import { Plan } from "@/models/Plan";
import { Brand } from "@/models/Brand";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { ActivityLog } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

/** Platform-wide numbers — super admin dashboard mate. */
export const GET = handle(async () => {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    organizations,
    orgsByStatus,
    users,
    plans,
    brands,
    accounts,
    postsTotal,
    postsThisMonth,
    recentOrgs,
    recentLogs,
  ] = await Promise.all([
    Organization.countDocuments(),
    Organization.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    User.countDocuments({ role: { $ne: "superadmin" } }),
    Plan.countDocuments({ active: true }),
    Brand.countDocuments(),
    SocialAccount.countDocuments(),
    Post.countDocuments(),
    Post.countDocuments({ createdAt: { $gte: monthStart } }),
    Organization.find()
      .populate("plan", "name key")
      .populate("owner", "name email")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    ActivityLog.find().sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  // MRR — active/trial organizations na plans no sarvado.
  const revenue = await Organization.aggregate<{ total: number }>([
    { $match: { status: { $in: ["active", "trial"] } } },
    {
      $lookup: {
        from: "plans",
        localField: "plan",
        foreignField: "_id",
        as: "planDoc",
      },
    },
    { $unwind: "$planDoc" },
    { $group: { _id: null, total: { $sum: "$planDoc.priceMonthly" } } },
  ]);

  return ok({
    organizations,
    byStatus: Object.fromEntries(
      orgsByStatus.map((row) => [row._id, row.count]),
    ),
    users,
    plans,
    brands,
    accounts,
    postsTotal,
    postsThisMonth,
    mrr: revenue[0]?.total ?? 0,
    recentOrgs,
    recentLogs,
  });
});
