import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";

/**
 * Ek connected social profile.
 * - facebook  -> pageId + pageAccessToken
 * - instagram -> igUserId (IG Business account) + pageAccessToken
 */
const SocialAccountSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
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

SocialAccountSchema.index({ brand: 1, platform: 1 });
// Ek j Page/IG account ek brand ma be vaar na aavvu joiye.
SocialAccountSchema.index(
  { brand: 1, pageId: 1 },
  { unique: true, partialFilterExpression: { pageId: { $type: "string" } } },
);
SocialAccountSchema.index(
  { brand: 1, igUserId: 1 },
  { unique: true, partialFilterExpression: { igUserId: { $type: "string" } } },
);

export type SocialAccountDoc = InferSchemaType<typeof SocialAccountSchema> & {
  _id: mongoose.Types.ObjectId;
};

/** DB mathi aavelu jivant document. */
export type SocialAccountDocument = HydratedDocument<SocialAccountDoc>;

export const SocialAccount: Model<SocialAccountDoc> =
  (mongoose.models.SocialAccount as Model<SocialAccountDoc>) ||
  mongoose.model<SocialAccountDoc>("SocialAccount", SocialAccountSchema);
