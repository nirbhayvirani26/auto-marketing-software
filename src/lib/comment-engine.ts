import { CommentEvent, CommentRule, type CommentRuleDoc } from "@/models/CommentRule";
import { SocialAccount, type SocialAccountDoc } from "@/models/SocialAccount";
import { Product, type ProductDoc } from "@/models/Product";
import { logActivity } from "@/models/ActivityLog";
import { env } from "./env";
import { generateCommentReply } from "./ai";
import {
  replyToComment,
  sendFacebookPrivateReply,
  sendInstagramPrivateReply,
} from "./social";

export type IncomingComment = {
  platform: "facebook" | "instagram";
  /** Page ID (FB) ke IG User ID — kayo account che e olakhva */
  accountRef: string;
  commentId: string;
  postId?: string;
  text: string;
  fromUserId?: string;
  fromUsername?: string;
};

/** Comment na text saathe rule na keywords match thay che ke nahi. */
export function ruleMatches(rule: CommentRuleDoc, text: string): boolean {
  const keywords = (rule.keywords ?? []).filter(Boolean);
  // Keywords j na hoy to dareak comment par trigger thay.
  if (keywords.length === 0) return true;

  const haystack = rule.caseSensitive ? text : text.toLowerCase();
  const needles = rule.caseSensitive
    ? keywords
    : keywords.map((k) => k.toLowerCase());

  switch (rule.matchType) {
    case "all":
      return needles.every((needle) => haystack.includes(needle));
    case "exact":
      return needles.some((needle) => haystack.trim() === needle.trim());
    case "any":
    default:
      return needles.some((needle) => haystack.includes(needle));
  }
}

/**
 * DM na chhede link jode.
 * Product jodyu hoy to ENI link (ane price) jaay che, nahi to manual link.
 */
function composeDm(
  rule: CommentRuleDoc,
  body: string,
  product?: ProductDoc | null,
): string {
  if (product) {
    const price =
      product.price != null
        ? ` — ${product.currency ?? ""}${product.price}`.trimEnd()
        : "";
    return `${body}\n\n🛒 ${product.title}${price}\n${product.url}`;
  }

  if (!rule.dmLinkUrl) return body;
  const title = rule.dmLinkTitle?.trim();
  return `${body}\n\n${title ? `${title}: ` : ""}${rule.dmLinkUrl}`;
}

export type CommentHandleResult = {
  commentId: string;
  matched: boolean;
  ruleName?: string;
  publicReplied: boolean;
  dmSent: boolean;
  error?: string;
  skippedReason?: string;
};

/**
 * Ek incoming comment ne process kare:
 *   account shodho -> matching rule shodho -> public reply -> private DM
 *
 * Duplicate comment (Meta ghani var e j event fari mokle che) automatically
 * skip thay che — `commentId` par unique index che.
 */
