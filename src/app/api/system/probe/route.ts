import sharp from "sharp";

import { handle, ok, requireAuth } from "@/lib/api";
import { allProviders } from "@/lib/ai";
import { askVision } from "@/lib/ai/vision";
import { generateImage } from "@/lib/media/image-gen";
import { uploadPublic } from "@/lib/media/hosts";
import { pickMusic } from "@/lib/trends/audio";
import { generateVoiceover } from "@/lib/video/voiceover";
import { aiVideoConfigured, generateVideoClip } from "@/lib/video/ai-video";
import { videoEngineStatus, runFfmpeg, probe as probeMedia } from "@/lib/video/ffmpeg";
import { resolveFont } from "@/lib/video/fonts";
import { withTempDir } from "@/lib/video/ffmpeg";
import { apiFetch } from "@/lib/pipeline/chain";
import path from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

type ProbeResult = {
  key: string;
  label: string;
  /** Aa vagar reel bilkul nahi bane? */
  required: boolean;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
  /** Su karvu — user ne sidhu kaam nu vaakya. */
  fix?: string;
};

async function probeStep(
  key: string,
  label: string,
  required: boolean,
  fix: string,
  fn: () => Promise<string>,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { key, label, required, ok: true, ms: Date.now() - started, detail };
  } catch (error) {
    return {
      key,
      label,
      required,
      ok: false,
      ms: Date.now() - started,
      error: (error as Error).message.slice(0, 800),
      fix,
    };
  }
}

/** Nani test image — vision ane hosting probe mate. */
async function tinyImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 40, g: 90, b: 180 },
    },
  })
    .jpeg({ quality: 70 })
    .toBuffer();
}

/**
 * "Badhu KHAREKHAR chale che ke nahi" — key set hovi ane key kaam karvi
 * e be alag vaat che (dakhla tarike key barabar hoy pan credit khatam hoy).
 *
 * Aa route dareak jaruri service ne EK NANI SACHI request mokle che.
 * Thoda token/bandwidth vaparay che, pan pachi koi surprise nathi rehtu.
 */
