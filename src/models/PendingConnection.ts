import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * Accounts returned by the Meta OAuth callback are parked here for a few
 * minutes so the user can pick which ones to connect.
 *
 * They cannot live in a cookie: page tokens are long and would blow past the
 * 4 KB limit. Records expire ten minutes after they are written.
 */
export type PendingConnectionAccount = {
  platform: "facebook" | "instagram";
  displayName?: string;
  pageId?: string;
  igUserId?: string;
  accessToken?: string;
  avatarUrl?: string;
};

export type PendingConnectionDoc = BaseFields & {
  user: ObjectId;
  accounts: PendingConnectionAccount[];
};

const PendingAccountSchema = new Schema({
  platform: { type: String, enum: ["facebook", "instagram"] },
  displayName: { type: String },
  pageId: { type: String },
  igUserId: { type: String },
  accessToken: { type: String },
  avatarUrl: { type: String },
});

const PendingConnectionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    accounts: { type: [PendingAccountSchema], default: [] },
  },
  { timestamps: true },
);

PendingConnectionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

export const PendingConnection = model<PendingConnectionDoc>(
  "PendingConnection",
  PendingConnectionSchema,
);
