import { handle, ok } from "@/lib/api";
import { requireApiToken, resolveBrand } from "@/lib/api-auth";
import { SocialAccount } from "@/models/SocialAccount";
import { Brand } from "@/models/Brand";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/accounts
 * n8n ne kaya Facebook Pages / Instagram accounts available che e batave.
 *
 *   Authorization: Bearer amk_...
 *   ?brandSlug=my-brand   (optional — nahi to badha brands na accounts)
 */
export const GET = handle(async (request) => {
  const auth = await requireApiToken(request, "accounts:read");
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const brandSlug = url.searchParams.get("brandSlug") ?? undefined;
  const platform = url.searchParams.get("platform") ?? undefined;

  const brands = brandSlug
    ? [await resolveBrand(auth.ctx, { brandSlug })].filter(Boolean)
    : await Brand.find({ organization: auth.ctx.orgId, active: true });

  const accounts = await SocialAccount.find({
    brand: { $in: brands.map((b) => b!._id) },
    ...(platform ? { platform } : {}),
  })
    .select("displayName platform pageId igUserId status brand")
    .populate("brand", "name slug")
    .lean();

  return ok({
    accounts: accounts.map((account) => ({
      id: String(account._id),
      name: account.displayName,
      platform: account.platform,
      status: account.status,
      brand: account.brand,
    })),
  });
});
