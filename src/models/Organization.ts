import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Organization = ek customer (tenant). Ena andar brands, ane brands andar
 * accounts/posts/automations aave che.
 *
 *   Organization → Brand → SocialAccount / Post / Campaign / Automation
 *
 * Super admin badhi organizations joi ane manage kari shake che.
 */
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

    /**
     * Per-organization module override. `null` = plan nu j value vaparo.
     * Super admin ahiya thi ek j organization mate module on/off kari shake.
     */
    moduleOverrides: {
      type: Map,
      of: Boolean,
      default: undefined,
    },
    /** Per-organization limit override. `null` = plan nu value. */
    limitOverrides: {
      type: Map,
      of: Number,
      default: undefined,
    },

    /**
     * Organization potani API keys aapi shake. Na aape to platform (super
     * admin) ni keys vaparay che — `useOwnKeys` false hoy tyare.
     */
    useOwnKeys: { type: Boolean, default: false },
    credentials: {
      anthropicApiKey: { type: String, select: false },
      anthropicModel: { type: String },
      metaAppId: { type: String },
      metaAppSecret: { type: String, select: false },
      n8nWebhookUrl: { type: String },
      n8nWebhookSecret: { type: String, select: false },
    },

    // Usage counters — postsPerMonth limit check karva mate
    usage: {
      postsThisMonth: { type: Number, default: 0 },
      periodStart: { type: Date, default: () => new Date() },
    },

    // White-label
    logoUrl: { type: String, trim: true },
    primaryColor: { type: String, default: "#5B5BD6" },

    notes: { type: String },
  },
  { timestamps: true },
);

export type OrganizationDoc = InferSchemaType<typeof OrganizationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Organization: Model<OrganizationDoc> =
  (mongoose.models.Organization as Model<OrganizationDoc>) ||
  mongoose.model<OrganizationDoc>("Organization", OrganizationSchema);
