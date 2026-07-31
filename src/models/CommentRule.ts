import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * "Koi post par comment kare to su karvu" — aa rule nakki kare che.
 *
 * Meta ni be alag capability vaparay che:
 *  - public reply  : comment ni niche jaher ma jawab
 *  - private reply : e user ne DM (Instagram/Messenger inbox ma)
 *
 * ⚠️ Meta ni limit: private reply ek comment dith **ek j vaar** mokli shakay,
 * ane comment thai gaya na 7 divas ni andar j. Aa platform no niyam che.
 */
const CommentRuleSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },

    // Kaya accounts par aa rule lagu pade. Khali = brand na badha accounts.
    accounts: [{ type: Schema.Types.ObjectId, ref: "SocialAccount" }],

    /**
     * Comment ma aa mathi koi pan shabd hoy to rule trigger thay.
     * Khali rakho to *dareak* comment par trigger thashe.
     */
    keywords: { type: [String], default: [] },
    matchType: {
      type: String,
      enum: ["any", "all", "exact"],
      default: "any",
    },
    caseSensitive: { type: Boolean, default: false },

    // --- Su karvu ---
    publicReply: { type: Boolean, default: true },
    publicReplyText: { type: String, trim: true },

    sendDm: { type: Boolean, default: true },
    dmText: { type: String, trim: true },
    // DM ma link mokalvo hoy to (dakhla tarike offer page)
    dmLinkUrl: { type: String, trim: true },
    dmLinkTitle: { type: String, trim: true },

    /**
     * true hoy to reply AI thi banashe (comment no context aapine),
     * fixed text ne badle.
     */
    useAi: { type: Boolean, default: false },
    aiInstruction: { type: String, trim: true },

    enabled: { type: Boolean, default: true, index: true },
    // Ek j user ne vaar vaar DM na jay etle
    onlyOncePerUser: { type: Boolean, default: true },

    triggerCount: { type: Number, default: 0 },
    lastTriggeredAt: { type: Date },
    lastError: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type CommentRuleDoc = InferSchemaType<typeof CommentRuleSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const CommentRule: Model<CommentRuleDoc> =
  (mongoose.models.CommentRule as Model<CommentRuleDoc>) ||
  mongoose.model<CommentRuleDoc>("CommentRule", CommentRuleSchema);

/* ------------------------------------------------------------------ */

/**
 * Dareak handle thayela comment no record — duplicate DM rokva ane
 * audit trail mate.
 */
const CommentEventSchema = new Schema(
  {
    brand: { type: Schema.Types.ObjectId, ref: "Brand", index: true },
    rule: { type: Schema.Types.ObjectId, ref: "CommentRule" },
    account: { type: Schema.Types.ObjectId, ref: "SocialAccount" },
    platform: { type: String, enum: ["facebook", "instagram"] },

    // Meta na IDs
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

// Ek comment be vaar process na thay.
CommentEventSchema.index({ commentId: 1 }, { unique: true });

export type CommentEventDoc = InferSchemaType<typeof CommentEventSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const CommentEvent: Model<CommentEventDoc> =
  (mongoose.models.CommentEvent as Model<CommentEventDoc>) ||
  mongoose.model<CommentEventDoc>("CommentEvent", CommentEventSchema);
