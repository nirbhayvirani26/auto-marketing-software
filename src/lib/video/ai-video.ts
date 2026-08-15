/**
 * AI video clips — Omni (Google's Gemini Omni Flash).
 *
 * This does NOT replace ffmpeg. ffmpeg builds the reel by moving still images
 * (a Ken Burns pan), which is cheap, fast and completely reliable. But a few
 * shots genuinely need real motion: fabric catching the air, a model turning,
 * a product actually being used. That is what this file is for.
 *
 * The route is deliberately image-to-video, never text-to-video:
 *
 *     product photo -> a scene image -> Omni animates that exact image
 *
 * Generate straight from text and the model invents its own version of the
 * product; the fabric changes, the colour drifts, the print is wrong. Building
 * the still first and animating *that* keeps the product identical, which is
 * the only acceptable outcome when the video exists to sell the thing.
 *
 * API: the Interactions API — https://ai.google.dev/gemini-api/docs/omni
 *   POST /v1beta/interactions   -> a 3-10 second clip, 720p, 24fps
 *   delivery:"uri" -> files/<id> -> poll until ACTIVE -> download
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

/** Omni's own limits — ask for anything outside this and it clamps silently. */
export const MIN_CLIP_SECONDS = 3;
export const MAX_CLIP_SECONDS = 10;

export type VideoAspectRatio = "9:16" | "16:9";

export type GeneratedClip = {
  data: Buffer;
  mimeType: string;
  provider: string;
  prompt: string;
};

export type GenerateClipOptions = {
  /** What should be visible, and how the camera moves. */
  prompt: string;
  /** The image to animate. Supplying it is what keeps the product unchanged. */
  image?: { data: Buffer; mimeType: string };
  aspectRatio?: VideoAspectRatio;
  /** Between 3 and 10 seconds. Omni takes this from the prompt text. */
  durationSeconds?: number;
  prefer?: string;
};

/* ------------------------------------------------------------------ *
 *  Configuration
 * ------------------------------------------------------------------ */

function geminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function omniModel(): string {
  return process.env.OMNI_MODEL || "gemini-omni-flash-preview";
}

/** Whether AI video is switched on. Default: on whenever a key exists. */
export function aiVideoConfigured(): boolean {
  if (process.env.AI_VIDEO_ENABLED === "false") return false;
  return Boolean(geminiKey());
}

/**
 * How many AI clips to put in one reel.
 *
 * Each clip takes a minute or two and costs money, so animating every scene
 * makes little sense. Two or three clips on the shots that matter most — the
 * hook and the lifestyle beat — with stills for the rest gives the best result
 * per rupee. Set it to 0 to turn AI video off entirely.
 */
export function aiVideoMaxClips(): number {
  const raw = Number(process.env.AI_VIDEO_MAX_CLIPS);
  if (!Number.isFinite(raw) || raw < 0) return 2;
  return Math.min(8, Math.floor(raw));
}

/* ------------------------------------------------------------------ *
 *  Omni — the Interactions API
 * ------------------------------------------------------------------ */

type InteractionContent = {
  type?: string;
  mime_type?: string;
  data?: string;
  uri?: string;
  text?: string;
};

type InteractionResponse = {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: InteractionContent[] }>;
  output_video?: { uri?: string; mime_type?: string };
  error?: { message?: string; status?: string };
};

/** Finds the video in the response — inline base64 or a Files API URI. */
function findVideo(json: InteractionResponse): InteractionContent | null {
  if (json.output_video?.uri) {
    return {
      type: "video",
      uri: json.output_video.uri,
      mime_type: json.output_video.mime_type,
    };
  }
  for (const step of json.steps ?? []) {
    for (const content of step.content ?? []) {
      if (content.type === "video" && (content.data || content.uri)) return content;
    }
  }
  return null;
}

/**
 * The Files API id. The URI arrives in more than one shape:
 *   files/abc123
 *   https://…/v1beta/files/abc123:download?alt=media
 */
