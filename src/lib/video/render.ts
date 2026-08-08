/**
 * Reel renderer — scenes andar, 1080x1920 mp4 bahar.
 *
 * Kaam be tabakke thay che, jaani joine:
 *
 *   1. Dareak scene ne alag nani clip tarike render karo
 *   2. Badhi clips ne transition sathe jodo + music/voiceover naakho
 *
 * Ek j motu filter_complex banavvu shakya che, pan e debug karvu asakya
 * thai jaay che ane ek scene ma bhool hoy to aakhu fail thay. Alag alag
 * karvathi bhool kaya scene ma che e sidhu khabar pade che.
 *
 * Output Instagram Reels ni spec pramane j che:
 *   1080x1920 (9:16) · 30fps · H.264 High · yuv420p · AAC 128k 44.1kHz stereo
 *   + faststart (jethi Meta ne aakhi file utaarya vagar j shuru thai jaay)
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  runFfmpeg,
  probe,
  escapeFilterPath,
  withTempDir,
  type RunOptions,
} from "./ffmpeg";
import { resolveFont, type TextScript } from "./fonts";

/* ------------------------------------------------------------------ *
 *  Types
 * ------------------------------------------------------------------ */

export type MotionPreset =
  | "zoom-in"
  | "zoom-out"
  | "pan-left"
  | "pan-right"
  | "pan-up"
  | "pan-down"
  | "none";

export type TransitionType =
  | "fade"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "wipeleft"
  | "circleopen"
  | "dissolve"
  | "smoothleft"
  | "none";

export type TextPosition = "top" | "center" | "bottom";
export type TextSize = "hero" | "large" | "medium" | "small";
export type TextStyle = "box" | "outline" | "shadow";

export type TextOverlay = {
  text: string;
  position?: TextPosition;
  size?: TextSize;
  style?: TextStyle;
  /** "#ffffff" ke "white" — ffmpeg na color naam pan chale. */
  color?: string;
  boxColor?: string;
  /** Scene ni andar kyare dekhay (second). Khali = aakha scene bhar. */
  startAt?: number;
  endAt?: number;
};

export type Scene = {
  /** Local file nu path — image ke video. */
  source: string;
  sourceType: "image" | "video";
  /** Seconds. */
  duration: number;
  motion?: MotionPreset;
  overlays?: TextOverlay[];
  /** Video source hoy to kya thi kaapvu. */
  trimStart?: number;
  /** Aa scene ma aavva mate no transition (pehla scene par lagu nathi padto). */
  transition?: TransitionType;
};

export type RenderOptions = {
  scenes: Scene[];
  outputPath: string;

  width?: number;
  height?: number;
  fps?: number;

  /** Background music nu local path. */
  musicPath?: string;
  /** 0-1. Voiceover hoy to aapoaap ghatadi devay che. */
  musicVolume?: number;
  /** Voiceover audio nu local path. */
  voiceoverPath?: string;

  transitionDuration?: number;
  defaultTransition?: TransitionType;

  /** Text kai lipi ma che — font aa pramane pasand thay che. */
  script?: TextScript;
  /** Dareak scene par nichle khune nanu brand naam. */
  watermark?: string;

  /** Encode ni gunvatta — nichu = saru pan motu. */
  crf?: number;
  preset?: string;

  onProgress?: (info: { step: string; done: number; total: number }) => void;
};

export type RenderResult = {
  outputPath: string;
  thumbnailPath: string;
  duration: number;
  width: number;
  height: number;
  bytes: number;
  sceneCount: number;
  ms: number;
};

/* ------------------------------------------------------------------ *
 *  Text — lambai, size ane lapetvu
 * ------------------------------------------------------------------ */

const FONT_SIZES: Record<TextSize, number> = {
  hero: 96,
  large: 70,
  medium: 52,
  small: 38,
};

/**
 * drawtext jate line break nathi karto — aapne j karvu pade.
 * Font ni sarerash pahodai fontSize na ~0.52 gani hoy che (bold sans mate).
 */
