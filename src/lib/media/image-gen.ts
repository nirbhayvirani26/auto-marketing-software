/**
 * Image generation ane image EDITING.
 *
 * Be alag kaam che, ane bije kaam j "mari avatar mara kapda pehri ne" ne
 * shakya banave che:
 *
 *   generateImage()  — sadho prompt → navi image (background, lifestyle shot)
 *   composeImage()   — reference image + prompt → navi image
 *                      (avatar no chehro + product na kapda ek j frame ma)
 *   virtualTryOn()   — khaas try-on model — kapdu vyaktine pehravi de che
 *
 * Providers:
 *   openai        — ChatGPT nu gpt-image-1. Sauthi saru — product ni vigat ane
 *                   chehro barabar sachve che, ane image par lakhelu text pan
 *                   saachu aave che. Paid. `IMAGE_PROVIDER=openai` thi pehla.
 *   gemini-image  — Gemini 2.5 Flash Image. FREE tier. Reference image
 *                   samje che ane chehro sachve che.
 *   pollinations  — koi key nahi. Fakt text→image (reference nahi samje).
 *   replicate     — optional, paid pan sasto. Khaas try-on model (IDM-VTON)
 *                   sauthi saacho result aape che.
 *
 * Kram runChain nakki kare che: default ma free pehla, pan `IMAGE_PROVIDER`
 * ma je lakhyu hoy e sauthi mokhare aave che. Ek fail thay to biju chale che.
 */

import sharp from "sharp";

import { runChain, apiFetch, FatalError, type ChainResult } from "@/lib/pipeline/chain";

export type GeneratedImage = {
  data: Buffer;
  mimeType: string;
  provider: string;
  prompt: string;
};

export type ReferenceImage = {
  data: Buffer;
  mimeType: string;
  /** AI ne kahevu ke aa reference su che. */
  role: "person" | "garment" | "product" | "style" | "background";
};

export type AspectRatio = "1:1" | "9:16" | "16:9" | "4:5" | "3:4";

const DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "3:4": { width: 1080, height: 1440 },
};

/* ------------------------------------------------------------------ *
 *  Gemini 2.5 Flash Image
 * ------------------------------------------------------------------ */

function geminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

const GEMINI_IMAGE_MODELS = [
  process.env.GEMINI_IMAGE_MODEL,
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-preview-image-generation",
].filter(Boolean) as string[];

async function geminiImage(
  opts: {
    prompt: string;
    references: ReferenceImage[];
    aspectRatio: AspectRatio;
  },
  signal: AbortSignal,
): Promise<GeneratedImage> {
  const key = geminiKey();
  const errors: string[] = [];

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      const parts: unknown[] = [];

      // Reference images pehla, ane dareak ne "aa su che" nu label.
      for (const ref of opts.references) {
        const prepared = await shrink(ref.data, 1024);
        parts.push({ text: labelFor(ref.role) });
        parts.push({
          inline_data: { mime_type: "image/jpeg", data: prepared.toString("base64") },
        });
      }
      parts.push({ text: opts.prompt });

      const json = await apiFetch<{
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> };
          finishReason?: string;
        }>;
        promptFeedback?: { blockReason?: string };
      }>(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseModalities: ["IMAGE"],
              imageConfig: { aspectRatio: opts.aspectRatio },
            },
          }),
        },
      );

      if (json.promptFeedback?.blockReason) {
        throw new FatalError(`Gemini e prompt block karyu: ${json.promptFeedback.blockReason}`);
      }

      const partsOut = json.candidates?.[0]?.content?.parts ?? [];
      for (const part of partsOut) {
        const inline = part.inlineData ?? part.inline_data;
        const base64 = inline?.data;
        if (base64) {
          return {
            data: Buffer.from(base64, "base64"),
            mimeType: (inline as { mimeType?: string; mime_type?: string }).mimeType ??
              (inline as { mime_type?: string }).mime_type ??
              "image/png",
            provider: `gemini:${model}`,
            prompt: opts.prompt,
          };
        }
      }

      throw new Error("Gemini e image na aapi");
    } catch (error) {
      errors.push(`${model}: ${(error as Error).message}`);
      // Aa model na chalyo — bija model par jaao.
    }
  }

  throw new Error(errors.join(" | ") || "Gemini image fail");
}

