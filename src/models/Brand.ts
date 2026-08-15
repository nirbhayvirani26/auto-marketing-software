import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * A brand is one workspace. Each brand owns its own social accounts,
 * campaigns, posts and automations. The top bar switches between brands and
 * every list in the admin panel is filtered by the active one.
 */
export type BrandDoc = BaseFields & {
  organization: ObjectId;
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  brandVoice: string;
  targetAudience?: string;
  website?: string;
  defaultHashtags: string[];
  color: string;
  active: boolean;
  createdBy?: ObjectId;
};

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
    // Default context for every AI generation under this brand.
    brandVoice: { type: String, trim: true, default: "friendly, professional" },
    targetAudience: { type: String, trim: true },
    website: { type: String, trim: true },
    defaultHashtags: { type: [String], default: [] },
    // Used to tell brands apart in the UI.
    color: { type: String, trim: true, default: "#5B5BD6" },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// A slug is unique inside an organization; different orgs may reuse it.
BrandSchema.index({ organization: 1, slug: 1 }, { unique: true });

export const Brand = model<BrandDoc>("Brand", BrandSchema);

/** "My Brand Name" -> "my-brand-name" */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
