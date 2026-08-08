/**
 * AI video clip — Google nu Gemini Omni Flash.
 *
 * Aa file ffmpeg ni JAGYA E nathi. ffmpeg still image ne halavine (Ken Burns)
 * reel banave che — e sasto, zadapi ane bharoso layak che. Pan ketlak shot
 * ma KHAREKHAR halchal joiye che: kapdu udtu hoy, model chaale, product ferve.
 * Ena mate aa file che.
 *
 * Rasto jaani joine "image → video" j rakhyo che:
 *
 *      product ni photo → gpt-image-1 (scene ni image) → Omni (e j image halave)
 *
 * Sidha text thi video banaviye to AI product ne potani rite kalpi le che ane
 * kapdu/rang badlai jaay che. Pehla image banavi ne pachi ene j halavvathi
 * product jem no tem rahe che — vechan mate aa j ek maatra saacho rasto che.
 *
 * API: Interactions API — https://ai.google.dev/gemini-api/docs/omni
 *   POST /v1beta/interactions        → video (3-10s, 720p, 24fps)
 *   delivery:"uri" → files/<id>      → ACTIVE thay tya sudhi rah jovi → download
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

/** Omni ni potani had — aa thi bahar magiye to e potani rite kaapi de che. */
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
  /** Su dekhavvu ane camera kem hale — e nu varnan. */
  prompt: string;
  /** Aa image ne halavvi che. Aa aapvathi product badlato nathi. */
  image?: { data: Buffer; mimeType: string };
  aspectRatio?: VideoAspectRatio;
  /** 3-10 second. Omni ne prompt ma j kahevu pade che. */
  durationSeconds?: number;
  prefer?: string;
};

/* ------------------------------------------------------------------ *
 *  Config
 * ------------------------------------------------------------------ */

function geminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function omniModel(): string {
  return process.env.OMNI_MODEL || "gemini-omni-flash-preview";
}

/** AI video chalu che ke nahi. Default: key hoy to chalu. */
export function aiVideoConfigured(): boolean {
  if (process.env.AI_VIDEO_ENABLED === "false") return false;
  return Boolean(geminiKey());
}

/**
 * Ek reel ma ketla AI clip banavva.
 *
 * Dareak clip ne ~1-2 minute lage che ane e paid pan che, etle aakha reel na
 * badha scene video banavva no koi arth nathi — 2-3 sauthi agatya na shot
 * (hook ane lifestyle) video hoy ane baaki still hoy e j sauthi saru pariman
 * aape che. 0 karo to AI video sav bandh.
 */
export function aiVideoMaxClips(): number {
  const raw = Number(process.env.AI_VIDEO_MAX_CLIPS);
  if (!Number.isFinite(raw) || raw < 0) return 2;
  return Math.min(8, Math.floor(raw));
}

/* ------------------------------------------------------------------ *
 *  Omni — Interactions API
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

/** Jawab ma video kya paḍyo che e shodhe — inline base64 ke file URI. */
function findVideo(json: InteractionResponse): InteractionContent | null {
  if (json.output_video?.uri) {
    return { type: "video", uri: json.output_video.uri, mime_type: json.output_video.mime_type };
  }
  for (const step of json.steps ?? []) {
    for (const content of step.content ?? []) {
      if (content.type === "video" && (content.data || content.uri)) return content;
    }
  }
  return null;
}

/**
 * Files API nu id — URI gme te aakar no hoy shake:
 *   files/abc123
 *   https://…/v1beta/files/abc123:download?alt=media
 */
function fileIdFromUri(uri: string): string | null {
  const match = uri.match(/files\/([^:/?#]+)/);
  return match ? match[1] : null;
}

/**
 * File taiyar (ACTIVE) thay tya sudhi rah jue che. Omni motu video Files API
 * ma mukе che ane e turant download layak hotu nathi.
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
      throw new FatalError(`Omni: file process na thai — ${file.error?.message ?? "FAILED"}`);
    }
    if (Date.now() > deadline) {
      throw new RetryableError("Omni: video taiyar thata bahu var lagi");
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

/** Image mota moklvathi request fail thay che — 1024px puratu che. */
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
  opts: Required<Pick<GenerateClipOptions, "prompt" | "aspectRatio" | "durationSeconds">> & {
    image?: { data: Buffer; mimeType: string };
  },
  signal: AbortSignal,
): Promise<GeneratedClip> {
  const key = geminiKey();
  if (!key) throw new FatalError("GEMINI_API_KEY set nathi");

  const model = omniModel();

  // Omni pase `duration` no parameter nathi — e prompt mathi samje che.
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

  const json = await apiFetch<InteractionResponse>(`${GENAI_BASE}/interactions?key=${key}`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      // Fakt text hoy to Omni sadhi string pan sweekare che, pan array
      // hamesha chale che — etle ek j rasto rakhie chie.
      input,
      response_format: {
        type: "video",
        aspect_ratio: opts.aspectRatio,
        // Video mota bhage 4MB thi motu hoy che ane tyare inline base64
        // aavtu nathi — etle hamesha URI j magie chie.
        delivery: "uri",
      },
    }),
  });

  if (json.error) {
    throw new FatalError(`Omni: ${json.error.message ?? json.error.status}`);
  }
  if (json.status && json.status !== "completed") {
    throw new RetryableError(`Omni: status ${json.status}`);
  }

  const video = findVideo(json);
  if (!video) throw new Error("Omni e video na aapyu");

  if (video.data) {
    return {
      data: Buffer.from(video.data, "base64"),
      mimeType: video.mime_type ?? "video/mp4",
      provider: `omni:${model}`,
      prompt: opts.prompt,
    };
  }

  const fileId = fileIdFromUri(video.uri ?? "");
  if (!fileId) throw new Error(`Omni no video URI samjayo nahi: ${video.uri}`);

  await waitForFile(fileId, signal);

  const data = await apiFetch<Buffer>(
    `${GENAI_BASE}/files/${fileId}:download?alt=media&key=${key}`,
    { expect: "buffer", signal },
  );

  if (data.length < 10_000) throw new Error("Omni e khali file aapi");

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
 * Ek AI video clip banave.
 *
 * Fail thay to ChainError phenke che — call karnaar e pakadi ne still image
 * par pachho vali javu joiye. Reel kyarey aana karane atakvu na joiye.
 */
export function generateVideoClip(
  options: GenerateClipOptions,
): Promise<ChainResult<GeneratedClip>> {
  const duration = Math.round(
    Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, options.durationSeconds ?? 5)),
  );
  const aspectRatio = options.aspectRatio ?? "9:16";

  return runChain<GeneratedClip>(
    [
      {
        name: "omni",
        label: "Gemini Omni Flash",
        free: false,
        configured: aiVideoConfigured,
        run: (signal) =>
          omniClip(
            { prompt: options.prompt, image: options.image, aspectRatio, durationSeconds: duration },
            signal,
          ),
        // 10s no clip banta ~1-2 minute lage che; motu render thodu vadhu.
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

/** Setup page mate — AI video taiyar che ke nahi. */
export function aiVideoStatus() {
  return [
    {
      key: "omni",
      label: `Gemini Omni Flash (${omniModel()})`,
      free: false,
      configured: aiVideoConfigured(),
      note: aiVideoConfigured()
        ? `Reel dith ${aiVideoMaxClips()} clip sudhi — AI_VIDEO_MAX_CLIPS thi badlo`
        : "GEMINI_API_KEY joiye (Omni paid tier ma che). Aa vagar pan reel banse — ffmpeg still image halave che.",
    },
  ];
}
