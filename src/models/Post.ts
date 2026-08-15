import {
  model,
  ObjectId,
  Schema,
  type BaseFields,
  type HydratedDocument,
} from "@/lib/localdb";

/**
 * A post is one publishable unit for one account.
 * Lifecycle: draft -> scheduled -> publishing -> published | failed
 */
export type PostDoc = BaseFields & {
  brand: ObjectId;
  campaign?: ObjectId;
  /**
   * Optional: a draft written before any account is connected has nowhere to
   * go yet. Publishing checks for it and says so.
   */
  account?: ObjectId;
  platform: "facebook" | "instagram";
  prompt?: string;
  caption: string;
  hashtags: string[];
  /** Instagram requires a public image URL. */
  mediaUrl?: string;
  mediaType: "none" | "image" | "video";

  /**
   * How this post gets published.
   *   image    -> a single photo
   *   reel     -> a 9:16 video (Instagram Reels / Facebook Reels)
   *   carousel -> 2-10 swipeable media items
   *   story    -> disappears after 24 hours
   */
  postType: "image" | "reel" | "carousel" | "story" | "text";
  /** Carousel media, in order. */
  mediaUrls: string[];
  /** Reel cover / video thumbnail. */
  thumbnailUrl?: string;

  /** The reel job this post came out of. */
  reelJob?: ObjectId;
  /** The media asset used, so the file can always be traced back. */
  mediaAsset?: ObjectId;

  /**
   * Posted as the first comment right after publishing. Keeping hashtags here
   * leaves the caption itself clean.
   */
  firstComment?: string;
  firstCommentId?: string;

  /** Ranking score (0-100) plus suggestions — the output of scoreCaption(). */
  seo?: unknown;
  /** Which track was used, and which trending sound to pick in the app. */
  audio?: unknown;

  /** Links the Instagram post to its Facebook twin. */
  crossPostOf?: ObjectId;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed";
  scheduledAt?: Date;
  publishedAt?: Date;
  /** The post/media id returned by the Graph API. */
  externalPostId?: string;
  permalink?: string;
  error?: string;
  attempts: number;
  generatedByAI: boolean;
  source: "manual" | "ai" | "automation" | "n8n";
  /**
   * Posting to several accounts at once creates one document per account, all
   * sharing this id. Each keeps its own status, so one failure cannot block
   * the others.
   */
  batchId?: string;
  createdBy?: ObjectId;
};

/** A live document, with `save()` attached. */
export type PostDocument = HydratedDocument<PostDoc>;

const PostSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
    campaign: { type: Schema.Types.ObjectId, ref: "Campaign", index: true },
    account: {
      type: Schema.Types.ObjectId,
      ref: "SocialAccount",
      index: true,
    },
    platform: {
      type: String,
      enum: ["facebook", "instagram"],
      required: true,
      index: true,
    },
    prompt: { type: String, trim: true },
    caption: { type: String, required: true },
    hashtags: { type: [String], default: [] },
    mediaUrl: { type: String, trim: true },
    mediaType: {
      type: String,
      enum: ["none", "image", "video"],
      default: "none",
    },

    postType: {
      type: String,
      enum: ["image", "reel", "carousel", "story", "text"],
      default: "image",
      index: true,
    },
    mediaUrls: { type: [String], default: [] },
    thumbnailUrl: { type: String, trim: true },

    reelJob: { type: Schema.Types.ObjectId, ref: "ReelJob", index: true },
    mediaAsset: { type: Schema.Types.ObjectId, ref: "MediaAsset" },

    firstComment: { type: String, trim: true },
    firstCommentId: { type: String, trim: true },

    seo: { type: Schema.Types.Mixed },
    audio: { type: Schema.Types.Mixed },

    crossPostOf: { type: Schema.Types.ObjectId, ref: "Post", index: true },
    status: {
      type: String,
      enum: ["draft", "scheduled", "publishing", "published", "failed"],
      default: "draft",
      index: true,
    },
    scheduledAt: { type: Date, index: true },
    publishedAt: { type: Date },
    externalPostId: { type: String, trim: true },
    permalink: { type: String, trim: true },
    error: { type: String },
    attempts: { type: Number, default: 0 },
    generatedByAI: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ["manual", "ai", "automation", "n8n"],
      default: "manual",
    },
    batchId: { type: String, trim: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

PostSchema.index({ status: 1, scheduledAt: 1 });

export const Post = model<PostDoc>("Post", PostSchema);
