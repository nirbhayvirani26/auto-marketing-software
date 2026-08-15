import { fail, handle, ok, requireBrand } from "@/lib/api";
import { Website } from "@/models/Website";
import { syncWebsite } from "@/lib/website/sync";

export const dynamic = "force-dynamic";
// Crawling a large store takes longer than the default budget.
export const maxDuration = 300;

/**
 * Re-crawls a store and returns what was found.
 *
 * This runs inline rather than in the background: a sync takes seconds, not
 * minutes, and the seller is watching the button.
 */
export const POST = handle(async (_request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;

  const exists = await Website.findOne({ _id: id, brand: auth.brandId }).lean();
  if (!exists) return fail("Website not found", 404);

  await syncWebsite(id, auth.brandId);

  const website = await Website.findById(id).lean();

  return ok({
    id,
    host: website?.host,
    syncStatus: website?.syncStatus,
    syncError: website?.syncError,
    syncSources: website?.syncSources ?? [],
    lastSyncMs: website?.lastSyncMs,
    productCount: website?.products?.length ?? 0,
    products: website?.products ?? [],
  });
});
