import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * A product. Paste its link and the details are pulled in automatically; from
 * there the AI writes posts and builds images, and the same link is what goes
 * out in the automated direct messages.
 */
export type ProductDoc = BaseFields & {
  brand: ObjectId;
  /** The link you pasted — this is the one that gets shared. */
  url: string;
  title: string;
  description?: string;
  price?: number;
  currency?: string;
  brandName?: string;
  availability?: string;
  siteName?: string;
  /** Images found on the product page. */
  images: string[];
  /** An AI-generated image, hosted at a public URL for Instagram. */
  generatedImageUrl?: string;
  imagePrompt?: string;
  /** How the details were obtained — useful when debugging. */
  scrapeSource?: string;
  lastScrapedAt?: Date;
  scrapeError?: string;
  active: boolean;
  createdBy?: ObjectId;
};

const ProductSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    url: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    price: { type: Number },
    currency: { type: String, trim: true },
    brandName: { type: String, trim: true },
    availability: { type: String, trim: true },
    siteName: { type: String, trim: true },

    images: { type: [String], default: [] },
    generatedImageUrl: { type: String, trim: true },
    imagePrompt: { type: String, trim: true },

    scrapeSource: { type: String, trim: true },
    lastScrapedAt: { type: Date },
    scrapeError: { type: String },

    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ProductSchema.index({ brand: 1, url: 1 }, { unique: true });

export const Product = model<ProductDoc>("Product", ProductSchema);
