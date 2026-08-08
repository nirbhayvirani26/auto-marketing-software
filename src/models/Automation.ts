import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Automation = "aa campaign mate, aa frequency e, AI thi post banavo ane publish karo".
 * Trigger banne rite chalse:
 *  - internal cron  -> /api/cron/dispatch
 *  - n8n schedule   -> /api/webhooks/n8n (event: "automation.run")
 */
const AutomationSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    campaign: { type: Schema.Types.ObjectId, ref: "Campaign", index: true },
    accounts: [{ type: Schema.Types.ObjectId, ref: "SocialAccount" }],
    // AI ne aapva mate topic / theme
    topic: { type: String, trim: true, required: true },
    tone: { type: String, trim: true, default: "friendly" },

    /**
     * post — sadho text/image post (juno vartav)
     * reel — dar vakhate ek product ni image lai ne AKHI reel banave ane
     *        Instagram + Facebook banne par muki de. "Set karo ane bhuli jao."
     */
    mode: {
      type: String,
      enum: ["post", "reel"],
      default: "post",
      index: true,
    },

    /**
     * Reel mode mate — kai image vaparvi:
     *   library — brand ni upload kareli product images ma thi vaari fari
     *             (jе sauthi juni vaparai hoy e pehla — badha product ne
     *             vaaro male che)
     *   fixed   — niche aapeli j images
     */
    reelSource: {
      type: String,
      enum: ["library", "fixed"],
      default: "library",
    },
    reelImages: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],
    /** Ek reel ma ketla product (library mode ma). */
    reelProductCount: { type: Number, default: 1, min: 1, max: 10 },
    reelDuration: { type: Number, default: 40, min: 15, max: 90 },
    reelLanguage: { type: String, default: "en" },
    reelAvatar: { type: Schema.Types.ObjectId, ref: "Avatar" },
    reelVoiceover: { type: Boolean, default: false },
    /** Chhelli var kai image sudhi pahonchya — library ma vaaro rakhva mate. */
    reelCursor: { type: Number, default: 0 },

    frequency: {
      type: String,
      enum: ["hourly", "daily", "weekly"],
      default: "daily",
    },
    // 24h clock, e.g. "09:30" (server local time)
    timeOfDay: { type: String, default: "09:30" },
    // 0 = Sunday ... 6 = Saturday (weekly mate)
    dayOfWeek: { type: Number, min: 0, max: 6, default: 1 },
    // true -> generate karine sidhu publish; false -> draft ma raheshe
    autoPublish: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true, index: true },
    lastRunAt: { type: Date },
    nextRunAt: { type: Date, index: true },
    runCount: { type: Number, default: 0 },
    lastError: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type AutomationDoc = InferSchemaType<typeof AutomationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Automation: Model<AutomationDoc> =
  (mongoose.models.Automation as Model<AutomationDoc>) ||
  mongoose.model<AutomationDoc>("Automation", AutomationSchema);
