import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";

/**
 * Ek post = ek account mate ek publishable unit.
 * Lifecycle: draft -> scheduled -> publishing -> published | failed
 */
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
      required: true,
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
    // Instagram ne public image URL joiye j che
    mediaUrl: { type: String, trim: true },
    mediaType: {
      type: String,
      enum: ["none", "image", "video"],
      default: "none",
    },

    /**
     * Post no prakar — publish kai rite thashe e aa nakki kare che.
     *   image    → ek photo
     *   reel     → 9:16 video (Instagram Reels / Facebook Reels)
     *   carousel → 2-10 media, swipe thay evu
     *   story    → 24 kalak
     */
    postType: {
      type: String,
      enum: ["image", "reel", "carousel", "story", "text"],
      default: "image",
      index: true,
    },
    /** Carousel mate — badha media na public URL, kram sathe. */
    mediaUrls: { type: [String], default: [] },
    /** Reel no cover / video no thumbnail. */
    thumbnailUrl: { type: String, trim: true },

    /** Aa post kaya reel job mathi banyu. */
    reelJob: { type: Schema.Types.ObjectId, ref: "ReelJob", index: true },
    /** Vaparelu media — file kya che e khabar rahe. */
    mediaAsset: { type: Schema.Types.ObjectId, ref: "MediaAsset" },

    /**
     * Publish thaya pachi turant pehla comment ma aa mukay che.
     * Instagram par hashtag ahiya rakhvathi caption saaf rahe che.
     */
    firstComment: { type: String, trim: true },
    firstCommentId: { type: String, trim: true },

    /** Ranking score (0-100) ane su sudharvu — scoreCaption() no jawab. */
    seo: { type: Schema.Types.Mixed },
    /** Kayu music vagyu + IG ma kayo trending sound lagavvo e suchav. */
    audio: { type: Schema.Types.Mixed },

    /** Instagram par gayelu e j Facebook par gayu — banne ne jode che. */
    crossPostOf: { type: Schema.Types.ObjectId, ref: "Post", index: true },
    status: {
      type: String,
      enum: ["draft", "scheduled", "publishing", "published", "failed"],
      default: "draft",
      index: true,
    },
    scheduledAt: { type: Date, index: true },
    publishedAt: { type: Date },
    // Graph API e aapel post/media id
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
    /**
     * Ek j vaar ma ghana account par post karo tyare badha posts ne aa id thi
     * group karay che. Dareak post no potano status/permalink rahe che, etle
     * ek account fail thay to biju atkatu nathi.
     */
    batchId: { type: String, trim: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

PostSchema.index({ status: 1, scheduledAt: 1 });

export type PostDoc = InferSchemaType<typeof PostSchema> & {
  _id: mongoose.Types.ObjectId;
};

/** DB mathi aavelu jivant document — `.save()` jevi methods sathe. */
export type PostDocument = HydratedDocument<PostDoc>;

export const Post: Model<PostDoc> =
  (mongoose.models.Post as Model<PostDoc>) ||
  mongoose.model<PostDoc>("Post", PostSchema);
