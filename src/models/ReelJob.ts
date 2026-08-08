import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";

/**
 * Ek reel banavva no aakho hisab.
 *
 * Reel banavva ma 30 second thi 5 minute lage che (vision → trends →
 * script → images → render → upload). Etle e kaam background ma chale che
 * ane aa document ma dareak step no hisab rahe che — jethi UI ma
 * "atyare su thai rahyu che" batavi shakay ane fail thay to KYA fail thayu
 * e khabar pade.
 */
const StepSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "running", "done", "failed", "skipped"],
      default: "pending",
    },
    /** Kayo provider chalyo (fallback thayu ke nahi e khabar pade). */
    provider: { type: String, trim: true },
    ms: { type: Number },
    error: { type: String },
    note: { type: String },
  },
  { _id: false },
);

const SceneSchema = new Schema(
  {
    index: { type: Number, required: true },
    /** "hook" | "product" | "detail" | "benefit" | "proof" | "cta" */
    purpose: { type: String, trim: true },
    duration: { type: Number, required: true },
    motion: { type: String, trim: true },
    transition: { type: String, trim: true },
    /** Screen par dekhato text. */
    onScreenText: { type: String, trim: true },
    /** Voiceover mate bolvanu vakya. */
    voiceLine: { type: String, trim: true },
    /** Kai image vaparai — upload kareli ke AI e banaveli. */
    media: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    imagePrompt: { type: String, trim: true },
    imageSource: {
      type: String,
      enum: ["uploaded", "generated", "tryon", "reference"],
      default: "uploaded",
    },
    /** Still image halavi ke AI e kharekhar video banavyu (Omni). */
    mediaKind: { type: String, enum: ["image", "video"], default: "image" },
    /** Video hoy to — Omni ne su halavvanu kahyu hatu. */
    videoPrompt: { type: String, trim: true },
  },
  { _id: false },
);

const ReelJobSchema = new Schema(
  {
    brand: { type: Schema.Types.ObjectId, ref: "Brand", required: true, index: true },
    avatar: { type: Schema.Types.ObjectId, ref: "Avatar" },
    product: { type: Schema.Types.ObjectId, ref: "Product" },

    /** User e upload kareli original images. */
    sourceImages: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],
    /** "aa jevi reel banavo" — reference video. */
    referenceVideo: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    referenceUrl: { type: String, trim: true },

    /**
     * single   — ek product ni reel
     * multi    — ghana product ni ek j reel (collection)
     * tryon    — avatar potane product pehri ne
     * reference— aapelі reel ni style ma
     */
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

    /** Vision e su samjyu — aakhu object jem che em. */
    analysis: { type: Schema.Types.Mixed },
    /** Trending keywords + hashtags. */
    trends: { type: Schema.Types.Mixed },
    /** Platform dith caption. */
    copy: { type: Schema.Types.Mixed },
    /** Kayu music vaparyu + IG trending audio suchav. */
    audio: { type: Schema.Types.Mixed },

    /** Final reel ane ena cover. */
    output: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    thumbnail: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
    duration: { type: Number },

    /** Aa reel mathi banela posts. */
    posts: [{ type: Schema.Types.ObjectId, ref: "Post" }],

    /**
     * Reel taiyar thay ke turant jate j publish kari devu?
     * Automation ("set karo ane bhuli jao") aa vaapre che — reel banta
     * 2-4 minute lage che, etle cron ma raah na jovay; kaam pura thay tyare
     * background worker j aa joine post kari de che.
     */
    autoDistribute: {
      enabled: { type: Boolean, default: false },
      accountIds: { type: [String], default: [] },
      when: {
        type: String,
        enum: ["now", "auto", "draft"],
        default: "now",
      },
      hashtagsInFirstComment: { type: Boolean, default: true },
      /** Kayu automation e banavyu — log ane debugging mate. */
      automation: { type: Schema.Types.ObjectId, ref: "Automation" },
      result: { type: Schema.Types.Mixed },
      error: { type: String },
    },

    error: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    ms: { type: Number },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ReelJobSchema.index({ brand: 1, status: 1, createdAt: -1 });

export type ReelJobDoc = InferSchemaType<typeof ReelJobSchema> & {
  _id: mongoose.Types.ObjectId;
};

/** DB mathi aavelu jivant document — `.save()` jevi methods sathe. */
export type ReelJobDocument = HydratedDocument<ReelJobDoc>;

export const ReelJob: Model<ReelJobDoc> =
  (mongoose.models.ReelJob as Model<ReelJobDoc>) ||
  mongoose.model<ReelJobDoc>("ReelJob", ReelJobSchema);

/** Step ne update karvanu — job document ma sidhu lakhe che. */
export async function setStep(
  jobId: mongoose.Types.ObjectId | string,
  key: string,
  patch: {
    label?: string;
    status?: "pending" | "running" | "done" | "failed" | "skipped";
    provider?: string;
    ms?: number;
    error?: string;
    note?: string;
  },
): Promise<void> {
  const job = await ReelJob.findById(jobId);
  if (!job) return;

  const existing = job.steps.find((s) => s.key === key);
  if (existing) {
    Object.assign(existing, patch);
  } else {
    job.steps.push({
      key,
      label: patch.label ?? key,
      status: patch.status ?? "pending",
      ...patch,
    } as never);
  }
  await job.save();
}
