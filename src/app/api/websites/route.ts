import { z } from "zod";

import { fail, handle, ok, requireBrand } from "@/lib/api";
import { logActivity } from "@/models/ActivityLog";
import { Website } from "@/models/Website";
import { normaliseSiteUrl } from "@/lib/website/crawler";
import { syncWebsite } from "@/lib/website/sync";
import { DuplicateKeyError } from "@/lib/localdb";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  url: z.string().min(4).max(300),
  name: z.string().max(120).optional(),
  /** Crawl straight away. Off by default so the request returns quickly. */
  sync: z.boolean().optional(),
});

/** Every store connected to this brand. */
export const GET = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const withProducts = new URL(request.url).searchParams.get("products") === "1";

  const websites = await Website.find({ brand: ctx.brandId, active: true })
    .sort({ createdAt: 1 })
    .lean();

  return ok(
    websites.map((site) => ({
      id: String(site._id),
      name: site.name,
      url: site.url,
      host: site.host,
      platform: site.platform,
      productCount: site.products?.length ?? 0,
      lastSyncedAt: site.lastSyncedAt,
      lastSyncMs: site.lastSyncMs,
      syncStatus: site.syncStatus,
      syncError: site.syncError,
      syncSources: site.syncSources ?? [],
      // The full list is large, so it is only sent when asked for.
      products: withProducts ? (site.products ?? []) : undefined,
    })),
  );
});

/** Connects a store, and optionally crawls it immediately. */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const body = createSchema.parse(await request.json());

  let normalised: { url: string; host: string };
  try {
    normalised = normaliseSiteUrl(body.url);
  } catch {
    return fail("That does not look like a valid website address", 422);
  }

  let website;
  try {
    website = await Website.create({
      brand: ctx.brandId,
      url: normalised.url,
      host: normalised.host,
      name: body.name?.trim() || normalised.host,
      createdBy: ctx.session.sub,
      syncStatus: "never",
    });
  } catch (error) {
    if (error instanceof DuplicateKeyError) {
      return fail(`${normalised.host} is already connected to this brand`, 409);
    }
    throw error;
  }

  await logActivity({
    action: "website.connected",
    message: `Connected ${normalised.host}`,
    actor: ctx.session.email,
  });

  if (body.sync) {
    await syncWebsite(String(website._id), ctx.brandId);
    const fresh = await Website.findById(website._id).lean();
    return ok(
      {
        id: String(website._id),
        host: fresh?.host,
        productCount: fresh?.products?.length ?? 0,
        syncStatus: fresh?.syncStatus,
        syncSources: fresh?.syncSources ?? [],
        syncError: fresh?.syncError,
      },
      201,
    );
  }

  return ok({ id: String(website._id), host: website.host }, 201);
});
