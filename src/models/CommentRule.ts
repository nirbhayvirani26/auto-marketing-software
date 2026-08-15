import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * "When someone comments on a post, do this."
 *
 * Two separate Meta capabilities are involved:
 *   public reply  — a visible answer under the comment
 *   private reply — a direct message to that person's inbox
 *
 * Meta's limits apply: a private reply may be sent **once** per comment, and
 * only within seven days of the comment. That is a platform rule, not ours.
 */
export type CommentRuleDoc = BaseFields & {
  brand: ObjectId;
  name: string;
  /** Which accounts this rule covers. Empty means every account in the brand. */
  accounts: ObjectId[];
  /** Any of these words triggers the rule. Empty means every comment does. */
  keywords: string[];
  matchType: "any" | "all" | "exact";
  caseSensitive: boolean;

  publicReply: boolean;
  publicReplyText?: string;

  sendDm: boolean;
  dmText?: string;
  dmLinkUrl?: string;
  dmLinkTitle?: string;

  /**
   * When a product is attached, its link is sent instead of `dmLinkUrl` —
   * that is the "comment to get the link in your DMs" flow.
   */
  product?: ObjectId;

  /** Write the reply with AI from the comment's context instead of fixed text. */
  useAi: boolean;
  aiInstruction?: string;

  enabled: boolean;
  /** Stops the same person being messaged over and over. */
  onlyOncePerUser: boolean;

  triggerCount: number;
  lastTriggeredAt?: Date;
  lastError?: string;
  createdBy?: ObjectId;
};

const CommentRuleSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },

    accounts: [{ type: Schema.Types.ObjectId, ref: "SocialAccount" }],

    keywords: { type: [String], default: [] },
    matchType: {
      type: String,
      enum: ["any", "all", "exact"],
      default: "any",
    },
    caseSensitive: { type: Boolean, default: false },

    publicReply: { type: Boolean, default: true },
    publicReplyText: { type: String, trim: true },

    sendDm: { type: Boolean, default: true },
    dmText: { type: String, trim: true },
    dmLinkUrl: { type: String, trim: true },
    dmLinkTitle: { type: String, trim: true },

    product: { type: Schema.Types.ObjectId, ref: "Product" },

    useAi: { type: Boolean, default: false },
    aiInstruction: { type: String, trim: true },

    enabled: { type: Boolean, default: true, index: true },
    onlyOncePerUser: { type: Boolean, default: true },

    triggerCount: { type: Number, default: 0 },
    lastTriggeredAt: { type: Date },
    lastError: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const CommentRule = model<CommentRuleDoc>("CommentRule", CommentRuleSchema);

/* ------------------------------------------------------------------ */

/**
 * A record of every comment that was handled — it prevents duplicate direct
 * messages and doubles as an audit trail.
 */
export type CommentEventDoc = BaseFields & {
  brand?: ObjectId;
  rule?: ObjectId;
  account?: ObjectId;
  platform?: "facebook" | "instagram";
  /** Identifiers as they come from Meta. */
  commentId: string;
  postId?: string;
  fromUserId?: string;
  fromUsername?: string;
  commentText?: string;
  publicReplied: boolean;
  dmSent: boolean;
  error?: string;
};

const CommentEventSchema = new Schema(
  {
    brand: { type: Schema.Types.ObjectId, ref: "Brand", index: true },
    rule: { type: Schema.Types.ObjectId, ref: "CommentRule" },
    account: { type: Schema.Types.ObjectId, ref: "SocialAccount" },
    platform: { type: String, enum: ["facebook", "instagram"] },

    commentId: { type: String, required: true, index: true },
    postId: { type: String },
    fromUserId: { type: String, index: true },
    fromUsername: { type: String },
    commentText: { type: String },

    publicReplied: { type: Boolean, default: false },
    dmSent: { type: Boolean, default: false },
    error: { type: String },
  },
  { timestamps: true },
);

// A single comment is never processed twice.
CommentEventSchema.index({ commentId: 1 }, { unique: true });

export const CommentEvent = model<CommentEventDoc>("CommentEvent", CommentEventSchema);
