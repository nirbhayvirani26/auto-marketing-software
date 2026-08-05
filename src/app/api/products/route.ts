import { z } from "zod";
import { fail, handle, ok, requireBrand } from "@/lib/api";
import { Product } from "@/models/Product";
import { scrapeProduct } from "@/lib/product-scraper";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const products = await Product.find({ brand: ctx.brandId, active: true })
    .sort({ createdAt: -1 })
    .lean();

  return ok(products);
});

const createSchema = z.object({
  url: z.string().min(4),
  /** Scrape kharab aave to user jate sudhari shake. */
  title: z.string().optional(),
  description: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
});

/**
 * Link paste karo → vigat aapoaap aavi jaay → product save thay.
 * Scrape fail thay to pan record bane che (title jate bharvu pade).
 */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const body = createSchema.parse(await request.json());

  let scraped;
  let scrapeError: string | undefined;
  try {
    scraped = await scrapeProduct(body.url);
  } catch (error) {
    scrapeError = (error as Error).message;
    // Title jate aapyu hoy to aagal vadhi shakay.
    if (!body.title) {
      return fail(scrapeError, 422);
    }
  }

  const doc = {
    brand: ctx.brandId,
    url: scraped?.url ?? body.url,
    title: body.title ?? scraped?.title ?? "",
    description: body.description ?? scraped?.description ?? "",
    price: body.price ?? scraped?.price,
    currency: body.currency ?? scraped?.currency,
    brandName: scraped?.brand,
    availability: scraped?.availability,
    siteName: scraped?.siteName,
    images: scraped?.images ?? [],
    scrapeSource: scraped?.source,
    lastScrapedAt: new Date(),
    scrapeError,
    createdBy: ctx.session.sub,
  };

  // Ek j link be vaar add thay to update thay che.
  const product = await Product.findOneAndUpdate(
    { brand: ctx.brandId, url: doc.url },
    doc,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await logActivity({
    level: scrapeError ? "warning" : "success",
    action: "product.added",
    message: `Product add thayu: ${product.title}${scrapeError ? " (vigat jate bhari)" : ""}`,
    actor: ctx.session.email,
  });

  return ok({ product, scrapeError }, 201);
});

export const DELETE = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return fail("Product id joiye", 400);

  const product = await Product.findOneAndDelete({ _id: id, brand: ctx.brandId });
  if (!product) return fail("Product madyu nahi", 404);

  return ok({ deleted: true });
});
