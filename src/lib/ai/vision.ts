/**
 * Vision — this is what makes "I will just upload a photo" possible.
 *
 * One or more product images go in, and a complete marketing brief comes out:
 * what the product is, what it is made of, who it is for, which keywords it
 * can rank on, and what kind of reel would sell it.
 *
 * Four providers in a chain, so one hitting its free limit does not stop the
 * work:  gemini (free) → groq (free) → openrouter (free) → anthropic (paid)
 *
 * If every provider is unavailable and the seller supplied a description, that
 * description is used instead. The brief is thinner, but the reel still ships.
 */

import sharp from "sharp";

import { runChain, apiFetch, FatalError, type ChainResult } from "@/lib/pipeline/chain";
import { parseJsonLoose } from "./openai-compat";

export type VisionImage = {
  /** Raw bytes, in whatever format they arrived. */
  data: Buffer;
  mimeType: string;
};

export type ProductIntelligence = {
  /** A sellable name for the product. */
  productName: string;
  category: string;
  subCategory: string;
  /** If it is apparel, an avatar can be shown wearing it. */
  isApparel: boolean;
  apparelType: string;

  colors: string[];
  materials: string[];
  patterns: string[];
  style: string;
  occasions: string[];
  seasons: string[];

  targetGender: "women" | "men" | "unisex" | "kids" | "unknown";
  targetAgeRange: string;
  targetAudience: string;

  keyFeatures: string[];
  sellingPoints: string[];
  /** What the buyer feels — the raw material for a hook. */
  emotionalHooks: string[];
  objections: string[];

  suggestedPriceBand: string;
  positioning: string;

  /** What is literally visible, handed to the image generator. */
  visualDescription: string;
  /** Scene ideas for the reel. */
  sceneSuggestions: string[];

  /** The words people actually search for — the basis of the SEO. */
  searchKeywords: string[];
  seedHashtags: string[];

  /** How good the photo is, so a poor one can be flagged. */
  imageQuality: {
    score: number;
    issues: string[];
  };

  confidence: number;
  language: string;

  /**
   * True when no vision provider was reachable and this brief was assembled
   * without ever looking at the photo.
   *
   * Downstream steps must treat it as "we do not know what this product is".
   * Guessing from whatever string happens to be available produces confidently
   * wrong output — a brand name run through Google Autocomplete once yielded
   * "#mycompanyisnotgivingmysalary" — which is far worse than saying less.
   */
  degraded?: boolean;
};

