import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Ek connected social profile.
 * - facebook  -> pageId + pageAccessToken
 * - instagram -> igUserId (IG Business account) + pageAccessToken
 */
const SocialAccountSchema = new Schema(
  {
    platform: {
      type: String,
      enum: ["facebook", "instagram"],
      required: true,
      index: true,
    },
    displayName: { type: String, required: true, trim: true },
    // Facebook Page ID
    pageId: { type: String, trim: true },
    // Instagram Business Account ID (IG User ID)
    igUserId: { type: String, trim: true },
    // Long-lived Page access token (Graph API)
    accessToken: { type: String, select: false },
    tokenExpiresAt: { type: Date },
    avatarUrl: { type: String, trim: true },
    status: {
      type: String,
      enum: ["connected", "disconnected", "error"],
      default: "connected",
      index: true,
    },
    lastError: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

SocialAccountSchema.index({ platform: 1, pageId: 1, igUserId: 1 });

export type SocialAccountDoc = InferSchemaType<typeof SocialAccountSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SocialAccount: Model<SocialAccountDoc> =
  (mongoose.models.SocialAccount as Model<SocialAccountDoc>) ||
  mongoose.model<SocialAccountDoc>("SocialAccount", SocialAccountSchema);
