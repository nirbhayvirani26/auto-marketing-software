import { z } from "zod";
import { Brand, slugify } from "@/models/Brand";
import { SocialAccount } from "@/models/SocialAccount";
import { handle, ok, requireLimit, requireOrg } from "@/lib/api";
import { getActiveBrand } from "@/lib/brand";
import { checkLimit } from "@/lib/tenant";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().optional(),
  brandVoice: z.string().optional(),
  targetAudience: z.string().optional(),
  website: z.string().optional(),
  logoUrl: z.string().optional(),
  color: z.string().optional(),
  defaultHashtags: z.array(z.string()).optional(),
});

export const GET = handle(async () => {
  const ctx = await requireOrg();
  if ("response" in ctx) return ctx.response;

  const [brands, active, usage] = await Promise.all([
    Brand.find({ organization: ctx.orgId, active: true })
      .sort({ createdAt: 1 })
      .lean(),
    getActiveBrand(ctx.orgId),
    checkLimit(ctx.tenant, "brands"),
  ]);

  const countByBrand = await SocialAccount.groupCount("brand", {
    brand: { $in: brands.map((b) => b._id) },
  });

  return ok({
    brands: brands.map((brand) => ({
      ...brand,
      accountCount: countByBrand[String(brand._id)] ?? 0,
    })),
    activeBrandId: active ? String(active._id) : null,
    usage,
    plan: ctx.tenant.plan.name,
  });
});

export const POST = handle(async (request) => {
  const ctx = await requireOrg();
  if ("response" in ctx) return ctx.response;

  const limited = await requireLimit(ctx.tenant, "brands");
  if (limited) return limited;

  const body = createSchema.parse(await request.json());

  // Slug organization ni andar unique hovo joiye.
  const base = slugify(body.name) || "brand";
  let slug = base;
  for (
    let i = 2;
    await Brand.exists({ organization: ctx.orgId, slug });
    i += 1
  ) {
    slug = `${base}-${i}`;
  }

  const brand = await Brand.create({
    ...body,
    organization: ctx.orgId,
    slug,
    createdBy: ctx.session.sub,
  });

  await logActivity({
    level: "success",
    action: "brand.created",
    message: `Navu brand banyu: ${brand.name}`,
    actor: ctx.session.email,
  });

  return ok({ id: String(brand._id), slug: brand.slug }, 201);
});
