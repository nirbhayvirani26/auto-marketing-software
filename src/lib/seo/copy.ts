/**
 * Captions and descriptions.
 *
 * Not simply "write something good" — write it, GRADE it, and rewrite when the
 * grade is poor. scoreCaption() marks the draft the way the ranking algorithms
 * see it; a low score is fed back to the model with exactly what is missing.
 * The result is a consistent standard leaving the app, whatever mood the model
 * happens to be in.
 *
 * If every AI provider is unavailable — no key, no credit, an outage — a
 * template caption is assembled from the product facts instead. It is plainer
 * than a written one, but the reel still ships with a usable, honest caption
 * rather than failing outright.
 */

import { complete } from "@/lib/ai/index";
import type { ProductIntelligence } from "@/lib/ai/vision";
import type { TrendPack } from "@/lib/trends/keywords";
import { scoreCaption, type CaptionScore } from "./ranking";

export type CopyFormat = "reel" | "image" | "carousel" | "story";
export type CopyPlatform = "instagram" | "facebook";

export type SocialCopy = {
  /** The first line — all that shows before 'more'. */
  hook: string;
  caption: string;
  hashtags: string[];
  /** The call to action placed on the post. */
  callToAction: string;
  /** A longer, keyword-rich description for reels and Facebook. */
  description: string;
  /** The hashtag block for the first comment — standard practice on Instagram. */
  firstComment: string;
  score: CaptionScore;
  /** How many times it was rewritten. */
  revisions: number;
  /** True when no AI provider was reachable and the template was used. */
  fromTemplate: boolean;
};

const COPY_SCHEMA = {
  type: "object",
  properties: {
    hook: {
      type: "string",
      description: "The first line of the caption. 30-90 characters. Must contain the primary keyword. Must make someone stop scrolling — a question, a number, a bold claim or a pain point. Never start with 'Introducing' or 'Check out'.",
    },
    body: {
      type: "string",
      description: "The rest of the caption after the hook, WITHOUT the hook repeated and WITHOUT hashtags. 3-6 short lines separated by newlines. Weave 2-4 of the given keywords in naturally. Answer one buyer objection. Sound like a real person, not a brochure.",
    },
    callToAction: {
      type: "string",
      description: "One line asking for a comment, save, share or DM. Must be specific and easy to answer, e.g. 'Comment SIZE and I'll send the fit guide'.",
    },
    description: {
      type: "string",
      description: "A longer keyword-rich description, 60-120 words, for Facebook and for the reel description. Written for search: state what the product is, who it is for, the material, the occasion. No hashtags.",
    },
  },
  required: ["hook", "body", "callToAction", "description"],
};

type CopyResponse = {
  hook: string;
  body: string;
  callToAction: string;
  description: string;
};

const PLATFORM_RULES: Record<CopyPlatform, string> = {
  instagram: [
    "Instagram. Only the first line shows before 'more' — it carries the whole post.",
    "Short punchy lines with line breaks. Emojis are fine, 3-6 total, never in the hook's first 3 words.",
    "Instagram now indexes caption words in search, so the primary keyword must read naturally in the first sentence.",
  ].join(" "),
  facebook: [
    "Facebook. People read a little more here, so 2-4 short paragraphs work.",
    "Conversational. A genuine question near the end pulls comments, and comments are the strongest Facebook signal.",
    "Very few hashtags on Facebook — they do not help ranking there.",
  ].join(" "),
};

const FORMAT_RULES: Record<CopyFormat, string> = {
  reel: "This caption sits under a Reel. Reels rank on watch time, shares and saves — so the caption should give a reason to rewatch or send it to a friend.",
  image: "This caption sits under a single photo. The caption has to do the selling the photo cannot.",
  carousel: "This caption sits under a carousel. Tell people there is more to swipe — swipes are a strong ranking signal.",
  story: "This is a story. Keep it to 1-2 very short lines, built around a tap or a sticker.",
};

export type GenerateCopyOptions = {
  product: ProductIntelligence;
  trends: TrendPack;
  platform: CopyPlatform;
  format: CopyFormat;
  brandName?: string;
  brandVoice?: string;
  /** "en" | "hi" | "gu" | "hinglish" */
  language?: string;
  productUrl?: string;
  price?: string;
  /** How many rewrites to allow when the score comes back low. */
  maxRevisions?: number;
};