function labelFor(role: ReferenceImage["role"]): string {
  switch (role) {
    case "person":
      return "REFERENCE IMAGE — THE PERSON. Keep this exact face, skin tone, hair and body type. Do not change their identity.";
    case "garment":
      return "REFERENCE IMAGE — THE GARMENT. Keep this exact fabric, colour, print, neckline, sleeves and length.";
    case "product":
      return "REFERENCE IMAGE — THE PRODUCT. Keep this exact shape, colour, material and details.";
    case "style":
      return "REFERENCE IMAGE — STYLE ONLY. Copy the lighting, camera angle, colour grade and composition. Do not copy the subject.";
    case "background":
      return "REFERENCE IMAGE — BACKGROUND / SETTING to place the subject into.";
  }
}

/* ------------------------------------------------------------------ *
 *  OpenAI gpt-image-1 (ChatGPT ni image API)
 * ------------------------------------------------------------------ */

function openaiKey(): string {
  return process.env.OPENAI_API_KEY || "";
}

function openaiBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

/**
 * gpt-image-1 fakt traan maap aape che. Reel ubhu (9:16) joiye che, etle
 * ubha aakar mate 1024x1536 magie chie ane pachi fitToAspect() ene barabar
 * 1080x1920 ma kaapi aape che.
 */
const OPENAI_SIZES: Record<AspectRatio, string> = {
  "1:1": "1024x1024",
  "9:16": "1024x1536",
  "4:5": "1024x1536",
  "3:4": "1024x1536",
  "16:9": "1536x1024",
};

function openaiModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
}

function openaiQuality(): string {
  return process.env.OPENAI_IMAGE_QUALITY || "high";
}

type OpenAiImageResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string; code?: string };
};

/**
 * Be alag endpoint che ane e j aakho fer paade che:
 *
 *   reference vagar → /images/generations  (sadho prompt → navi image)
 *   reference sathe → /images/edits        (16 sudhi image reference tarike)
 *
 * `edits` j aapno mukhya rasto che — product ni asli photo ane avatar no
 * chehro reference tarike aapiye chie, etle AI product ne badli nathi sakto.
 * `input_fidelity: high` ena mate j che.
 */
async function openaiImage(
  opts: {
    prompt: string;
    references: ReferenceImage[];
    aspectRatio: AspectRatio;
  },
  signal: AbortSignal,
): Promise<GeneratedImage> {
  const key = openaiKey();
  if (!key) throw new FatalError("OPENAI_API_KEY set nathi");

  const model = openaiModel();
  const size = OPENAI_SIZES[opts.aspectRatio];
  const headers = { authorization: `Bearer ${key}` };

  let json: OpenAiImageResponse;

  if (opts.references.length > 0) {
    // Dareak reference ne "aa su che" nu label prompt ma aapiye chie —
    // gpt-image-1 image no kram ane lakhan banne dhyan ma le che.
    const labelled = [
      ...opts.references.map((ref, index) => `Image ${index + 1}: ${labelFor(ref.role)}`),
      "",
      opts.prompt,
    ].join("\n");

    const form = new FormData();
    form.append("model", model);
    form.append("prompt", labelled.slice(0, 30_000));
    form.append("n", "1");
    form.append("size", size);
    form.append("quality", openaiQuality());
    form.append("input_fidelity", "high");
    form.append("output_format", "jpeg");

    // 16 thi vadhu reference gpt-image-1 letu nathi.
    for (const [index, ref] of opts.references.slice(0, 16).entries()) {
      const prepared = await shrink(ref.data, 1536);
      form.append(
        "image[]",
        new Blob([new Uint8Array(prepared)], { type: "image/jpeg" }),
        `reference-${index}.jpg`,
      );
    }

    json = await apiFetch<OpenAiImageResponse>(`${openaiBaseUrl()}/images/edits`, {
      method: "POST",
      signal,
      headers,
      body: form,
    });
  } else {
    json = await apiFetch<OpenAiImageResponse>(`${openaiBaseUrl()}/images/generations`, {
      method: "POST",
      signal,
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: opts.prompt.slice(0, 30_000),
        n: 1,
        size,
        quality: openaiQuality(),
        output_format: "jpeg",
        // Product photo ma kyarek kapda/body ne moderation adkave che —
        // `low` thi asli marketing image block thata atke che.
        moderation: "low",
      }),
    });
  }

  if (json.error) throw new FatalError(`OpenAI: ${json.error.message ?? json.error.code}`);

  const first = json.data?.[0];

  // gpt-image-1 hamesha base64 aape che; junaa/proxy setup ma URL aavi shake.
  if (first?.b64_json) {
    return {
      data: Buffer.from(first.b64_json, "base64"),
      mimeType: "image/jpeg",
      provider: `openai:${model}`,
      prompt: opts.prompt,
    };
  }
  if (first?.url) {
    return {
      data: await apiFetch<Buffer>(first.url, { expect: "buffer", signal }),
      mimeType: "image/jpeg",
      provider: `openai:${model}`,
      prompt: opts.prompt,
    };
  }

  throw new Error("OpenAI e image na aapi");
}

