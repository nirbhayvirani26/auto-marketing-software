import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Roles:
 *   superadmin — platform malik. Koi organization ma nathi; badhu joi/kari shake.
 *   owner      — organization no malik (register karnar).
 *   admin      — organization ma full access, pan billing nahi.
 *   member     — posts/campaigns kari shake, settings nahi.
 */
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

    /** superadmin mate null. Baki badha ek organization ma hoy che. */
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
    /**
     * Agency plan vado user ghani organizations chalavi shake — ahiya badhi
     * organizations ni list rahe che, ane `organization` atyare kai active che e.
     */
    organizations: [{ type: Schema.Types.ObjectId, ref: "Organization" }],

    emailVerified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    avatarUrl: { type: String, trim: true },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof UserSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ||
  mongoose.model<UserDoc>("User", UserSchema);

/* ------------------------------------------------------------------ */

/**
 * Email OTP — register verification ane password reset mate.
 * TTL index 15 minute pachi record kadhi naakhe che.
 */
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
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

OtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 900 });

export type OtpDoc = InferSchemaType<typeof OtpSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Otp: Model<OtpDoc> =
  (mongoose.models.Otp as Model<OtpDoc>) ||
  mongoose.model<OtpDoc>("Otp", OtpSchema);
