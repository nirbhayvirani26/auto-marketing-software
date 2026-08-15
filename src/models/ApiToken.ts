import { createHash, randomBytes } from "node:crypto";

import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * An API token for an organization, so n8n or any other service can call this
 * app.
 *
 * The plain token is never stored — only its SHA-256 hash, plus the last four
 * characters so a person can recognise which token is which.
 */
export type ApiTokenDoc = BaseFields & {
  organization: ObjectId;
  name: string;
  tokenHash: string;
  tokenSuffix: string;
  scopes: string[];
  lastUsedAt?: Date;
  useCount: number;
  expiresAt?: Date;
  revokedAt?: Date;
  createdBy?: ObjectId;
};

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

export const ApiToken = model<ApiTokenDoc>("ApiToken", ApiTokenSchema);

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mints a new token. The plain value is returned exactly once. */
export function generateToken(): { token: string; hash: string; suffix: string } {
  const token = `amk_${randomBytes(24).toString("base64url")}`;
  return {
    token,
    hash: hashToken(token),
    suffix: token.slice(-4),
  };
}
