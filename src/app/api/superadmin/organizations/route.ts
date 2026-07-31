import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { Organization } from "@/models/Organization";
import { Brand } from "@/models/Brand";
import { User } from "@/models/User";
import { SocialAccount } from "@/models/SocialAccount";
import { Post } from "@/models/Post";
import { Automation } from "@/models/Automation";

export const dynamic = "force-dynamic";

/** Badhi organizations + dareak ni usage — super admin ne badhu dekhaay. */
export const GET = handle(async (request) => {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("q");
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (search) filter.name = { $regex: search, $options: "i" };

  const organizations = await Organization.find(filter)
    .populate("plan", "name key priceMonthly limits modules")
    .populate("owner", "name email lastLoginAt")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const orgIds = organizations.map((org) => org._id);
  const brands = await Brand.find({ organization: { $in: orgIds } })
    .select("_id organization")
    .lean();

  const brandsByOrg = new Map<string, unknown[]>();
  for (const brand of brands) {
    const key = String(brand.organization);
    brandsByOrg.set(key, [...(brandsByOrg.get(key) ?? []), brand._id]);
  }

  // Dareak organization ni usage — brands thi thai ne.
  const enriched = await Promise.all(
    organizations.map(async (org) => {
      const ids = brandsByOrg.get(String(org._id)) ?? [];
      const [accounts, posts, automations, users] = await Promise.all([
        SocialAccount.countDocuments({ brand: { $in: ids } }),
        Post.countDocuments({ brand: { $in: ids } }),
        Automation.countDocuments({ brand: { $in: ids } }),
        User.countDocuments({ organization: org._id }),
      ]);
      return {
        ...org,
        usageCounts: {
          brands: ids.length,
          socialAccounts: accounts,
          posts,
          automations,
          users,
        },
      };
    }),
  );

  return ok(enriched);
});
