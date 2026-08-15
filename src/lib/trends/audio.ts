/**
 * Music for the reel.
 *
 * ================== READ THIS FIRST ==================
 * Instagram's "trending song" — the licensed tracks you see inside the app
 * while making a Reel — CANNOT be attached through the Graph API. Meta has
 * never opened the music catalogue. No tool can do this; it is a platform
 * limitation, not a shortcoming of this code.
 *
 * So the app provides two things instead:
 *
 *   1. MUSIC BAKED INTO THE VIDEO — a royalty-free / Creative Commons track
 *      playing inside the reel itself. This publishes automatically with no
 *      risk of a copyright strike.
 *
 *   2. A TRENDING-AUDIO SUGGESTION — which sound to search for in the app.
 *      After publishing: Instagram → Edit → Audio → apply that sound. Two
 *      taps, and the trending-audio boost still applies.
 *
 * Music sources, in order:
 *   jamendo  — free key, hundreds of thousands of CC tracks, searchable by mood
 *   ccmixter — no key needed
 *   local    — your own mp3 files (the MUSIC_DIR folder, or uploaded in the app)
 * ============================================================
 */

import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { apiFetch, runChain, FatalError } from "@/lib/pipeline/chain";
import { saveMediaFromUrl, saveMedia, ensureLocalPath, mediaRoot } from "@/lib/media/store";
import { MediaAsset, type MediaAssetDocument } from "@/models/MediaAsset";
import { connectDB } from "@/lib/db";
import { readFile } from "node:fs/promises";

export type MusicMood =
  | "upbeat"
  | "chill"
  | "cinematic"
  | "luxury"
  | "festive"
  | "energetic"
  | "romantic"
  | "hiphop";

export type MusicTrack = {
  title: string;
  artist: string;
  /** Download karva layak sidhu URL. */
  url: string;
  duration: number;
  license: string;
  source: string;
};

/** Product ni style par thi music no mood nakki kare. */
export function moodForProduct(input: {
  category?: string;
  style?: string;
  occasions?: string[];
  positioning?: string;
  targetGender?: string;
}): MusicMood {
  const text = [
    input.category,
    input.style,
    input.positioning,
    ...(input.occasions ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (/wedding|bridal|festive|diwali|navratri|traditional|ethnic|saree|lehenga/.test(text)) {
    return "festive";
  }
  if (/luxury|premium|gold|diamond|designer|couture|watch/.test(text)) return "luxury";
  if (/street|urban|sneaker|hoodie|gym|sport|active|fitness/.test(text)) return "hiphop";
  if (/romantic|date|valentine|gift|perfume|jewel/.test(text)) return "romantic";
  if (/home|decor|candle|skincare|wellness|spa|book/.test(text)) return "chill";
  if (/tech|gadget|electronic|camera|drone/.test(text)) return "cinematic";
  return "upbeat";
}

const MOOD_TAGS: Record<MusicMood, string> = {
  upbeat: "upbeat+pop+happy",
  chill: "chillout+lounge+ambient",
  cinematic: "cinematic+epic+electronic",
  luxury: "elegant+jazz+lounge",
  festive: "world+indian+festive",
  energetic: "energetic+electronic+dance",
  romantic: "romantic+acoustic+soft",
  hiphop: "hiphop+trap+beat",
};

/**
 * IG app ma kaya trending sound shodhva — mood pramane.
 * (Aa search terms che, actual song nahi — karan uper lakhyu che.)
 */
const IG_AUDIO_HINTS: Record<MusicMood, string[]> = {
  upbeat: ["trending upbeat", "viral pop remix", "feel good trending"],
  chill: ["aesthetic chill", "lofi trending", "soft vibes trending"],
  cinematic: ["cinematic trending", "epic transition sound", "dramatic reveal"],
  luxury: ["luxury aesthetic", "rich vibes trending", "elegant transition"],
  festive: ["festive trending", "wedding trending song", "traditional remix trending"],
  energetic: ["gym trending", "high energy transition", "workout viral"],
  romantic: ["romantic trending", "love song trending", "soft romantic viral"],
  hiphop: ["hiphop trending", "trap remix viral", "drip trending sound"],
};

export function instagramAudioHints(mood: MusicMood): {
  mood: MusicMood;
  searchTerms: string[];
  howTo: string;
} {
  return {
    mood,
    searchTerms: IG_AUDIO_HINTS[mood],
    howTo:
      "Reel publish thaya pachi Instagram app ma reel kholo → ⋯ → Edit → Audio → uper na koi ek shabd search karo → 'Trending' filter lagavo → sound select karo. Aa karvathi IG no trending-audio reach boost pan male che. (API thi aa automatic karvu Meta e sabh mate band rakhyu che.)",
  };
}

/* ------------------------------------------------------------------ *
 *  Source 1 — Jamendo (free key, laakho CC track)
 * ------------------------------------------------------------------ */

async function fromJamendo(
  mood: MusicMood,
  minDuration: number,
  signal: AbortSignal,
): Promise<MusicTrack> {
  const clientId = process.env.JAMENDO_CLIENT_ID || "";
  const url = new URL("https://api.jamendo.com/v3.0/tracks/");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "30");
  url.searchParams.set("tags", MOOD_TAGS[mood]);
  url.searchParams.set("audioformat", "mp32");
  url.searchParams.set("order", "popularity_month");
  url.searchParams.set("include", "musicinfo");
  url.searchParams.set("durationbetween", `${Math.ceil(minDuration)}_400`);

  const json = await apiFetch<{
    headers?: { status?: string; error_message?: string };
    results?: Array<{
      name: string;
      artist_name: string;
      audio: string;
      audiodownload: string;
      duration: number;
      license_ccurl?: string;
    }>;
  }>(url.toString(), { signal });

  if (json.headers?.status !== "success") {
    throw new FatalError(`Jamendo: ${json.headers?.error_message ?? "fail"}`);
  }

  const usable = (json.results ?? []).filter(
    (t) => t.duration >= minDuration && (t.audiodownload || t.audio),
  );
  if (usable.length === 0) throw new Error("Jamendo had no track for this mood");

  // Popular ma thi random — dar vakhate same song na vage.
  const pick = usable[Math.floor(Math.random() * Math.min(usable.length, 15))];

  return {
    title: pick.name,
    artist: pick.artist_name,
    url: pick.audiodownload || pick.audio,
    duration: pick.duration,
    license: pick.license_ccurl ?? "Jamendo (Creative Commons)",
    source: "jamendo",
  };
}

/* ------------------------------------------------------------------ *
 *  Source 2 — ccMixter (koi key nahi)
 * ------------------------------------------------------------------ */

/**
 * ccMixter response headers bahu moti mokle che — ek thi vadhu result
 * magie to Node no default 16KB header limit tuti jaay che ane
 * `UND_ERR_HEADERS_OVERFLOW` aave che. `fetch()` ma aa limit badli
 * shakati nathi, etle ahiya sadho `https` module vaparie chie jya
 * `maxHeaderSize` aapi shakay che.
 */
function fetchWithBigHeaders(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    void import("node:https").then(({ request }) => {
      const req = request(
        url,
        {
          method: "GET",
          maxHeaderSize: 256 * 1024,
          headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
          timeout: 25_000,
        },
        (res) => {
          if ((res.statusCode ?? 0) >= 400) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          res.on("error", reject);
        },
      );

      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      signal.addEventListener("abort", () => req.destroy(new Error("aborted")));
      req.end();
    }, reject);
  });
}

