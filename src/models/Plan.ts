import { model, Schema, type BaseFields } from "@/lib/localdb";

export type ModuleKey =
  | "posts"
  | "campaigns"
  | "automations"
  | "autoDm"
  | "aiGeneration"
  | "reels"
  | "n8n"
  | "apiTokens"
  | "whiteLabel"
  | "analytics";

export type LimitKey =
  | "organizations"
  | "brands"
  | "socialAccounts"
  | "postsPerMonth"
  | "reelsPerMonth"
  | "users"
  | "automations"
  | "commentRules";

/**
 * A sellable plan. The super admin creates and edits these; every organization
 * sits on exactly one and works within its limits.
 *
 * A limit of `-1` means unlimited.
 */
export type PlanDoc = BaseFields & {
  key: string;
  name: string;
  description?: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  limits: Record<LimitKey, number>;
  modules: Record<ModuleKey, boolean>;
  /** Shown on the public pricing page. */
  highlights: string[];
  popular: boolean;
  sortOrder: number;
  visible: boolean;
  active: boolean;
};

const PlanSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    priceMonthly: { type: Number, default: 0 },
    priceYearly: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },

    limits: {
      // On the agency plan one account can run many organizations.
      organizations: { type: Number, default: 1 },
      brands: { type: Number, default: 1 },
      socialAccounts: { type: Number, default: 3 },
      postsPerMonth: { type: Number, default: 100 },
      reelsPerMonth: { type: Number, default: 30 },
      users: { type: Number, default: 1 },
      automations: { type: Number, default: 2 },
      commentRules: { type: Number, default: 0 },
    },

    /**
     * Which modules this plan unlocks. The super admin can override any of
     * them for a single organization.
     */
    modules: {
      posts: { type: Boolean, default: true },
      campaigns: { type: Boolean, default: true },
      automations: { type: Boolean, default: true },
      autoDm: { type: Boolean, default: false },
      aiGeneration: { type: Boolean, default: true },
      // Reel Studio — turns an image into a reel and publishes it.
      reels: { type: Boolean, default: true },
      n8n: { type: Boolean, default: false },
      apiTokens: { type: Boolean, default: false },
      whiteLabel: { type: Boolean, default: false },
      analytics: { type: Boolean, default: false },
    },

    highlights: { type: [String], default: [] },
    popular: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    visible: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Plan = model<PlanDoc>("Plan", PlanSchema);

/** Plans created on a fresh install. The super admin can change them later. */
export const DEFAULT_PLANS = [
  {
    key: "starter",
    name: "Starter",
    description: "Start with a single brand",
    priceMonthly: 999,
    priceYearly: 9990,
    sortOrder: 1,
    limits: {
      organizations: 1,
      brands: 1,
      socialAccounts: 3,
      postsPerMonth: 100,
      reelsPerMonth: 30,
      users: 1,
      automations: 2,
      commentRules: 0,
    },
    modules: {
      posts: true,
      campaigns: true,
      automations: true,
      autoDm: false,
      aiGeneration: true,
      reels: true,
      n8n: false,
      apiTokens: false,
      whiteLabel: false,
      analytics: false,
    },
    highlights: [
      "1 brand",
      "3 social accounts",
      "100 AI posts / month",
      "Scheduling + auto publish",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    description: "For a growing business",
    priceMonthly: 2999,
    priceYearly: 29990,
    popular: true,
    sortOrder: 2,
    limits: {
      organizations: 1,
      brands: 5,
      socialAccounts: 20,
      postsPerMonth: 1000,
      reelsPerMonth: 300,
      users: 5,
      automations: 20,
      commentRules: 20,
    },
    modules: {
      posts: true,
      campaigns: true,
      automations: true,
      autoDm: true,
      aiGeneration: true,
      reels: true,
      n8n: true,
      apiTokens: false,
      whiteLabel: false,
      analytics: true,
    },
    highlights: [
      "5 brands",
      "20 social accounts",
      "1000 AI posts / month",
      "Auto DM & comment replies",
      "n8n automation",
      "5 team members",
    ],
  },
  {
    key: "agency",
    name: "Agency",
    description: "Run many organizations, one per client",
    priceMonthly: 9999,
    priceYearly: 99990,
    sortOrder: 3,
    limits: {
      organizations: -1,
      brands: -1,
      socialAccounts: -1,
      postsPerMonth: -1,
      reelsPerMonth: -1,
      users: -1,
      automations: -1,
      commentRules: -1,
    },
    modules: {
      posts: true,
      campaigns: true,
      automations: true,
      autoDm: true,
      aiGeneration: true,
      reels: true,
      n8n: true,
      apiTokens: true,
      whiteLabel: true,
      analytics: true,
    },
    highlights: [
      "Unlimited organizations",
      "Unlimited brands & accounts",
      "Unlimited AI posts",
      "API tokens + n8n",
      "White-label",
      "Unlimited team members",
    ],
  },
] as const;
