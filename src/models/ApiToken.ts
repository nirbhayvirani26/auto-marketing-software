import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { createHash, randomBytes } from "node:crypto";

/**
 * Organization no API token — n8n ke biji koi service aa app ne call kari
 * shake e mate.
 *
 * Token plain-text kadi store nathi thato; fakt SHA-256 hash rahe che ane
 * olakhva mate chhella 4 characters.
 */
const ApiTokenSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    tokenSuffix: { type: String, required: true },

    scopes: {
      type: [String],
      default: ["posts:write", "posts:read", "automations:run"],
    },
    lastUsedAt: { type: Date },
    useCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type ApiTokenDoc = InferSchemaType<typeof ApiTokenSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ApiToken: Model<ApiTokenDoc> =
  (mongoose.models.ApiToken as Model<ApiTokenDoc>) ||
  mongoose.model<ApiTokenDoc>("ApiToken", ApiTokenSchema);

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Navo token banave — plain value fakt ek j vaar pacho aape che. */
export function generateToken(): { token: string; hash: string; suffix: string } {
  const token = `amk_${randomBytes(24).toString("base64url")}`;
  return {
    token,
    hash: hashToken(token),
    suffix: token.slice(-4),
  };
}
