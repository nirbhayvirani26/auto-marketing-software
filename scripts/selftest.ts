/**
 * Self-test — aakhi pipeline 10 var chalavi ne jue ke kai j tutatu to nathi.
 *
 *   npm run test:pipeline           → 10 round
 *   npm run test:pipeline -- 3      → 3 round
 *   npm run test:pipeline -- 10 live → AI/API valaa test pan chalavo
 *
 * BE MODE:
 *   offline (default) — koi API key ke internet vagar chale che. ffmpeg,
 *                       fonts, image processing, ranking, scheduling,
 *                       fallback chain — badhu tapase che.
 *   live              — uper nu badhu + kharekhar AI ne puchhe che
 *                       (vision, trends, script, caption). Key hoy tyare j.
 *
 * Dareak round ma jaani joine JUDA JUDA input aapie chie — alag aspect
 * ratio, alag scene count, unicode text, khali text, lambo text — jethi
 * "mara computer par to chalyu hatu" jevu na thay.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Next.js `.env` jate vanchi le che, pan aa script sidhu node par chale che —
// etle jate lodavvu pade, nahi to badhi key gum lage.
const ENV_FILE = path.join(process.cwd(), ".env");
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    // Junu Node hoy to `live` mode kaam nahi kare — offline test to chalse j.
    console.warn(".env vanchi na shakayu:", (error as Error).message);
  }
}

import {
  runChain,
  runChainSoft,
  resetBreakers,
  breakerStatus,
  RetryableError,
  FatalError,
  ChainError,
} from "../src/lib/pipeline/chain";
import { renderReel, wrapText, type Scene } from "../src/lib/video/render";
import { probe, videoEngineStatus, runFfmpeg } from "../src/lib/video/ffmpeg";
import { fontStatus, resolveFont, scriptForLanguage } from "../src/lib/video/fonts";
import { scoreCaption, bestPostTimes, spreadSchedule } from "../src/lib/seo/ranking";
import { moodForProduct, instagramAudioHints } from "../src/lib/trends/audio";

const OUT = path.join(process.cwd(), "storage", "selftest");

/* ------------------------------------------------------------------ *
 *  Nano test framework
 * ------------------------------------------------------------------ */

type Result = {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
  note?: string;
  skipped?: boolean;
};

const results: Result[] = [];

async function test(
  name: string,
  fn: () => Promise<string | void>,
): Promise<boolean> {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, note: note ?? undefined });
    process.stdout.write(`  ✓ ${name}${note ? `  — ${note}` : ""}\n`);
    return true;
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    results.push({ name, ok: false, ms: Date.now() - started, error: message });
    process.stdout.write(`  ✗ ${name}\n      ${message.split("\n")[0].slice(0, 220)}\n`);
    return false;
  }
}

