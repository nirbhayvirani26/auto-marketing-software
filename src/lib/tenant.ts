import { Organization, type OrganizationDoc } from "@/models/Organization";
import { Plan, type LimitKey, type ModuleKey, type PlanDoc } from "@/models/Plan";
import { Brand } from "@/models/Brand";
import { SocialAccount } from "@/models/SocialAccount";
import { Automation } from "@/models/Automation";
import { CommentRule } from "@/models/CommentRule";
import { ReelJob } from "@/models/ReelJob";
import type { ObjectId } from "@/lib/localdb";
import { env } from "./env";

export type TenantContext = {
  organization: OrganizationDoc;
  plan: PlanDoc;
};

/** An id as it arrives from a session, a request body or another document. */
export type IdInput = ObjectId | string | null | undefined;

/**
 * Is a module switched on? The organization's own override wins; otherwise the
 * plan decides.
 */
export function moduleEnabled(ctx: TenantContext, key: ModuleKey): boolean {
  const override = ctx.organization.moduleOverrides?.[key];
  if (typeof override === "boolean") return override;
  return Boolean(ctx.plan.modules?.[key]);
}

/** The effective limit: organization override, else plan. `-1` is unlimited. */
export function limitFor(ctx: TenantContext, key: LimitKey): number {
  const override = ctx.organization.limitOverrides?.[key];
  if (typeof override === "number") return override;
  return ctx.plan.limits?.[key] ?? 0;
}

export type LimitCheck = { allowed: boolean; used: number; limit: number };

/**
 * How much has been used so far, and whether that is still within the limit.
 * `postsPerMonth` resets at the start of every calendar month.
 */
export async function checkLimit(
  ctx: TenantContext,
  key: LimitKey,
): Promise<LimitCheck> {
  const limit = limitFor(ctx, key);
  if (limit === -1) return { allowed: true, used: 0, limit: -1 };

  const orgId = ctx.organization._id;
  const brandIds = await Brand.distinct("_id", { organization: orgId });

  let used = 0;
  switch (key) {
    case "brands":
      used = brandIds.length;
      break;
    case "socialAccounts":
      used = await SocialAccount.countDocuments({ brand: { $in: brandIds } });
      break;
    case "automations":
      used = await Automation.countDocuments({ brand: { $in: brandIds } });
      break;
    case "commentRules":
      used = await CommentRule.countDocuments({ brand: { $in: brandIds } });
      break;
    case "postsPerMonth":
      used = ctx.organization.usage?.postsThisMonth ?? 0;
      break;
    case "reelsPerMonth": {
      // Reels are counted separately from posts: one reel produces several
      // posts (Instagram, Facebook, other accounts) but costs one render.
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      used = await ReelJob.countDocuments({
        brand: { $in: brandIds },
        createdAt: { $gte: monthStart },
        status: { $ne: "failed" },
      });
      break;
    }
    default:
      used = 0;
  }

  return { allowed: used < limit, used, limit };
}

/** Bumps the monthly post counter, resetting it when the month rolls over. */
export async function incrementPostUsage(
  organizationId: IdInput,
  count = 1,
): Promise<void> {
  const org = await Organization.findById(organizationId);
  if (!org) return;

  const now = new Date();
  const start = org.usage?.periodStart ?? now;
  const newMonth =
    start.getMonth() !== now.getMonth() ||
    start.getFullYear() !== now.getFullYear();

  org.usage = {
    postsThisMonth: (newMonth ? 0 : (org.usage?.postsThisMonth ?? 0)) + count,
    periodStart: newMonth ? now : start,
  };
  await org.save();
}

/**
 * The organization's own API keys when it has them, the platform's otherwise.
 * This is what lets one organization bring its own Anthropic key while the
 * rest run on the shared one.
 */
export async function resolveCredentials(organizationId: IdInput): Promise<{
  anthropicApiKey: string;
  anthropicModel: string;
  metaAppId: string;
  metaAppSecret: string;
  n8nWebhookUrl: string;
  n8nWebhookSecret: string;
  usingOwnKeys: boolean;
}> {
  const org = await Organization.findById(organizationId).select(
    "+credentials.anthropicApiKey +credentials.metaAppSecret +credentials.n8nWebhookSecret",
  );

  const own = org?.useOwnKeys ? (org.credentials ?? {}) : {};

  return {
    anthropicApiKey: own.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
    anthropicModel:
      own.anthropicModel || process.env.ANTHROPIC_MODEL || "claude-opus-5",
    metaAppId: own.metaAppId || process.env.META_APP_ID || "",
    metaAppSecret: own.metaAppSecret || process.env.META_APP_SECRET || "",
    n8nWebhookUrl: own.n8nWebhookUrl || env.n8nWebhookUrl || "",
    n8nWebhookSecret: own.n8nWebhookSecret || env.n8nWebhookSecret || "",
    usingOwnKeys: Boolean(org?.useOwnKeys),
  };
}

/** Loads an organization together with its plan. */
export async function loadTenant(
  organizationId: IdInput,
): Promise<TenantContext | null> {
  const organization = await Organization.findById(organizationId);
  if (!organization) return null;

  const plan = await Plan.findById(organization.plan);
  if (!plan) return null;

  return { organization, plan };
}
