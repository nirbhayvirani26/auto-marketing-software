import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/**
 * A connected store.
 *
 * Point this at the site you actually sell on and the crawler pulls back every
 * product URL it can find, with a thumbnail. From then on, creating a post is
 * "pick a product" instead of "go and find the link".
 *
 * A brand may connect as many stores as it likes — one Shopify shop, one
 * marketplace listing page, a landing page — and they are all searched
 * together when you pick a product.
 */
export type WebsiteProduct = {
  url: string;
  title: string;
  imageUrl?: string;
  price?: string;
  /** Where this entry came from: sitemap, collection page, or added by hand. */
  source: "sitemap" | "crawl" | "manual";
  foundAt: Date;
};

export type WebsiteDoc = BaseFields & {
  brand: ObjectId;
  /** The store's home page, as the seller typed it. */
  url: string;
  /** Hostname only, for display and de-duplication. */
  host: string;
  name: string;
  /** Detected platform, when it is recognisable. */
  platform?: "shopify" | "woocommerce" | "wix" | "magento" | "custom";

  /** Every product found on the last sync. */
  products: WebsiteProduct[];

  lastSyncedAt?: Date;
  lastSyncMs?: number;
  syncStatus: "never" | "syncing" | "ok" | "failed";
  syncError?: string;
  /** How the last sync found things, for the UI to explain itself. */
  syncSources: string[];

  active: boolean;
  createdBy?: ObjectId;
};

const WebsiteProductSchema = new Schema({
  url: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  imageUrl: { type: String, trim: true },
  price: { type: String, trim: true },
  source: {
    type: String,
    enum: ["sitemap", "crawl", "manual"],
    default: "crawl",
  },
  foundAt: { type: Date, default: () => new Date() },
});

const WebsiteSchema = new Schema(
  {
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
    url: { type: String, required: true, trim: true },
    host: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    platform: {
      type: String,
      enum: ["shopify", "woocommerce", "wix", "magento", "custom"],
      default: "custom",
    },

    products: { type: [WebsiteProductSchema], default: [] },

    lastSyncedAt: { type: Date },
    lastSyncMs: { type: Number },
    syncStatus: {
      type: String,
      enum: ["never", "syncing", "ok", "failed"],
      default: "never",
      index: true,
    },
    syncError: { type: String },
    syncSources: { type: [String], default: [] },

    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// The same store must not be connected twice to one brand.
WebsiteSchema.index({ brand: 1, host: 1 }, { unique: true });

export const Website = model<WebsiteDoc>("Website", WebsiteSchema);
