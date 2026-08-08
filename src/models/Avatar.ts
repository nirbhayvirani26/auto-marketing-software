import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Avatar = reel ma dekhaati vyakti.
 *
 * Aa tamaro potano photo pan hoi shake, tamara model no, ke AI e banavelo
 * chehro. Ek j avatar badhi reels ma rahe che etle brand ne ek olakh male
 * che — log chehro joine j olakhi jaay ke aa tamari brand che.
 *
 * `referencePhotos` sauthi agatya nu che — jetli vadhu angle ni image
 * hase, etli AI chehro sthir rakhi shakshe.
 */
const AvatarSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    /** Reel ma dekhaati vyakti kevi che — AI ne aa j varnan aapiye chie. */
    description: { type: String, trim: true },

    /** Chehro sthir rakhva mate — 1 thi 5 photo. */
    referencePhotos: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],
    /** Mukhya photo — sauthi saaf chehro valo. */
    primaryPhoto: { type: Schema.Types.ObjectId, ref: "MediaAsset" },

    gender: {
      type: String,
      enum: ["female", "male", "non-binary", "unspecified"],
      default: "unspecified",
    },
    ageRange: { type: String, trim: true, default: "22-30" },
    skinTone: { type: String, trim: true },
    hair: { type: String, trim: true },
    bodyType: { type: String, trim: true },
    heightNote: { type: String, trim: true },

    /** Reel ma bolvani rit — voiceover ane on-screen text aa pramane bane. */
    persona: { type: String, trim: true, default: "friendly, confident, warm" },
    /** "en" | "hi" | "gu" | "hinglish" */
    language: { type: String, trim: true, default: "en" },

    /** Kaya prakar na kapda / look ma dekhaay. */
    wardrobeNotes: { type: String, trim: true },
    /** Kaya jagya e shoot thayelu lage. */
    settingNotes: { type: String, trim: true },

    /** Ek brand ma ek j default avatar. */
    isDefault: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

AvatarSchema.index({ brand: 1, name: 1 }, { unique: true });

/**
 * Avatar ne ek prompt-line ma badle — dareak image generation ma aa j
 * lakhan jaay che, etle chehro/look badha scenes ma sarkho rahe.
 */
AvatarSchema.methods.toPromptDescription = function toPromptDescription(): string {
  const doc = this as AvatarDoc;
  return [
    doc.description,
    doc.gender !== "unspecified" ? `${doc.gender}` : "",
    doc.ageRange ? `around ${doc.ageRange} years old` : "",
    doc.skinTone ? `${doc.skinTone} skin` : "",
    doc.hair ? `${doc.hair} hair` : "",
    doc.bodyType ? `${doc.bodyType} build` : "",
  ]
    .filter(Boolean)
    .join(", ");
};

export type AvatarDoc = InferSchemaType<typeof AvatarSchema> & {
  _id: mongoose.Types.ObjectId;
  toPromptDescription(): string;
};

export const Avatar: Model<AvatarDoc> =
  (mongoose.models.Avatar as Model<AvatarDoc>) ||
  mongoose.model<AvatarDoc>("Avatar", AvatarSchema);

/** Model method na hoy tya pan vaparvva mate — plain object par pan chale. */
export function avatarPromptDescription(
  avatar: Partial<AvatarDoc> | null | undefined,
): string {
  if (!avatar) return "";
  return [
    avatar.description,
    avatar.gender && avatar.gender !== "unspecified" ? avatar.gender : "",
    avatar.ageRange ? `around ${avatar.ageRange} years old` : "",
    avatar.skinTone ? `${avatar.skinTone} skin` : "",
    avatar.hair ? `${avatar.hair} hair` : "",
    avatar.bodyType ? `${avatar.bodyType} build` : "",
  ]
    .filter(Boolean)
    .join(", ");
}
