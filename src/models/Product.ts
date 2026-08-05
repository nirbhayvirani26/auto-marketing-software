import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Ek product — eni link paste karo etle vigat aapoaap aavi jaay che,
 * pachi ena parthi AI post ane image bane che, ane comment par jе DM jaay
 * ena ma aa j product ni link mukay che.
 */
const ProductSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    /** Je link paste kari — DM ane post ma aa j jaay che. */
    url: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    price: { type: Number },
    currency: { type: String, trim: true },
    brandName: { type: String, trim: true },
    availability: { type: String, trim: true },
    siteName: { type: String, trim: true },

    /** Product page par thi malelі images. */
    images: { type: [String], default: [] },
    /** AI e banaveli image (Instagram mate public URL). */
    generatedImageUrl: { type: String, trim: true },
    imagePrompt: { type: String, trim: true },

    /** Kai rite vigat madi — debugging mate. */
    scrapeSource: { type: String, trim: true },
    lastScrapedAt: { type: Date },
    scrapeError: { type: String },

    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ProductSchema.index({ brand: 1, url: 1 }, { unique: true });

export type ProductDoc = InferSchemaType<typeof ProductSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Product: Model<ProductDoc> =
  (mongoose.models.Product as Model<ProductDoc>) ||
  mongoose.model<ProductDoc>("Product", ProductSchema);
