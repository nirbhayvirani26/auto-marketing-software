import { complete } from "./ai/index";

export { AiError, allProviders, providerStatus, ollamaPing } from "./ai/index";
export type { AiProvider, ProviderKey } from "./ai/index";

/* ------------------------------------------------------------------ *
 *  Social post generation
 * ------------------------------------------------------------------ */

export type GenerateInput = {
  topic: string;
  platform: "facebook" | "instagram";
  tone?: string;
  brandVoice?: string;
  targetAudience?: string;
  keywords?: string[];
  callToAction?: string;
  variants?: number;
  /** Product hoy to caption ema thi banse. */
  product?: {
    title: string;
    description?: string;
    price?: number;
    currency?: string;
    url: string;
    brand?: string;
  };
};

export type GeneratedPost = {
  caption: string;
  hashtags: string[];
  imagePrompt: string;
};

const POSTS_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          caption: {
            type: "string",
            description: "The post body text, ready to publish. No hashtags inside.",
          },
          hashtags: {
            type: "array",
            items: { type: "string" },
            description: "Hashtags without the leading # character.",
          },
          imagePrompt: {
            type: "string",
            description:
              "A detailed prompt for an image generator describing a photo that suits this post. Describe subject, setting, lighting and mood. No text overlays.",
          },
        },
        required: ["caption", "hashtags", "imagePrompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts"],
  additionalProperties: false,
};

const PLATFORM_RULES: Record<GenerateInput["platform"], string> = {
  facebook:
    "Facebook: 2-4 short paragraphs are fine. Conversational, can include a question to drive comments. 3-6 hashtags.",
  instagram:
    "Instagram: hook in the first line (it is the only line shown before 'more'), then short punchy lines. Emojis are welcome but not excessive. 8-15 hashtags.",
};

export async function generatePosts(
  input: GenerateInput,
): Promise<GeneratedPost[]> {
  const variants = Math.min(Math.max(input.variants ?? 1, 1), 5);

  const system = [
    "You are a senior social media marketer who writes high-performing organic posts.",
    "Write copy that sounds human — no corporate filler, no 'In today's fast-paced world', no em-dash-heavy AI cadence.",
    "Never invent statistics, prices, dates, or product claims that were not given to you.",
    "Return only the structured output requested.",
  ].join(" ");

  const productBlock = input.product
    ? [
        "",
        "You are promoting this specific product. Use only these facts:",
        `Product: ${input.product.title}`,
        input.product.brand ? `Brand: ${input.product.brand}` : "",
        input.product.price
          ? `Price: ${input.product.currency ?? ""} ${input.product.price}`
          : "",
        input.product.description
          ? `Details: ${input.product.description.slice(0, 900)}`
          : "",
        "",
        "Do not state a price, discount, or shipping claim that is not listed above.",
        "End the caption with a call to action pointing to the link in bio / link below.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const prompt = [
    `Write ${variants} distinct ${input.platform} post${variants > 1 ? "s" : ""}.`,
    "",
    input.product ? "" : `Topic: ${input.topic}`,
    productBlock,
    input.brandVoice ? `Brand voice: ${input.brandVoice}` : "",
    input.tone ? `Tone: ${input.tone}` : "",
    input.targetAudience ? `Target audience: ${input.targetAudience}` : "",
    input.keywords?.length ? `Keywords to work in: ${input.keywords.join(", ")}` : "",
    input.callToAction ? `Call to action: ${input.callToAction}` : "",
    "",
    `Platform guidance — ${PLATFORM_RULES[input.platform]}`,
    "",
    variants > 1
      ? "Each variant should take a genuinely different angle, not a reworded version of the same one."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await complete<{ posts: GeneratedPost[] }>({
    system,
    prompt,
    schema: POSTS_SCHEMA,
    maxTokens: 4000,
  });

  if (!Array.isArray(data.posts) || data.posts.length === 0) {
    throw new Error("AI response ma koi post madyo nahi.");
  }

  return data.posts.map((post) => ({
    caption: post.caption.trim(),
    hashtags: (post.hashtags ?? [])
      .map((tag) => tag.replace(/^#/, "").trim())
      .filter(Boolean),
    imagePrompt: post.imagePrompt?.trim() ?? "",
  }));
}

/* ------------------------------------------------------------------ *
 *  Comment reply / DM
 * ------------------------------------------------------------------ */

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    publicReply: {
      type: "string",
      description:
        "Short public reply to post under the comment. One or two sentences, no hashtags.",
    },
    dm: {
      type: "string",
      description:
        "Direct message to send privately to the commenter. Friendly and specific, no hashtags.",
    },
  },
  required: ["publicReply", "dm"],
  additionalProperties: false,
};

export async function generateCommentReply(input: {
  comment: string;
  username?: string;
  platform: "facebook" | "instagram";
  instruction?: string;
  needsPublicReply: boolean;
  needsDm: boolean;
  /** DM ma aa product ni link jashe — AI ne khabar hovi joiye. */
  product?: { title: string; price?: number; currency?: string; url: string };
}): Promise<{ publicReply: string; dm: string }> {
  const system = [
    "You reply to comments on a brand's social media posts.",
    "Write like a real person on the brand's social team — warm, brief, specific to what the commenter actually said.",
    "Never invent prices, stock levels, delivery dates, or policies you were not told.",
    "If the comment is hostile or a complaint, stay calm, do not argue, and offer to help privately.",
    "No hashtags. No emoji spam. Do not repeat the commenter's words back verbatim.",
  ].join(" ");

  const prompt = [
    `Platform: ${input.platform}`,
    input.username ? `Commenter: ${input.username}` : "",
    `Comment: "${input.comment}"`,
    "",
    input.product
      ? [
          "The DM will promote this product. Use only these facts:",
          `Product: ${input.product.title}`,
          input.product.price
            ? `Price: ${input.product.currency ?? ""} ${input.product.price}`
            : "",
          "The product link is appended automatically after your text — do not write the URL yourself.",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    input.instruction ? `Brand instruction: ${input.instruction}` : "",
    "",
    input.needsPublicReply
      ? "Write a short public reply."
      : "The public reply will not be used — return an empty string for it.",
    input.needsDm
      ? "Write a direct message to send this person privately."
      : "The DM will not be used — return an empty string for it.",
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await complete<{ publicReply: string; dm: string }>({
    system,
    prompt,
    schema: REPLY_SCHEMA,
    maxTokens: 1000,
  });

  return {
    publicReply: (data.publicReply ?? "").trim(),
    dm: (data.dm ?? "").trim(),
  };
}
