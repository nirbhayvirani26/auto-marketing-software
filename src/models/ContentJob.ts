import {
  model,
  ObjectId,
  Schema,
  type BaseFields,
  type HydratedDocument,
} from "@/lib/localdb";

/**
 * One "Create New" run, from a photo to a finished post and reel.
 *
 * The work takes minutes — trends, script, image, four video clips, a render —
 * so it happens in the background and every step is written here as it goes.
 * That is what the progress panel reads: what is running now, which provider
 * served it, how long it took, and what each step actually produced.
 */

export type ContentStepKey =
  | "understand"
  | "trends"
  | "script"
  | "image"
  | "copy"
  | "video"
  | "assemble"
  | "save";

export type ContentStep = {
  key: ContentStepKey;
  label: string;
  /** One line on what this step is for, shown under the label. */
  detail?: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  provider?: string;
  ms?: number;
  /** What it produced, in a few words. */
  note?: string;
  error?: string;
  /** Anything worth showing in full — keywords, prompts, the caption. */
  output?: unknown;
};

export type ContentJobDoc = BaseFields & {
  brand: ObjectId;

  /* ---- What was asked for ---- */
  sourceImages: ObjectId[];
  productName?: string;
  productUrl?: string;
  price?: string;
  notes?: string;
  avatar?: ObjectId;
  language: string;
  tone?: string;
  /** Target reel length in seconds. */
  videoSeconds: number;
  /** Build the reel at all, or stop after the image post. */
  wantVideo: boolean;

  accountIds: string[];
  platforms: string[];

  /* ---- Progress ---- */
  status: "queued" | "running" | "done" | "failed";
  steps: ContentStep[];

  /* ---- Results ---- */
  /** The Nano Banana post image. */
  postImage?: ObjectId;
  /** The finished reel. */
  reelVideo?: ObjectId;
  reelThumbnail?: ObjectId;
  reelDuration?: number;
  /** Clips generated on the way, kept so a failed stitch can be retried. */
  clips: ObjectId[];

  analysis?: unknown;
  trends?: unknown;
  script?: unknown;
  copy?: unknown;

  posts: ObjectId[];

  warnings: string[];
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
  ms?: number;
  createdBy?: ObjectId;
};

export type ContentJobDocument = HydratedDocument<ContentJobDoc>;

const StepSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  detail: { type: String },
  status: {
    type: String,
    enum: ["pending", "running", "done", "failed", "skipped"],
    default: "pending",
  },
  provider: { type: String, trim: true },
  ms: { type: Number },
  note: { type: String },
  error: { type: String },
  output: { type: Schema.Types.Mixed },
});

const ContentJobSchema = new Schema(
  {
    brand: { type: Schema.Types.ObjectId, ref: "Brand", required: true, index: true },

    sourceImages: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],
    productName: { type: String, trim: true },
    productUrl: { type: String, trim: true },
    price: { type: String, trim: true },
    notes: { type: String, trim: true },
    avatar: { type: Schema.Types.ObjectId, ref: "Avatar" },
    language: { type: String, default: "en" },
    tone: { type: String, trim: true },
    videoSeconds: { type: Number, default: 30 },
    wantVideo: { type: Boolean, default: true },

    accountIds: { type: [String], default: [] },
    platforms: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["queued", "running", "done", "failed"],
      default: "queued",
      index: true,
    },
    steps: { type: [StepSchema], default: [] },

    postImage: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    reelVideo: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    reelThumbnail: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    reelDuration: { type: Number },
    clips: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],

    analysis: { type: Schema.Types.Mixed },
    trends: { type: Schema.Types.Mixed },
    script: { type: Schema.Types.Mixed },
    copy: { type: Schema.Types.Mixed },

    posts: [{ type: Schema.Types.ObjectId, ref: "Post" }],

    warnings: { type: [String], default: [] },
    error: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    ms: { type: Number },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ContentJobSchema.index({ brand: 1, status: 1, createdAt: -1 });

export const ContentJob = model<ContentJobDoc>("ContentJob", ContentJobSchema);

/**
 * The pipeline, in order. Every job starts with all of these pending so the
 * progress panel can show the whole plan from the first second, rather than
 * revealing steps one at a time.
 */
export const CONTENT_STEPS: Array<{
  key: ContentStepKey;
  label: string;
  detail: string;
}> = [
  {
    key: "understand",
    label: "Understanding the product",
    detail: "Reading your photo: what it is, what it is made of, who buys it",
  },
  {
    key: "trends",
    label: "Finding trending keywords",
    detail: "What people are searching for right now, and the hashtag ladder",
  },
  {
    key: "script",
    label: "Writing the script and prompts",
    detail: "Post angle, story beats, the image prompt and one prompt per clip",
  },
  {
    key: "image",
    label: "Generating the post image",
    detail: "Nano Banana turns your photo into a finished marketing image",
  },
  {
    key: "copy",
    label: "Writing the caption",
    detail: "Caption, description and hashtags, then scored and rewritten",
  },
  {
    key: "video",
    label: "Generating the video clips",
    detail: "Veo renders one clip per beat, from your product image",
  },
  {
    key: "assemble",
    label: "Building the reel",
    detail: "Joining the clips, adding music, rendering 1080x1920",
  },
  {
    key: "save",
    label: "Saving your posts",
    detail: "The image post and the reel, ready on the Posts page",
  },
];

/** Records progress for one step. */
export async function setContentStep(
  jobId: ObjectId | string,
  key: ContentStepKey,
  patch: Partial<Omit<ContentStep, "key">>,
): Promise<void> {
  const job = await ContentJob.findById(jobId);
  if (!job) return;

  const existing = job.steps.find((step) => step.key === key);
  if (existing) {
    Object.assign(existing, patch);
  } else {
    job.steps.push({
      key,
      label: patch.label ?? key,
      status: patch.status ?? "pending",
      ...patch,
    });
  }
  await job.save();
}
