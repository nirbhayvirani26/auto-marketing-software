import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, handle, ok } from "@/lib/api";
import { requireApiToken, resolveBrand } from "@/lib/api-auth";
import { SocialAccount } from "@/models/SocialAccount";
import { Post } from "@/models/Post";
import { generatePosts } from "@/lib/ai";
import { publishPost } from "@/lib/publisher";
import { checkLimit, incrementPostUsage, moduleEnabled } from "@/lib/tenant";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

const schema = z.object({
  brandSlug: z.string().optional(),
  brandId: z.string().optional(),

  /** Kaya accounts par — id ke naam. Khali = brand na BADHA accounts. */
  accountIds: z.array(z.string()).optional(),
  platform: z.enum(["facebook", "instagram"]).optional(),

  /** Aa be mathi ek joiye: caption (jate lakhelu) ke topic (AI banavshe). */
  caption: z.string().optional(),
  topic: z.string().optional(),
  tone: z.string().optional(),

  hashtags: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),

  /** true = turant publish; false/absent = draft ke schedule */
  publish: z.boolean().optional(),
  scheduledAt: z.string().optional(),
});

/**
 * POST /api/v1/posts — n8n no main endpoint.
 *
 * Ek j call ma: AI thi caption banavo → badha accounts par post banavo →
 * (chahe to) turant publish karo. Facebook ane Instagram banne.
 *
 *   Authorization: Bearer amk_...
 *   { "topic": "Diwali sale", "publish": true, "imageUrl": "https://..." }
 */
export const POST = handle(async (request) => {
  const auth = await requireApiToken(request, "posts:write");
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const body = schema.parse(await request.json());

  if (!body.caption && !body.topic) {
    return fail("`caption` ke `topic` — be mathi ek joiye", 422);
  }

  const brand = await resolveBrand(ctx, body);
  if (!brand) return fail("Brand madyu nahi", 404);

  // Accounts nakki karo
  const accountFilter: Record<string, unknown> = { brand: brand._id };
  if (body.accountIds?.length) accountFilter._id = { $in: body.accountIds };
  if (body.platform) accountFilter.platform = body.platform;

  const accounts = await SocialAccount.find({
    ...accountFilter,
    status: "connected",
  });
  if (accounts.length === 0) {
    return fail("Ek pan connected account madyu nahi", 404);
  }

  // Monthly quota
  const quota = await checkLimit(ctx.tenant, "postsPerMonth");
  if (!quota.allowed) {
    return fail(
      `Monthly post limit puri thai gai (${quota.used}/${quota.limit})`,
      402,
    );
  }

  const batchId = accounts.length > 1 ? randomUUID() : undefined;
  const created: Array<Record<string, unknown>> = [];
  const skipped: Array<{ account: string; reason: string }> = [];

  /**
   * AI caption platform pramane alag hoy che, etle platform dith ek j vaar
   * generate karine e platform na badha accounts ma vaparie chie.
   */
  const captionCache = new Map<string, { caption: string; hashtags: string[] }>();

  for (const account of accounts) {
    if (account.platform === "instagram" && !body.imageUrl) {
      skipped.push({
        account: account.displayName,
        reason: "Instagram mate imageUrl farjiyat che",
      });
      continue;
    }

    let caption = body.caption ?? "";
    let hashtags = body.hashtags ?? [];

    if (!body.caption && body.topic) {
      if (!moduleEnabled(ctx.tenant, "aiGeneration")) {
        return fail("AI generation tamara plan ma nathi", 402);
      }

      const cached = captionCache.get(account.platform);
      if (cached) {
        caption = cached.caption;
        hashtags = [...(body.hashtags ?? []), ...cached.hashtags];
      } else {
        try {
          const [generated] = await generatePosts({
            topic: body.topic,
            platform: account.platform as "facebook" | "instagram",
            tone: body.tone,
            brandVoice: brand.brandVoice ?? undefined,
            targetAudience: brand.targetAudience ?? undefined,
            variants: 1,
          });
          caption = generated.caption;
          hashtags = [...(body.hashtags ?? []), ...generated.hashtags];
          captionCache.set(account.platform, {
            caption: generated.caption,
            hashtags: generated.hashtags,
          });
        } catch (error) {
          return fail(`AI generation fail: ${(error as Error).message}`, 502);
        }
      }
    }

    const post = await Post.create({
      brand: brand._id,
      account: account._id,
      platform: account.platform,
      prompt: body.topic,
      caption,
      hashtags: Array.from(new Set(hashtags)),
      mediaUrl: body.imageUrl,
      mediaType: body.imageUrl ? "image" : "none",
      status: body.publish
        ? "scheduled"
        : body.scheduledAt
          ? "scheduled"
          : "draft",
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      batchId,
      generatedByAI: Boolean(body.topic),
      source: "n8n",
    });

    const entry: Record<string, unknown> = {
      postId: String(post._id),
      account: account.displayName,
      platform: account.platform,
      caption,
      status: post.status,
    };

    // publish=true hoy to turant publish karo (schedule ni raah na jovo).
    if (body.publish) {
      const result = await publishPost(String(post._id));
      entry.published = result.ok;
      entry.permalink = result.permalink;
      entry.error = result.error;
    }

    created.push(entry);
  }

  if (created.length === 0) {
    return fail(
      skipped.map((s) => `${s.account}: ${s.reason}`).join(" | "),
      422,
    );
  }

  await incrementPostUsage(ctx.orgId, created.length);

  await logActivity({
    level: skipped.length ? "warning" : "success",
    action: "api.post_created",
    message: `n8n token "${ctx.tokenName}" e ${created.length} post banavya`,
    actor: `token:${ctx.tokenName}`,
    meta: { batchId, created, skipped },
  });

  return ok({ batchId, created, skipped }, 201);
});

/** GET /api/v1/posts — status check karva mate. */
export const GET = handle(async (request) => {
  const auth = await requireApiToken(request, "posts:read");
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const batchId = url.searchParams.get("batchId");
  const status = url.searchParams.get("status");

  const brand = await resolveBrand(auth.ctx, {
    brandSlug: url.searchParams.get("brandSlug") ?? undefined,
  });
  if (!brand) return fail("Brand madyu nahi", 404);

  const posts = await Post.find({
    brand: brand._id,
    ...(batchId ? { batchId } : {}),
    ...(status ? { status } : {}),
  })
    .populate("account", "displayName platform")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return ok({
    posts: posts.map((post) => ({
      id: String(post._id),
      caption: post.caption,
      platform: post.platform,
      status: post.status,
      permalink: post.permalink,
      error: post.error,
      publishedAt: post.publishedAt,
      scheduledAt: post.scheduledAt,
    })),
  });
});