export async function generateSocialCopy(
  options: GenerateCopyOptions,
): Promise<SocialCopy> {
  const maxRevisions = options.maxRevisions ?? 2;
  const language = options.language ?? options.product.language ?? "en";
  const keywords = options.trends.keywords.slice(0, 8);

  const hashtags = options.trends.hashtags
    .map((h) => h.tag)
    .slice(0, options.platform === "facebook" ? 5 : 30);

  let best: { copy: CopyResponse; score: CaptionScore } | null = null;
  let revisions = 0;
  let feedback: string[] = [];
  let lastError: Error | null = null;

  const grade = (copy: CopyResponse): CaptionScore =>
    scoreCaption({
      caption: assembleCaption(copy, options.platform),
      hashtags,
      keywords,
      platform: options.platform,
      format: options.format,
    });

  for (let attempt = 0; attempt <= maxRevisions; attempt += 1) {
    let data: CopyResponse;
    try {
      ({ data } = await complete<CopyResponse>({
        system: systemPrompt(language),
        prompt: userPrompt(options, keywords, feedback),
        schema: COPY_SCHEMA,
        maxTokens: 2500,
      }));
    } catch (error) {
      // Every provider is down or out of quota. Stop asking and use whatever
      // the earlier attempts produced, or fall back to the template.
      lastError = error as Error;
      break;
    }

    const score = grade(data);
    if (!best || score.score > best.score.score) best = { copy: data, score };
    if (score.score >= 85) break;

    revisions = attempt + 1;
    feedback = score.checks
      .filter((check) => !check.passed)
      .map((check) => `${check.label} — ${check.hint}`);
  }

  const fromTemplate = best === null;
  if (!best) {
    const copy = templateCopy(options, keywords);
    best = { copy, score: grade(copy) };
    console.warn(
      `[copy] Falling back to a template caption — ${lastError?.message ?? "no AI provider was available"}`,
    );
  }

  return {
    hook: best.copy.hook.trim(),
    caption: assembleCaption(best.copy, options.platform),
    hashtags,
    callToAction: best.copy.callToAction.trim(),
    description: best.copy.description.trim(),
    firstComment:
      options.platform === "instagram" ? hashtags.map((tag) => `#${tag}`).join(" ") : "",
    score: best.score,
    revisions,
    fromTemplate,
  };
}

/**
 * A caption built only from facts already known about the product — no model
 * involved, so nothing here can be invented. Used when every AI provider is
 * unavailable.
 */