async function fromCcMixter(
  mood: MusicMood,
  minDuration: number,
  signal: AbortSignal,
): Promise<MusicTrack> {
  const tag = MOOD_TAGS[mood].split("+")[0];
  const url = new URL("https://ccmixter.org/api/query");
  url.searchParams.set("f", "json");
  url.searchParams.set("limit", "25");
  url.searchParams.set("tags", tag);
  url.searchParams.set("sinced", "2 years ago");

  const raw = await fetchWithBigHeaders(url.toString(), signal);

  let json: Array<{
    upload_name?: string;
    user_name?: string;
    license_name?: string;
    files?: Array<{ download_url?: string; file_format_info?: { length?: string } }>;
  }>;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`ccMixter no jawab JSON ma nathi: ${raw.slice(0, 120)}`);
  }

  const candidates = (Array.isArray(json) ? json : [])
    .map((item) => {
      const file = item.files?.find((f) => f.download_url?.endsWith(".mp3"));
      if (!file?.download_url) return null;
      return {
        title: item.upload_name ?? "Untitled",
        artist: item.user_name ?? "ccMixter artist",
        url: file.download_url,
        duration: parseLength(file.file_format_info?.length) || 180,
        license: item.license_name ?? "Creative Commons",
        source: "ccmixter",
      } satisfies MusicTrack;
    })
    .filter((t): t is MusicTrack => t !== null && t.duration >= minDuration);

  if (candidates.length === 0) throw new Error("No track was found on ccMixter");
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function parseLength(value?: string): number {
  if (!value) return 0;
  const parts = value.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/* ------------------------------------------------------------------ *
 *  Source 3 — tamari potani mp3
 * ------------------------------------------------------------------ */

function musicDir(): string {
  return process.env.MUSIC_DIR
    ? path.resolve(process.env.MUSIC_DIR)
    : path.join(mediaRoot(), "..", "music");
}

async function fromLocalFolder(): Promise<MusicTrack> {
  const dir = musicDir();
  if (!existsSync(dir)) throw new FatalError(`Music folder nathi: ${dir}`);

  const files = (await readdir(dir)).filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f));
  if (files.length === 0) throw new FatalError(`${dir} ma ek pan audio file nathi`);

  const pick = files[Math.floor(Math.random() * files.length)];
  return {
    title: path.basename(pick, path.extname(pick)),
    artist: "Local library",
    url: `file://${path.join(dir, pick)}`,
    duration: 0,
    license: "Tamari potani file",
    source: "local",
  };
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

