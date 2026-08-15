import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * An avatar is the person who appears in your reels.
 *
 * It can be a photo of you, of your model, or an AI-generated face. Using the
 * same avatar across every reel gives the brand a face people recognise.
 *
 * `referencePhotos` matters most: the more angles you supply, the more stable
 * the face stays across generated scenes.
 */
export type AvatarDoc = BaseFields & {
  brand: ObjectId;
  name: string;
  /** How the person looks — this description is what the AI receives. */
  description?: string;
  /** One to five photos, used to keep the face consistent. */
  referencePhotos: ObjectId[];
  /** The clearest face shot. */
  primaryPhoto?: ObjectId;

  /**
   * Views generated from the reference photos — full body, side, back, face.
   * These are what the reel pipeline reaches for when it needs the avatar in
   * a particular pose, instead of hoping one reference happens to suit.
   */
  generatedViews: Array<{
    key: string;
    label: string;
    purpose?: string;
    media: ObjectId;
    provider?: string;
    createdAt: Date;
  }>;
  gender: "female" | "male" | "non-binary" | "unspecified";
  ageRange: string;
  skinTone?: string;
  hair?: string;
  bodyType?: string;
  heightNote?: string;
  /** Speaking style — drives the voiceover and the on-screen text. */
  persona: string;
  /** "en" | "hi" | "gu" | "hinglish" */
  language: string;
  /** The kind of clothing or look this avatar wears. */
  wardrobeNotes?: string;
  /** Where the shot should look like it was taken. */
  settingNotes?: string;
  /** One default avatar per brand. */
  isDefault: boolean;
  active: boolean;
  createdBy?: ObjectId;
};

const GeneratedViewSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  purpose: { type: String },
  media: { type: Schema.Types.ObjectId, ref: "MediaAsset", required: true },
  provider: { type: String },
  createdAt: { type: Date, default: () => new Date() },
});

const AvatarSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    referencePhotos: [{ type: Schema.Types.ObjectId, ref: "MediaAsset" }],
    primaryPhoto: { type: Schema.Types.ObjectId, ref: "MediaAsset" },

    generatedViews: { type: [GeneratedViewSchema], default: [] },

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

    persona: { type: String, trim: true, default: "friendly, confident, warm" },
    language: { type: String, trim: true, default: "en" },

    wardrobeNotes: { type: String, trim: true },
    settingNotes: { type: String, trim: true },

    isDefault: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

AvatarSchema.index({ brand: 1, name: 1 }, { unique: true });

export const Avatar = model<AvatarDoc>("Avatar", AvatarSchema);

/**
 * Turns an avatar into a single prompt line. The same wording goes into every
 * image request, which is what keeps the face and the look consistent.
 */
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
