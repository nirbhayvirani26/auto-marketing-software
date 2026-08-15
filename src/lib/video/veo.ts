/**
 * Veo — Google's video generation model.
 *
 * This is the engine behind the 30-second reel. Veo produces roughly 8-second
 * clips, so a 30-second reel is built as several clips, each with its own
 * prompt, stitched together afterwards. That is a feature rather than a
 * workaround: a reel that holds attention needs a change of shot every few
 * seconds anyway, and one prompt per beat is exactly how a shot list works.
 *
 * The API is a long-running operation:
 *   POST  /models/<model>:predictLongRunning  -> an operation name
 *   GET   /<operation name>                   -> poll until done
 *   GET   /files/<id>:download                -> the mp4
 *
 * An image may be supplied as the first frame. When it is, the product in the
 * clip is the seller's real product rather than the model's idea of one, which
 * is the difference between a usable advert and a pretty fake.
 */

import sharp from "sharp";

import {
  runChain,
  apiFetch,
  FatalError,
  RetryableError,
  type ChainResult,
} from "@/lib/pipeline/chain";

const GENAI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** What Veo will actually produce, whatever we ask for. */
export const CLIP_SECONDS = 8;

export type VeoAspectRatio = "9:16" | "16:9";

export type VeoClip = {
  data: Buffer;
  mimeType: string;
  provider: string;
  prompt: string;
  seconds: number;
};

function key(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function veoModel(): string {
  // The fast variant is several times cheaper and quick enough that a reel
  // finishes while someone is still watching the progress bar.
  return process.env.VEO_MODEL || "veo-3.1-fast-generate-preview";
}

export function veoConfigured(): boolean {
  if (process.env.AI_VIDEO_ENABLED === "false") return false;
  return Boolean(key());
}

/* ------------------------------------------------------------------ */

type Operation = {
  name?: string;
  done?: boolean;
  error?: { message?: string; code?: number };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
  };
};

/** Veo rejects very large stills; 1024px is ample as a first frame. */
async function shrink(data: Buffer): Promise<{ base64: string; mimeType: string }> {
  try {
    const resized = await sharp(data)
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { base64: resized.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return { base64: data.toString("base64"), mimeType: "image/jpeg" };
  }
}

async function generate(
  options: {
    prompt: string;
    aspectRatio: VeoAspectRatio;
    image?: Buffer;
    negativePrompt?: string;
  },
  signal: AbortSignal,
): Promise<VeoClip> {
  const apiKey = key();
  if (!apiKey) throw new FatalError("GEMINI_API_KEY is not set");

  const model = veoModel();

  const instance: Record<string, unknown> = { prompt: options.prompt };
  if (options.image) {
    const prepared = await shrink(options.image);
    instance.image = {
      bytesBase64Encoded: prepared.base64,
      mimeType: prepared.mimeType,
    };
  }

  const started = await apiFetch<Operation>(
    `${GENAI_BASE}/models/${model}:predictLongRunning?key=${apiKey}`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instances: [instance],
        parameters: {
          aspectRatio: options.aspectRatio,
          durationSeconds: CLIP_SECONDS,
          // Text baked into a clip cannot be edited later, and the caption
          // already carries the words.
          negativePrompt:
            options.negativePrompt ??
            "on-screen text, captions, subtitles, watermarks, logos, distorted hands, extra fingers",
        },
      }),
    },
  );

  if (started.error) {
    throw new FatalError(`Veo: ${started.error.message ?? "request rejected"}`);
  }
  if (!started.name) throw new RetryableError("Veo: no operation was returned");

  /* ---- Poll ---- */
  const deadline = Date.now() + 6 * 60_000;
  let operation: Operation = started;

  while (!operation.done) {
    if (Date.now() > deadline) {
      throw new RetryableError("Veo: the clip took too long to render");
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    operation = await apiFetch<Operation>(
      `${GENAI_BASE}/${started.name}?key=${apiKey}`,
      { signal },
    );
  }

  if (operation.error) {
    throw new FatalError(`Veo: ${operation.error.message ?? "generation failed"}`);
  }

  const uri =
    operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new Error("Veo finished but returned no video");

  /* ---- Download ---- */
  const separator = uri.includes("?") ? "&" : "?";
  const data = await apiFetch<Buffer>(`${uri}${separator}key=${apiKey}`, {
    expect: "buffer",
    signal,
  });

  if (data.length < 10_000) throw new Error("Veo returned an empty file");

  return {
    data,
    mimeType: "video/mp4",
    provider: `veo:${model}`,
    prompt: options.prompt,
    seconds: CLIP_SECONDS,
  };
}

/* ------------------------------------------------------------------ */

/**
 * Renders one clip.
 *
 * Throws a ChainError when it cannot. Callers should catch it and fall back to
 * an animated still — a reel must never fail because one clip did.
 */
export function generateVeoClip(options: {
  prompt: string;
  aspectRatio?: VeoAspectRatio;
  /** The first frame. Supplying it keeps the real product in shot. */
  image?: Buffer;
}): Promise<ChainResult<VeoClip>> {
  return runChain<VeoClip>(
    [
      {
        name: "veo",
        label: `Veo (${veoModel()})`,
        free: false,
        configured: veoConfigured,
        run: (signal) =>
          generate(
            {
              prompt: options.prompt,
              aspectRatio: options.aspectRatio ?? "9:16",
              image: options.image,
            },
            signal,
          ),
        timeoutMs: 7 * 60_000,
      },
    ],
    {
      label: "AI video clip",
      preferFree: false,
      retries: 1,
      backoffMs: 5000,
    },
  );
}

/** How many clips are needed to fill a reel of this length. */
export function clipsForDuration(seconds: number): number {
  return Math.max(1, Math.min(6, Math.ceil(seconds / CLIP_SECONDS)));
}

/** Setup page status. */
export function veoStatus() {
  const configured = veoConfigured();
  return {
    key: "veo",
    label: `Veo — ${veoModel()}`,
    free: false,
    configured,
    note: configured
      ? `Generates ${CLIP_SECONDS}-second clips; a 30-second reel uses four of them.`
      : "Needs GEMINI_API_KEY with billing enabled.",
  };
}
