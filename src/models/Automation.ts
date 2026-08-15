import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * An automation says: "for this campaign, at this frequency, generate content
 * with AI and publish it."
 *
 * It can be triggered two ways:
 *   - the built-in scheduler -> /api/cron/dispatch
 *   - an n8n schedule        -> /api/webhooks/n8n (event: "automation.run")
 */
export type AutomationDoc = BaseFields & {
  brand: ObjectId;
  name: string;
  campaign?: ObjectId;
  accounts: ObjectId[];
  /** The topic or theme handed to the AI. */
  topic: string;
  tone: string;

  /**
   * post — a plain text or image post
   * reel — takes one product image and builds a whole reel, then publishes it
   *        to Instagram and Facebook. Set it once and forget about it.
   */
  mode: "post" | "reel";

  /**
   * Reel mode, image source:
   *   library — cycles through the brand's uploaded product images, least
   *             recently used first, so every product gets its turn
   *   fixed   — always the images listed below
   */
  reelSource: "library" | "fixed";
  reelImages: ObjectId[];
  /** How many products go into one reel (library mode). */
  reelProductCount: number;
  reelDuration: number;
  reelLanguage: string;
  reelAvatar?: ObjectId;
  reelVoiceover: boolean;
  /** How far through the library the last run got. */
  reelCursor: number;

  frequency: "hourly" | "daily" | "weekly";
  /** 24-hour clock in server local time, e.g. "09:30". */
  timeOfDay: string;
  /** 0 = Sunday … 6 = Saturday, for weekly runs. */
  dayOfWeek: number;
  /** true -> generate and publish straight away; false -> leave as a draft. */
  autoPublish: boolean;
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
  runCount: number;
  lastError?: string;
  createdBy?: ObjectId;
};

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
    topic: { type: String, trim: true, required: true },
    tone: { type: String, trim: true, default: "friendly" },

    mode: {
      type: String,
      enum: ["post", "reel"],
      default: "post",
      index: true,
    },

    reelSource: {
      type: String,
      enum: ["library", "fixed"],
      default: "library",
    },
    reelImages: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],
    reelProductCount: { type: Number, default: 1, min: 1, max: 10 },
    reelDuration: { type: Number, default: 40, min: 15, max: 90 },
    reelLanguage: { type: String, default: "en" },
    reelAvatar: { type: Schema.Types.ObjectId, ref: "Avatar" },
    reelVoiceover: { type: Boolean, default: false },
    reelCursor: { type: Number, default: 0 },

    frequency: {
      type: String,
      enum: ["hourly", "daily", "weekly"],
      default: "daily",
    },
    timeOfDay: { type: String, default: "09:30" },
    dayOfWeek: { type: Number, min: 0, max: 6, default: 1 },
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

export const Automation = model<AutomationDoc>("Automation", AutomationSchema);