export const POST = handle(async (req) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const results: ProbeResult[] = [];

  // AI video no test kharekhar ek video banave che — ~2 minute ane paisa
  // banne lage che. Etle e jate nathi chalto; `?video=1` thi j chale che.
  const testVideo = new URL(req.url).searchParams.get("video") === "1";

  /* ---------- 1. ffmpeg + font ---------- */
  results.push(
    await probeStep(
      "video",
      "Video engine (ffmpeg + font)",
      true,
      "`npm install` fari chalavo. Font mate `npm run fonts`.",
      async () => {
        const engine = videoEngineStatus();
        if (!engine.ready) throw new Error(engine.error ?? "ffmpeg madyu nahi");

        const font = resolveFont("latin");

        return withTempDir("probe", async (dir) => {
          const out = path.join(dir, "probe.mp4");
          await runFfmpeg(
            [
              "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=1:r=30",
              "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
              "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
              "-c:a", "aac", "-shortest", "-t", "1",
              out,
            ],
            { timeoutMs: 60_000 },
          );
          const info = await probeMedia(out);
          if (info.width !== 1080 || !info.hasAudio) {
            throw new Error("Test video barabar na banyu");
          }
          return `ffmpeg chale che · font: ${path.basename(font)}`;
        });
      },
    ),
  );

  /* ---------- 2. Text AI ---------- */
  const configuredText = allProviders().filter((p) => p.configured());
  for (const provider of configuredText) {
    results.push(
      await probeStep(
        `text:${provider.key}`,
        `AI lakhan — ${provider.label}`,
        false,
        "Key badlo, ke bijo free provider naakho (Gemini sauthi saral che).",
        async () => {
          const data = await provider.complete<{ word: string }>({
            system: "You reply with structured JSON only.",
            prompt: 'Return exactly {"word":"ok"}',
            schema: {
              type: "object",
              properties: { word: { type: "string" } },
              required: ["word"],
            },
            maxTokens: 50,
          });
          return `${provider.model} — jawab malyo (${JSON.stringify(data).slice(0, 60)})`;
        },
      ),
    );
  }
  if (configuredText.length === 0) {
    results.push({
      key: "text",
      label: "AI lakhan",
      required: true,
      ok: false,
      ms: 0,
      error: "Ek pan AI provider ni key set nathi",
      fix: "aistudio.google.com/apikey par thi FREE key lo ane .env ma GEMINI_API_KEY ma nakho.",
    });
  } else if (!results.some((r) => r.key.startsWith("text:") && r.ok)) {
    results.push({
      key: "text",
      label: "AI lakhan — ek pan provider na chalyo",
      required: true,
      ok: false,
      ms: 0,
      error: "Badhi key set che pan ek pan kaam na kari",
      fix: "Uper na error vancho. Sauthi saral upay: aistudio.google.com/apikey par thi FREE Gemini key lo.",
    });
  }

  /* ---------- 3. Vision ---------- */
  const image = await tinyImage();
  results.push(
    await probeStep(
      "vision",
      "AI — image samajvi",
      true,
      "GEMINI_API_KEY (free) naakho — vision mate sauthi saru.",
      async () => {
        const { data, provider } = await askVision<{ colour: string }>(
          [{ data: image, mimeType: "image/jpeg" }],
          {
            system: "You describe images. Reply with structured JSON only.",
            prompt: "What is the single dominant colour in this image? One word.",
            schema: {
              type: "object",
              properties: { colour: { type: "string" } },
              required: ["colour"],
            },
            maxTokens: 60,
          },
        );
        return `${provider} — "${String(data.colour).slice(0, 30)}"`;
      },
    ),
  );

  /* ---------- 4. Public hosting ---------- */
  results.push(
    await probeStep(
      "hosting",
      "Public media hosting",
      true,
      "Cloudinary ni free key naakho (CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET), ke PUBLIC_MEDIA_BASE_URL set karo. Aa vagar Instagram/Facebook par post NAHI thay.",
      async () => {
        const base = (process.env.PUBLIC_MEDIA_BASE_URL || "").replace(/\/$/, "");
        if (base && /^https:\/\//i.test(base)) {
          return `Tamaru potanu URL vaparashe: ${base}/api/media/…`;
        }

        const uploaded = await uploadPublic({
          data: image,
          filename: `probe-${Date.now()}.jpg`,
          mimeType: "image/jpeg",
          kind: "image",
        });

        // Kharekhar bahar thi khule che ke nahi e j asal test che.
        const fetched = await apiFetch<Buffer>(uploaded.data.url, {
          expect: "buffer",
          signal: AbortSignal.timeout(30_000),
        });
        if (fetched.length < 500) throw new Error("URL khulyu pan file khali aavi");

        return `${uploaded.data.host} — URL bahar thi khule che`;
      },
    ),
  );

  /* ---------- 5. Image generation (marji nu) ---------- */
  results.push(
    await probeStep(
      "image-gen",
      "AI image (avatar + kapda)",
      false,
      "GEMINI_API_KEY naakho. Aa vagar pan reel banse — fakt tamari upload kareli image thi.",
      async () => {
        const { data, provider } = await generateImage({
          prompt: "A plain blue ceramic coffee mug on a white table, soft daylight",
          aspectRatio: "9:16",
          fit: false,
        });
        const meta = await sharp(data.data).metadata();
        return `${provider} — ${meta.width}x${meta.height} image aavi`;
      },
    ),
  );

  /* ---------- 5b. AI video (marji nu, ane magya thi j) ---------- */
  if (testVideo && aiVideoConfigured()) {
    results.push(
      await probeStep(
        "ai-video",
        "AI video clip (Gemini Omni)",
        false,
        "GEMINI_API_KEY joiye ane Omni tamara account ma chalu hovu joiye. Aa vagar pan reel banse — ffmpeg still image halave che.",
        async () => {
          const { data, provider } = await generateVideoClip({
            prompt: "Gentle breeze moves across a plain blue surface. The camera pushes in very slowly.",
            image: { data: image, mimeType: "image/jpeg" },
            aspectRatio: "9:16",
            durationSeconds: 3,
          });
          return `${provider} — ${(data.data.length / 1024 / 1024).toFixed(1)} MB video aavyu`;
        },
      ),
    );
  }

  /* ---------- 6. Music (marji nu) ---------- */
  results.push(
    await probeStep(
      "music",
      "Reel nu music",
      false,
      "JAMENDO_CLIENT_ID (free) naakho, ke storage/music/ ma potani mp3 mukho.",
      async () => {
        const picked = await pickMusic({ mood: "upbeat", minDuration: 30 });
        if (!picked) throw new Error("Ek pan track na madyo");
        return `${picked.track.source} — "${picked.track.title}" (${Math.round(picked.track.duration)}s)`;
      },
    ),
  );

  /* ---------- 7. Voiceover (marji nu) ---------- */
  results.push(
    await probeStep(
      "voiceover",
      "Voiceover",
      false,
      "GEMINI_API_KEY (free) ke ELEVENLABS_API_KEY naakho. Voiceover vagar pan reel saru chale che.",
      async () => {
        const { data, provider } = await generateVoiceover({
          text: "This is a short test of the voiceover system.",
        });
        if (data.data.length < 2000) throw new Error("Audio bahu nanu aavyu");
        return `${provider} — ${(data.data.length / 1024).toFixed(0)} KB audio`;
      },
    ),
  );

  /* ---------- 8. Meta ---------- */
  results.push(
    await probeStep(
      "meta",
      "Instagram / Facebook app",
      true,
      "developers.facebook.com/apps par app banavo ane META_APP_ID + META_APP_SECRET naakho.",
      async () => {
        const appId = process.env.META_APP_ID || "";
        const secret = process.env.META_APP_SECRET || "";
        if (!appId || !secret) throw new Error("META_APP_ID / META_APP_SECRET set nathi");

        const version = process.env.META_GRAPH_VERSION || "v21.0";

        // App access token magiye chie — ID ane Secret jode barabar che ke
        // nahi e nakki karvano aa j saacho rasto che.
        const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
        url.searchParams.set("client_id", appId);
        url.searchParams.set("client_secret", secret);
        url.searchParams.set("grant_type", "client_credentials");

        const json = await apiFetch<{
          access_token?: string;
          error?: { message?: string };
        }>(url.toString(), { signal: AbortSignal.timeout(20_000) });

        if (json.error) throw new Error(json.error.message ?? "Meta e na paadi");
        if (!json.access_token) {
          throw new Error("META_APP_ID ke META_APP_SECRET khoto che");
        }
        return `App ${appId} barabar che`;
      },
    ),
  );

  const failedRequired = results.filter((r) => r.required && !r.ok);
  const passed = results.filter((r) => r.ok).length;

  return ok({
    ready: failedRequired.length === 0,
    passed,
    failed: results.length - passed,
    /** Aa thay tya sudhi reel nahi bane. */
    blocking: failedRequired.map((r) => ({
      label: r.label,
      error: r.error,
      fix: r.fix,
    })),
    results,
  });
});