function templateCopy(options: GenerateCopyOptions, keywords: string[]): CopyResponse {
  const product = options.product;
  const audience =
    product.targetAudience || `${product.targetGender}, ${product.targetAgeRange}`;
  const brand = options.brandName?.trim();

  // Vision never saw the photo, so nothing specific about the product is known.
  // Lead with the brand, which IS true, rather than inventing a product name.
  if (product.degraded) {
    return {
      hook: brand ? `New in at ${brand}` : "New in",
      body: [options.price ? `${options.price}.` : "", "Swipe up for the details."]
        .filter(Boolean)
        .join("\n"),
      callToAction:
        options.platform === "instagram"
          ? "Comment below and we will send you the details."
          : "Tell us in the comments what you would like to know.",
      description: [
        brand ? `A new piece from ${brand}.` : "A new piece in stock.",
        options.price ? `Price: ${options.price}.` : "",
        "Message us for sizes, colours and availability.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  // A keyword only earns a place in the hook if it is specific AND actually
  // about this product. "General" is the placeholder normalise() falls back
  // to, and a stray trending phrase reads like a mistake in the caption.
  const generic = new Set(["general", "product", "unknown", "", "other"]);
  const productWords = new Set(
    `${product.productName} ${product.subCategory} ${product.category}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3),
  );

  const keyword = [keywords[0], product.subCategory, product.category].find((candidate) => {
    const value = candidate?.toLowerCase().trim();
    if (!value || generic.has(value)) return false;
    return value.split(/[^a-z0-9]+/).some((word) => productWords.has(word));
  });

  const details = [
    product.materials.length ? `Made from ${product.materials.join(", ")}.` : "",
    product.colors.length ? `Available in ${product.colors.join(", ")}.` : "",
    product.occasions.length ? `Made for ${product.occasions.join(", ")}.` : "",
    product.sellingPoints[0] ? `${product.sellingPoints[0]}.` : "",
    options.price ? `${options.price}.` : "",
  ].filter(Boolean);

  return {
    hook: keyword
      ? `${product.productName} — the ${keyword} worth a second look`
      : product.productName,
    body: details.slice(0, 4).join("\n"),
    callToAction:
      options.platform === "instagram"
        ? "Comment SIZE and we will send you the fit guide."
        : "Tell us in the comments which colour you would pick.",
    description: [
      `${product.productName} from ${options.brandName ?? "our store"}.`,
      product.materials.length ? `Material: ${product.materials.join(", ")}.` : "",
      product.colors.length ? `Colours: ${product.colors.join(", ")}.` : "",
      product.style ? `Style: ${product.style}.` : "",
      product.occasions.length ? `Best for: ${product.occasions.join(", ")}.` : "",
      audience ? `Made for ${audience}.` : "",
      options.price ? `Price: ${options.price}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function assembleCaption(copy: CopyResponse, platform: CopyPlatform): string {
  const parts = [copy.hook.trim(), copy.body.trim(), copy.callToAction.trim()]
    .map((p) => p.replace(/#\w+/g, "").trim()) // hashtag caption ni bahar rahe
    .filter(Boolean);

  return parts.join(platform === "instagram" ? "\n\n" : "\n\n");
}

function systemPrompt(language: string): string {
  const languageRule: Record<string, string> = {
    en: "Write in clear, simple English.",
    hi: "Write in Hindi using Devanagari script.",
    gu: "Write in Gujarati using Gujarati script.",
    hinglish: "Write in Hinglish — Hindi words in Latin script mixed with English, the way people actually type on Instagram in India.",
  };

  return [
    "You are a direct-response social media copywriter for a commerce brand.",
    "You write copy that gets saved and shared, not copy that sounds impressive.",
    languageRule[language] ?? languageRule.en,
    "",
    "Hard rules:",
    "- Never invent a price, discount, fabric composition, certification, delivery time, stock level or review that you were not given.",
    "- Never use: 'In today's fast-paced world', 'Look no further', 'Elevate your', 'Unleash', 'Game-changer', 'Introducing'.",
    "- No em-dash-heavy AI cadence. Short sentences. Real words.",
    "- Hashtags are added separately — never put a hashtag in the caption text.",
    "Return only the structured output requested.",
  ].join("\n");
}

function userPrompt(
  options: GenerateCopyOptions,
  keywords: string[],
  feedback: string[],
): string {
  const p = options.product;

  return [
    `Write the caption for a ${options.platform} ${options.format}.`,
    "",
    "PRODUCT (these are the only facts you may state):",
    `• Name: ${p.productName}`,
    `• Category: ${p.category} → ${p.subCategory}`,
    p.materials.length ? `• Material: ${p.materials.join(", ")}` : "",
    p.colors.length ? `• Colour: ${p.colors.join(", ")}` : "",
    p.style ? `• Style: ${p.style}` : "",
    p.occasions.length ? `• Occasion: ${p.occasions.join(", ")}` : "",
    p.keyFeatures.length ? `• Features: ${p.keyFeatures.join("; ")}` : "",
    p.sellingPoints.length ? `• Why people buy it: ${p.sellingPoints.join("; ")}` : "",
    p.objections.length ? `• Doubts buyers have: ${p.objections.join("; ")}` : "",
    options.price ? `• Price: ${options.price}` : "",
    "",
    `AUDIENCE: ${p.targetAudience || `${p.targetGender}, ${p.targetAgeRange}`}`,
    p.emotionalHooks.length ? `What they actually feel: ${p.emotionalHooks.join("; ")}` : "",
    "",
    `PRIMARY KEYWORD (must appear naturally in the first sentence): ${keywords[0] ?? p.subCategory}`,
    keywords.length > 1 ? `OTHER KEYWORDS (weave in 2-4): ${keywords.slice(1).join(", ")}` : "",
    options.trends.risingTopics.length
      ? `TRENDING RIGHT NOW (use only if it honestly fits, else ignore): ${options.trends.risingTopics.join(", ")}`
      : "",
    "",
    options.brandName ? `BRAND: ${options.brandName}` : "",
    options.brandVoice ? `BRAND VOICE: ${options.brandVoice}` : "",
    options.productUrl ? `LINK (do not write the URL, it is appended automatically): ${options.productUrl}` : "",
    "",
    PLATFORM_RULES[options.platform],
    FORMAT_RULES[options.format],
    "",
    feedback.length
      ? [
          "YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS — fix every one of them:",
          ...feedback.map((f) => `- ${f}`),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
