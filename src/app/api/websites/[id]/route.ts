import { z } from "zod";

import { fail, handle, ok, requireBrand } from "@/lib/api";
import { logActivity } from "@/models/ActivityLog";
import { Website } from "@/models/Website";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  /** A product the seller adds by hand, when the crawler missed it. */
  addProduct: z
    .object({
      url: z.string().min(4).max(500),
      title: z.string().min(1).max(200),
      imageUrl: z.string().max(500).optional(),
      price: z.string().max(60).optional(),
    })
    .optional(),
  removeProductUrl: z.string().max(500).optional(),
});

/** One store, with its full product list. */
export const GET = handle(async (_request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const website = await Website.findOne({ _id: id, brand: auth.brandId }).lean();
  if (!website) return fail("Website not found", 404);

  return ok({
    id: String(website._id),
    name: website.name,
    url: website.url,
    host: website.host,
    platform: website.platform,
    syncStatus: website.syncStatus,
    syncError: website.syncError,
    syncSources: website.syncSources ?? [],
    lastSyncedAt: website.lastSyncedAt,
    lastSyncMs: website.lastSyncMs,
    products: website.products ?? [],
  });
});

export const PATCH = handle(async (request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const body = updateSchema.parse(await request.json());

  const website = await Website.findOne({ _id: id, brand: auth.brandId });
  if (!website) return fail("Website not found", 404);

  if (body.name) website.name = body.name;

  if (body.addProduct) {
    const exists = website.products.some((item) => item.url === body.addProduct!.url);
    if (exists) return fail("That product is already in the list", 409);

    website.products = [
      { ...body.addProduct, source: "manual" as const, foundAt: new Date() },
      ...website.products,
    ];
  }

  if (body.removeProductUrl) {
    website.products = website.products.filter(
      (item) => item.url !== body.removeProductUrl,
    );
  }

  await website.save();
  return ok({ id: String(website._id), productCount: website.products.length });
});

export const DELETE = handle(async (_request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const website = await Website.findOne({ _id: id, brand: auth.brandId });
  if (!website) return fail("Website not found", 404);

  await website.deleteOne();

  await logActivity({
    action: "website.disconnected",
    message: `Disconnected ${website.host}`,
    actor: auth.session.email,
  });

  return ok({ deleted: true });
});
