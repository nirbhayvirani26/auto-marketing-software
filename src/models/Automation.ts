import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Automation = "aa campaign mate, aa frequency e, AI thi post banavo ane publish karo".
 * Trigger banne rite chalse:
 *  - internal cron  -> /api/cron/dispatch
 *  - n8n schedule   -> /api/webhooks/n8n (event: "automation.run")
 */
const AutomationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    campaign: { type: Schema.Types.ObjectId, ref: "Campaign", index: true },
    accounts: [{ type: Schema.Types.ObjectId, ref: "SocialAccount" }],
    // AI ne aapva mate topic / theme
    topic: { type: String, trim: true, required: true },
    tone: { type: String, trim: true, default: "friendly" },
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
