/**
 * The creative brief for one "Create New" run.
 *
 * One AI call produces everything the rest of the pipeline needs:
 *   - the angle the post should take
 *   - the image prompt Nano Banana will render
 *   - one prompt per video clip, written as a shot list
 *   - a story version, which is shorter and built around a tap
 *
 * Doing it in a single call matters: the image and the clips then belong to
 * the same idea. Generating them independently gives you a picture and a video
 * that happen to feature the same product but tell two different stories.
 */

import { complete } from "@/lib/ai/index";
import { productLabel, type ProductIntelligence } from "@/lib/ai/vision";
import type { TrendPack } from "@/lib/trends/keywords";

export type VideoBeat = {
  /** Where this clip sits in the reel. */
  index: number;
  purpose: string;
  /** What Veo is told to render. Movement and camera, not a product essay. */
  prompt: string;
  /** Text burned over this beat. Kept short or left empty. */
  onScreenText: string;
};

export type ContentScript = {
  /** The single idea behind the whole post. */
  concept: string;
  /** What the image should show. */
  imagePrompt: string;
  /** The shot list. */
  beats: VideoBeat[];
  /** A shorter version for a story. */
  storyText: string;
  /** Cover text for the reel. */
  coverText: string;
  musicMood: string;
  fromTemplate: boolean;
};

const SCHEMA = {
  type: "object",
  properties: {
    concept: {
      type: "string",
      description: "One sentence describing the creative idea behind this post and reel.",
    },
    imagePrompt: {
      type: "string",
      description:
        "A detailed prompt for a marketing image of THIS product, to be rendered from the seller's own photo. " +
        "Describe the setting, surface, props, lighting and camera angle. " +
        "Never describe the product's own colour, material or shape — those come from the photo and must not be changed. " +
        "Never ask for text, logos or watermarks in the image.",
    },
    coverText: {
      type: "string",
      description: "3-6 words for the reel cover. Bold and readable at thumbnail size.",
    },
    storyText: {
      type: "string",
      description: "One or two very short lines for an Instagram story, built around a tap or a poll.",
    },
    musicMood: {
      type: "string",
      enum: ["upbeat", "chill", "cinematic", "luxury", "festive", "energetic", "romantic"],
    },
    beats: {
      type: "array",
      description: "The shot list for the reel, in order. One entry per clip.",
      items: {
        type: "object",
        properties: {
          purpose: {
            type: "string",
            enum: ["hook", "reveal", "detail", "lifestyle", "benefit", "cta"],
          },
          prompt: {
            type: "string",
            description:
              "What the camera does and what moves, in one or two sentences. " +
              "Describe MOVEMENT and FRAMING only — the product itself is fixed by the reference image and must not be re-described or restyled. " +
              "Example: 'Slow push in as the ring rotates on cream silk, light catching each facet.'",
          },
          onScreenText: {
            type: "string",
            description: "Up to 6 words burned over this beat, or an empty string for a clean shot.",
          },
        },
        required: ["purpose", "prompt", "onScreenText"],
      },
    },
  },
  required: ["concept", "imagePrompt", "coverText", "storyText", "musicMood", "beats"],
};

type ScriptResponse = {
  concept: string;
  imagePrompt: string;
  coverText: string;
  storyText: string;
  musicMood: string;
  beats: Array<{ purpose: string; prompt: string; onScreenText: string }>;
};

export type ScriptOptions = {
  product: ProductIntelligence;
  trends: TrendPack;
  brandName?: string;
  brandVoice?: string;
  language?: string;
  price?: string;
  tone?: string;
  /** How many video clips to write prompts for. */
  beatCount: number;
  /** How long each clip runs, so pacing advice is accurate. */
  clipSeconds: number;
  avatarDescription?: string;
};

export async function writeContentScript(
  options: ScriptOptions,
): Promise<ContentScript> {
  try {
    const { data } = await complete<ScriptResponse>({
      system: [
        "You are a short-form video director and performance copywriter for a commerce brand.",
        "You know the only three things that decide whether a reel works: the first 3 seconds decide the watch rate,",
        "a visual change every few seconds keeps people watching, and the last beat decides whether it is saved or shared.",
        "You never invent prices, discounts, materials, certifications or claims you were not given.",
        "You never describe the product's own appearance in an image or video prompt — the product comes from the seller's real photograph and must never be redesigned.",
        "Return only the structured output requested.",
      ].join(" "),
      prompt: buildPrompt(options),
      schema: SCHEMA,
      maxTokens: 3000,
    });

    return normalise(data, options, false);
  } catch (error) {
    console.warn(
      `[script] No AI provider available (${(error as Error).message}). Using a template shot list.`,
    );
    return templateScript(options);
  }
}

