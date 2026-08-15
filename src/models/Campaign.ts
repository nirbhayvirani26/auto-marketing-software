import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/** A campaign groups brand voice, keywords and target accounts. */
export type CampaignDoc = BaseFields & {
  brand: ObjectId;
  name: string;
  description?: string;
  brandVoice: string;
  targetAudience?: string;
  keywords: string[];
  hashtags: string[];
  callToAction?: string;
  accounts: ObjectId[];
  status: "draft" | "active" | "paused" | "completed";
  startDate?: Date;
  endDate?: Date;
  createdBy?: ObjectId;
};

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
    // Brand context handed to the AI on every generation.
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

export const Campaign = model<CampaignDoc>("Campaign", CampaignSchema);
