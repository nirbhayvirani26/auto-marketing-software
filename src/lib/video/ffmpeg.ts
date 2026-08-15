/**
 * ffmpeg no wrapper.
 *
 * Binary `ffmpeg-static` package sathe j aave che — tamare kai install
 * karvanu nathi, koi PATH set karvanu nathi. Windows, Mac, Linux — traney
 * par ek j rite chale che.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ *
 *  Binary shodhvi
 * ------------------------------------------------------------------ */

let ffmpegPathCache: string | null = null;
let ffprobePathCache: string | null = null;

export function ffmpegPath(): string {
  if (ffmpegPathCache) return ffmpegPathCache;

  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && existsSync(fromEnv)) {
    ffmpegPathCache = fromEnv;
    return fromEnv;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bundled = require("ffmpeg-static") as string | null;
  if (bundled && existsSync(bundled)) {
    ffmpegPathCache = bundled;
    return bundled;
  }

  throw new Error(
    "ffmpeg madyu nahi. `npm install ffmpeg-static` chalavo, athva .env ma FFMPEG_PATH set karo.",
  );
}

export function ffprobePath(): string {
  if (ffprobePathCache) return ffprobePathCache;

  const fromEnv = process.env.FFPROBE_PATH;
  if (fromEnv && existsSync(fromEnv)) {
    ffprobePathCache = fromEnv;
    return fromEnv;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bundled = require("ffprobe-static") as { path?: string };
  if (bundled?.path && existsSync(bundled.path)) {
    ffprobePathCache = bundled.path;
    return bundled.path;
  }

  throw new Error("ffprobe was not found. Run `npm install ffprobe-static`.");
}

/** Setup page mate — video banavi shakash ke nahi. */
export function videoEngineStatus(): {
  ready: boolean;
  ffmpeg?: string;
  ffprobe?: string;
  error?: string;
} {
  try {
    return { ready: true, ffmpeg: ffmpegPath(), ffprobe: ffprobePath() };
  } catch (error) {
    return { ready: false, error: (error as Error).message };
  }
}

/* ------------------------------------------------------------------ *
 *  Chalavvanu
 * ------------------------------------------------------------------ */

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr: string,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

/** ffmpeg no stderr bahu lambo hoy che — chhelli kaam ni line j kadho. */
function usefulError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const known = lines.filter((line) =>
    /error|invalid|no such file|not found|failed|unable|cannot|does not/i.test(line),
  );

  return (known.length ? known.slice(-3) : lines.slice(-3)).join(" | ").slice(0, 600);
}

export type RunOptions = {
  timeoutMs?: number;
  /** Progress line aave tyare — UI ne batavva mate. */
  onProgress?: (info: { timeSeconds: number; speed?: string }) => void;
};

export async function runFfmpeg(
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  const bin = ffmpegPath();
  const timeout = options.timeoutMs ?? 15 * 60_000;

  // `-nostdin` vagar ffmpeg kyarek input ni raah jue ane hang thay che.
  const fullArgs = ["-hide_banner", "-nostdin", "-y", ...args];

  try {
    const { stderr } = await execFileAsync(bin, fullArgs, {
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return stderr;
  } catch (error) {
    const err = error as { stderr?: string; killed?: boolean; message: string };
    if (err.killed) {
      throw new FfmpegError(
        `ffmpeg ne bahu var lagi (${Math.round(timeout / 1000)}s) — reel nani karo ke ochha scene rakho.`,
        fullArgs,
        err.stderr ?? "",
      );
    }
    throw new FfmpegError(
      `ffmpeg fail: ${usefulError(err.stderr ?? err.message)}`,
      fullArgs,
      err.stderr ?? "",
    );
  }
}

/* ------------------------------------------------------------------ *
 *  Probe
 * ------------------------------------------------------------------ */

export type MediaInfo = {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  codec: string;
  bitrate: number;
};

export async function probe(filePath: string): Promise<MediaInfo> {
  if (!existsSync(filePath)) throw new Error(`File nathi: ${filePath}`);

  const { stdout } = await execFileAsync(
    ffprobePath(),
    [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 60_000 },
  );

  const json = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
      r_frame_rate?: string;
    }>;
  };

  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  const [num, den] = (video?.r_frame_rate ?? "30/1").split("/").map(Number);
  const fps = den ? num / den : 30;

  return {
    duration: Number(json.format?.duration ?? video?.duration ?? 0) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    codec: video?.codec_name ?? audio?.codec_name ?? "",
    bitrate: Number(json.format?.bit_rate ?? 0) || 0,
  };
}

/* ------------------------------------------------------------------ *
 *  Temp folder
 * ------------------------------------------------------------------ */

export async function withTempDir<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ *
 *  Filter-graph ma path/text naakhva mate escaping
 * ------------------------------------------------------------------ */

/**
 * ffmpeg na filter argument ma path naakhvo hoy tyare Windows nu `C:\` ane
 * `:` `'` `\` badha ne escape karva pade che — nahi to filter parse fail thay.
 */
export function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/** drawtext na `text=` ma sidhu lakhvu hoy tyare. (Aapne mota bhage textfile
 *  vaparie chie, pan nana label mate aa kaam aave che.) */
export function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019") // apostrophe ne typographic thi badlo — sauthi surakshit
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/\n/g, "\\n");
}
