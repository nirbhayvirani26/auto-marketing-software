import { z } from "zod";
import { Brand } from "@/models/Brand";
import { SocialAccount } from "@/models/SocialAccount";
import { Post } from "@/models/Post";
import { Campaign } from "@/models/Campaign";
import { Automation } from "@/models/Automation";
import { CommentRule } from "@/models/CommentRule";
import { fail, handle, ok, requireOrg } from "@/lib/api";
import { setActiveBrandCookie } from "@/lib/brand";
import { logActivity } from "@/models/ActivityLog";

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().optional(),
  brandVoice: z.string().optional(),
  targetAudience: z.string().optional(),
  website: z.string().optional(),
  logoUrl: z.string().optional(),
  color: z.string().optional(),
  defaultHashtags: z.array(z.string()).optional(),
  /** true mokalo to aa brand active thai jashe (cookie set thashe). */
  makeActive: z.boolean().optional(),
});

export const PATCH = handle(async (request, { params }) => {
  const ctx = await requireOrg();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const { makeActive, ...body } = updateSchema.parse(await request.json());

  const brand = await Brand.findOne({ _id: id, organization: ctx.orgId });
  if (!brand) return fail("Brand madyu nahi", 404);

  if (Object.keys(body).length > 0) {
    Object.assign(brand, body);
    await brand.save();
  }

  if (makeActive) await setActiveBrandCookie(String(brand._id));

  return ok({ id: String(brand._id), active: Boolean(makeActive) });
});

/**
 * Brand delete = ena badha accounts, posts, campaigns, automations ane DM
 * rules pan jashe. Etle `?confirm=<brand name>` farjiyat che.
 */
export const DELETE = handle(async (request, { params }) => {
  const ctx = await requireOrg();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const brand = await Brand.findOne({ _id: id, organization: ctx.orgId });
  if (!brand) return fail("Brand madyu nahi", 404);

  const confirm = new URL(request.url).searchParams.get("confirm");
  if (confirm !== brand.name) {
    return fail(
      `Confirm karva mate brand nu naam mokalo: ?confirm=${brand.name}`,
      428,
    );
  }

  const remaining = await Brand.countDocuments({
    organization: ctx.orgId,
    active: true,
  });
  if (remaining <= 1) {
    return fail("Chhello brand delete na thay — ochha ma ochhu ek joiye", 409);
  }

  const filter = { brand: brand._id };
  const [posts, accounts, campaigns, automations, rules] = await Promise.all([
    Post.deleteMany(filter),
    SocialAccount.deleteMany(filter),
    Campaign.deleteMany(filter),
    Automation.deleteMany(filter),
    CommentRule.deleteMany(filter),
  ]);
  await brand.deleteOne();

  await logActivity({
    level: "warning",
    action: "brand.deleted",
    message: `Brand delete thayu: ${brand.name}`,
    actor: ctx.session.email,
    meta: {
      posts: posts.deletedCount,
      accounts: accounts.deletedCount,
      campaigns: campaigns.deletedCount,
      automations: automations.deletedCount,
      rules: rules.deletedCount,
    },
  });

  return ok({ deleted: true });
});