/* ------------------------------------------------------------------ *
 *  Pollinations — koi key nahi
 * ------------------------------------------------------------------ */

async function pollinationsImage(
  opts: { prompt: string; aspectRatio: AspectRatio; seed?: number },
  signal: AbortSignal,
): Promise<GeneratedImage> {
  const { width, height } = DIMENSIONS[opts.aspectRatio];
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: "true",
    model: process.env.POLLINATIONS_MODEL || "flux",
    seed: String(opts.seed ?? Math.floor(Math.random() * 1_000_000)),
  });

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    opts.prompt.slice(0, 1500),
  )}?${params.toString()}`;

  const token = process.env.POLLINATIONS_TOKEN;
  const data = await apiFetch<Buffer>(url, {
    expect: "buffer",
    signal,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });

  // Kyarek HTML error page aave che — image che ke nahi e khatri karo.
  if (data.length < 5000) throw new Error("Pollinations e kharab jawab aapyo");
  try {
    await sharp(data).metadata();
  } catch {
    throw new Error("Pollinations e image na aapi");
  }

  return { data, mimeType: "image/jpeg", provider: "pollinations", prompt: opts.prompt };
}

/* ------------------------------------------------------------------ *
 *  Replicate — optional, khaas virtual try-on mate
 * ------------------------------------------------------------------ */

async function replicateRun(
  version: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN || "";

  const created = await apiFetch<{
    id: string;
    status: string;
    urls?: { get?: string };
    error?: string;
  }>("https://api.replicate.com/v1/predictions", {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "wait=60",
    },
    body: JSON.stringify({ version, input }),
  });

  let prediction: {
    status: string;
    output?: string | string[];
    error?: string;
  } = created as never;

  const pollUrl = created.urls?.get ?? `https://api.replicate.com/v1/predictions/${created.id}`;
  const deadline = Date.now() + 5 * 60_000;

  while (prediction.status !== "succeeded" && Date.now() < deadline) {
    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new FatalError(`Replicate: ${prediction.error ?? prediction.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
    prediction = await apiFetch(pollUrl, {
      signal,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  if (prediction.status !== "succeeded") throw new Error("Replicate ne bahu var lagi");

  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!output) throw new Error("Replicate e output na aapyu");

  return apiFetch<Buffer>(output, { expect: "buffer", signal });
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

async function shrink(data: Buffer, maxSide: number): Promise<Buffer> {
  try {
    return await sharp(data)
      .rotate()
      .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    return data;
  }
}

/** Reel mate hamesha barabar 1080x1920 joiye — provider je aape e fit karo. */
export async function fitToAspect(
  data: Buffer,
  aspect: AspectRatio,
): Promise<Buffer> {
  const { width, height } = DIMENSIONS[aspect];
  return sharp(data)
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

export type GenerateImageOptions = {
  prompt: string;
  /** Reference aapo to Gemini j chale che (bija reference samajta nathi). */
  references?: ReferenceImage[];
  aspectRatio?: AspectRatio;
  seed?: number;
  prefer?: string;
  /** true = pachi 1080x1920 ma barabar kaapi aapo. */
  fit?: boolean;
};

export async function generateImage(
  options: GenerateImageOptions,
): Promise<ChainResult<GeneratedImage>> {
  const aspectRatio = options.aspectRatio ?? "9:16";
  const references = options.references ?? [];
  const needsReferences = references.length > 0;

  const result = await runChain<GeneratedImage>(
    [
      {
        name: "openai",
        label: "OpenAI gpt-image-1",
        free: false,
        configured: () => Boolean(openaiKey()),
        run: (signal) => openaiImage({ prompt: options.prompt, references, aspectRatio }, signal),
        timeoutMs: 240_000,
      },
      {
        name: "gemini-image",
        label: "Gemini 2.5 Flash Image (free)",
        free: true,
        configured: () => Boolean(geminiKey()),
        run: (signal) => geminiImage({ prompt: options.prompt, references, aspectRatio }, signal),
        timeoutMs: 180_000,
      },
      {
        name: "pollinations",
        label: "Pollinations (key vagar)",
        free: true,
        // Reference joito hoy to pollinations kaam nu nathi — e fakt text
        // samje che. Khoti image aapva karta skip karvu saaru.
        configured: () =>
          !needsReferences && process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
        run: (signal) =>
          pollinationsImage({ prompt: options.prompt, aspectRatio, seed: options.seed }, signal),
        timeoutMs: 180_000,
      },
      {
        name: "replicate",
        label: "Replicate Flux",
        free: false,
        configured: () => Boolean(process.env.REPLICATE_API_TOKEN),
        run: async (signal) => ({
          data: await replicateRun(
            process.env.REPLICATE_IMAGE_VERSION ||
              "black-forest-labs/flux-schnell",
            {
              prompt: options.prompt,
              aspect_ratio: aspectRatio,
              output_format: "jpg",
            },
            signal,
          ),
          mimeType: "image/jpeg",
          provider: "replicate",
          prompt: options.prompt,
        }),
        timeoutMs: 300_000,
      },
    ],
    {
      label: "Image generation",
      prefer: options.prefer ?? process.env.IMAGE_PROVIDER,
      retries: 1,
      backoffMs: 2000,
    },
  );

  if (options.fit !== false) {
    result.data.data = await fitToAspect(result.data.data, aspectRatio);
    result.data.mimeType = "image/jpeg";
  }

  return result;
}

/**
 * Reference image sathe navi image — "aa vyakti ne aa kapdu pehravo",
 * "aa product ne aa jagya e mukho".
 */
export function composeImage(options: {
  prompt: string;
  references: ReferenceImage[];
  aspectRatio?: AspectRatio;
  prefer?: string;
}): Promise<ChainResult<GeneratedImage>> {
  return generateImage({
    prompt: options.prompt,
    references: options.references,
    aspectRatio: options.aspectRatio ?? "9:16",
    prefer: options.prefer,
  });
}

/**
 * Virtual try-on — kapdu vyakti par pehravi de che.
 *
 * REPLICATE_API_TOKEN hoy to khaas try-on model vaparay che (sauthi saacho
 * result). Nahi to Gemini thi j kaam chalavie chie — e pan saaru kare che.
 */
export async function virtualTryOn(options: {
  person: Buffer;
  garment: Buffer;
  /** "upper_body" | "lower_body" | "dresses" */
  category?: string;
  description?: string;
  aspectRatio?: AspectRatio;
}): Promise<ChainResult<GeneratedImage>> {
  const category = options.category ?? "upper_body";
  const prompt = [
    "Photorealistic fashion photograph.",
    "Dress the person from the first reference image in the exact garment from the second reference image.",
    "Keep the person's face, skin tone, hair and body proportions completely unchanged.",
    "Keep the garment's exact colour, print, fabric texture, neckline, sleeve length and hemline.",
    "Natural drape and realistic folds where the fabric meets the body.",
    "Full body or three-quarter shot, soft natural lighting, clean modern background, shot on 85mm lens.",
    options.description ? `Extra direction: ${options.description}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return runChain<GeneratedImage>(
    [
      {
        name: "replicate-tryon",
        label: "IDM-VTON (khaas try-on model)",
        free: false,
        configured: () => Boolean(process.env.REPLICATE_API_TOKEN),
        run: async (signal) => ({
          data: await replicateRun(
            process.env.REPLICATE_TRYON_VERSION ||
              "cuuupid/idm-vton:c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4",
            {
              human_img: `data:image/jpeg;base64,${(await shrink(options.person, 1024)).toString("base64")}`,
              garm_img: `data:image/jpeg;base64,${(await shrink(options.garment, 1024)).toString("base64")}`,
              garment_des: options.description ?? "garment",
              category,
            },
            signal,
          ),
          mimeType: "image/jpeg",
          provider: "replicate-tryon",
          prompt,
        }),
        timeoutMs: 300_000,
      },
      {
        name: "openai",
        label: "OpenAI gpt-image-1",
        free: false,
        configured: () => Boolean(openaiKey()),
        run: (signal) =>
          openaiImage(
            {
              prompt,
              references: [
                { data: options.person, mimeType: "image/jpeg", role: "person" },
                { data: options.garment, mimeType: "image/jpeg", role: "garment" },
              ],
              aspectRatio: options.aspectRatio ?? "9:16",
            },
            signal,
          ),
        timeoutMs: 240_000,
      },
      {
        name: "gemini-image",
        label: "Gemini 2.5 Flash Image (free)",
        free: true,
        configured: () => Boolean(geminiKey()),
        run: (signal) =>
          geminiImage(
            {
              prompt,
              references: [
                { data: options.person, mimeType: "image/jpeg", role: "person" },
                { data: options.garment, mimeType: "image/jpeg", role: "garment" },
              ],
              aspectRatio: options.aspectRatio ?? "9:16",
            },
            signal,
          ),
        timeoutMs: 180_000,
      },
    ],
    {
      label: "Virtual try-on",
      // Try-on ma khaas model ni gunvatta ghani sari che, etle ahiya free
      // ne pehli pasandgi nathi aapta.
      preferFree: false,
      prefer: process.env.TRYON_PROVIDER,
      retries: 1,
      backoffMs: 3000,
    },
  );
}

/** Setup page mate. */
export function imageGenStatus() {
  return [
    {
      key: "openai",
      label: `OpenAI ${openaiModel()}`,
      free: false,
      configured: Boolean(openaiKey()),
      note: "ChatGPT ni image API. Product ni vigat ane chehro sauthi barabar sachve che. platform.openai.com/api-keys",
    },
    {
      key: "gemini-image",
      label: "Gemini 2.5 Flash Image",
      free: true,
      configured: Boolean(geminiKey()),
      note: "Avatar + kapda mate aa j joiye — reference image samje che. aistudio.google.com/apikey",
    },
    {
      key: "pollinations",
      label: "Pollinations",
      free: true,
      configured: process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
      note: "Koi key nahi. Fakt background/lifestyle image — avatar mate kaam nu nathi.",
    },
    {
      key: "replicate",
      label: "Replicate (IDM-VTON)",
      free: false,
      configured: Boolean(process.env.REPLICATE_API_TOKEN),
      note: "Sauthi saacho virtual try-on. Ek image na ~₹2. replicate.com/account/api-tokens",
    },
  ];
}