const VISION_SCHEMA = {
  type: "object",
  properties: {
    productName: { type: "string", description: "Short sellable product name, 2-6 words." },
    category: { type: "string", description: "Broad category e.g. Apparel, Footwear, Jewellery, Home Decor, Electronics, Beauty." },
    subCategory: { type: "string", description: "Specific type e.g. Anarkali kurti, running shoes, hoop earrings." },
    isApparel: { type: "boolean", description: "True if this is clothing/footwear/accessory a person wears." },
    apparelType: { type: "string", description: "If apparel: top, dress, saree, kurti, jeans, jacket, shoes, bag, watch. Else empty string." },

    colors: { type: "array", items: { type: "string" }, description: "Dominant colours, plain words." },
    materials: { type: "array", items: { type: "string" }, description: "Visible materials/fabrics. Only what you can actually see." },
    patterns: { type: "array", items: { type: "string" }, description: "Prints or patterns, e.g. floral, solid, striped, embroidered." },
    style: { type: "string", description: "Aesthetic in a few words, e.g. minimal streetwear, festive ethnic, boho casual." },
    occasions: { type: "array", items: { type: "string" }, description: "Where someone would use/wear it." },
    seasons: { type: "array", items: { type: "string" } },

    targetGender: { type: "string", enum: ["women", "men", "unisex", "kids", "unknown"] },
    targetAgeRange: { type: "string", description: "e.g. 18-28" },
    targetAudience: { type: "string", description: "One sentence describing the ideal buyer." },

    keyFeatures: { type: "array", items: { type: "string" }, description: "Concrete visible features. No invented specs." },
    sellingPoints: { type: "array", items: { type: "string" }, description: "Why someone buys this, benefit-first." },
    emotionalHooks: { type: "array", items: { type: "string" }, description: "Feelings/desires to open a reel with." },
    objections: { type: "array", items: { type: "string" }, description: "Doubts a buyer may have, to answer in the caption." },

    suggestedPriceBand: { type: "string", description: "Rough perceived price band with currency guess, clearly a guess." },
    positioning: { type: "string", description: "budget / mid-market / premium / luxury, plus one line why." },

    visualDescription: { type: "string", description: "Detailed factual description of what is in the image: subject, framing, background, lighting, colours. Used to regenerate similar images." },
    sceneSuggestions: { type: "array", items: { type: "string" }, description: "5 short reel scene ideas that would sell this product." },

    searchKeywords: { type: "array", items: { type: "string" }, description: "15 phrases real people type when searching for this on Instagram/Google." },
    seedHashtags: { type: "array", items: { type: "string" }, description: "20 relevant hashtags without the # symbol, mixing broad and niche." },

    imageQuality: {
      type: "object",
      properties: {
        score: { type: "number", description: "0-10 how usable this is as a marketing image." },
        issues: { type: "array", items: { type: "string" }, description: "Problems e.g. blurry, cluttered background, bad lighting, watermark." },
      },
      required: ["score", "issues"],
    },

    confidence: { type: "number", description: "0-1 how confident you are overall." },
    language: { type: "string", description: "Best language for the audience: en, hi, gu, hinglish." },
  },
  required: [
    "productName", "category", "subCategory", "isApparel", "apparelType",
    "colors", "materials", "patterns", "style", "occasions", "seasons",
    "targetGender", "targetAgeRange", "targetAudience",
    "keyFeatures", "sellingPoints", "emotionalHooks", "objections",
    "suggestedPriceBand", "positioning",
    "visualDescription", "sceneSuggestions",
    "searchKeywords", "seedHashtags", "imageQuality", "confidence", "language",
  ],
} as const;

const SYSTEM = [
  "You are a product analyst for a social commerce brand.",
  "You look at product photos and produce the marketing brief a strategist would write.",
  "Describe ONLY what is visibly in the image. Never invent specs, certifications, prices, fabric counts or brand names that are not visible.",
  "If something is not visible, say so or leave it out rather than guessing confidently.",
  "Keywords and hashtags must be what real buyers type, not marketing jargon.",
  "Return only the structured JSON requested.",
].join(" ");

function userPrompt(opts: {
  imageCount: number;
  hint?: string;
  market?: string;
}): string {
  return [
    opts.imageCount > 1
      ? `You are shown ${opts.imageCount} photos. They may be the SAME product from different angles, or DIFFERENT products from one collection. Decide which, and describe the collection as a whole if they differ — use productName for the collection name in that case.`
      : "You are shown one product photo.",
    "",
    "Produce the full marketing brief.",
    opts.market ? `Primary market: ${opts.market}. Tune keywords, price band and occasions to that market.` : "",
    opts.hint ? `The seller adds this context (trust it over your guess): ${opts.hint}` : "",
    "",
    "For searchKeywords, think about what someone types into the Instagram search bar or Google when they want to BUY this — include the category, the style, the occasion and long-tail phrases.",
    "For seedHashtags, mix: 4 huge (millions of posts), 8 medium (100k-1M), 8 niche (under 100k). Niche tags are where a small account actually ranks.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ *
 *  Image taiyar karvi — nani ane sasti
 * ------------------------------------------------------------------ */

/**
 * Vision model ne 4000px ni image ni jarur nathi — 1024px puratu che ane
 * token/bandwidth ghano bache che. Sathe HEIC/WebP jeva format ne JPEG ma
 * badli daiye jethi badha providers samje.
 */
export async function prepareForVision(
  image: VisionImage,
  maxSide = 1024,
): Promise<{ base64: string; mimeType: string }> {
  try {
    const data = await sharp(image.data)
      .rotate() // EXIF pramane sidhu karo
      .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { base64: data.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    // sharp na samje evu format hoy to jem che em moklo.
    return { base64: image.data.toString("base64"), mimeType: image.mimeType };
  }
}

/* ------------------------------------------------------------------ *
 *  Providers
 * ------------------------------------------------------------------ */

type PreparedImage = { base64: string; mimeType: string };

/** Ek j vision request nu varnan — koi pan kaam mate. */
export type VisionRequest = {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
};

function geminiSchema(schema: unknown): unknown {
  // Gemini `additionalProperties` / `$schema` na samje.
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "additionalProperties" || key === "$schema") continue;
      out[key] = geminiSchema(value);
    }
    return out;
  }
  return schema;
}

