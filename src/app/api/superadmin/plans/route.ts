import { z } from "zod";
import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { Plan } from "@/models/Plan";
import { Organization } from "@/models/Organization";

export const dynamic = "force-dynamic";

const limitsSchema = z
  .object({
    organizations: z.number().optional(),
    brands: z.number().optional(),
    socialAccounts: z.number().optional(),
    postsPerMonth: z.number().optional(),
    users: z.number().optional(),
    automations: z.number().optional(),
    commentRules: z.number().optional(),
  })
  .optional();

const modulesSchema = z
  .object({
    posts: z.boolean().optional(),
    campaigns: z.boolean().optional(),
    automations: z.boolean().optional(),
    autoDm: z.boolean().optional(),
    aiGeneration: z.boolean().optional(),
    n8n: z.boolean().optional(),
    apiTokens: z.boolean().optional(),
    whiteLabel: z.boolean().optional(),
    analytics: z.boolean().optional(),
  })
  .optional();

const upsertSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9_-]+$/, "fakt a-z, 0-9, - ane _"),
  name: z.string().min(1),
  description: z.string().optional(),
  priceMonthly: z.number().min(0).optional(),
  priceYearly: z.number().min(0).optional(),
  currency: z.string().optional(),
  limits: limitsSchema,
  modules: modulesSchema,
  highlights: z.array(z.string()).optional(),
  popular: z.boolean().optional(),
  sortOrder: z.number().optional(),
  visible: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const GET = handle(async () => {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const plans = await Plan.find().sort({ sortOrder: 1 }).lean();

  // Dareak plan par ketli organizations che.
  const counts = await Organization.aggregate<{ _id: unknown; count: number }>([
    { $group: { _id: "$plan", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((row) => [String(row._id), row.count]));

  return ok(
    plans.map((plan) => ({
      ...plan,
      organizationCount: countMap.get(String(plan._id)) ?? 0,
    })),
  );
});

/** Plan banave ke update kare (key par upsert). */
export const POST = handle(async (request) => {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const body = upsertSchema.parse(await request.json());

  const plan = await Plan.findOneAndUpdate(
    { key: body.key.toLowerCase() },
    { ...body, key: body.key.toLowerCase() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return ok({ id: String(plan._id), key: plan.key });
});
