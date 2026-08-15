/**
 * Image generation and image EDITING.
 *
 * These are two different jobs, and the second one is what makes "my avatar
 * wearing my product" possible at all:
 *
 *   generateImage()  — a prompt in, a new image out (background, lifestyle shot)
 *   composeImage()   — reference images + a prompt, so the avatar's face and the
 *                      product's real fabric end up in the same frame
 *   virtualTryOn()   — a dedicated try-on model that dresses a person
 *
 * Providers, in the order they are tried:
 *
 *   nano-banana   — Nano Banana, Google's Gemini 2.5 Flash Image. This is the
 *                   default. It is on the free tier, it reads reference images,
 *                   and it holds a face steady across scenes, which is exactly
 *                   what an avatar needs. One GEMINI_API_KEY covers it.
 *   openai        — gpt-image-1. Excellent at preserving product detail and at
 *                   rendering readable text inside the image, but it is paid.
 *   pollinations  — no key at all. Text to image only; it cannot read a
 *                   reference, so it is skipped whenever one is supplied.
 *   replicate     — optional and cheap. Its dedicated try-on model (IDM-VTON)
 *                   gives the most accurate clothing results.
 *
 * runChain decides the order: free first by default, and whatever is named in
 * `IMAGE_PROVIDER` jumps to the front. If one fails the next one runs.
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
  /** Tells the model what this reference actually is. */
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
 *  Nano Banana — Gemini 2.5 Flash Image
 * ------------------------------------------------------------------ */

function geminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

/**
 * Nano Banana model ids, newest first.
 *
 * Google retires preview ids without much warning, so several are listed and
 * tried in turn — a 404 on one must not take image generation down with it.
 * `GEMINI_IMAGE_MODEL` always goes first when it is set.
 */
const GEMINI_IMAGE_MODELS = [
  process.env.GEMINI_IMAGE_MODEL,
  "gemini-3.1-flash-image",
  "nano-banana-pro-preview",
  "gemini-2.5-flash-image",
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

      // References go first, each one labelled so the model knows its role.
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
        throw new FatalError(`Nano Banana blocked the prompt: ${json.promptFeedback.blockReason}`);
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
 * gpt-image-1 only offers three sizes. A reel is vertical (9:16), so the
 * ubha aakar mate 1024x1536 magie chie ane pachi fitToAspect() ene barabar
 * result is cropped to 1080x1920 afterwards.
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
 * There are two endpoints, and choosing the right one changes everything:
 *
 *   reference vagar → /images/generations  (sadho prompt → navi image)
 *   reference sathe → /images/edits        (16 sudhi image reference tarike)
 *
 * `edits` is the path this app relies on: the real product photo and the
 * avatar's face go in as references, so the model cannot reinvent the product.
 * `input_fidelity: high` exists for exactly this.
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
  if (!key) throw new FatalError("OPENAI_API_KEY is not set");

  const model = openaiModel();
  const size = OPENAI_SIZES[opts.aspectRatio];
  const headers = { authorization: `Bearer ${key}` };

  let json: OpenAiImageResponse;

  if (opts.references.length > 0) {
    // Label each reference inside the prompt as well — gpt-image-1 pays
    // attention to both the order of the images and the wording.
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

    // gpt-image-1 accepts at most 16 reference images.
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
        // Moderation sometimes trips on clothing and bodies in ordinary
        // product photos; `low` stops real marketing images being blocked.
        moderation: "low",
      }),
    });
  }

  if (json.error) throw new FatalError(`OpenAI: ${json.error.message ?? json.error.code}`);

  const first = json.data?.[0];

  // gpt-image-1 always returns base64; older or proxied setups may send a URL.
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

  // Sometimes an HTML error page comes back — make sure this really is an image.
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

/** A reel needs exactly 1080x1920, whatever size the provider returned. */
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
  /** With references only Nano Banana and gpt-image-1 run; the rest cannot read them. */
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
        name: "nano-banana",
        label: "Nano Banana — Gemini 2.5 Flash Image (free)",
        free: true,
        configured: () => Boolean(geminiKey()),
        run: (signal) => geminiImage({ prompt: options.prompt, references, aspectRatio }, signal),
        timeoutMs: 180_000,
      },
      {
        name: "pollinations",
        label: "Pollinations (no key needed)",
        free: true,
        // Pollinations only understands text, so with references it would
        // return the wrong picture entirely. Better to skip it.
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
 * A new image built from references: "put this garment on this person",
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
 * Virtual try-on — puts a garment onto a person.
 *
 * With REPLICATE_API_TOKEN set, a dedicated try-on model runs and gives the
 * most accurate result. Without it, Nano Banana handles the job, which is
 * good enough for most catalogue work.
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
        label: "IDM-VTON (dedicated try-on model)",
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
        name: "nano-banana",
        label: "Nano Banana — Gemini 2.5 Flash Image (free)",
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
      // The dedicated try-on model is markedly better here, so this is the
      // one place where free providers do not go first.
      preferFree: false,
      prefer: process.env.TRYON_PROVIDER,
      retries: 1,
      backoffMs: 3000,
    },
  );
}

/** Provider status for the Setup page. */
export function imageGenStatus() {
  return [
    {
      key: "openai",
      label: `OpenAI ${openaiModel()}`,
      free: false,
      configured: Boolean(openaiKey()),
      note: "Paid. The most faithful product detail and the only one that reliably renders text inside an image. platform.openai.com/api-keys",
    },
    {
      key: "nano-banana",
      label: "Nano Banana (Gemini 2.5 Flash Image)",
      free: true,
      configured: Boolean(geminiKey()),
      note: "The default. Free, reads reference images, and keeps a face consistent across scenes — which is what avatars need. aistudio.google.com/apikey",
    },
    {
      key: "pollinations",
      label: "Pollinations",
      free: true,
      configured: process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
      note: "No key required. Backgrounds and lifestyle shots only — it cannot work from a reference photo.",
    },
    {
      key: "replicate",
      label: "Replicate (IDM-VTON)",
      free: false,
      configured: Boolean(process.env.REPLICATE_API_TOKEN),
      note: "The most accurate virtual try-on, at a few cents per image. replicate.com/account/api-tokens",
    },
  ];
}
