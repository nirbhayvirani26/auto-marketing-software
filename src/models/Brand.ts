import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Brand = ek workspace. Dareak brand na potana social accounts, campaigns,
 * posts ane automations hoy che. Admin panel ma uper thi brand switch thay che
 * ane badhu data e brand pramane filter thay che.
 */
const BrandSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
    // Aa brand na badha AI generation mate default context
    brandVoice: { type: String, trim: true, default: "friendly, professional" },
    targetAudience: { type: String, trim: true },
    website: { type: String, trim: true },
    defaultHashtags: { type: [String], default: [] },
    // UI ma brand ne olakhva mate
    color: { type: String, trim: true, default: "#5B5BD6" },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Slug ek organization ni andar unique — bhinna orgs ma same slug chale.
BrandSchema.index({ organization: 1, slug: 1 }, { unique: true });

export type BrandDoc = InferSchemaType<typeof BrandSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Brand: Model<BrandDoc> =
  (mongoose.models.Brand as Model<BrandDoc>) ||
  mongoose.model<BrandDoc>("Brand", BrandSchema);

/** "My Brand Name" -> "my-brand-name" */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
