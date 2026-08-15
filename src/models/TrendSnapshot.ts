import { model, Schema, type BaseFields } from "@/lib/localdb";

/**
 * Cached trend data.
 *
 * Google Trends and autocomplete must not be hit on every request — do that
 * and the requests start getting blocked. So each answer is kept for a while,
 * keyed by subject and region.
 */
export type TrendSnapshotDoc = BaseFields & {
  /** "keywords" | "daily" | "hashtags" */
  kind: string;
  /** What it was fetched for — a category or a seed keyword. */
  subject: string;
  geo: string;
  keywords: string[];
  hashtags: string[];
  rising: string[];
  source?: string;
  /** After this moment the snapshot is refetched, and swept from disk. */
  expiresAt: Date;
};

const TrendSnapshotSchema = new Schema(
  {
    kind: { type: String, required: true, index: true },
    subject: { type: String, required: true, trim: true, index: true },
    geo: { type: String, default: "IN", index: true },

    keywords: { type: [String], default: [] },
    hashtags: { type: [String], default: [] },
    rising: { type: [String], default: [] },

    source: { type: String, trim: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

TrendSnapshotSchema.index({ kind: 1, subject: 1, geo: 1 }, { unique: true });
// Expired snapshots are removed the next time the collection is read.
TrendSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TrendSnapshot = model<TrendSnapshotDoc>("TrendSnapshot", TrendSnapshotSchema);