async function askGemini<T>(
  images: PreparedImage[],
  request: VisionRequest,
  signal: AbortSignal,
): Promise<T> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  // `-latest` alias ne free tier sauthi vadhu key par male che.
  const model = process.env.GEMINI_VISION_MODEL || "gemini-flash-latest";

  const json = await apiFetch<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [
          {
            role: "user",
            parts: [
              ...images.map((img) => ({
                inlineData: { mimeType: img.mimeType, data: img.base64 },
              })),
              { text: request.prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: geminiSchema(request.schema),
          // Thinking tokens mate jagya — jovo gemini.ts ni note.
          maxOutputTokens: Math.max(request.maxTokens ?? 8000, 512) + 2048,
          temperature: 0.4,
        },
      }),
    },
  );

  const candidate = json.candidates?.[0];
  if (candidate?.finishReason === "SAFETY") {
    throw new FatalError("Gemini e aa image par kaam karvani na paadi.");
  }
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini e khali jawab aapyo");

  return parseJsonLoose<T>(text, "gemini", "Gemini Vision");
}

async function askOpenAiCompatVision<T>(
  opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    label: string;
    providerKey: "groq" | "openrouter";
    extraHeaders?: Record<string, string>;
  },
  images: PreparedImage[],
  request: VisionRequest,
  signal: AbortSignal,
): Promise<T> {
  const json = await apiFetch<{
    choices?: Array<{ message?: { content?: string } }>;
  }>(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
      ...(opts.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        {
          role: "system",
          content: `${request.system}\n\nReply with ONLY a JSON object matching this schema (no markdown fence):\n${JSON.stringify(request.schema)}`,
        },
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
            })),
            { type: "text", text: request.prompt },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: request.maxTokens ?? 8000,
      temperature: 0.4,
    }),
  });

  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error(`${opts.label} e khali jawab aapyo`);

  return parseJsonLoose<T>(text, opts.providerKey, opts.label);
}

async function askAnthropic<T>(
  images: PreparedImage[],
  request: VisionRequest,
  signal: AbortSignal,
): Promise<T> {
  const json = await apiFetch<{
    content?: Array<{ type: string; text?: string; input?: unknown; name?: string }>;
  }>("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: request.maxTokens ?? 8000,
      system: request.system,
      tools: [
        {
          name: "structured_result",
          description: "Return the structured result.",
          input_schema: request.schema,
        },
      ],
      tool_choice: { type: "tool", name: "structured_result" },
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image",
              source: { type: "base64", media_type: img.mimeType, data: img.base64 },
            })),
            { type: "text", text: request.prompt },
          ],
        },
      ],
    }),
  });

  const toolUse = json.content?.find((block) => block.type === "tool_use");
  if (!toolUse?.input) throw new Error("Claude e structured jawab na aapyo");
  return toolUse.input as T;
}

/* ------------------------------------------------------------------ *
 *  Generic vision call — koi pan image + koi pan schema
 * ------------------------------------------------------------------ */

/**
 * Vision providers ni chain — koi pan kaam mate. Product analysis, reference
 * reel na frames, image ni gunvatta — badhu aa j thi chale che.
 */
