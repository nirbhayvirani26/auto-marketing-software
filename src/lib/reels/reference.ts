/**
 * "Aa jevi reel banavi aapo" — reference reel ne samajvanu.
 *
 * Aapne reference video ne KOPY nathi karta (e copyright no bhang thaay).
 * Aapne eni RACHNA sikhie chie: ketla shot che, ketli var e badlay che,
 * hook kevo che, text kai rite mukelo che, mood kevo che. E rachna pachi
 * TAMARA product ane TAMARI avatar sathe fari thi banave chie.
 *
 * Kaam traan tabakke:
 *   1. ffmpeg thi scene-cut shodho → pacing ane shot count
 *   2. thoda frames kaadho → vision ne batavo
 *   3. AI e badhu jodine "style card" banave
 */

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ffmpegPath, probe, withTempDir, runFfmpeg } from "@/lib/video/ffmpeg";
import { complete } from "@/lib/ai/index";
import { analyzeFramesForStyle } from "./frame-vision";
import type { ReferenceStyle } from "./plan";

const execFileAsync = promisify(execFile);

export type ReferenceAnalysis = ReferenceStyle & {
  duration: number;
  cutTimes: number[];
  frameDescriptions: string[];
};

/* ------------------------------------------------------------------ *
 *  1. Scene cuts
 * ------------------------------------------------------------------ */

/**
 * ffmpeg no `scene` detector — ek frame thi biju frame ketlu badlayu e
 * mape che. 0.3 thi upar hoy etle "navo shot shuru thayo" ganie chie.
 */
async function detectCuts(videoPath: string): Promise<number[]> {
  const args = [
    "-hide_banner", "-nostdin",
    "-i", videoPath,
    "-filter:v", "select='gt(scene,0.3)',showinfo",
    "-f", "null", "-",
  ];

  let stderr = "";
  try {
    const result = await execFileAsync(ffmpegPath(), args, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 5 * 60_000,
      windowsHide: true,
    });
    stderr = result.stderr;
  } catch (error) {
    // showinfo no output stderr ma j aave che — exit code gme te hoy.
    stderr = (error as { stderr?: string }).stderr ?? "";
  }

  return [...stderr.matchAll(/pts_time:([\d.]+)/g)]
    .map((match) => Number(match[1]))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 *  2. Frames
 * ------------------------------------------------------------------ */

async function extractFrames(
  videoPath: string,
  dir: string,
  count: number,
  duration: number,
): Promise<Buffer[]> {
  // Aakha video ma sarkha antare frames — shuru ane ant ne chhodine.
  const step = duration / (count + 1);

  const frames: Buffer[] = [];
  for (let i = 1; i <= count; i += 1) {
    const at = step * i;
    const file = path.join(dir, `frame-${i}.jpg`);
    try {
      await runFfmpeg(
        ["-ss", at.toFixed(2), "-i", videoPath, "-frames:v", "1", "-q:v", "4", "-vf", "scale=720:-1", file],
        { timeoutMs: 60_000 },
      );
    } catch {
      // Ek frame na malyo to chalse — bija thi kaam thai jashe.
    }
  }

  for (const file of (await readdir(dir)).filter((f) => f.startsWith("frame-"))) {
    frames.push(await readFile(path.join(dir, file)));
  }
  return frames;
}

/* ------------------------------------------------------------------ *
 *  3. Style card
 * ------------------------------------------------------------------ */

const STYLE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Two sentences describing what this reel does and why it works." },
    shotTypes: { type: "array", items: { type: "string" }, description: "The kinds of shots used, e.g. close-up detail, walking shot, flat lay, mirror selfie, before/after." },
    textStyle: { type: "string", description: "How on-screen text is used: placement, size, how many words, whether it is always present." },
    hookStyle: { type: "string", description: "What the first 3 seconds do to stop the scroll." },
    mood: { type: "string", description: "Overall feel: colour grade, energy, lighting." },
    structure: { type: "array", items: { type: "string" }, description: "The beat-by-beat structure, one short line per beat." },
  },
  required: ["summary", "shotTypes", "textStyle", "hookStyle", "mood", "structure"],
};

