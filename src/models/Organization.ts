import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";
import type { LimitKey, ModuleKey } from "./Plan";

/**
 * An organization is one customer (a tenant). Brands live inside it, and
 * accounts, posts and automations live inside brands:
 *
 *   Organization -> Brand -> SocialAccount / Post / Campaign / Automation
 *
 * The super admin can see and manage every organization.
 */
export type OrganizationDoc = BaseFields & {
  name: string;
  slug: string;
  owner: ObjectId;
  plan: ObjectId;
  status: "trial" | "active" | "past_due" | "suspended" | "cancelled";
  trialEndsAt?: Date;
  subscriptionEndsAt?: Date;

  /**
   * Per-organization module override. A missing key means "use whatever the
   * plan says". The super admin can switch one module on or off for a single
   * organization from here.
   */
  moduleOverrides?: Partial<Record<ModuleKey, boolean>>;
  /** Per-organization limit override, same rules as above. */
  limitOverrides?: Partial<Record<LimitKey, number>>;

  /**
   * An organization may supply its own API keys. When it does not, the
   * platform's keys are used instead.
   */
  useOwnKeys: boolean;
  credentials?: {
    anthropicApiKey?: string;
    anthropicModel?: string;
    metaAppId?: string;
    metaAppSecret?: string;
    n8nWebhookUrl?: string;
    n8nWebhookSecret?: string;
  };

  /** Usage counters, checked against the plan's monthly limits. */
  usage: {
    postsThisMonth: number;
    periodStart: Date;
  };

  // White-label
  logoUrl?: string;
  primaryColor: string;

  notes?: string;
};

const OrganizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    plan: { type: Schema.Types.ObjectId, ref: "Plan", required: true, index: true },

    status: {
      type: String,
      enum: ["trial", "active", "past_due", "suspended", "cancelled"],
      default: "trial",
      index: true,
    },
    trialEndsAt: { type: Date },
    subscriptionEndsAt: { type: Date },

    moduleOverrides: { type: Schema.Types.Mixed },
    limitOverrides: { type: Schema.Types.Mixed },

    useOwnKeys: { type: Boolean, default: false },
    credentials: {
      anthropicApiKey: { type: String, select: false },
      anthropicModel: { type: String },
      metaAppId: { type: String },
      metaAppSecret: { type: String, select: false },
      n8nWebhookUrl: { type: String },
      n8nWebhookSecret: { type: String, select: false },
    },

    usage: {
      postsThisMonth: { type: Number, default: 0 },
      periodStart: { type: Date, default: () => new Date() },
    },

    logoUrl: { type: String, trim: true },
    primaryColor: { type: String, default: "#5B5BD6" },

    notes: { type: String },
  },
  { timestamps: true },
);

export const Organization = model<OrganizationDoc>("Organization", OrganizationSchema);
