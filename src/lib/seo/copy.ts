/**
 * Caption / description lakhvanu.
 *
 * Fakt "sarsu lakho" nahi — lakhi ne TAPASO ane jarur pade to FARI lakho.
 * scoreCaption() ranking na najariya thi marks aape che; ochha aave to
 * ene su khute che e batavi ne AI pase fari lakhavie chie. Etle bahar
 * hamesha ek j level nu caption jaay che, AI no mood gme te hoy.
 */

import { complete } from "@/lib/ai/index";
import type { ProductIntelligence } from "@/lib/ai/vision";
import type { TrendPack } from "@/lib/trends/keywords";
import { scoreCaption, type CaptionScore } from "./ranking";

export type CopyFormat = "reel" | "image" | "carousel" | "story";
export type CopyPlatform = "instagram" | "facebook";

export type SocialCopy = {
  /** Pehli line — 'more' pehla aa j dekhay che. */
  hook: string;
  caption: string;
  hashtags: string[];
  /** Post par mukvano CTA. */
  callToAction: string;
  /** Reel/video mate — YouTube/FB description jevu lambu, keyword bharelu. */
  description: string;
  /** Pehla comment ma mukvano hashtag block (IG ni saras practice). */
  firstComment: string;
  score: CaptionScore;
  /** Ketli var fari lakhyu. */
  revisions: number;
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
  /** Ochho score aave to ketli var fari lakhavu. */
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

  for (let attempt = 0; attempt <= maxRevisions; attempt += 1) {
    const { data } = await complete<CopyResponse>({
      system: systemPrompt(language),
      prompt: userPrompt(options, keywords, feedback),
      schema: COPY_SCHEMA,
      maxTokens: 2500,
    });

    const caption = assembleCaption(data, options.platform);
    const score = scoreCaption({
      caption,
      hashtags,
      keywords,
      platform: options.platform,
      format: options.format,
    });

    if (!best || score.score > best.score.score) {
      best = { copy: data, score };
    }

    if (score.score >= 85) break;

    revisions = attempt + 1;
    feedback = score.checks
      .filter((c) => !c.passed)
      .map((c) => `${c.label} — ${c.hint}`);
  }

  if (!best) throw new Error("Caption banavi na shakayu");

  const caption = assembleCaption(best.copy, options.platform);

  return {
    hook: best.copy.hook.trim(),
    caption,
    hashtags,
    callToAction: best.copy.callToAction.trim(),
    description: best.copy.description.trim(),
    firstComment:
      options.platform === "instagram"
        ? hashtags.map((t) => `#${t}`).join(" ")
        : "",
    score: best.score,
    revisions,
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
