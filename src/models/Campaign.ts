import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const CampaignSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    // AI ne aapva mate brand context
    brandVoice: { type: String, trim: true, default: "friendly, professional" },
    targetAudience: { type: String, trim: true },
    keywords: { type: [String], default: [] },
    hashtags: { type: [String], default: [] },
    callToAction: { type: String, trim: true },
    accounts: [{ type: Schema.Types.ObjectId, ref: "SocialAccount" }],
    status: {
      type: String,
      enum: ["draft", "active", "paused", "completed"],
      default: "draft",
      index: true,
    },
    startDate: { type: Date },
    endDate: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type CampaignDoc = InferSchemaType<typeof CampaignSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Campaign: Model<CampaignDoc> =
  (mongoose.models.Campaign as Model<CampaignDoc>) ||
  mongoose.model<CampaignDoc>("Campaign", CampaignSchema);
