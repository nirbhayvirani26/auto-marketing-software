import { readFile } from "node:fs/promises";
import { z } from "zod";

import { fail, handle, ok, requireBrand } from "@/lib/api";
import { Avatar } from "@/models/Avatar";
import { MediaAsset } from "@/models/MediaAsset";
import { Post } from "@/models/Post";
import { SocialAccount } from "@/models/SocialAccount";
import { logActivity } from "@/models/ActivityLog";
import { ensureLocalPath, ensurePublicUrl } from "@/lib/media/store";
import { analyzeProductImages, briefFromText, productLabel } from "@/lib/ai/vision";
import { buildTrendPack } from "@/lib/trends/keywords";
import { generateSocialCopy } from "@/lib/seo/copy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  /** Uploaded product photos. At least one, unless a productUrl is given. */
  imageAssetIds: z.array(z.string()).default([]),
  /** What the product is called. */
  name: z.string().max(200).optional(),
  /** Where to buy it — appended to the caption. */
  productUrl: z.string().max(500).optional(),
  price: z.string().max(60).optional(),
  /** Anything else worth telling the AI. */
  notes: z.string().max(1000).optional(),

  /**
   * Where it goes. Both of these are optional on purpose: a draft is useful
   * long before any account is connected.
   */
  accountIds: z.array(z.string()).default([]),
  platforms: z.array(z.enum(["instagram", "facebook"])).default([]),

  /** Optional. Without one, the post is built from the product photo alone. */
  avatarId: z.string().optional(),

  tone: z.string().max(120).optional(),
  language: z.string().max(20).optional(),
  publish: z.boolean().optional(),
  scheduledAt: z.string().optional(),
});

/**
 * Builds a marketing post from photos, or from a product link.
 *
 * Deliberately forgiving about what it is given:
 *   - no account connected  -> the post is saved as a draft
 *   - no platform chosen    -> one draft per platform the brand could use
 *   - no avatar             -> the product photo carries the post
 *   - no AI available       -> the caption falls back to the product facts
 *
 * The only hard requirement is something to show: a photo, or a link.
 */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const body = schema.parse(await request.json());

  if (body.imageAssetIds.length === 0 && !body.productUrl?.trim()) {
    return fail("Add at least one photo, or a product link", 422);
  }

  /* ---- The images ---- */
  const images = body.imageAssetIds.length
    ? await MediaAsset.find({ _id: { $in: body.imageAssetIds }, kind: "image" })
    : [];

  if (body.imageAssetIds.length > 0 && images.length === 0) {
    return fail("Those photos could not be found", 404);
  }

  /* ---- Understand the product ---- */
  const buffers = await Promise.all(
    images.map(async (asset) => ({
      data: await readFile(await ensureLocalPath(asset)),
      mimeType: asset.mimeType,
    })),
  );

  const hint = [body.name, body.notes].filter(Boolean).join(". ").trim();

  const analysis =
    buffers.length > 0
      ? (
          await analyzeProductImages(buffers, {
            hint: hint || undefined,
            market: process.env.DEFAULT_MARKET || "India",
            fallbackName: body.name || ctx.brand.name,
          })
        ).data
      : // A link with no photo: everything known is what was typed.
        briefFromText({ name: body.name, notes: body.notes });

  // A name typed by the seller always beats whatever the model guessed.
  if (body.name?.trim()) analysis.productName = body.name.trim();

  /* ---- Trends ---- */
  const trends = await buildTrendPack({
    product: analysis,
    brandTag: ctx.brand.name,
  });

  /* ---- Which platforms ---- */
  const accounts = body.accountIds.length
    ? await SocialAccount.find({
        _id: { $in: body.accountIds },
        brand: ctx.brandId,
        status: "connected",
      })
    : [];

  // Work out the platforms to write for. An explicit choice wins; then the
  // accounts picked; and if neither, write for both so the drafts are ready.
  const platforms: Array<"instagram" | "facebook"> = body.platforms.length
    ? body.platforms
    : accounts.length
      ? [...new Set(accounts.map((account) => account.platform))]
      : ["instagram", "facebook"];

  /* ---- The avatar, if one was chosen ---- */
  const avatar = body.avatarId
    ? await Avatar.findOne({ _id: body.avatarId, brand: ctx.brandId }).lean()
    : null;

  /* ---- Media URL ---- */
  let mediaUrl: string | undefined;
  if (images[0]) {
    try {
      mediaUrl = await ensurePublicUrl(images[0]);
    } catch {
      // Publishing will complain later; a draft is still worth saving.
    }
  }

  /* ---- Captions and posts ---- */
  const created: Array<{ id: string; platform: string; caption: string; score: number }> = [];
  const usedTemplate: string[] = [];

  for (const platform of platforms) {
    const copy = await generateSocialCopy({
      product: analysis,
      trends,
      platform,
      format: "image",
      brandName: ctx.brand.name,
      brandVoice: ctx.brand.brandVoice,
      language: body.language ?? "en",
      productUrl: body.productUrl,
      price: body.price,
    });

    if (copy.fromTemplate) usedTemplate.push(platform);

    const caption = body.productUrl?.trim()
      ? `${copy.caption}\n\n${body.productUrl.trim()}`
      : copy.caption;

    // One post per matching account, or a single unassigned draft when no
    // account is connected yet.
    const targets = accounts.filter((account) => account.platform === platform);
    const rows = targets.length > 0 ? targets : [null];

    for (const account of rows) {
      const post = await Post.create({
        brand: ctx.brandId,
        account: account?._id ?? ctx.brandId,
        platform,
        postType: "image",
        caption,
        hashtags: copy.hashtags,
        mediaUrl,
        mediaType: mediaUrl ? "image" : "none",
        mediaAsset: images[0]?._id,
        firstComment: copy.firstComment,
        seo: copy.score,
        prompt: hint || body.productUrl,
        status: account && (body.publish || body.scheduledAt) ? "scheduled" : "draft",
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        generatedByAI: !copy.fromTemplate,
        source: "ai",
        createdBy: ctx.session.sub,
      });

      created.push({
        id: String(post._id),
        platform,
        caption,
        score: copy.score.score,
      });
    }
  }

  await logActivity({
    level: "success",
    action: "create.post",
    message: `${created.length} post(s) created for "${productLabel(analysis, ctx.brand.name)}"`,
    actor: ctx.session.email,
  });

  return ok(
    {
      created,
      product: {
        name: productLabel(analysis, ctx.brand.name),
        category: analysis.category,
        degraded: Boolean(analysis.degraded),
      },
      hashtags: trends.hashtags.map((tag) => tag.tag),
      avatarUsed: avatar ? { id: String(avatar._id), name: avatar.name } : null,
      mediaUrl: mediaUrl ?? null,
      warnings: [
        analysis.degraded
          ? "No AI could read the photo, so the caption is built from the product facts alone. Adding a name and a short description improves it a lot."
          : "",
        usedTemplate.length
          ? `The ${usedTemplate.join(" and ")} caption used the built-in template because no AI provider was reachable.`
          : "",
        accounts.length === 0
          ? "No account was selected, so these were saved as drafts. Connect an account to publish them."
          : "",
        !mediaUrl && images.length > 0
          ? "The photo could not be given a public URL, which Instagram requires before publishing."
          : "",
      ].filter(Boolean),
    },
    201,
  );
});