export async function askVision<T>(
  images: VisionImage[],
  request: VisionRequest,
  options: { prefer?: string; maxImages?: number } = {},
): Promise<ChainResult<T>> {
  if (images.length === 0) throw new Error("No image was found");

  const prepared = await Promise.all(
    images.slice(0, options.maxImages ?? 6).map((img) => prepareForVision(img)),
  );

  return runChain<T>(
    [
      {
        name: "gemini",
        label: "Gemini Vision (free)",
        free: true,
        configured: () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        run: (signal) => askGemini<T>(prepared, request, signal),
        timeoutMs: 120_000,
      },
      {
        name: "groq",
        label: "Groq Vision (free)",
        free: true,
        configured: () => Boolean(process.env.GROQ_API_KEY),
        run: (signal) =>
          askOpenAiCompatVision<T>(
            {
              baseUrl: "https://api.groq.com/openai/v1",
              apiKey: process.env.GROQ_API_KEY || "",
              model: process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
              label: "Groq Vision",
              providerKey: "groq",
            },
            prepared,
            request,
            signal,
          ),
        timeoutMs: 90_000,
      },
      {
        name: "openrouter",
        label: "OpenRouter Vision (free)",
        free: true,
        configured: () => Boolean(process.env.OPENROUTER_API_KEY),
        run: (signal) =>
          askOpenAiCompatVision<T>(
            {
              baseUrl: "https://openrouter.ai/api/v1",
              apiKey: process.env.OPENROUTER_API_KEY || "",
              model:
                process.env.OPENROUTER_VISION_MODEL ||
                "meta-llama/llama-3.2-11b-vision-instruct:free",
              label: "OpenRouter Vision",
              providerKey: "openrouter",
              extraHeaders: {
                "http-referer": process.env.APP_URL || "http://localhost:3000",
                "x-title": "Auto Marketing Software",
              },
            },
            prepared,
            request,
            signal,
          ),
        timeoutMs: 120_000,
      },
      {
        name: "anthropic",
        label: "Claude Vision",
        free: false,
        configured: () => Boolean(process.env.ANTHROPIC_API_KEY),
        run: (signal) => askAnthropic<T>(prepared, request, signal),
        timeoutMs: 120_000,
      },
    ],
    {
      label: "Vision",
      prefer: options.prefer ?? process.env.VISION_PROVIDER,
      retries: 1,
      backoffMs: 1500,
    },
  );
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

export type AnalyzeOptions = {
  /** Anything the seller wrote — trusted over the model's own guess. */
  hint?: string;
  /** "India", "US" — tunes keywords, price band and occasions. */
  market?: string;
  prefer?: string;
  /**
   * A name to fall back on if no vision provider is reachable and the seller
   * gave no description. The brand name works well here.
   */
  fallbackName?: string;
};

export async function analyzeProductImages(
  images: VisionImage[],
  options: AnalyzeOptions = {},
): Promise<ChainResult<ProductIntelligence>> {
  if (images.length === 0) throw new Error("No image was found");

  // Ghani image hoy to pan 6 thi vadhare vision ne moklvi nathi — kharch ane
  // limit banne vadhi jaay che, ane 6 ma badhu samjai jaay che.
  const used = images.slice(0, 6);

  const started = Date.now();

  try {
    const result = await askVision<Partial<ProductIntelligence>>(
      used,
      {
        system: SYSTEM,
        prompt: userPrompt({
          imageCount: used.length,
          hint: options.hint,
          market: options.market || process.env.DEFAULT_MARKET || "India",
        }),
        schema: VISION_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 8000,
      },
      { prefer: options.prefer, maxImages: 6 },
    );

    return { ...result, data: normalise(result.data) };
  } catch (error) {
    // No vision provider is reachable — out of credit, no key, or an outage.
    //
    // Abandoning the reel here would be the wrong call. The photos the seller
    // uploaded ARE the product, and ffmpeg can still build a real reel out of
    // them. So the run continues on a deliberately thin brief: whatever the
    // seller typed, and nothing else. Nothing is guessed or invented — the
    // caption simply says less.
    const hint = options.hint?.trim();

    console.warn(
      `[vision] No provider available (${(error as Error).message}). ` +
        (hint
          ? "Falling back to the description you supplied."
          : "Falling back to a minimal brief — add a description for a better result."),
    );

    const brief = normalise(
      hint
        ? {
            productName: hint.slice(0, 80),
            visualDescription: hint,
            searchKeywords: hint
              .toLowerCase()
              .split(/[\s,]+/)
              .filter((word) => word.length >= 3)
              .slice(0, 8),
          }
        : {
            // Deliberately left blank. There is no honest product name here,
            // and a placeholder would be copied into captions and hashtags as
            // though it were real.
            productName: "",
            visualDescription:
              "The seller's own product photograph, used exactly as uploaded.",
          },
    );

    return {
      // A description is something; a photo we could not read is not.
      data: { ...brief, degraded: !hint, confidence: hint ? 0.4 : 0 },
      provider: hint ? "description-only" : "photo-only",
      attempts: [],
      ms: Date.now() - started,
    };
  }
}

/**
 * A brief built from words alone, for when there is no photo to look at — a
 * product link with a name typed in, say.
 *
 * Marked `degraded` when even the name is missing, so downstream steps know
 * not to invent specifics they were never given.
 */
export function briefFromText(options: {
  name?: string;
  notes?: string;
}): ProductIntelligence {
  const name = options.name?.trim();
  const notes = options.notes?.trim();
  const text = [name, notes].filter(Boolean).join(". ");

  return {
    ...normalise({
      productName: name ?? "",
      visualDescription: notes ?? "",
      searchKeywords: text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3)
        .slice(0, 10),
    }),
    degraded: !name,
    confidence: name ? 0.4 : 0,
  };
}

