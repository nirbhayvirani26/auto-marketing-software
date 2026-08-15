import {
  model,
  ObjectId,
  Schema,
  type BaseFields,
  type HydratedDocument,
} from "@/lib/localdb";

/**
 * The complete record of building one reel.
 *
 * A reel takes anywhere from thirty seconds to five minutes (vision -> trends
 * -> script -> images -> render -> upload), so the work runs in the background
 * and every step is written down here. That is what lets the UI show what is
 * happening right now, and lets you see exactly *where* something failed.
 */

export type ReelStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  /** Which provider ran, so a fallback is visible after the fact. */
  provider?: string;
  ms?: number;
  error?: string;
  note?: string;
};

export type ReelScene = {
  index: number;
  /** "hook" | "product" | "detail" | "benefit" | "proof" | "cta" */
  purpose?: string;
  duration: number;
  motion?: string;
  transition?: string;
  /** Text burned onto the screen. */
  onScreenText?: string;
  /** The line spoken by the voiceover. */
  voiceLine?: string;
  /** The image used — uploaded or AI-generated. */
  media?: ObjectId;
  imagePrompt?: string;
  imageSource: "uploaded" | "generated" | "tryon" | "reference";
  /** Whether the scene is a moving still or a real generated video clip. */
  mediaKind: "image" | "video";
  /** For a video scene — what the video model was told to animate. */
  videoPrompt?: string;
};

export type ReelJobDoc = BaseFields & {
  brand: ObjectId;
  avatar?: ObjectId;
  product?: ObjectId;

  /** The original images the user uploaded. */
  sourceImages: ObjectId[];
  /** "Make one like this" — a reference video. */
  referenceVideo?: ObjectId;
  referenceUrl?: string;

  /**
   * single    — one product
   * multi     — several products in one reel
   * tryon     — the avatar wearing the product
   * reference — in the style of a supplied reel
   */
  mode: "single" | "multi" | "tryon" | "reference";

  targetDuration: number;
  language: string;
  tone?: string;

  status: "queued" | "running" | "done" | "failed" | "canceled";
  steps: ReelStep[];
  scenes: ReelScene[];

  /** Everything the vision pass understood about the product. */
  analysis?: unknown;
  /** Trending keywords and hashtags. */
  trends?: unknown;
  /** Per-platform captions. */
  copy?: unknown;
  /** The track used, plus the trending-audio suggestion for Instagram. */
  audio?: unknown;

  /** The finished reel and its cover. */
  output?: ObjectId;
  thumbnail?: ObjectId;
  duration?: number;

  /** Posts created from this reel. */
  posts: ObjectId[];

  /**
   * Publish automatically the moment the reel is ready.
   *
   * This is what "set it and forget it" automation uses: a reel takes minutes
   * to build, so the scheduler cannot wait for it. The background worker picks
   * this up when the work finishes and publishes on its own.
   */
  autoDistribute: {
    enabled: boolean;
    accountIds: string[];
    when: "now" | "auto" | "draft";
    hashtagsInFirstComment: boolean;
    /** Which automation created this, for logs and debugging. */
    automation?: ObjectId;
    result?: unknown;
    error?: string;
  };

  /** Non-fatal problems worth telling the seller about. */
  warnings: string[];

  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
  ms?: number;

  createdBy?: ObjectId;
};

/** A live document, with `save()` attached. */
export type ReelJobDocument = HydratedDocument<ReelJobDoc>;

const StepSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  status: {
    type: String,
    enum: ["pending", "running", "done", "failed", "skipped"],
    default: "pending",
  },
  provider: { type: String, trim: true },
  ms: { type: Number },
  error: { type: String },
  note: { type: String },
});

const SceneSchema = new Schema({
  index: { type: Number, required: true },
  purpose: { type: String, trim: true },
  duration: { type: Number, required: true },
  motion: { type: String, trim: true },
  transition: { type: String, trim: true },
  onScreenText: { type: String, trim: true },
  voiceLine: { type: String, trim: true },
  media: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
  imagePrompt: { type: String, trim: true },
  imageSource: {
    type: String,
    enum: ["uploaded", "generated", "tryon", "reference"],
    default: "uploaded",
  },
  mediaKind: { type: String, enum: ["image", "video"], default: "image" },
  videoPrompt: { type: String, trim: true },
});

const ReelJobSchema = new Schema(
  {
    brand: { type: Schema.Types.ObjectId, ref: "Brand", required: true, index: true },
    avatar: { type: Schema.Types.ObjectId, ref: "Avatar" },
    product: { type: Schema.Types.ObjectId, ref: "Product" },

    sourceImages: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],
    referenceVideo: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    referenceUrl: { type: String, trim: true },

    mode: {
      type: String,
      enum: ["single", "multi", "tryon", "reference"],
      default: "single",
      index: true,
    },

    targetDuration: { type: Number, default: 40 },
    language: { type: String, default: "en" },
    tone: { type: String, trim: true },

    status: {
      type: String,
      enum: ["queued", "running", "done", "failed", "canceled"],
      default: "queued",
      index: true,
    },
    steps: { type: [StepSchema], default: [] },
    scenes: { type: [SceneSchema], default: [] },

    analysis: { type: Schema.Types.Mixed },
    trends: { type: Schema.Types.Mixed },
    copy: { type: Schema.Types.Mixed },
    audio: { type: Schema.Types.Mixed },

    output: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    thumbnail: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    duration: { type: Number },

    posts: [{ type: Schema.Types.ObjectId, ref: "Post" }],

    autoDistribute: {
      enabled: { type: Boolean, default: false },
      accountIds: { type: [String], default: [] },
      when: {
        type: String,
        enum: ["now", "auto", "draft"],
        default: "now",
      },
      hashtagsInFirstComment: { type: Boolean, default: true },
      automation: { type: Schema.Types.ObjectId, ref: "Automation" },
      result: { type: Schema.Types.Mixed },
      error: { type: String },
    },

    warnings: { type: [String], default: [] },

    error: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    ms: { type: Number },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ReelJobSchema.index({ brand: 1, status: 1, createdAt: -1 });

export const ReelJob = model<ReelJobDoc>("ReelJob", ReelJobSchema);

/** Records progress for one step, straight onto the job document. */
export async function setStep(
  jobId: ObjectId | string,
  key: string,
  patch: {
    label?: string;
    status?: ReelStep["status"];
    provider?: string;
    ms?: number;
    error?: string;
    note?: string;
  },
): Promise<void> {
  const job = await ReelJob.findById(jobId);
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
