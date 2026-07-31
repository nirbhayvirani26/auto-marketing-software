import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * OAuth callback ma malela accounts ne thodi var mate ahiya rakhiye chie,
 * jethi user "kaya accounts connect karva che" e pasand kari shake.
 *
 * Cookie ma na rakhi shakay — page tokens motta hoy che ane 4KB limit vati jay.
 * TTL index 10 minute pachi record aapoaap kadhi naakhe che.
 */
const PendingConnectionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    accounts: [
      {
        platform: { type: String, enum: ["facebook", "instagram"] },
        displayName: String,
        pageId: String,
        igUserId: String,
        accessToken: String,
        avatarUrl: String,
      },
    ],
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

PendingConnectionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

export type PendingConnectionDoc = InferSchemaType<
  typeof PendingConnectionSchema
> & { _id: mongoose.Types.ObjectId };

export const PendingConnection: Model<PendingConnectionDoc> =
  (mongoose.models.PendingConnection as Model<PendingConnectionDoc>) ||
  mongoose.model<PendingConnectionDoc>(
    "PendingConnection",
    PendingConnectionSchema,
  );