export async function analyzeReference(
  videoPath: string,
): Promise<ReferenceAnalysis> {
  const info = await probe(videoPath);
  if (!info.hasVideo) throw new Error("There is no video in that file");

  const duration = info.duration || 30;

  return withTempDir("refframes", async (dir) => {
    const [cuts, frames] = await Promise.all([
      detectCuts(videoPath).catch(() => [] as number[]),
      extractFrames(videoPath, dir, 6, duration),
    ]);

    // Cut na madya to sarerash 3 second no shot ganie chie.
    const sceneCount = Math.max(2, cuts.length + 1);
    const averageSceneDuration = duration / sceneCount;
    const pacing: ReferenceStyle["pacing"] =
      averageSceneDuration < 1.8 ? "fast" : averageSceneDuration < 3.5 ? "medium" : "slow";

    let frameDescriptions: string[] = [];
    let vision: Awaited<ReturnType<typeof analyzeFramesForStyle>> | null = null;

    if (frames.length > 0) {
      try {
        vision = await analyzeFramesForStyle(frames);
        frameDescriptions = vision.descriptions;
      } catch {
        // Vision na chalyu to fakt aakda thi kaam chalavie chie.
      }
    }

    let style: {
      summary: string;
      shotTypes: string[];
      textStyle: string;
      hookStyle: string;
      mood: string;
      structure: string[];
    };

    try {
      const { data } = await complete<typeof style>({
        system:
          "You are a short-form video editor who reverse-engineers why a reel works. You describe structure and technique, never the specific brand or words used.",
        prompt: [
          `A reel of ${duration.toFixed(1)} seconds with about ${sceneCount} shots (average ${averageSceneDuration.toFixed(1)}s per shot, ${pacing} pacing).`,
          cuts.length ? `Cuts happen at: ${cuts.slice(0, 25).map((c) => c.toFixed(1)).join("s, ")}s` : "",
          "",
          frameDescriptions.length
            ? `Frames sampled through the reel, in order:\n${frameDescriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}`
            : "No frames could be read — infer from the timing alone.",
          "",
          "Describe the reel's structure and technique so another creator could rebuild the same rhythm with a completely different product.",
        ]
          .filter(Boolean)
          .join("\n"),
        schema: STYLE_SCHEMA,
        maxTokens: 2000,
      });
      style = data;
    } catch {
      style = {
        summary: `${pacing} paced reel with about ${sceneCount} shots.`,
        shotTypes: ["product close-up", "lifestyle shot"],
        textStyle: "Short bold text, centred",
        hookStyle: "Fast visual reveal in the first shot",
        mood: vision?.mood ?? "clean and modern",
        structure: [],
      };
    }

    return {
      sceneCount,
      averageSceneDuration,
      pacing,
      shotTypes: (style.shotTypes ?? []).map(String).slice(0, 8),
      textStyle: String(style.textStyle ?? ""),
      hookStyle: String(style.hookStyle ?? ""),
      mood: String(style.mood ?? ""),
      summary: [String(style.summary ?? ""), ...(style.structure ?? []).map(String)]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 1200),
      duration,
      cutTimes: cuts,
      frameDescriptions,
    };
  });
}

/* ------------------------------------------------------------------ *
 *  Reference video lavvo
 * ------------------------------------------------------------------ */

/**
 * Instagram/TikTok ni LINK par thi video utarvu.
 *
 * ⚠️ Aa fakt tyare j chale che jyare tamare potane yt-dlp install karyu
 * hoy ane .env ma YTDLP_PATH aapyu hoy. Aapne e bundle nathi karta —
 * kaya video utarva e tamari jawabdari che (potani reel, ke jenі paravanagi
 * hoy e j). Saral ane surakshit rasto: video download karine app ma
 * SIDHU UPLOAD karo.
 */
export async function downloadReference(url: string, targetPath: string): Promise<string> {
  const ytdlp = process.env.YTDLP_PATH;
  if (!ytdlp) {
    throw new Error(
      "Link par thi video utarvani suvidha band che. Reel ne tamara phone/computer ma download karo ane ahiya file upload karo — e sauthi saral ane surakshit rasto che. (Jankar hoy to: yt-dlp install karine .env ma YTDLP_PATH set karo.)",
    );
  }

  await execFileAsync(
    ytdlp,
    ["-f", "mp4/best", "-o", targetPath, "--no-playlist", "--max-filesize", "200M", url],
    { timeout: 5 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );

  return targetPath;
}