/**
 * A name safe to show on screen. Falls back to the brand, then to a neutral
 * word — never into a caption as though it were the product's real name.
 */
export function productLabel(
  product: Pick<ProductIntelligence, "productName" | "subCategory" | "category">,
  brandName?: string,
): string {
  return (
    product.productName?.trim() ||
    product.subCategory?.trim() ||
    brandName?.trim() ||
    "Your product"
  );
}

/**
 * Smaller models sometimes leave a field out, or return a number where a
 * string belongs. Everything is cleaned up here so nothing downstream can
 * ever crash on a malformed response.
 */
function normalise(raw: Partial<ProductIntelligence>): ProductIntelligence {
  const list = (value: unknown, limit = 30): string[] =>
    Array.isArray(value)
      ? value
          .map((v) => String(v).trim())
          .filter(Boolean)
          .slice(0, limit)
      : [];

  const text = (value: unknown, fallback = ""): string =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;

  const gender = text(raw.targetGender, "unknown").toLowerCase();

  return {
    // Left empty when genuinely unknown — see `degraded`. Callers that need a
    // display name use productLabel().
    productName: text(raw.productName),
    category: text(raw.category, "General"),
    subCategory: text(raw.subCategory),
    isApparel: Boolean(raw.isApparel),
    apparelType: text(raw.apparelType),

    colors: list(raw.colors, 8),
    materials: list(raw.materials, 8),
    patterns: list(raw.patterns, 8),
    style: text(raw.style),
    occasions: list(raw.occasions, 8),
    seasons: list(raw.seasons, 4),

    targetGender: (["women", "men", "unisex", "kids"].includes(gender)
      ? gender
      : "unknown") as ProductIntelligence["targetGender"],
    targetAgeRange: text(raw.targetAgeRange, "18-35"),
    targetAudience: text(raw.targetAudience),

    keyFeatures: list(raw.keyFeatures, 10),
    sellingPoints: list(raw.sellingPoints, 10),
    emotionalHooks: list(raw.emotionalHooks, 10),
    objections: list(raw.objections, 6),

    suggestedPriceBand: text(raw.suggestedPriceBand),
    positioning: text(raw.positioning, "mid-market"),

    visualDescription: text(raw.visualDescription),
    sceneSuggestions: list(raw.sceneSuggestions, 8),

    searchKeywords: list(raw.searchKeywords, 25),
    seedHashtags: list(raw.seedHashtags, 40).map((tag) =>
      tag.replace(/^#/, "").replace(/\s+/g, ""),
    ),

    imageQuality: {
      score: Number(raw.imageQuality?.score ?? 7) || 7,
      issues: list(raw.imageQuality?.issues, 6),
    },

    confidence: Math.min(1, Math.max(0, Number(raw.confidence ?? 0.7) || 0.7)),
    language: text(raw.language, "en"),
  };
}

/** Setup page mate — kayo vision provider taiyar che. */
export function visionStatus() {
  return [
    {
      key: "gemini",
      label: "Gemini Vision",
      free: true,
      configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      note: "The best free option — aistudio.google.com/apikey",
    },
    {
      key: "groq",
      label: "Groq Vision",
      free: true,
      configured: Boolean(process.env.GROQ_API_KEY),
      note: "Very fast — console.groq.com/keys",
    },
    {
      key: "openrouter",
      label: "OpenRouter Vision",
      free: true,
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      note: "openrouter.ai/keys",
    },
    {
      key: "anthropic",
      label: "Claude Vision",
      free: false,
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      note: "Sauthi sachot, pan paid",
    },
  ];
}