export function wrapText(text: string, fontSize: number, maxWidth: number): string {
  const perChar = fontSize * 0.52;
  const maxChars = Math.max(8, Math.floor(maxWidth / perChar));

  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!current) {
        current = word;
      } else if ((current + " " + word).length <= maxChars) {
        current += " " + word;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  // Reel ma 4 line thi vadhu vanchay nahi.
  return lines.slice(0, 4).join("\n");
}

/* ------------------------------------------------------------------ *
 *  Scene render
 * ------------------------------------------------------------------ */

function motionFilter(
  motion: MotionPreset,
  frames: number,
  width: number,
  height: number,
): string {
  const last = Math.max(1, frames - 1);
  const center = {
    x: "iw/2-(iw/zoom/2)",
    y: "ih/2-(ih/zoom/2)",
  };

  // Dhime dhime — jhatko na lage. 8% zoom aakha scene ma.
  const speed = (0.08 / last).toFixed(6);

  let z = "1";
  let x = center.x;
  let y = center.y;

  switch (motion) {
    case "zoom-in":
      z = `min(1+${speed}*on,1.08)`;
      break;
    case "zoom-out":
      z = `max(1.08-${speed}*on,1.0)`;
      break;
    case "pan-left":
      z = "1.08";
      x = `(iw-iw/zoom)*(1-on/${last})`;
      break;
    case "pan-right":
      z = "1.08";
      x = `(iw-iw/zoom)*on/${last}`;
      break;
    case "pan-up":
      z = "1.08";
      y = `(ih-ih/zoom)*(1-on/${last})`;
      break;
    case "pan-down":
      z = "1.08";
      y = `(ih-ih/zoom)*on/${last}`;
      break;
    default:
      z = "1";
  }

  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${width}x${height}`;
}

async function overlayFilters(
  overlays: TextOverlay[],
  opts: {
    dir: string;
    sceneIndex: number;
    width: number;
    height: number;
    duration: number;
    fontFile: string;
  },
): Promise<string[]> {
  const filters: string[] = [];

  for (const [index, overlay] of overlays.entries()) {
    const text = overlay.text?.trim();
    if (!text) continue;

    const size = FONT_SIZES[overlay.size ?? "large"];
    const wrapped = wrapText(text, size, opts.width * 0.84);

    // Text ne file ma lakhie chie — filter string ma escaping ni jhanjhat
    // (quote, colon, emoji, newline) sav nikli jaay che.
    const textFile = path.join(
      opts.dir,
      `text-${opts.sceneIndex}-${index}.txt`,
    );
    await writeFile(textFile, wrapped, "utf8");

    const position = overlay.position ?? "bottom";
    const y =
      position === "top"
        ? `${Math.round(opts.height * 0.11)}`
        : position === "center"
          ? "(h-text_h)/2"
          : `h-text_h-${Math.round(opts.height * 0.22)}`;

    const start = Math.max(0, overlay.startAt ?? 0);
    const end = Math.min(opts.duration, overlay.endAt ?? opts.duration);

    // Halke thi aave — jhatko na lage.
    const fadeIn = 0.25;
    const alpha = `if(lt(t,${start}),0,if(lt(t,${(start + fadeIn).toFixed(2)}),(t-${start})/${fadeIn},1))`;

    const style = overlay.style ?? "box";
    const decoration =
      style === "box"
        ? `box=1:boxcolor=${overlay.boxColor ?? "black@0.55"}:boxborderw=${Math.round(size * 0.35)}`
        : style === "outline"
          ? `borderw=${Math.max(3, Math.round(size * 0.07))}:bordercolor=black@0.85`
          : `shadowcolor=black@0.7:shadowx=3:shadowy=4`;

    filters.push(
      [
        `drawtext=fontfile='${escapeFilterPath(opts.fontFile)}'`,
        `textfile='${escapeFilterPath(textFile)}'`,
        `fontsize=${size}`,
        `fontcolor=${overlay.color ?? "white"}`,
        // Box style ma line_spacing dareak line na box vachhe faat paade che,
        // etle tya nanu rakhie chie.
        `line_spacing=${Math.round(size * (style === "box" ? 0.08 : 0.2))}`,
        `x=(w-text_w)/2`,
        `y=${y}`,
        decoration,
        `alpha='${alpha}'`,
        `enable='between(t,${start},${end})'`,
      ].join(":"),
    );
  }

  return filters;
}

/** Ek scene ne potani nani mp4 clip banave (audio vagar). */
async function renderScene(
  scene: Scene,
  index: number,
  opts: {
    dir: string;
    width: number;
    height: number;
    fps: number;
    fontFile: string;
    watermark?: string;
    crf: number;
    preset: string;
  },
): Promise<string> {
  const output = path.join(opts.dir, `scene-${String(index).padStart(3, "0")}.mp4`);
  const duration = Math.max(0.5, scene.duration);
  const frames = Math.round(duration * opts.fps);

  const chain: string[] = [];
  const inputArgs: string[] = [];

  if (scene.sourceType === "image") {
    inputArgs.push("-loop", "1", "-t", duration.toFixed(3), "-i", scene.source);

    // Ken Burns ma jhatko na aave e mate pehla mothu karie chie — zoompan
    // na x/y purnank hoy che, etle nani image par pan jhatko dekhay.
    const bigW = Math.round(opts.width * 1.5);
    const bigH = Math.round(opts.height * 1.5);

    // Product ni image mota bhage chorasa hoy che ane reel ubhi — etle
    // pachhal blur karelu e j image mukiye chie. Aa "professional" lage che
    // ane koi bhaag kapato nathi.
    chain.push(
      `[0:v]scale=${bigW}:${bigH}:force_original_aspect_ratio=increase,crop=${bigW}:${bigH},boxblur=luma_radius=${Math.round(bigW / 28)}:luma_power=2,eq=brightness=-0.10:saturation=0.85[bg]`,
      `[0:v]scale=${Math.round(bigW * 0.94)}:${Math.round(bigH * 0.7)}:force_original_aspect_ratio=decrease:flags=lanczos[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto[comp]`,
      `[comp]fps=${opts.fps},${motionFilter(scene.motion ?? "zoom-in", frames, opts.width, opts.height)},setsar=1[base]`,
    );
  } else {
    if (scene.trimStart && scene.trimStart > 0) {
      inputArgs.push("-ss", scene.trimStart.toFixed(3));
    }
    inputArgs.push("-t", duration.toFixed(3), "-i", scene.source);

    chain.push(
      `[0:v]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${opts.width}:${opts.height},fps=${opts.fps},setsar=1[base]`,
    );
  }

  // Text
  const drawFilters = await overlayFilters(scene.overlays ?? [], {
    dir: opts.dir,
    sceneIndex: index,
    width: opts.width,
    height: opts.height,
    duration,
    fontFile: opts.fontFile,
  });

  if (opts.watermark) {
    const markFile = path.join(opts.dir, `mark-${index}.txt`);
    await writeFile(markFile, opts.watermark.trim(), "utf8");
    drawFilters.push(
      [
        `drawtext=fontfile='${escapeFilterPath(opts.fontFile)}'`,
        `textfile='${escapeFilterPath(markFile)}'`,
        `fontsize=30`,
        `fontcolor=white@0.72`,
        `x=(w-text_w)/2`,
        `y=${Math.round(opts.height * 0.055)}`,
        `shadowcolor=black@0.6:shadowx=2:shadowy=2`,
      ].join(":"),
    );
  }

  const tail = drawFilters.length
    ? `[base]${drawFilters.join(",")},format=yuv420p[vout]`
    : `[base]format=yuv420p[vout]`;
  chain.push(tail);

  await runFfmpeg(
    [
      ...inputArgs,
      "-filter_complex", chain.join(";"),
      "-map", "[vout]",
      "-an",
      "-c:v", "libx264",
      "-preset", opts.preset,
      "-crf", String(opts.crf),
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
      "-r", String(opts.fps),
      "-t", duration.toFixed(3),
      output,
    ],
    { timeoutMs: 5 * 60_000 },
  );

  return output;
}

/* ------------------------------------------------------------------ *
 *  Jodvanu + audio
 * ------------------------------------------------------------------ */

function buildTransitionGraph(
  clips: string[],
  sceneTransitions: TransitionType[],
  durations: number[],
  transitionDuration: number,
  fps: number,
): { filter: string; label: string; totalDuration: number } {
  if (clips.length === 1) {
    return { filter: "", label: "0:v", totalDuration: durations[0] };
  }

  // "none" mate pan xfade j vaparie chie — fakt be frame nu.
  //
  // Pehla `concat` filter vaparto hato, pan concat ane xfade ne ek j
  // chain ma bhelvi na shakay: concat dareak segment par filters fari
  // shuru kare che ane xfade no timebase alag hoy che, etle ffmpeg
  // "Error reinitializing filters" aapine mari jaay che.
  // Be frame nu xfade aankh ne hard-cut jevu j lage che, ane graph
  // ek j prakar no rahe che — etle e kayam chale che.
  const cutDuration = Math.max(2 / fps, 0.05);

  const parts: string[] = [];
  let current = "0:v";
  let accumulated = durations[0];

  for (let i = 1; i < clips.length; i += 1) {
    const transition = sceneTransitions[i] ?? "fade";
    const isCut = transition === "none";
    const type = isCut ? "fade" : transition;
    const length = isCut ? cutDuration : transitionDuration;
    const label = `x${i}`;

    // xfade ne "kya thi bhelvvanu shuru karvu" e joie che.
    const offset = Math.max(0, accumulated - length);
    parts.push(
      `[${current}][${i}:v]xfade=transition=${type}:duration=${length.toFixed(3)}:offset=${offset.toFixed(3)}[${label}]`,
    );
    accumulated += durations[i] - length;
    current = label;
  }

  return { filter: parts.join(";"), label: current, totalDuration: accumulated };
}

function buildAudioGraph(opts: {
  musicIndex?: number;
  voiceIndex?: number;
  totalDuration: number;
  musicVolume: number;
}): { filter: string; label: string } | null {
  const { musicIndex, voiceIndex, totalDuration } = opts;
  if (musicIndex === undefined && voiceIndex === undefined) return null;

  const parts: string[] = [];
  const fadeOutStart = Math.max(0, totalDuration - 1.5);

  // Voiceover hoy to music ne pachhal dhakeli daiye — nahi to shabdo
  // sambhalay nahi. (Sidhu volume ghatadie chie: sauthi bharoso layak.)
  const musicVolume = voiceIndex !== undefined
    ? Math.min(opts.musicVolume, 0.14)
    : opts.musicVolume;

  if (musicIndex !== undefined) {
    parts.push(
      `[${musicIndex}:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=1.5,` +
        `volume=${musicVolume.toFixed(2)},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[amusic]`,
    );
  }

  if (voiceIndex !== undefined) {
    parts.push(
      `[${voiceIndex}:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `volume=1.6,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[avoice]`,
    );
  }

  if (musicIndex !== undefined && voiceIndex !== undefined) {
    parts.push(
      `[amusic][avoice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
    );
    return { filter: parts.join(";"), label: "aout" };
  }

  return {
    filter: parts.join(";"),
    label: musicIndex !== undefined ? "amusic" : "avoice",
  };
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

export async function renderReel(options: RenderOptions): Promise<RenderResult> {
  const started = Date.now();

  const width = options.width ?? 1080;
  const height = options.height ?? 1920;
  const fps = options.fps ?? 30;
  const crf = options.crf ?? 23;
  const preset = options.preset ?? "veryfast";
  const transitionDuration = options.transitionDuration ?? 0.45;
  const defaultTransition = options.defaultTransition ?? "fade";

  const scenes = options.scenes.filter((s) => s.source && s.duration > 0);
  if (scenes.length === 0) throw new Error("Reel banavva mate ek pan scene nathi");

  const fontFile = resolveFont(options.script ?? "latin");

  return withTempDir("reel", async (dir) => {
    /* ---- 1. Dareak scene ni clip ---- */
    // Scenes ek-bija par aadharit nathi, etle sathe sathe render karie chie.
    // 10 scene ni reel ma aa 3 gani ochhi var lage che.
    const clips = new Array<string>(scenes.length);
    let completed = 0;
    let nextIndex = 0;

    const workerCount = Math.min(
      scenes.length,
      Math.max(1, Number(process.env.RENDER_CONCURRENCY || 3)),
    );

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= scenes.length) return;

        clips[index] = await renderScene(scenes[index], index, {
          dir,
          width,
          height,
          fps,
          fontFile,
          watermark: options.watermark,
          crf,
          preset,
        });

        completed += 1;
        options.onProgress?.({
          step: `Scene ${completed}/${scenes.length} taiyar`,
          done: completed,
          total: scenes.length + 1,
        });
      }
    };

    await Promise.all(Array.from({ length: workerCount }, worker));

    options.onProgress?.({
      step: "Badhu jodie chie ane music naakhie chie",
      done: scenes.length,
      total: scenes.length + 1,
    });

    /* ---- 2. Jodo + audio + final encode ---- */
    const durations = scenes.map((s) => Math.max(0.5, s.duration));
    const transitions = scenes.map((s, i) =>
      i === 0 ? "none" : (s.transition ?? defaultTransition),
    );

    // Transition scene karta lambo na hovo joiye, nahi to xfade fail thay.
    const shortest = Math.min(...durations);
    const safeTransition = Math.min(transitionDuration, shortest * 0.4);

    const inputArgs: string[] = [];
    for (const clip of clips) inputArgs.push("-i", clip);

    const video = buildTransitionGraph(clips, transitions, durations, safeTransition, fps);

    let musicIndex: number | undefined;
    let voiceIndex: number | undefined;

    if (options.musicPath) {
      // Track tunko hoy to fari fari vagse — reel adhurii chup na rahe.
      inputArgs.push("-stream_loop", "-1", "-i", options.musicPath);
      musicIndex = clips.length;
    }
    if (options.voiceoverPath) {
      inputArgs.push("-i", options.voiceoverPath);
      voiceIndex = clips.length + (musicIndex !== undefined ? 1 : 0);
    }

    const audio = buildAudioGraph({
      musicIndex,
      voiceIndex,
      totalDuration: video.totalDuration,
      musicVolume: options.musicVolume ?? 0.38,
    });

    const graphParts = [video.filter, audio?.filter].filter(Boolean);
    // xfade valo chhello label ne format karvo pade che (yuv420p pehle thi che,
    // pan xfade pachi fari khatri kari laiye).
    graphParts.push(`[${video.label}]format=yuv420p,fps=${fps}[vfinal]`);

    // Music/voiceover ek pan na hoy to pan audio track to hovo j joiye —
    // Instagram ane ghana player audio vagar ni file par nakhra kare che.
    // anullsrc ne filter ni andar j banavie chie, jethi input list ma
    // vadharano `-i` umervo na pade (e ordering ma bhool ubhi kare che).
    const audioLabel = audio?.label ?? "asilent";
    if (!audio) {
      graphParts.push(
        `anullsrc=channel_layout=stereo:sample_rate=44100:d=${video.totalDuration.toFixed(3)}[asilent]`,
      );
    }

    const args = [
      ...inputArgs,
      "-filter_complex", graphParts.join(";"),
      "-map", "[vfinal]",
      "-map", `[${audioLabel}]`,
      "-c:a", "aac",
      "-b:a", audio ? "128k" : "64k",
      "-ar", "44100",
      "-ac", "2",
    ];

    args.push(
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-profile:v", "high",
      "-level", "4.1",
      "-pix_fmt", "yuv420p",
      "-r", String(fps),
      "-g", String(fps * 2),
      "-movflags", "+faststart",
      "-t", video.totalDuration.toFixed(3),
      options.outputPath,
    );

    await runFfmpeg(args, { timeoutMs: 20 * 60_000 });

    /* ---- 3. Cover image ---- */
    const thumbnailPath = options.outputPath.replace(/\.\w+$/, "") + "-cover.jpg";
    await runFfmpeg(
      [
        "-ss", Math.min(1.2, video.totalDuration / 3).toFixed(2),
        "-i", options.outputPath,
        "-frames:v", "1",
        "-q:v", "3",
        thumbnailPath,
      ],
      { timeoutMs: 60_000 },
    );

    const info = await probe(options.outputPath);
    const { statSync } = await import("node:fs");

    return {
      outputPath: options.outputPath,
      thumbnailPath,
      duration: info.duration,
      width: info.width,
      height: info.height,
      bytes: statSync(options.outputPath).size,
      sceneCount: scenes.length,
      ms: Date.now() - started,
    };
  });
}

/** RunOptions ne re-export — caller ne alag import na karvu pade. */
export type { RunOptions };