export type PickMusicOptions = {
  mood: MusicMood;
  /** Reel ni lambai — track aa thi lambo hovo joiye. */
  minDuration: number;
  brand?: string;
  /** Brand e potani mp3 upload kari hoy to e j vaparo. */
  preferUploaded?: boolean;
};

/**
 * Ek music track pasand kari, download kari, MediaAsset tarike save kare.
 * Pacho aavelo asset render pipeline ma sidho vaparay che.
 */
export async function pickMusic(
  options: PickMusicOptions,
): Promise<{ asset: MediaAssetDocument; track: MusicTrack } | null> {
  await connectDB();

  // Brand e potani music upload kari hoy to e ne pehli pasandgi.
  if (options.preferUploaded !== false && options.brand) {
    const uploaded = await MediaAsset.find({
      brand: options.brand,
      role: "music",
      provider: "upload",
    })
      .sort({ createdAt: -1 })
      .limit(20);

    const usable = uploaded.filter(
      (a) => !a.duration || a.duration >= options.minDuration,
    );
    if (usable.length > 0) {
      const asset = usable[Math.floor(Math.random() * usable.length)];
      return {
        asset,
        track: {
          title: asset.filename,
          artist: "Tamaru upload",
          url: asset.publicUrl ?? "",
          duration: asset.duration ?? 0,
          license: "Tamaru potanu",
          source: "upload",
        },
      };
    }
  }

  let picked: MusicTrack;
  try {
    const result = await runChain<MusicTrack>(
      [
        {
          name: "jamendo",
          label: "Jamendo (free CC music)",
          free: true,
          configured: () => Boolean(process.env.JAMENDO_CLIENT_ID),
          run: (signal) => fromJamendo(options.mood, options.minDuration, signal),
          timeoutMs: 30_000,
        },
        {
          name: "ccmixter",
          label: "ccMixter (no key needed)",
          free: true,
          configured: () => process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
          run: (signal) => fromCcMixter(options.mood, options.minDuration, signal),
          timeoutMs: 30_000,
        },
        {
          name: "local",
          label: "Local music folder",
          free: true,
          configured: () => existsSync(musicDir()),
          run: () => fromLocalFolder(),
          timeoutMs: 10_000,
        },
      ],
      { label: "Reel music", retries: 1, backoffMs: 800 },
    );
    picked = result.data;
  } catch {
    // Music na madyu to reel chup-chaap banse — atkavu nathi.
    return null;
  }

  try {
    // Ek j track vaar vaar download na karie.
    const existing = await MediaAsset.findOne({
      role: "music",
      prompt: picked.url,
    });
    if (existing) return { asset: existing, track: picked };

    let asset: MediaAssetDocument;
    if (picked.url.startsWith("file://")) {
      const filePath = picked.url.slice("file://".length);
      asset = await saveMedia({
        data: await readFile(filePath),
        filename: path.basename(filePath),
        mimeType: "audio/mpeg",
        role: "music",
        brand: options.brand,
        provider: picked.source,
        prompt: picked.url,
        duration: picked.duration,
      });
    } else {
      asset = await saveMediaFromUrl(picked.url, {
        filename: `${picked.source}-${Date.now()}.mp3`,
        mimeType: "audio/mpeg",
        role: "music",
        brand: options.brand,
        provider: picked.source,
        prompt: picked.url,
        duration: picked.duration,
      });
    }

    await ensureLocalPath(asset);
    return { asset, track: picked };
  } catch {
    return null;
  }
}

/** Setup page mate. */
export function musicStatus() {
  return [
    {
      key: "jamendo",
      label: "Jamendo",
      free: true,
      configured: Boolean(process.env.JAMENDO_CLIENT_ID),
      note: "Sauthi saaru — laakho CC track. devportal.jamendo.com par thi free client_id.",
    },
    {
      key: "ccmixter",
      label: "ccMixter",
      free: true,
      configured: process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
      note: "No key needed — works immediately.",
    },
    {
      key: "local",
      label: "Tamari potani mp3",
      free: true,
      configured: existsSync(musicDir()),
      note: `${musicDir()} folder ma mp3 mukho, ke app ma upload karo.`,
    },
  ];
}
