import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * Roles:
 *   superadmin — platform owner. Belongs to no organization, sees everything.
 *   owner      — owns an organization (the account that registered).
 *   admin      — full access inside an organization, except billing.
 *   member     — can work on posts and campaigns, not on settings.
 */
export type UserDoc = BaseFields & {
  name: string;
  email: string;
  passwordHash: string;
  role: "superadmin" | "owner" | "admin" | "member";
  /** Null for a superadmin; everyone else belongs to one organization. */
  organization?: ObjectId;
  /** Agency accounts may run several organizations and switch between them. */
  organizations: ObjectId[];
  emailVerified: boolean;
  active: boolean;
  lastLoginAt?: Date;
  avatarUrl?: string;
};

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["superadmin", "owner", "admin", "member"],
      default: "owner",
      index: true,
    },

    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
    organizations: [{ type: Schema.Types.ObjectId, ref: "Organization" }],

    emailVerified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    avatarUrl: { type: String, trim: true },
  },
  { timestamps: true },
);

export const User = model<UserDoc>("User", UserSchema);

/* ------------------------------------------------------------------ */

/**
 * Email one-time codes, used for registration and password reset.
 * Records expire fifteen minutes after they are created.
 */
export type OtpDoc = BaseFields & {
  email: string;
  codeHash: string;
  purpose: "verify_email" | "login" | "reset_password";
  attempts: number;
  consumedAt?: Date;
};

const OtpSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    codeHash: { type: String, required: true },
    purpose: {
      type: String,
      enum: ["verify_email", "login", "reset_password"],
      default: "verify_email",
    },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date },
  },
  { timestamps: true },
);

OtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 900 });

export const Otp = model<OtpDoc>("Otp", OtpSchema);
