import { randomUUID } from "node:crypto";
import { Product, type ProductDoc } from "@/models/Product";
import { SocialAccount } from "@/models/SocialAccount";
import { Post } from "@/models/Post";
import { Brand, type BrandDoc } from "@/models/Brand";
import { generatePosts } from "./ai";
import { generateImage } from "./image-gen";
import { publishPost } from "./publisher";
import { logActivity } from "@/models/ActivityLog";

export type ProductCampaignOptions = {
  productId: string;
  brand: BrandDoc;
  /** Khali = brand na badha connected accounts */
  accountIds?: string[];
  tone?: string;
  /** true = turant publish, false = draft */
  publish?: boolean;
  scheduledAt?: Date;
  /**
   * Kai image vaparvi:
   *   "generate" — AI thi navi banavo (default)
   *   "product"  — product page ni pehli image
   *   URL        — jate aapeli image
   */
  imageMode?: "generate" | "product" | string;
  createdBy?: string;
};

export type ProductCampaignResult = {
  batchId?: string;
  imageUrl?: string;
  imageSource: "generated" | "product" | "custom" | "none";
  created: Array<{
    postId: string;
    account: string;
    platform: string;
    caption: string;
    status: string;
    published?: boolean;
    permalink?: string;
    error?: string;
  }>;
  skipped: Array<{ account: string; reason: string }>;
};

/** Product ni link caption na chhede jode. */
function withProductLink(caption: string, product: ProductDoc): string {
  const url = product.url;
  if (!url || caption.includes(url)) return caption;
  return `${caption}\n\n🔗 ${url}`;
}

/**
 * Product link thi ekdam full flow:
 *   product vigat → AI caption (platform pramane alag) → image
 *   → dareak account mate post → (chahe to) publish
 */
export async function runProductCampaign(
  options: ProductCampaignOptions,
): Promise<ProductCampaignResult> {
  const product = await Product.findOne({
    _id: options.productId,
    brand: options.brand._id,
  });
  if (!product) throw new Error("Product madyu nahi");

  const filter: Record<string, unknown> = {
    brand: options.brand._id,
    status: "connected",
  };
  if (options.accountIds?.length) filter._id = { $in: options.accountIds };

  const accounts = await SocialAccount.find(filter);
  if (accounts.length === 0) {
    throw new Error("Ek pan connected account nathi — pehla account jodo");
  }

  const result: ProductCampaignResult = {
    imageSource: "none",
    created: [],
    skipped: [],
  };

  // ---- 1. Platform dith AI caption (ek j vaar per platform) ----
  const captions = new Map<
    string,
    { caption: string; hashtags: string[]; imagePrompt: string }
  >();

  const platforms = Array.from(new Set(accounts.map((a) => a.platform)));
  for (const platform of platforms) {
    const [generated] = await generatePosts({
      topic: product.title,
      platform: platform as "facebook" | "instagram",
      tone: options.tone,
      brandVoice: options.brand.brandVoice ?? undefined,
      targetAudience: options.brand.targetAudience ?? undefined,
      variants: 1,
      product: {
        title: product.title,
        description: product.description ?? undefined,
        price: product.price ?? undefined,
        currency: product.currency ?? undefined,
        url: product.url,
        brand: product.brandName ?? undefined,
      },
    });
    captions.set(platform, generated);
  }

  // ---- 2. Image ----
  const mode = options.imageMode ?? "generate";
  let imageUrl: string | undefined;

  if (mode === "product") {
    imageUrl = product.images?.[0];
    if (imageUrl) result.imageSource = "product";
  } else if (mode !== "generate" && mode.startsWith("http")) {
    imageUrl = mode;
    result.imageSource = "custom";
  } else {
    // AI ni imagePrompt vaparie — product nu naam pan ema nakhiye.
    const prompt =
      captions.values().next().value?.imagePrompt ||
      `Professional product photo of ${product.title}, clean background, soft studio lighting, commercial quality`;
    try {
      const image = await generateImage({ prompt });
      imageUrl = image.url;
      result.imageSource = "generated";
      product.generatedImageUrl = image.url;
      product.imagePrompt = prompt;
      await product.save();
    } catch {
      // Generation fail thay to product ni potani image vapro.
      imageUrl = product.images?.[0];
      if (imageUrl) result.imageSource = "product";
    }
  }
  result.imageUrl = imageUrl;

  // ---- 3. Posts ----
  const batchId = accounts.length > 1 ? randomUUID() : undefined;
  result.batchId = batchId;

  for (const account of accounts) {
    // Instagram ne image farjiyat che.
    if (account.platform === "instagram" && !imageUrl) {
      result.skipped.push({
        account: account.displayName,
        reason: "Instagram mate image joiye — generate fail thayu ane product ma pan image nathi",
      });
      continue;
    }

    const generated = captions.get(account.platform);
    if (!generated) continue;

    const caption = withProductLink(generated.caption, product);

    const post = await Post.create({
      brand: options.brand._id,
      account: account._id,
      platform: account.platform,
      prompt: `Product: ${product.title}`,
      caption,
      hashtags: generated.hashtags,
      mediaUrl: imageUrl,
      mediaType: imageUrl ? "image" : "none",
      status: options.publish || options.scheduledAt ? "scheduled" : "draft",
      scheduledAt: options.scheduledAt,
      batchId,
      generatedByAI: true,
      source: "ai",
      createdBy: options.createdBy,
    });

    const entry: ProductCampaignResult["created"][number] = {
      postId: String(post._id),
      account: account.displayName,
      platform: account.platform,
      caption,
      status: post.status,
    };

    if (options.publish) {
      const published = await publishPost(String(post._id));
      entry.published = published.ok;
      entry.permalink = published.permalink;
      entry.error = published.error;
    }

    result.created.push(entry);
  }

  await logActivity({
    level: result.skipped.length ? "warning" : "success",
    action: "product.campaign",
    message: `"${product.title}" mate ${result.created.length} post banya (image: ${result.imageSource})`,
    meta: { productId: String(product._id), batchId },
  });

  return result;
}

/** Brand no doc — helper. */
export async function loadBrand(brandId: string) {
  return Brand.findById(brandId);
}
