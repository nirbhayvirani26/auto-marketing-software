/**
 * Renderer no ekalo test — DB ke API vagar.
 *
 *   npx tsx scripts/test-render.ts
 *
 * Aa 4 nakli product image banave che ane emathi ek aakhi reel render kare
 * che: Ken Burns, transitions, text overlay, watermark, cover image.
 * ffmpeg ni koi pan filter ma bhool hoy to ahiya j pakdai jashe.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { renderReel, type Scene } from "../src/lib/video/render";
import { probe, videoEngineStatus } from "../src/lib/video/ffmpeg";
import { fontStatus } from "../src/lib/video/fonts";

const OUT = path.join(process.cwd(), "storage", "test");

const SWATCHES = [
  { bg: "#1a1a2e", accent: "#e94560", label: "A" },
  { bg: "#0f3460", accent: "#16c79a", label: "B" },
  { bg: "#2d132c", accent: "#ee4540", label: "C" },
  { bg: "#3d5a80", accent: "#ee6c4d", label: "D" },
];

/** Nakli product photo — alag alag aspect ratio, jethi crop logic pan test thay. */
async function makeTestImage(index: number, target: string): Promise<void> {
  const s = SWATCHES[index % SWATCHES.length];
  const sizes = [
    [1200, 1200],
    [1600, 900],
    [900, 1600],
    [2000, 1400],
  ];
  const [width, height] = sizes[index % sizes.length];

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${s.bg}"/>
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.3}" fill="${s.accent}"/>
    <rect x="${width * 0.1}" y="${height * 0.78}" width="${width * 0.8}" height="${height * 0.06}" fill="#ffffff" opacity="0.35"/>
  </svg>`;

  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(target);
}

async function main() {
  console.log("\n=== Reel renderer test ===\n");

  const engine = videoEngineStatus();
  console.log("ffmpeg :", engine.ready ? engine.ffmpeg : `❌ ${engine.error}`);
  if (!engine.ready) process.exit(1);

  for (const font of fontStatus()) {
    console.log(
      `font ${font.script.padEnd(11)}:`,
      font.ok ? font.path : `❌ ${font.error}`,
    );
  }
  console.log("");

  await mkdir(OUT, { recursive: true });

  const images: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const file = path.join(OUT, `product-${i}.jpg`);
    await makeTestImage(i, file);
    images.push(file);
  }
  console.log(`${images.length} test image banya\n`);

  const scenes: Scene[] = [
    {
      source: images[0],
      sourceType: "image",
      duration: 3.2,
      motion: "zoom-in",
      overlays: [
        {
          text: "Aa ek lambo hook che je aapoaap be line ma vahenchai javo joiye",
          position: "top",
          size: "large",
          style: "box",
        },
      ],
    },
    {
      source: images[1],
      sourceType: "image",
      duration: 3.5,
      motion: "pan-right",
      transition: "slideleft",
      overlays: [
        { text: "100% cotton", position: "bottom", size: "hero", style: "outline" },
      ],
    },
    {
      source: images[2],
      sourceType: "image",
      duration: 3.5,
      motion: "zoom-out",
      transition: "fade",
      overlays: [
        { text: "Text: with colon, 'quotes' & 100% special chars", position: "center", size: "medium", style: "shadow" },
        { text: "Bije aavelu biju text", position: "bottom", size: "small", startAt: 1.5 },
      ],
    },
    {
      source: images[3],
      sourceType: "image",
      duration: 3.0,
      motion: "pan-up",
      transition: "circleopen",
      overlays: [
        { text: "Link in bio 🔗", position: "center", size: "hero", style: "box", color: "#ffe066" },
      ],
    },
  ];

  // Chup audio track banaviye — music pipeline nu path test karva mate.
  const musicPath = path.join(OUT, "test-tone.mp3");
  const { runFfmpeg } = await import("../src/lib/video/ffmpeg");
  await runFfmpeg([
    "-f", "lavfi",
    "-i", "sine=frequency=220:duration=30",
    "-c:a", "libmp3lame", "-b:a", "128k",
    musicPath,
  ]);
  console.log("test music banyu\n");

  const outputPath = path.join(OUT, "reel.mp4");
  const started = Date.now();

  const result = await renderReel({
    scenes,
    outputPath,
    musicPath,
    watermark: "@mybrand",
    script: "latin",
    onProgress: (p) => console.log(`  [${p.done}/${p.total}] ${p.step}`),
  });

  console.log("\n--- Result ---");
  console.log("file      :", result.outputPath);
  console.log("cover     :", result.thumbnailPath);
  console.log("duration  :", result.duration.toFixed(2), "s");
  console.log("size      :", result.width, "x", result.height);
  console.log("bytes     :", (result.bytes / 1024 / 1024).toFixed(2), "MB");
  console.log("render ma :", ((Date.now() - started) / 1000).toFixed(1), "s");

  const info = await probe(outputPath);
  console.log("\n--- Instagram Reels spec check ---");
  const checks: Array<[string, boolean, string]> = [
    ["9:16 aspect", Math.abs(info.width / info.height - 9 / 16) < 0.01, `${info.width}x${info.height}`],
    ["h264 codec", info.codec === "h264", info.codec],
    ["audio track che", info.hasAudio, String(info.hasAudio)],
    ["30fps", Math.abs(info.fps - 30) < 1, info.fps.toFixed(2)],
    ["3-90 second", info.duration >= 3 && info.duration <= 90, info.duration.toFixed(1)],
    ["1GB thi nani", result.bytes < 1024 ** 3, `${(result.bytes / 1024 / 1024).toFixed(1)}MB`],
  ];

  let failed = 0;
  for (const [label, passed, value] of checks) {
    console.log(`  ${passed ? "✓" : "✗"} ${label.padEnd(20)} ${value}`);
    if (!passed) failed += 1;
  }

  // Transition sathe jodaya pachi ni apeksha rakhel lambai.
  const expected = scenes.reduce((sum, s) => sum + s.duration, 0) - 0.45 * 3;
  console.log(`\n  apekshit lambai ~${expected.toFixed(2)}s, kharekhar ${info.duration.toFixed(2)}s`);

  console.log(failed === 0 ? "\n✅ Badhu barabar\n" : `\n❌ ${failed} check fail\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n❌ Test fail:", error.message);
  if (error.stderr) console.error(String(error.stderr).slice(-2000));
  process.exit(1);
});
