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
    Organization.groupCount("status"),
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

  // Monthly recurring revenue — the monthly price of every plan held by an
  // active or trialling organization.
  const [paying, allPlans] = await Promise.all([
    Organization.find({ status: { $in: ["active", "trial"] } })
      .select("plan")
      .lean(),
    Plan.find().select("priceMonthly").lean(),
  ]);

  const priceByPlan = new Map(
    allPlans.map((plan) => [String(plan._id), plan.priceMonthly ?? 0]),
  );
  const mrr = paying.reduce(
    (total, org) => total + (priceByPlan.get(String(org.plan)) ?? 0),
    0,
  );

  return ok({
    organizations,
    byStatus: orgsByStatus,
    users,
    plans,
    brands,
    accounts,
    postsTotal,
    postsThisMonth,
    mrr,
    recentOrgs,
    recentLogs,
  });
});
