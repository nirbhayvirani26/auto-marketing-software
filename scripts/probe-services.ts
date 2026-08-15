/**
 * Sends ONE SMALL REAL REQUEST to every external service.
 *
 *   npm run test:services
 *
 * "The key is set" and "the key works" are two different things. A key can be
 * perfectly valid while the account is out of credit or the free quota is
 * spent. This is the script that catches that, and tells you what to do.
 *
 * The same checks are available as a button on the Setup page.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";

const ENV_FILE = path.join(process.cwd(), ".env");
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    /* junu Node — env jate set karvu padse */
  }
}

import { allProviders } from "../src/lib/ai";
import { askVision } from "../src/lib/ai/vision";
import { generateImage } from "../src/lib/media/image-gen";
import { uploadPublic } from "../src/lib/media/hosts";
import { pickMusic } from "../src/lib/trends/audio";
import { generateVoiceover } from "../src/lib/video/voiceover";
import { googleAutocomplete, googleDailyTrends } from "../src/lib/trends/keywords";
import { videoEngineStatus } from "../src/lib/video/ffmpeg";
import { resolveFont } from "../src/lib/video/fonts";

type Row = { label: string; required: boolean; ok: boolean; note: string; fix?: string };
const rows: Row[] = [];

async function step(
  label: string,
  required: boolean,
  fix: string,
  fn: () => Promise<string>,
): Promise<void> {
  process.stdout.write(`  … ${label}`.padEnd(46));
  const started = Date.now();
  try {
    const note = await fn();
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(`\r  ✓ ${label.padEnd(42)} ${note}  (${secs}s)\n`);
    rows.push({ label, required, ok: true, note });
  } catch (error) {
    const message = (error as Error).message.split("\n")[0].slice(0, 160);
    process.stdout.write(`\r  ✗ ${label.padEnd(42)} ${message}\n`);
    rows.push({ label, required, ok: false, note: (error as Error).message, fix });
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  Does every service actually work?                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const image = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();

  /* ---- Local database ---- */
  // First, because when storage is broken almost everything else fails for
  // confusing secondary reasons.
  await step(
    "Local database",
    true,
    "Check that the project folder is writable, then run `npm run seed`.",
    async () => {
      const { connectDB, databaseLocation } = await import("../src/lib/db");
      const { User } = await import("../src/models/User");
      await connectDB();
      const users = await User.countDocuments();
      return `${databaseLocation()} · ${users} user${users === 1 ? "" : "s"}`;
    },
  );

  /* ---- Video engine ---- */
  await step("Video engine (ffmpeg + fonts)", true, "Run `npm install` again, then `npm run fonts`.", async () => {
    const engine = videoEngineStatus();
    if (!engine.ready) throw new Error(engine.error ?? "ffmpeg was not found");
    return `ok · ${path.basename(resolveFont("latin"))}`;
  });

  /* ---- Text AI ---- */
  const providers = allProviders().filter((p) => p.configured());
  if (providers.length === 0) {
    rows.push({
      label: "Text AI",
      required: true,
      ok: false,
      note: "No AI key is set",
      fix: "Get a free key at aistudio.google.com/apikey and set GEMINI_API_KEY in .env",
    });
    console.log("  ✗ Text AI                                  no key is set");
  } else {
    for (const provider of providers) {
      await step(
        `Text AI — ${provider.key}`,
        false,
        "Replace the key, or add another provider. Groq and Ollama are both free.",
        async () => {
          await provider.complete<{ word: string }>({
            system: "Reply with JSON only.",
            prompt: 'Return exactly {"word":"ok"}',
            schema: {
              type: "object",
              properties: { word: { type: "string" } },
              required: ["word"],
            },
            maxTokens: 50,
          });
          return provider.model;
        },
      );
    }
  }

  /* ---- Vision ---- */
  await step(
    "Vision — reading a product photo",
    true,
    "Add a working AI key: Gemini (aistudio.google.com/apikey), Groq (console.groq.com/keys, free), or run Ollama locally.",
    async () => {
      const { provider } = await askVision<{ colour: string }>(
        [{ data: image, mimeType: "image/jpeg" }],
        {
          system: "Reply with JSON only.",
          prompt: "Dominant colour in one word.",
          schema: {
            type: "object",
            properties: { colour: { type: "string" } },
            required: ["colour"],
          },
          maxTokens: 60,
        },
      );
      return provider;
    },
  );

  /* ---- Public hosting ---- */
  await step(
    "Public media hosting",
    true,
    "Set CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET (free) or PUBLIC_MEDIA_BASE_URL. Without one of these nothing can be published to Instagram or Facebook.",
    async () => {
      const base = (process.env.PUBLIC_MEDIA_BASE_URL || "").replace(/\/$/, "");
      if (base && /^https:\/\//i.test(base)) return `your own URL: ${base}`;

      const up = await uploadPublic({
        data: image,
        filename: `probe-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        kind: "image",
      });
      const check = await fetch(up.data.url, { signal: AbortSignal.timeout(30_000) });
      if (!check.ok) throw new Error(`the URL did not open (${check.status})`);
      return `${up.data.host} · reachable from the internet`;
    },
  );

  /* ---- Trends (no key needed) ---- */
  await step("Trends — Google Autocomplete", false, "Check your internet connection or proxy.", async () => {
    const words = await googleAutocomplete("cotton kurti", process.env.TRENDS_GEO || "IN");
    if (words.length === 0) throw new Error("no suggestions came back");
    return `${words.length} keywords`;
  });

  await step("Trends — Google Trends", false, "Check your internet connection or proxy.", async () => {
    const topics = await googleDailyTrends(process.env.TRENDS_GEO || "IN");
    if (topics.length === 0) throw new Error("no topics came back");
    return `${topics.length} topics`;
  });

  /* ---- Image generation ---- */
  await step(
    "Image generation (Nano Banana)",
    false,
    "Add GEMINI_API_KEY. Reels still render without it, using your own photos.",
    async () => {
      const { data, provider } = await generateImage({
        prompt: "A plain blue ceramic mug on a white table, soft daylight",
        aspectRatio: "9:16",
        fit: false,
      });
      const meta = await sharp(data.data).metadata();
      return `${provider} · ${meta.width}x${meta.height}`;
    },
  );

  /* ---- Music ---- */
  await step(
    "Music for the reel",
    false,
    "JAMENDO_CLIENT_ID (free) naakho, ke storage/music/ ma mp3 mukho.",
    async () => {
      const picked = await pickMusic({ mood: "upbeat", minDuration: 30 });
      if (!picked) throw new Error("no track was found");
      return `${picked.track.source} · "${picked.track.title.slice(0, 30)}"`;
    },
  );

  /* ---- Voiceover ---- */
  await step(
    "Voiceover",
    false,
    "Add GEMINI_API_KEY or ELEVENLABS_API_KEY. Reels work fine without a voiceover.",
    async () => {
      const { data, provider } = await generateVoiceover({ text: "Short voiceover test." });
      return `${provider} · ${(data.data.length / 1024).toFixed(0)} KB`;
    },
  );

  /* ---- Meta ---- */
  await step(
    "Instagram / Facebook app",
    true,
    "developers.facebook.com/apps → META_APP_ID + META_APP_SECRET",
    async () => {
      const appId = process.env.META_APP_ID || "";
      const secret = process.env.META_APP_SECRET || "";
      if (!appId || !secret) throw new Error("META_APP_ID and META_APP_SECRET are not set");

      const version = process.env.META_GRAPH_VERSION || "v21.0";

      // Ask for an app access token: this is the honest way to tell whether
      // the ID and secret actually belong together. (`debug_token` sometimes
      // answers "Cannot get application info due to a system error", which is
      // a misleading signal.)
      const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
      url.searchParams.set("client_id", appId);
      url.searchParams.set("client_secret", secret);
      url.searchParams.set("grant_type", "client_credentials");

      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const json = (await response.json()) as {
        access_token?: string;
        error?: { message?: string };
      };

      if (json.error) throw new Error(json.error.message ?? "Meta refused the request");
      if (!json.access_token) throw new Error("META_APP_ID or META_APP_SECRET is wrong");
      return `app ${appId} verified`;
    },
  );

  /* ---- Report ---- */
  const blocking = rows.filter((r) => r.required && !r.ok);
  const passed = rows.filter((r) => r.ok).length;

  console.log(`\n  ${passed}/${rows.length} working\n`);

  if (blocking.length > 0) {
    console.log("  Reels cannot be built until these are fixed:\n");
    for (const row of blocking) {
      console.log(`    • ${row.label}`);
      console.log(`      ${row.note.split("\n").slice(0, 4).join("\n      ").slice(0, 500)}`);
      if (row.fix) console.log(`      → ${row.fix}`);
      console.log("");
    }
  }

  const optional = rows.filter((r) => !r.required && !r.ok);
  if (optional.length > 0) {
    console.log("  Optional — everything works without these, but better with them:\n");
    for (const row of optional) {
      console.log(`    • ${row.label} — ${row.fix ?? ""}`);
    }
    console.log("");
  }

  if (blocking.length === 0) {
    console.log("  Everything essential works — open the Reel Studio.\n");
  }

  const { flushDatabase } = await import("../src/lib/db");
  flushDatabase();

  process.exit(blocking.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nThe probe crashed:", error);
  process.exit(1);
});
