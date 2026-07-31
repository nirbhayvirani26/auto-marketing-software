import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Ek post = ek account mate ek publishable unit.
 * Lifecycle: draft -> scheduled -> publishing -> published | failed
 */
const PostSchema = new Schema(
  {
    campaign: { type: Schema.Types.ObjectId, ref: "Campaign", index: true },
    account: {
      type: Schema.Types.ObjectId,
      ref: "SocialAccount",
      required: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ["facebook", "instagram"],
      required: true,
      index: true,
    },
    prompt: { type: String, trim: true },
    caption: { type: String, required: true },
    hashtags: { type: [String], default: [] },
    // Instagram ne public image URL joiye j che
    mediaUrl: { type: String, trim: true },
    mediaType: {
      type: String,
      enum: ["none", "image", "video"],
      default: "none",
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "publishing", "published", "failed"],
      default: "draft",
      index: true,
    },
    scheduledAt: { type: Date, index: true },
    publishedAt: { type: Date },
    // Graph API e aapel post/media id
    externalPostId: { type: String, trim: true },
    permalink: { type: String, trim: true },
    error: { type: String },
    attempts: { type: Number, default: 0 },
    generatedByAI: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ["manual", "ai", "automation", "n8n"],
      default: "manual",
    },
    /**
     * Ek j vaar ma ghana account par post karo tyare badha posts ne aa id thi
     * group karay che. Dareak post no potano status/permalink rahe che, etle
     * ek account fail thay to biju atkatu nathi.
     */
    batchId: { type: String, trim: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

PostSchema.index({ status: 1, scheduledAt: 1 });

export type PostDoc = InferSchemaType<typeof PostSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Post: Model<PostDoc> =
  (mongoose.models.Post as Model<PostDoc>) ||
  mongoose.model<PostDoc>("Post", PostSchema);
