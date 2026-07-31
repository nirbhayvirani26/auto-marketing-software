import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return client;
}

/**
 * Anthropic SDK na error ne samajay evi bhasha ma badle che — nahi to UI ma
 * raw JSON blob dekhaay che.
 */
function friendlyAiError(error: unknown): Error {
  if (error instanceof Anthropic.APIError) {
    const message = String(
      (error.error as { error?: { message?: string } })?.error?.message ??
        error.message,
    );

    if (/credit balance is too low/i.test(message)) {
      return new Error(
        "Anthropic account ma credit khutya che. console.anthropic.com → Plans & Billing par credit add karo.",
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return new Error(
        "ANTHROPIC_API_KEY khoto ke expire thayelo che. .env ma navo key nakho ane server restart karo.",
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new Error(
        "Anthropic rate limit lagi gayu. Thodi var pachi fari try karo.",
      );
    }
    if (error instanceof Anthropic.NotFoundError) {
      return new Error(
        `Model "${env.anthropicModel}" madyu nahi. .env ma ANTHROPIC_MODEL check karo.`,
      );
    }
    if (error.status && error.status >= 500) {
      return new Error(
        "Anthropic API atyare available nathi. Thodi var pachi try karo.",
      );
    }
    return new Error(`Anthropic API: ${message}`);
  }

  return error instanceof Error ? error : new Error(String(error));
}

export type GenerateInput = {
  topic: string;
  platform: "facebook" | "instagram";
  tone?: string;
  brandVoice?: string;
  targetAudience?: string;
  keywords?: string[];
  callToAction?: string;
  /** Ketla variants joiye (1-5) */
  variants?: number;
};

export type GeneratedPost = {
  caption: string;
  hashtags: string[];
  imagePrompt: string;
};

const RESPONSE_SCHEMA = {
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
            description: "A short prompt describing an image that suits this post.",
          },
        },
        required: ["caption", "hashtags", "imagePrompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts"],
  additionalProperties: false,
} as const;

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

  const userPrompt = [
    `Write ${variants} distinct ${input.platform} post${variants > 1 ? "s" : ""}.`,
    "",
    `Topic: ${input.topic}`,
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

  let response;
  try {
    response = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 4000,
      system,
      output_config: {
        format: { type: "json_schema", schema: RESPONSE_SCHEMA },
      },
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (error) {
    throw friendlyAiError(error);
  }

  if (response.stop_reason === "refusal") {
    throw new Error(
      "AI e aa topic par lakhvani na paadi. Topic badlo ane fari try karo.",
    );
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("AI e koi text response na aapyu.");
  }

  const parsed = JSON.parse(text.text) as { posts: GeneratedPost[] };
  if (!Array.isArray(parsed.posts) || parsed.posts.length === 0) {
    throw new Error("AI response ma koi post madyo nahi.");
  }

  return parsed.posts.map((post) => ({
    caption: post.caption.trim(),
    hashtags: (post.hashtags ?? []).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean),
    imagePrompt: post.imagePrompt?.trim() ?? "",
  }));
}

/* ------------------------------------------------------------------ *
 *  Comment par auto reply / DM
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
} as const;

export async function generateCommentReply(input: {
  comment: string;
  username?: string;
  platform: "facebook" | "instagram";
  instruction?: string;
  needsPublicReply: boolean;
  needsDm: boolean;
}): Promise<{ publicReply: string; dm: string }> {
  const system = [
    "You reply to comments on a brand's social media posts.",
    "Write like a real person on the brand's social team — warm, brief, specific to what the commenter actually said.",
    "Never invent prices, stock levels, delivery dates, or policies you were not told.",
    "If the comment is hostile or a complaint, stay calm, do not argue, and offer to help privately.",
    "No hashtags. No emoji spam. Do not repeat the commenter's words back verbatim.",
  ].join(" ");

  const userPrompt = [
    `Platform: ${input.platform}`,
    input.username ? `Commenter: ${input.username}` : "",
    `Comment: "${input.comment}"`,
    "",
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

  let response;
  try {
    response = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 1000,
      system,
      output_config: {
        format: { type: "json_schema", schema: REPLY_SCHEMA },
      },
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (error) {
    throw friendlyAiError(error);
  }

  if (response.stop_reason === "refusal") {
    throw new Error("AI e aa comment no jawab aapvani na paadi.");
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("AI e koi reply na aapyu.");
  }

  const parsed = JSON.parse(text.text) as { publicReply: string; dm: string };
  return {
    publicReply: (parsed.publicReply ?? "").trim(),
    dm: (parsed.dm ?? "").trim(),
  };
}