function skip(name: string, why: string): void {
  results.push({ name, ok: true, ms: 0, skipped: true, note: why });
  process.stdout.write(`  – ${name}  (skip: ${why})\n`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/* ------------------------------------------------------------------ *
 *  Test data — dar round e alag
 * ------------------------------------------------------------------ */

const ASPECTS: Array<[number, number]> = [
  [1200, 1200], [1600, 900], [900, 1600], [2000, 1400],
  [800, 800], [1080, 1350], [3000, 2000], [640, 480],
];

const TEXTS = [
  "Simple text",
  "Text with: colon, 'apostrophe' and 100% percent",
  "Ek bahu j lambo text je jaani joine ghani badhi line ma vahenchai jashe ane test karshe ke wrap barabar kaam kare che ke nahi",
  "",
  "उत्सव का नया कलेक्शन",
  "તહેવારનું નવું કલેક્શન",
  "Emoji 🔥 test 💯 karo",
  "Special \\ back / slash [brackets] {braces}",
  "A",
  "₹1,299 — 40% OFF",
];

const MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none"] as const;
const TRANSITIONS = ["fade", "slideleft", "slideup", "circleopen", "dissolve", "wipeleft", "none"] as const;

async function makeImage(round: number, index: number): Promise<string> {
  const [width, height] = ASPECTS[(round + index) % ASPECTS.length];
  const hue = ((round * 47 + index * 83) % 360);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="hsl(${hue},45%,18%)"/>
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.28}" fill="hsl(${(hue + 140) % 360},70%,55%)"/>
    <rect x="${width * 0.08}" y="${height * 0.8}" width="${width * 0.84}" height="${height * 0.05}" fill="#fff" opacity="0.3"/>
  </svg>`;

  const file = path.join(OUT, `r${round}-img${index}.jpg`);
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(file);
  return file;
}

/* ------------------------------------------------------------------ *
 *  Tests
 * ------------------------------------------------------------------ */

async function testPipelineChain(round: number): Promise<void> {
  resetBreakers();

  // 1. Pehlo fail thay to bijo chale
  await test(`[${round}] chain: pehlo provider fail → bijo chale`, async () => {
    const result = await runChain<string>(
      [
        { name: "broken", free: true, run: async () => { throw new Error("500 server error"); } },
        { name: "working", free: true, run: async () => "ok" },
      ],
      { label: "test", retries: 0 },
    );
    assert(result.data === "ok", "bija provider no jawab na aavyo");
    assert(result.provider === "working", "khoto provider vaparyo");
    assert(result.attempts.length === 2, "attempts no hisab khoto");
    return `${result.attempts.length} attempts`;
  });

  // 2. Configure na hoy e skip thay
  await test(`[${round}] chain: configure na hoy e skip thay`, async () => {
    const result = await runChain<string>(
      [
        { name: "nokey", free: true, configured: () => false, run: async () => "nope" },
        { name: "haskey", free: true, configured: () => true, run: async () => "yes" },
      ],
      { label: "test", retries: 0 },
    );
    assert(result.provider === "haskey", "configure na hoy e chalyu");
    assert(result.attempts[0].skipped === "not-configured", "skip nu karan khotu");
  });

  // 3. Retryable error par fari try thay, fatal par nahi
  await test(`[${round}] chain: retry fakt retryable error par`, async () => {
    let retryable = 0;
    let fatal = 0;

    await runChainSoft<string>(
      [{ name: "a", free: true, run: async () => { retryable += 1; throw new RetryableError("try again"); } }],
      { label: "test", retries: 2, backoffMs: 1 },
    );
    await runChainSoft<string>(
      [{ name: "b", free: true, run: async () => { fatal += 1; throw new FatalError("bad key"); } }],
      { label: "test", retries: 2, backoffMs: 1 },
    );

    assert(retryable === 3, `retryable 3 var thavu joitu, thayu ${retryable}`);
    assert(fatal === 1, `fatal 1 j var thavu joitu, thayu ${fatal}`);
    return `retryable ×${retryable}, fatal ×${fatal}`;
  });

  // 4. Free ne pehli pasandgi
  await test(`[${round}] chain: free provider pehla chale`, async () => {
    const result = await runChain<string>(
      [
        { name: "paid", free: false, run: async () => "paid" },
        { name: "free", free: true, run: async () => "free" },
      ],
      { label: "test", retries: 0 },
    );
    assert(result.provider === "free", "paid provider pehla chalyo");
  });

  // 5. `prefer` sauthi uper aave
  await test(`[${round}] chain: prefer sauthi pehla chale`, async () => {
    const result = await runChain<string>(
      [
        { name: "a", free: true, run: async () => "a" },
        { name: "b", free: true, run: async () => "b" },
      ],
      { label: "test", retries: 0, prefer: "b" },
    );
    assert(result.provider === "b", "prefer kaam na karyu");
  });

  // 6. Badha fail thay to samjay evo error
  await test(`[${round}] chain: badha fail → ChainError`, async () => {
    try {
      await runChain<string>(
        [
          { name: "x", free: true, run: async () => { throw new FatalError("no"); } },
          { name: "y", free: true, run: async () => { throw new FatalError("also no"); } },
        ],
        { label: "test", retries: 0 },
      );
      throw new Error("error aavvo joito hato pan na aavyo");
    } catch (error) {
      assert(error instanceof ChainError, "ChainError na aavyo");
      assert(error.attempts.length === 2, "attempts gum");
      assert(error.summary.includes("x"), "summary ma provider nathi");
    }
  });

  // 7. Circuit breaker
  await test(`[${round}] chain: circuit breaker khule che`, async () => {
    resetBreakers();
    const name = `flaky-${round}`;
    for (let i = 0; i < 3; i += 1) {
      await runChainSoft<string>(
        [{ name, free: true, run: async () => { throw new FatalError("down"); } }],
        { label: "test", retries: 0 },
      );
    }

    const open = breakerStatus().find((b) => b.provider === name);
    assert(open && open.openForMs > 0, "3 fail pachi breaker khulvu joitu hatu");

    // Have e skip thavo joiye
    const result = await runChain<string>(
      [
        { name, free: true, run: async () => "should not run" },
        { name: `backup-${round}`, free: true, run: async () => "backup" },
      ],
      { label: "test", retries: 0 },
    );
    assert(result.provider === `backup-${round}`, "breaker khulyo hova chhata chalyo");
    resetBreakers();
    return "3 fail → skip";
  });

  // 8. Timeout
  await test(`[${round}] chain: timeout par bija par jaay`, async () => {
    const result = await runChain<string>(
      [
        {
          name: "slow",
          free: true,
          timeoutMs: 120,
          run: (signal) =>
            new Promise((_, reject) => {
              const timer = setTimeout(() => reject(new Error("never")), 5000);
              signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
              });
            }),
        },
        { name: "fast", free: true, run: async () => "fast" },
      ],
      { label: "test", retries: 0 },
    );
    assert(result.provider === "fast", "timeout pachi bijo na chalyo");
  });
}

async function testTextAndFonts(round: number): Promise<void> {
  await test(`[${round}] fonts: traney lipi na font made che`, async () => {
    const found = (["latin", "devanagari", "gujarati"] as const).map((script) => {
      const file = resolveFont(script);
      assert(file && file.length > 0, `${script} no font na madyo`);
      return script;
    });
    return found.join(", ");
  });

  await test(`[${round}] fonts: language → lipi barabar mape che`, async () => {
    assert(scriptForLanguage("hi") === "devanagari", "hi → devanagari khotu");
    assert(scriptForLanguage("gu") === "gujarati", "gu → gujarati khotu");
    assert(scriptForLanguage("en") === "latin", "en → latin khotu");
    assert(scriptForLanguage("hinglish") === "latin", "hinglish → latin khotu");
  });

  await test(`[${round}] text wrap: 4 line thi vadhu nahi, khali pan chale`, async () => {
    for (const text of TEXTS) {
      const wrapped = wrapText(text, 70, 900);
      const lines = wrapped ? wrapped.split("\n") : [];
      assert(lines.length <= 4, `"${text.slice(0, 20)}" ${lines.length} line ma gayu`);
    }
    // Bahu lambo shabd pan atkavvo na joiye
    const long = wrapText("A".repeat(400), 90, 900);
    assert(typeof long === "string", "lambo shabd crash karyo");
    return `${TEXTS.length} case`;
  });
}

async function testRanking(round: number): Promise<void> {
  await test(`[${round}] ranking: saru caption A/B grade lave`, async () => {
    const score = scoreCaption({
      caption:
        "Cotton kurti je aakho divas thandi rakhe che?\n\nAa handblock cotton kurti office ane evening banne mate chale che. Fabric shwas le che, etle June ma pan chip-chip nahi thay.\n\nSize ma confusion che? Comment ma SIZE lakho, hu fit guide mokli daish.",
      hashtags: Array.from({ length: 18 }, (_, i) => `tag${i}`),
      keywords: ["cotton kurti", "handblock kurti", "summer kurti"],
      platform: "instagram",
      format: "reel",
    });
    assert(score.score >= 70, `saru caption ne fakt ${score.score} malyu`);
    assert(["A", "B"].includes(score.grade), `grade ${score.grade}`);
    return `${score.score}/100 · ${score.grade}`;
  });

  await test(`[${round}] ranking: kharab caption ne ochha marks`, async () => {
    const score = scoreCaption({
      caption: "In today's fast-paced world, look no further than our amazing product!!!",
      hashtags: ["a"],
      keywords: ["cotton kurti"],
      platform: "instagram",
      format: "reel",
    });
    assert(score.score < 55, `kharab caption ne ${score.score} malyu — bahu vadhu`);
    assert(score.topFixes.length > 0, "su sudharvu e na kahyu");
    return `${score.score}/100 · ${score.topFixes.length} suchan`;
  });

  await test(`[${round}] ranking: score hamesha 0-100 vachhe`, async () => {
    for (const text of [...TEXTS, "x".repeat(3000)]) {
      for (const platform of ["instagram", "facebook"] as const) {
        const score = scoreCaption({
          caption: text,
          hashtags: [],
          keywords: [],
          platform,
        });
        assert(
          score.score >= 0 && score.score <= 100 && Number.isFinite(score.score),
          `score ${score.score} range ni bahar`,
        );
      }
    }
  });

  await test(`[${round}] scheduling: badha slot bhavishya ma ane kram ma`, async () => {
    const now = new Date();
    for (const category of ["fashion", "food", "beauty", "electronics", ""]) {
      const slots = bestPostTimes({ category, count: 4, from: now });
      assert(slots.length === 4, `${category}: ${slots.length} slot madya`);
      for (const [i, slot] of slots.entries()) {
        assert(slot.at > now, `${category}: slot ${i} bhutkal ma che`);
        if (i > 0) {
          assert(slot.at >= slots[i - 1].at, `${category}: slot kram ma nathi`);
        }
      }
    }
  });

  await test(`[${round}] scheduling: spread ma barabar antar rahe che`, async () => {
    const gapHours = 20;
    const slots = spreadSchedule(5, { category: "fashion", minGapHours: gapHours });
    assert(slots.length === 5, `${slots.length} slot madya`);
    for (let i = 1; i < slots.length; i += 1) {
      const gap = (slots[i].getTime() - slots[i - 1].getTime()) / 3600_000;
      assert(gap >= gapHours - 0.01, `slot ${i} nu antar fakt ${gap.toFixed(1)} kalak`);
    }
    return `5 slot, ochha ma ochhu ${gapHours}h antar`;
  });
}

async function testAudioMapping(round: number): Promise<void> {
  await test(`[${round}] music: dareak product ne mood made che`, async () => {
    const cases = [
      { category: "Apparel", style: "festive ethnic saree", expect: "festive" },
      { category: "Jewellery", style: "luxury gold diamond", expect: "luxury" },
      { category: "Footwear", style: "urban streetwear sneaker", expect: "hiphop" },
      { category: "Home Decor", style: "minimal candle", expect: "chill" },
      { category: "Electronics", style: "tech gadget", expect: "cinematic" },
      { category: "Stationery", style: "", expect: "upbeat" },
    ];
    for (const item of cases) {
      const mood = moodForProduct(item);
      assert(mood === item.expect, `${item.style || item.category} → ${mood}, joitu ${item.expect}`);

      const hint = instagramAudioHints(mood);
      assert(hint.searchTerms.length > 0, `${mood} mate koi search term nathi`);
      assert(hint.howTo.length > 40, `${mood} mate suchna adhuri che`);
    }
    return `${cases.length} category`;
  });
}

async function testRender(round: number): Promise<void> {
  // Dar round e alag aakar ni reel — 2 thi 9 scene.
  const sceneCount = 2 + (round % 8);
  const imageCount = 1 + (round % 4);

  const images: string[] = [];
  for (let i = 0; i < imageCount; i += 1) images.push(await makeImage(round, i));

  const scenes: Scene[] = Array.from({ length: sceneCount }, (_, i) => {
    const text = TEXTS[(round * 3 + i) % TEXTS.length];
    return {
      source: images[i % images.length],
      sourceType: "image" as const,
      duration: 2 + ((round + i) % 4),
      motion: MOTIONS[(round + i) % MOTIONS.length],
      transition: TRANSITIONS[(round + i) % TRANSITIONS.length],
      overlays: text
        ? [
            {
              text,
              position: (["top", "center", "bottom"] as const)[i % 3],
              size: (["hero", "large", "medium", "small"] as const)[i % 4],
              style: (["box", "outline", "shadow"] as const)[i % 3],
              ...(i % 3 === 0 ? { startAt: 0.5 } : {}),
            },
          ]
        : [],
    };
  });

  const expected = scenes.reduce((sum, s) => sum + s.duration, 0);
  const musicPath = path.join(OUT, `music-${round}.mp3`);
  await runFfmpeg([
    "-f", "lavfi",
    "-i", `sine=frequency=${200 + round * 20}:duration=${Math.ceil(expected) + 5}`,
    "-c:a", "libmp3lame", "-b:a", "128k",
    musicPath,
  ]);

  const language = (["en", "hi", "gu", "hinglish"] as const)[round % 4];

  await test(
    `[${round}] render: ${sceneCount} scene · ${imageCount} image · ${language}`,
    async () => {
      const output = path.join(OUT, `reel-${round}.mp4`);
      const result = await renderReel({
        scenes,
        outputPath: output,
        musicPath,
        watermark: round % 2 === 0 ? "@testbrand" : undefined,
        script: scriptForLanguage(language),
      });

      const info = await probe(output);

      assert(info.width === 1080 && info.height === 1920, `aakar ${info.width}x${info.height}`);
      assert(info.codec === "h264", `codec ${info.codec}`);
      assert(info.hasAudio, "audio track nathi");
      assert(Math.abs(info.fps - 30) < 1.5, `fps ${info.fps}`);
      assert(result.bytes > 10_000, `file bahu nani (${result.bytes} bytes)`);
      assert(result.bytes < 1024 ** 3, "file 1GB thi moti — IG na le");

      // Transition dareak jod par lambai ghatade che, etle apeksha ganvi pade.
      // "none" pan be frame nu xfade che (jovo: buildTransitionGraph).
      const shortest = Math.min(...scenes.map((s) => s.duration));
      const cut = Math.min(0.45, shortest * 0.4);
      const hardCut = Math.max(2 / 30, 0.05);
      const joins = scenes.slice(1);
      const want =
        expected -
        cut * joins.filter((s) => s.transition !== "none").length -
        hardCut * joins.filter((s) => s.transition === "none").length;
      assert(
        Math.abs(info.duration - want) < 1.2,
        `lambai ${info.duration.toFixed(2)}s, apekshit ${want.toFixed(2)}s`,
      );

      return `${info.duration.toFixed(1)}s · ${(result.bytes / 1024 / 1024).toFixed(2)}MB · ${(result.ms / 1000).toFixed(1)}s ma`;
    },
  );

  await test(`[${round}] render: cover image bane che`, async () => {
    const cover = path.join(OUT, `reel-${round}-cover.jpg`);
    const meta = await sharp(cover).metadata();
    assert(meta.width === 1080 && meta.height === 1920, `cover ${meta.width}x${meta.height}`);
  });
}

async function testRenderEdgeCases(round: number): Promise<void> {
  if (round !== 1) return; // Ek j var — dhima test che

  await test(`[edge] render: ek j scene (transition vagar)`, async () => {
    const image = await makeImage(99, 0);
    const output = path.join(OUT, "edge-single.mp4");
    await renderReel({
      scenes: [{ source: image, sourceType: "image", duration: 3, motion: "zoom-in" }],
      outputPath: output,
    });
    const info = await probe(output);
    assert(Math.abs(info.duration - 3) < 0.5, `lambai ${info.duration}`);
    assert(info.hasAudio, "music vagar pan chup audio track hovo joiye");
  });

  await test(`[edge] render: music vagar`, async () => {
    const image = await makeImage(98, 0);
    const output = path.join(OUT, "edge-nomusic.mp4");
    await renderReel({
      scenes: [
        { source: image, sourceType: "image", duration: 2.5, overlays: [{ text: "No music" }] },
        { source: image, sourceType: "image", duration: 2.5, transition: "fade" },
      ],
      outputPath: output,
    });
    const info = await probe(output);
    assert(info.hasAudio, "chup audio track na madyo");
  });

  await test(`[edge] render: bahu tunka scene (transition ne overflow na thay)`, async () => {
    const image = await makeImage(97, 0);
    const output = path.join(OUT, "edge-short.mp4");
    await renderReel({
      scenes: Array.from({ length: 6 }, () => ({
        source: image,
        sourceType: "image" as const,
        duration: 0.8,
        transition: "fade" as const,
      })),
      outputPath: output,
    });
    const info = await probe(output);
    assert(info.duration > 1.5, `lambai ${info.duration} — bahu nani`);
  });

  await test(`[edge] render: ek j scene par 3 text layer`, async () => {
    const image = await makeImage(96, 0);
    const output = path.join(OUT, "edge-layers.mp4");
    await renderReel({
      scenes: [
        {
          source: image,
          sourceType: "image",
          duration: 4,
          overlays: [
            { text: "Upar", position: "top", size: "medium" },
            { text: "Vachhe: 100% & 'quoted'", position: "center", size: "hero", style: "outline" },
            { text: "Niche", position: "bottom", size: "small", startAt: 2, endAt: 4 },
          ],
        },
      ],
      outputPath: output,
      watermark: "@brand",
    });
    const info = await probe(output);
    assert(info.duration > 3.5, `lambai ${info.duration}`);
  });

  await test(`[edge] render: khali scene list par saaf error`, async () => {
    try {
      await renderReel({ scenes: [], outputPath: path.join(OUT, "never.mp4") });
      throw new Error("error aavvo joito hato");
    } catch (error) {
      assert(
        (error as Error).message.includes("scene"),
        `error samjay evo nathi: ${(error as Error).message}`,
      );
    }
  });
}

/* ------------------------------------------------------------------ *
 *  Live tests — key hoy tyare j
 * ------------------------------------------------------------------ */

function hasTextAi(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.ANTHROPIC_API_KEY,
  );
}

async function testLive(round: number): Promise<void> {
  if (!hasTextAi()) {
    if (round === 1) skip("[live] AI test", "ek pan AI key set nathi");
    return;
  }

  const { analyzeProductImages } = await import("../src/lib/ai/vision");
  const { buildTrendPack } = await import("../src/lib/trends/keywords");
  const { planReel } = await import("../src/lib/reels/plan");
  const { generateSocialCopy } = await import("../src/lib/seo/copy");
  const { readFile } = await import("node:fs/promises");

  const imagePath = await makeImage(round, 0);
  const buffer = await readFile(imagePath);

  let analysis: Awaited<ReturnType<typeof analyzeProductImages>>["data"] | null = null;

  await test(`[${round}] live: vision — image mathi product ni vigat`, async () => {
    const result = await analyzeProductImages(
      [{ data: buffer, mimeType: "image/jpeg" }],
      { hint: "cotton kurti, handblock print, festive wear" },
    );
    analysis = result.data;

    assert(analysis.productName.length > 0, "productName khali");
    assert(analysis.searchKeywords.length >= 3, `fakt ${analysis.searchKeywords.length} keyword`);
    assert(analysis.seedHashtags.length >= 5, `fakt ${analysis.seedHashtags.length} hashtag`);
    assert(
      analysis.seedHashtags.every((t) => !t.includes("#") && !t.includes(" ")),
      "hashtag ma # ke space rahi gai",
    );
    assert(
      analysis.confidence >= 0 && analysis.confidence <= 1,
      `confidence ${analysis.confidence} range ni bahar`,
    );
    return `${result.provider} · ${analysis.productName}`;
  });

  if (!analysis) return;
  const product = analysis;

  let trends: Awaited<ReturnType<typeof buildTrendPack>> | null = null;

  await test(`[${round}] live: trends — hashtag ladder`, async () => {
    trends = await buildTrendPack({ product, brandTag: "testbrand", platform: "instagram" });

    assert(trends.hashtags.length >= 8, `fakt ${trends.hashtags.length} hashtag`);
    assert(trends.hashtags.length <= 30, `${trends.hashtags.length} hashtag — IG ni limit 30`);

    const tags = trends.hashtags.map((h) => h.tag);
    assert(new Set(tags).size === tags.length, "hashtag ma duplicate che");
    assert(
      tags.every((t) => /^[a-z0-9_]+$/.test(t)),
      `hashtag ma khota akshar: ${tags.find((t) => !/^[a-z0-9_]+$/.test(t))}`,
    );
    assert(
      trends.hashtags.some((h) => h.tier === "niche"),
      "ek pan niche hashtag nathi — nana account ne aa j kaam aave che",
    );
    return `${trends.hashtags.length} tag · ${trends.sources.join("+")}`;
  });

  if (!trends) return;
  const trendPack = trends;

  await test(`[${round}] live: script — scene plan barabar lambai no`, async () => {
    const target = 30 + (round % 4) * 10;
    const plan = await planReel({
      product,
      trends: trendPack,
      uploadedImageCount: 3,
      mode: "multi",
      targetDuration: target,
      language: "en",
    });

    assert(plan.scenes.length >= 3, `fakt ${plan.scenes.length} scene`);
    assert(
      Math.abs(plan.totalDuration - target) <= 4,
      `lambai ${plan.totalDuration}s, joitu ${target}s`,
    );
    assert(plan.scenes[0].purpose === "hook", "pehlo scene hook nathi");
    assert(plan.scenes[0].duration <= 3.5, `hook ${plan.scenes[0].duration}s — bahu lambo`);
    assert(plan.scenes[0].transition === "none", "pehla scene par transition che");

    for (const scene of plan.scenes) {
      assert(scene.duration >= 1.5 && scene.duration <= 8, `scene ${scene.index}: ${scene.duration}s`);
      assert(
        scene.onScreenText.split(/\s+/).filter(Boolean).length <= 10,
        `scene ${scene.index} no text bahu lambo`,
      );
      if (scene.imageStrategy === "uploaded") {
        assert(
          scene.uploadedImageIndex >= 0 && scene.uploadedImageIndex < 3,
          `scene ${scene.index}: image index ${scene.uploadedImageIndex} range ni bahar`,
        );
      }
    }
    return `${plan.scenes.length} scene · ${plan.totalDuration}s`;
  });

  await test(`[${round}] live: caption — IG ane FB banne`, async () => {
    const [instagram, facebook] = await Promise.all([
      generateSocialCopy({
        product,
        trends: trendPack,
        platform: "instagram",
        format: "reel",
        brandName: "Test Brand",
        maxRevisions: 1,
      }),
      generateSocialCopy({
        product,
        trends: trendPack,
        platform: "facebook",
        format: "reel",
        brandName: "Test Brand",
        maxRevisions: 1,
      }),
    ]);

    for (const [name, copy] of [["IG", instagram], ["FB", facebook]] as const) {
      assert(copy.caption.length > 40, `${name}: caption bahu tunku`);
      assert(!copy.caption.includes("#"), `${name}: caption ni andar hashtag rahi gayo`);
      assert(copy.score.score >= 55, `${name}: ranking score fakt ${copy.score.score}`);
      assert(copy.description.length > 60, `${name}: description bahu tunku`);
    }

    assert(facebook.hashtags.length <= 6, `FB par ${facebook.hashtags.length} hashtag — bahu vadhu`);
    assert(instagram.firstComment.includes("#"), "IG no pehlo comment khali che");
    assert(
      instagram.caption !== facebook.caption,
      "IG ane FB nu caption ekdum sarkhu che — platform pramane alag hovu joiye",
    );

    return `IG ${instagram.score.score}/100 · FB ${facebook.score.score}/100`;
  });
}

/* ------------------------------------------------------------------ *
 *  Main
 * ------------------------------------------------------------------ */

async function main() {
  const args = process.argv.slice(2);
  const rounds = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);
  const live = args.includes("live");

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  Auto Marketing — self test                              ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const engine = videoEngineStatus();
  console.log(`ffmpeg   : ${engine.ready ? "✓" : "✗ " + engine.error}`);
  for (const font of fontStatus()) {
    console.log(`font ${font.script.padEnd(11)}: ${font.ok ? "✓" : "✗ " + font.error}`);
  }
  console.log(`AI keys  : ${hasTextAi() ? "✓ set che" : "– koi nathi (offline test j chalse)"}`);
  console.log(`Mode     : ${live ? "LIVE (AI call thashe)" : "OFFLINE"}`);
  console.log(`Rounds   : ${rounds}\n`);

  if (!engine.ready) {
    console.error("ffmpeg vagar test chalse nahi. `npm install` fari chalavo.");
    process.exit(1);
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const started = Date.now();

  for (let round = 1; round <= rounds; round += 1) {
    console.log(`\n── Round ${round}/${rounds} ${"─".repeat(40)}`);
    await testPipelineChain(round);
    await testTextAndFonts(round);
    await testRanking(round);
    await testAudioMapping(round);
    await testRender(round);
    await testRenderEdgeCases(round);
    if (live) await testLive(round);
  }

  /* ---- Report ---- */
  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok);

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log(`║  ${String(passed).padStart(4)} pass · ${String(failed.length).padStart(3)} fail · ${String(skipped).padStart(3)} skip${" ".repeat(24)}║`);
  console.log(`║  Kul samay: ${((Date.now() - started) / 1000).toFixed(1)}s${" ".repeat(41 - ((Date.now() - started) / 1000).toFixed(1).length)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  if (failed.length > 0) {
    console.log("FAIL thayela test:\n");
    // Ek j bhool 10 round ma 10 var dekhay — ekathi karine batavie chie.
    const grouped = new Map<string, { count: number; example: string }>();
    for (const item of failed) {
      const key = item.name.replace(/^\[\d+\]\s*/, "").replace(/\d+ scene.*/, "…");
      const existing = grouped.get(key);
      if (existing) existing.count += 1;
      else grouped.set(key, { count: 1, example: item.error ?? "" });
    }
    for (const [name, info] of grouped) {
      console.log(`  ✗ ${name}  (×${info.count})`);
      // Provider chain no aakho hisab batavo — kayo provider kem na chalyo
      // e j sauthi kaam nu che.
      console.log(`      ${info.example.split("\n").slice(0, 8).join("\n      ").slice(0, 1200)}\n`);
    }
  }

  // Sauthi dhima test — kya sudharvu e khabar pade.
  const slowest = [...results]
    .filter((r) => !r.skipped)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3);
  if (slowest.length && slowest[0].ms > 1000) {
    console.log("Sauthi dhima:");
    for (const item of slowest) {
      console.log(`  ${(item.ms / 1000).toFixed(1)}s  ${item.name}`);
    }
    console.log("");
  }

  await writeFile(
    path.join(OUT, "report.json"),
    JSON.stringify({ rounds, live, passed, failed: failed.length, skipped, results }, null, 2),
  );
  console.log(`Puro report: ${path.join(OUT, "report.json")}\n`);

  // live mode ma MongoDB no connection khulo rahi jaay che — ene band karya
  // vagar process.exit() karie to Node exit vakhate assertion aape che.
  try {
    const mongoose = (await import("mongoose")).default;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  } catch {
    /* connection hato j nahi */
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nSelf-test j crash thai gayu:", error);
  process.exit(1);
});
