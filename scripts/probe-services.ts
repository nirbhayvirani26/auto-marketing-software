/**
 * Bahar ni badhi service ne EK NANI SACHI request mokle che.
 *
 *   npm run test:services
 *
 * "Key set che" ane "key kaam kare che" — e be alag vaat che. Dakhla
 * tarike key barabar hoy pan credit khatam hoy, ke free limit lagi hoy.
 * Aa script e j pakde che, ane su karvu e pan kahe che.
 *
 * (Aa j test admin panel ma Setup page par button tarike pan che.)
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
  console.log("║  Badhi service kharekhar chale che ke nahi               ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const image = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();

  /* ---- MongoDB ---- */
  // Aa sauthi pehla — DB band hoy to bija ghana test khota karan sathe
  // fail thay che ane user gothvai jaay che.
  await step(
    "MongoDB",
    true,
    "`npm run mongo` chalavo (bija terminal ma), ke .env ma MONGODB_URI barabar karo.",
    async () => {
      const { connectDB } = await import("../src/lib/db");
      await connectDB();
      const mongoose = (await import("mongoose")).default;
      if (mongoose.connection.readyState !== 1) throw new Error("connect na thayu");
      return mongoose.connection.name;
    },
  );

  /* ---- Video engine ---- */
  await step("Video engine (ffmpeg + font)", true, "`npm install` fari chalavo, pachi `npm run fonts`.", async () => {
    const engine = videoEngineStatus();
    if (!engine.ready) throw new Error(engine.error ?? "ffmpeg madyu nahi");
    return `ok · ${path.basename(resolveFont("latin"))}`;
  });

  /* ---- Text AI ---- */
  const providers = allProviders().filter((p) => p.configured());
  if (providers.length === 0) {
    rows.push({
      label: "AI lakhan",
      required: true,
      ok: false,
      note: "Ek pan AI key set nathi",
      fix: "aistudio.google.com/apikey par thi FREE key lo → .env ma GEMINI_API_KEY",
    });
    console.log("  ✗ AI lakhan                                ek pan key set nathi");
  } else {
    for (const provider of providers) {
      await step(
        `AI lakhan — ${provider.key}`,
        false,
        "Key badlo ke bijo free provider naakho.",
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
    "AI — image samajvi",
    true,
    "GEMINI_API_KEY (free) naakho — aistudio.google.com/apikey",
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
    "CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET (free), ke PUBLIC_MEDIA_BASE_URL. Aa vagar IG/FB par post NAHI thay.",
    async () => {
      const base = (process.env.PUBLIC_MEDIA_BASE_URL || "").replace(/\/$/, "");
      if (base && /^https:\/\//i.test(base)) return `potanu URL: ${base}`;

      const up = await uploadPublic({
        data: image,
        filename: `probe-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        kind: "image",
      });
      const check = await fetch(up.data.url, { signal: AbortSignal.timeout(30_000) });
      if (!check.ok) throw new Error(`URL khulyu nahi (${check.status})`);
      return `${up.data.host} · bahar thi khule che`;
    },
  );

  /* ---- Trends (key vagar) ---- */
  await step("Trends — Google Autocomplete", false, "Internet/proxy check karo.", async () => {
    const words = await googleAutocomplete("cotton kurti", process.env.TRENDS_GEO || "IN");
    if (words.length === 0) throw new Error("koi suggestion na madyu");
    return `${words.length} keyword`;
  });

  await step("Trends — Google Trends", false, "Internet/proxy check karo.", async () => {
    const topics = await googleDailyTrends(process.env.TRENDS_GEO || "IN");
    if (topics.length === 0) throw new Error("koi topic na madyo");
    return `${topics.length} topic`;
  });

  /* ---- Image generation ---- */
  await step(
    "AI image (avatar + kapda)",
    false,
    "GEMINI_API_KEY naakho. Aa vagar pan reel banse — tamari potani image thi.",
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
    "Reel nu music",
    false,
    "JAMENDO_CLIENT_ID (free) naakho, ke storage/music/ ma mp3 mukho.",
    async () => {
      const picked = await pickMusic({ mood: "upbeat", minDuration: 30 });
      if (!picked) throw new Error("ek pan track na madyo");
      return `${picked.track.source} · "${picked.track.title.slice(0, 30)}"`;
    },
  );

  /* ---- Voiceover ---- */
  await step(
    "Voiceover",
    false,
    "GEMINI_API_KEY ke ELEVENLABS_API_KEY naakho. Voiceover vagar pan chale che.",
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
      if (!appId || !secret) throw new Error("META_APP_ID / META_APP_SECRET set nathi");

      const version = process.env.META_GRAPH_VERSION || "v21.0";

      // App access token magiye chie — ID ane Secret jode barabar che ke
      // nahi e nakki karvano aa j saacho rasto che. (`debug_token` kyarek
      // "Cannot get application info due to a system error" aape che, e
      // khoto sanket che.)
      const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
      url.searchParams.set("client_id", appId);
      url.searchParams.set("client_secret", secret);
      url.searchParams.set("grant_type", "client_credentials");

      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const json = (await response.json()) as {
        access_token?: string;
        error?: { message?: string };
      };

      if (json.error) throw new Error(json.error.message ?? "Meta e na paadi");
      if (!json.access_token) throw new Error("META_APP_ID ke META_APP_SECRET khoto che");
      return `app ${appId} barabar che`;
    },
  );

  /* ---- Report ---- */
  const blocking = rows.filter((r) => r.required && !r.ok);
  const passed = rows.filter((r) => r.ok).length;

  console.log(`\n  ${passed}/${rows.length} chale che\n`);

  if (blocking.length > 0) {
    console.log("  ⚠ AA THAY TYA SUDHI REEL NAHI BANE:\n");
    for (const row of blocking) {
      console.log(`    • ${row.label}`);
      console.log(`      ${row.note.split("\n").slice(0, 4).join("\n      ").slice(0, 500)}`);
      if (row.fix) console.log(`      → ${row.fix}`);
      console.log("");
    }
  }

  const optional = rows.filter((r) => !r.required && !r.ok);
  if (optional.length > 0) {
    console.log("  ○ Aa na hoy to pan chale, pan hoy to saru:\n");
    for (const row of optional) {
      console.log(`    • ${row.label} — ${row.fix ?? ""}`);
    }
    console.log("");
  }

  if (blocking.length === 0) {
    console.log("  ✅ Badhu jaruri kaam kare che — Reel Studio ma javo.\n");
  }

  try {
    const mongoose = (await import("mongoose")).default;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  } catch {
    /* connection hato j nahi */
  }

  process.exit(blocking.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nProbe crash thayu:", error);
  process.exit(1);
});