function fileIdFromUri(uri: string): string | null {
  const match = uri.match(/files\/([^:/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Waits until the file reports ACTIVE. Omni puts larger videos in the Files
 * API, and they are not downloadable the instant the call returns.
 */
async function waitForFile(fileId: string, signal: AbortSignal): Promise<void> {
  const key = geminiKey();
  const deadline = Date.now() + 5 * 60_000;

  for (;;) {
    const file = await apiFetch<{ state?: string; error?: { message?: string } }>(
      `${GENAI_BASE}/files/${fileId}?key=${key}`,
      { signal },
    );

    if (file.state === "ACTIVE" || !file.state) return;
    if (file.state === "FAILED") {
      throw new FatalError(
        `Omni: the file failed to process — ${file.error?.message ?? "FAILED"}`,
      );
    }
    if (Date.now() > deadline) {
      throw new RetryableError("Omni: the video took too long to become available");
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

/** Large images make the request fail; 1024px is plenty as a reference. */
async function shrink(data: Buffer): Promise<Buffer> {
  try {
    return await sharp(data)
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    return data;
  }
}

async function omniClip(
  opts: Required<
    Pick<GenerateClipOptions, "prompt" | "aspectRatio" | "durationSeconds">
  > & {
    image?: { data: Buffer; mimeType: string };
  },
  signal: AbortSignal,
): Promise<GeneratedClip> {
  const key = geminiKey();
  if (!key) throw new FatalError("GEMINI_API_KEY is not set");

  const model = omniModel();

  // Omni has no duration parameter — it reads the length from the prompt.
  const promptText = [
    opts.prompt.trim(),
    "",
    `Duration: about ${opts.durationSeconds} seconds. One single continuous shot, no cuts.`,
    "Keep every product, garment, colour, print and face exactly as in the reference image — animate it, do not redesign it.",
    "No on-screen text, no captions, no subtitles, no logos, no watermarks.",
  ].join("\n");

  const input: InteractionContent[] = [];
  if (opts.image) {
    const prepared = await shrink(opts.image.data);
    input.push({
      type: "image",
      mime_type: "image/jpeg",
      data: prepared.toString("base64"),
    });
  }
  input.push({ type: "text", text: promptText });

  const json = await apiFetch<InteractionResponse>(
    `${GENAI_BASE}/interactions?key=${key}`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        // With text alone Omni also accepts a plain string, but the array form
        // always works — so there is only ever one code path here.
        input,
        response_format: {
          type: "video",
          aspect_ratio: opts.aspectRatio,
          // Videos are usually larger than 4MB, and inline base64 stops coming
          // back at that size, so always ask for a URI.
          delivery: "uri",
        },
      }),
    },
  );

  if (json.error) {
    throw new FatalError(`Omni: ${json.error.message ?? json.error.status}`);
  }
  if (json.status && json.status !== "completed") {
    throw new RetryableError(`Omni: status ${json.status}`);
  }

  const video = findVideo(json);
  if (!video) throw new Error("Omni returned no video");

  if (video.data) {
    return {
      data: Buffer.from(video.data, "base64"),
      mimeType: video.mime_type ?? "video/mp4",
      provider: `omni:${model}`,
      prompt: opts.prompt,
    };
  }

  const fileId = fileIdFromUri(video.uri ?? "");
  if (!fileId) throw new Error(`Omni returned a video URI we cannot read: ${video.uri}`);

  await waitForFile(fileId, signal);

  const data = await apiFetch<Buffer>(
    `${GENAI_BASE}/files/${fileId}:download?alt=media&key=${key}`,
    { expect: "buffer", signal },
  );

  if (data.length < 10_000) throw new Error("Omni returned an empty file");

  return {
    data,
    mimeType: video.mime_type ?? "video/mp4",
    provider: `omni:${model}`,
    prompt: opts.prompt,
  };
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

/**
 * Generates one AI video clip.
 *
 * Throws a ChainError on failure. Callers are expected to catch it and fall
 * back to the still image — a reel must never fail because of this step.
 */
export function generateVideoClip(
  options: GenerateClipOptions,
): Promise<ChainResult<GeneratedClip>> {
  const duration = Math.round(
    Math.min(
      MAX_CLIP_SECONDS,
      Math.max(MIN_CLIP_SECONDS, options.durationSeconds ?? 5),
    ),
  );
  const aspectRatio = options.aspectRatio ?? "9:16";

  return runChain<GeneratedClip>(
    [
      {
        name: "omni",
        label: "Omni — Gemini Omni Flash",
        free: false,
        configured: aiVideoConfigured,
        run: (signal) =>
          omniClip(
            {
              prompt: options.prompt,
              image: options.image,
              aspectRatio,
              durationSeconds: duration,
            },
            signal,
          ),
        // A 10 second clip takes one to two minutes; a heavier render longer.
        timeoutMs: 6 * 60_000,
      },
    ],
    {
      label: "AI video",
      prefer: options.prefer ?? process.env.VIDEO_PROVIDER,
      preferFree: false,
      retries: 1,
      backoffMs: 5000,
    },
  );
}

/** Whether AI video is ready — shown on the Setup page. */
export function aiVideoStatus() {
  const configured = aiVideoConfigured();
  return [
    {
      key: "omni",
      label: `Omni — Gemini Omni Flash (${omniModel()})`,
      free: false,
      configured,
      note: configured
        ? `Up to ${aiVideoMaxClips()} clips per reel — change AI_VIDEO_MAX_CLIPS to adjust.`
        : "Needs GEMINI_API_KEY with billing enabled, since Omni is on the paid tier. Reels still render without it — ffmpeg animates the stills instead.",
    },
  ];
}