function buildPrompt(options: ScriptOptions): string {
  const product = options.product;
  const label = productLabel(product, options.brandName);
  const totalSeconds = options.beatCount * options.clipSeconds;

  const languageLine: Record<string, string> = {
    en: "Write all on-screen text in simple English.",
    hi: "Write all on-screen text in Hindi, Devanagari script.",
    gu: "Write all on-screen text in Gujarati script.",
    hinglish: "Write on-screen text in Hinglish — Hindi in Latin script mixed with English.",
  };

  return [
    `Direct a ${totalSeconds}-second Instagram Reel and one matching feed image for this product.`,
    `The reel is made of exactly ${options.beatCount} clips, each about ${options.clipSeconds} seconds. Write one beat per clip.`,
    "",
    languageLine[options.language ?? "en"] ?? languageLine.en,
    options.tone ? `Tone: ${options.tone}` : "",
    options.brandName ? `Brand: ${options.brandName}` : "",
    options.brandVoice ? `Brand voice: ${options.brandVoice}` : "",
    options.avatarDescription
      ? `A brand model appears in the reel: ${options.avatarDescription}`
      : "",
    "",
    "PRODUCT — the only facts you may state:",
    `• ${label}${product.category ? ` (${product.category}${product.subCategory ? ` → ${product.subCategory}` : ""})` : ""}`,
    product.materials?.length ? `• Material: ${product.materials.join(", ")}` : "",
    product.colors?.length ? `• Colour: ${product.colors.join(", ")}` : "",
    product.style ? `• Style: ${product.style}` : "",
    product.occasions?.length ? `• Occasion: ${product.occasions.join(", ")}` : "",
    product.sellingPoints?.length ? `• Why people buy it: ${product.sellingPoints.join("; ")}` : "",
    product.emotionalHooks?.length ? `• What the buyer feels: ${product.emotionalHooks.join("; ")}` : "",
    options.price ? `• Price: ${options.price}` : "",
    `• Audience: ${product.targetAudience || `${product.targetGender} ${product.targetAgeRange}`}`,
    "",
    options.trends.keywords.length
      ? `PEOPLE ARE SEARCHING FOR (work these in naturally):\n${options.trends.keywords.slice(0, 10).join(", ")}`
      : "",
    options.trends.risingTopics?.length
      ? `TRENDING TODAY (use only if it honestly fits): ${options.trends.risingTopics.join(", ")}`
      : "",
    "",
    "Rules for the beats:",
    "- Beat 1 must be the hook. It has to stop the scroll on its own.",
    "- The last beat must be the call to action.",
    "- Each prompt describes MOVEMENT and CAMERA only, never the product's appearance.",
    "- On-screen text is at most 6 words, and most beats are stronger with none at all.",
  ]
    .filter(Boolean)
    .join("\n");
}

const PURPOSES = ["hook", "reveal", "detail", "lifestyle", "benefit", "cta"];

function normalise(
  raw: ScriptResponse,
  options: ScriptOptions,
  fromTemplate: boolean,
): ContentScript {
  const beats = (Array.isArray(raw.beats) ? raw.beats : [])
    .slice(0, options.beatCount)
    .map((beat, index) => ({
      index,
      purpose: PURPOSES.includes(beat.purpose) ? beat.purpose : "detail",
      prompt: String(beat.prompt ?? "").trim().slice(0, 900),
      onScreenText: String(beat.onScreenText ?? "")
        .trim()
        .split(/\s+/)
        .slice(0, 6)
        .join(" "),
    }))
    .filter((beat) => beat.prompt.length > 0);

  // The model occasionally returns fewer beats than asked for. Pad rather than
  // ship a short reel.
  while (beats.length < options.beatCount) {
    const template = templateBeats(options);
    beats.push({ ...template[beats.length % template.length], index: beats.length });
  }

  if (beats.length > 0) {
    beats[0].purpose = "hook";
    beats[beats.length - 1].purpose = "cta";
  }

  return {
    concept: String(raw.concept ?? "").trim() || `${productLabel(options.product, options.brandName)} reel`,
    imagePrompt: String(raw.imagePrompt ?? "").trim() || templateImagePrompt(options),
    beats,
    storyText: String(raw.storyText ?? "").trim(),
    coverText: String(raw.coverText ?? "")
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .join(" "),
    musicMood: String(raw.musicMood ?? "upbeat"),
    fromTemplate,
  };
}

/* ------------------------------------------------------------------ *
 *  Templates — used when no AI provider answers
 * ------------------------------------------------------------------ */

function templateImagePrompt(options: ScriptOptions): string {
  return [
    "A premium marketing photograph of this exact product, placed on a clean neutral surface",
    "with soft directional daylight and a gentle shadow.",
    "Minimal styling, shallow depth of field, shot on an 85mm lens.",
    "Keep the product exactly as it appears in the reference photograph.",
    "No text, no logos, no watermarks.",
  ].join(" ");
}

function templateBeats(options: ScriptOptions): VideoBeat[] {
  const label = productLabel(options.product, options.brandName);

  return [
    {
      index: 0,
      purpose: "hook",
      prompt:
        "Slow push in towards the product from slightly above, soft light sweeping across it as it comes into focus.",
      onScreenText: label.split(/\s+/).slice(0, 4).join(" "),
    },
    {
      index: 1,
      purpose: "reveal",
      prompt:
        "The product rotates slowly on its surface, the camera holding steady as light travels across the detail.",
      onScreenText: "",
    },
    {
      index: 2,
      purpose: "detail",
      prompt:
        "Very close macro pass across the surface of the product, shallow focus, light catching the texture.",
      onScreenText: "",
    },
    {
      index: 3,
      purpose: "cta",
      prompt:
        "Slow pull back to a clean hero framing of the product, the shot settling and holding still.",
      onScreenText: "Link in bio",
    },
  ];
}

function templateScript(options: ScriptOptions): ContentScript {
  const beats = templateBeats(options);
  const label = productLabel(options.product, options.brandName);

  return normalise(
    {
      concept: `${label} — a clean product showcase`,
      imagePrompt: templateImagePrompt(options),
      coverText: label.split(/\s+/).slice(0, 4).join(" "),
      storyText: `${label} — tap to see more`,
      musicMood: "upbeat",
      beats: Array.from({ length: options.beatCount }, (_, index) => {
        const beat = beats[index % beats.length];
        return {
          purpose: beat.purpose,
          prompt: beat.prompt,
          onScreenText: beat.onScreenText,
        };
      }),
    },
    options,
    true,
  );
}
