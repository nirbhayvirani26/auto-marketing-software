import { Organization, type OrganizationDoc } from "@/models/Organization";
import { Plan, type LimitKey, type ModuleKey, type PlanDoc } from "@/models/Plan";
import { Brand } from "@/models/Brand";
import { SocialAccount } from "@/models/SocialAccount";
import { Automation } from "@/models/Automation";
import { CommentRule } from "@/models/CommentRule";
import { env } from "./env";

export type TenantContext = {
  organization: OrganizationDoc;
  plan: PlanDoc;
};

/**
 * Module chalu che ke nahi — pehla organization no override jovo, pachi plan.
 */
export function moduleEnabled(ctx: TenantContext, key: ModuleKey): boolean {
  const override = ctx.organization.moduleOverrides?.get(key);
  if (typeof override === "boolean") return override;
  return Boolean(ctx.plan.modules?.[key]);
}

/** Limit value — organization override, nahi to plan. `-1` = unlimited. */
export function limitFor(ctx: TenantContext, key: LimitKey): number {
  const override = ctx.organization.limitOverrides?.get(key);
  if (typeof override === "number") return override;
  return ctx.plan.limits?.[key] ?? 0;
}

export type LimitCheck = { allowed: boolean; used: number; limit: number };

/**
 * Atyar sudhi ketlu vaparyu ane limit ma che ke nahi.
 * `postsPerMonth` mahina pramane reset thay che.
 */
export async function checkLimit(
  ctx: TenantContext,
  key: LimitKey,
): Promise<LimitCheck> {
  const limit = limitFor(ctx, key);
  if (limit === -1) return { allowed: true, used: 0, limit: -1 };

  const orgId = ctx.organization._id;
  const brandIds = await Brand.find({ organization: orgId }).distinct("_id");

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
    default:
      used = 0;
  }

  return { allowed: used < limit, used, limit };
}

/** Post banya pachi monthly counter vadharo (mahino badlay to reset). */
export async function incrementPostUsage(
  organizationId: unknown,
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
 * Organization ni potani API keys, nahi to platform (super admin) ni.
 * Aa thi ek organization potano Anthropic key vapri shake ane baki na
 * platform no key vaapre.
 */
export async function resolveCredentials(organizationId: unknown): Promise<{
  anthropicApiKey: string;
  anthropicModel: string;
  metaAppId: string;
  metaAppSecret: string;
  n8nWebhookUrl: string;
  n8nWebhookSecret: string;
  usingOwnKeys: boolean;
}> {
  const org = await Organization.findById(organizationId).select(
    "+credentials.anthropicApiKey +credentials.metaAppSecret +credentials.n8nWebhookSecret useOwnKeys credentials",
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

/** Organization + eno plan ek saathe lai aave. */
export async function loadTenant(
  organizationId: unknown,
): Promise<TenantContext | null> {
  const organization = await Organization.findById(organizationId);
  if (!organization) return null;

  const plan = await Plan.findById(organization.plan);
  if (!plan) return null;

  return { organization, plan };
}
