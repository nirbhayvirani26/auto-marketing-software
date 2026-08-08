import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Trend data cache.
 *
 * Google Trends / autocomplete ne dar vakhate hit karvani jarur nathi — ane
 * karie to block thai jaiye. Etle category+geo dith jawab thodo vakhat
 * sachvi rakhie chie.
 */
const TrendSnapshotSchema = new Schema(
  {
    /** "keywords" | "daily" | "hashtags" */
    kind: { type: String, required: true, index: true },
    /** Jena mate lidhu — category ke seed keyword. */
    subject: { type: String, required: true, trim: true, index: true },
    geo: { type: String, default: "IN", index: true },

    keywords: { type: [String], default: [] },
    hashtags: { type: [String], default: [] },
    rising: { type: [String], default: [] },

    source: { type: String, trim: true },
    /**
     * Aa vakhat pachi navu lavvu pade.
     * Index niche `expireAfterSeconds` sathe alag thi banavyo che — ahiya
     * `index: true` na lakhvu, nahi to Mongoose be index banave che.
     */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

TrendSnapshotSchema.index({ kind: 1, subject: 1, geo: 1 }, { unique: true });
// Juna snapshot Mongo jate kadhi naakhe.
TrendSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type TrendSnapshotDoc = InferSchemaType<typeof TrendSnapshotSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const TrendSnapshot: Model<TrendSnapshotDoc> =
  (mongoose.models.TrendSnapshot as Model<TrendSnapshotDoc>) ||
  mongoose.model<TrendSnapshotDoc>("TrendSnapshot", TrendSnapshotSchema);
