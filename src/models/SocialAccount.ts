import {
  model,
  ObjectId,
  Schema,
  type BaseFields,
  type HydratedDocument,
} from "@/lib/localdb";

/**
 * One connected social profile.
 *   facebook  -> pageId  + accessToken
 *   instagram -> igUserId (Instagram Business account) + accessToken
 */
export type SocialAccountDoc = BaseFields & {
  brand: ObjectId;
  platform: "facebook" | "instagram";
  displayName: string;
  /** Facebook Page ID. */
  pageId?: string;
  /** Instagram Business Account ID. */
  igUserId?: string;
  /** Long-lived Page access token. Hidden from API responses. */
  accessToken?: string;
  tokenExpiresAt?: Date;
  avatarUrl?: string;
  status: "connected" | "disconnected" | "error";
  lastError?: string;
  createdBy?: ObjectId;
};

/** A live document, with `save()` attached. */
export type SocialAccountDocument = HydratedDocument<SocialAccountDoc>;

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
    pageId: { type: String, trim: true },
    igUserId: { type: String, trim: true },
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
// The same Page or Instagram account must not be connected twice to one brand.
SocialAccountSchema.index(
  { brand: 1, pageId: 1 },
  { unique: true, partialFilterExpression: { pageId: { $type: "string" } } },
);
SocialAccountSchema.index(
  { brand: 1, igUserId: 1 },
  { unique: true, partialFilterExpression: { igUserId: { $type: "string" } } },
);

export const SocialAccount = model<SocialAccountDoc>(
  "SocialAccount",
  SocialAccountSchema,
);