export async function handleIncomingComment(
  incoming: IncomingComment,
): Promise<CommentHandleResult> {
  const result: CommentHandleResult = {
    commentId: incoming.commentId,
    matched: false,
    publicReplied: false,
    dmSent: false,
  };

  // 1. Aa comment pehla process thai gayo che?
  const already = await CommentEvent.findOne({ commentId: incoming.commentId });
  if (already) {
    result.skippedReason = "pehla thi process thayelo che";
    return result;
  }

  // 2. Kayo account che?
  const account = (await SocialAccount.findOne({
    ...(incoming.platform === "facebook"
      ? { pageId: incoming.accountRef }
      : { igUserId: incoming.accountRef }),
  }).select("+accessToken")) as SocialAccountDoc | null;

  if (!account) {
    result.skippedReason = `Aa app ma ${incoming.accountRef} account connected nathi`;
    return result;
  }

  // Brand e jate karelo comment/reply — ena par trigger thay to infinite
  // loop bane (aapnu reply -> webhook -> fari reply...).
  if (
    incoming.fromUserId &&
    (incoming.fromUserId === account.pageId ||
      incoming.fromUserId === account.igUserId)
  ) {
    result.skippedReason = "aa aapno j comment che";
    return result;
  }

  // 3. Matching rule shodho (jena accounts ma aa account hoy, ke badha mate hoy)
  const rules = await CommentRule.find({
    brand: account.brand,
    enabled: true,
    $or: [{ accounts: { $size: 0 } }, { accounts: account._id }],
  }).sort({ createdAt: 1 });

  const rule = rules.find((candidate) => ruleMatches(candidate, incoming.text));
  if (!rule) {
    result.skippedReason = "koi rule match na thayo";
    // Match na thay to pan record rakho — audit ane duplicate-guard mate.
    await CommentEvent.create({
      brand: account.brand,
      account: account._id,
      platform: incoming.platform,
      commentId: incoming.commentId,
      postId: incoming.postId,
      fromUserId: incoming.fromUserId,
      fromUsername: incoming.fromUsername,
      commentText: incoming.text,
    });
    return result;
  }

  result.matched = true;
  result.ruleName = rule.name;

  // 4. Ek j user ne vaar vaar DM na jay.
  if (rule.onlyOncePerUser && incoming.fromUserId) {
    const seen = await CommentEvent.findOne({
      rule: rule._id,
      fromUserId: incoming.fromUserId,
      dmSent: true,
    });
    if (seen) {
      result.skippedReason = "aa user ne pehla DM jai gayelo che";
      await CommentEvent.create({
        brand: account.brand,
        rule: rule._id,
        account: account._id,
        platform: incoming.platform,
        commentId: incoming.commentId,
        postId: incoming.postId,
        fromUserId: incoming.fromUserId,
        fromUsername: incoming.fromUsername,
        commentText: incoming.text,
      });
      return result;
    }
  }

  const accessToken = account.accessToken || env.metaDefaultAccessToken;
  if (!accessToken) {
    result.error = `"${account.displayName}" no access token nathi`;
    return result;
  }

  // 5. Reply text taiyar karo (AI ke fixed)
  let publicText = rule.publicReplyText ?? "";
  let dmBody = rule.dmText ?? "";

  // Rule saathe product jodayelu hoy to eni link DM ma jashe.
  const product = rule.product ? await Product.findById(rule.product) : null;

  if (rule.useAi) {
    try {
      const ai = await generateCommentReply({
        comment: incoming.text,
        username: incoming.fromUsername,
        platform: incoming.platform,
        instruction: rule.aiInstruction ?? undefined,
        needsPublicReply: Boolean(rule.publicReply),
        needsDm: Boolean(rule.sendDm),
        product: product
          ? {
              title: product.title,
              price: product.price ?? undefined,
              currency: product.currency ?? undefined,
              url: product.url,
            }
          : undefined,
      });
      if (rule.publicReply) publicText = ai.publicReply || publicText;
      if (rule.sendDm) dmBody = ai.dm || dmBody;
    } catch (error) {
      // AI fail thay to fixed text thi chalu rakho — reply gum na thay.
      result.error = `AI: ${(error as Error).message}`;
    }
  }

  // 6. Public reply
  if (rule.publicReply && publicText.trim()) {
    try {
      await replyToComment({
        commentId: incoming.commentId,
        accessToken,
        message: publicText,
      });
      result.publicReplied = true;
    } catch (error) {
      result.error = [result.error, `Public reply: ${(error as Error).message}`]
        .filter(Boolean)
        .join(" | ");
    }
  }

  // 7. Private DM
  if (rule.sendDm && dmBody.trim()) {
    try {
      const message = composeDm(rule, dmBody, product);
      if (incoming.platform === "facebook") {
        await sendFacebookPrivateReply({
          commentId: incoming.commentId,
          accessToken,
          message,
        });
      } else {
        await sendInstagramPrivateReply({
          igUserId: account.igUserId ?? incoming.accountRef,
          accessToken,
          commentId: incoming.commentId,
          message,
        });
      }
      result.dmSent = true;
    } catch (error) {
      result.error = [result.error, `DM: ${(error as Error).message}`]
        .filter(Boolean)
        .join(" | ");
    }
  }

  // 8. Record + counters
  await CommentEvent.create({
    brand: account.brand,
    rule: rule._id,
    account: account._id,
    platform: incoming.platform,
    commentId: incoming.commentId,
    postId: incoming.postId,
    fromUserId: incoming.fromUserId,
    fromUsername: incoming.fromUsername,
    commentText: incoming.text,
    publicReplied: result.publicReplied,
    dmSent: result.dmSent,
    error: result.error,
  });

  rule.triggerCount = (rule.triggerCount ?? 0) + 1;
  rule.lastTriggeredAt = new Date();
  rule.lastError = result.error;
  await rule.save();

  await logActivity({
    level: result.error ? "warning" : "success",
    action: "comment.auto_reply",
    message: `"${rule.name}" trigger thayu — ${incoming.fromUsername ?? "user"} na comment par${
      result.publicReplied ? " · public reply" : ""
    }${result.dmSent ? " · DM" : ""}`,
    meta: { ...result, comment: incoming.text.slice(0, 200) },
    actor: "webhook",
  });

  return result;
}
