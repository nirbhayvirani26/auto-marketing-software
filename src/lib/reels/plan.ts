/**
 * Reel no script — "kaya scene ma su dekhaay ane su lakhelu hoy".
 *
 * Aa file nu ek j kaam che: product ni samajan ne EK VECHAN-LAYAK VIDEO
 * SCRIPT ma badalvu. Reels no ranking watch-time par chale che, etle
 * script ma traan vastu farjiyat che:
 *
 *   1. Pehli 3 second no hook — nahi to koi aagal jotu j nathi
 *   2. Dareak 2-3 second e kaink navu — scroll atke etle
 *   3. Chhelle spashta CTA — save/share/DM
 */

import { complete } from "@/lib/ai/index";
import { productLabel, type ProductIntelligence } from "@/lib/ai/vision";
import type { TrendPack } from "@/lib/trends/keywords";
import type { MotionPreset, TransitionType } from "@/lib/video/render";

export type ScenePurpose =
  | "hook"
  | "reveal"
  | "detail"
  | "benefit"
  | "lifestyle"
  | "proof"
  | "offer"
  | "cta";

export type ImageStrategy = "uploaded" | "generate" | "tryon";

/**
 * Scene halshe kevi rite:
 *   still — ffmpeg image ne dhime dhime zoom/pan kare (sasto, hamesha chale)
 *   video — Gemini Omni e j image ne kharekhar halavta video ma badle
 */
export type MotionStrategy = "still" | "video";

export type PlannedScene = {
  index: number;
  purpose: ScenePurpose;
  duration: number;
  onScreenText: string;
  voiceLine: string;
  imageStrategy: ImageStrategy;
  /** "uploaded" hoy to kai image (0 thi shuru). */
  uploadedImageIndex: number;
  imagePrompt: string;
  motionStrategy: MotionStrategy;
  /** "video" hoy to — su halvu joiye ane camera kem fare. */
  videoPrompt: string;
  motion: MotionPreset;
  transition: TransitionType;
};

export type ReelPlan = {
  concept: string;
  scenes: PlannedScene[];
  totalDuration: number;
  musicMood: string;
  coverText: string;
  /** Reel ni niche jashe e caption no hook (copy module e vadhu sudhare che). */
  captionSeed: string;
};

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    concept: {
      type: "string",
      description: "One line describing the creative idea of this reel.",
    },
    coverText: {
      type: "string",
      description: "3-6 words for the reel cover. Big, bold, readable at thumbnail size.",
    },
    captionSeed: {
      type: "string",
      description: "One line hook for the caption under the reel.",
    },
    musicMood: {
      type: "string",
      enum: ["upbeat", "chill", "cinematic", "luxury", "festive", "energetic", "romantic", "hiphop"],
    },
    scenes: {
      type: "array",
      description: "The shot list, in order.",
      items: {
        type: "object",
        properties: {
          purpose: {
            type: "string",
            enum: ["hook", "reveal", "detail", "benefit", "lifestyle", "proof", "offer", "cta"],
          },
          durationSeconds: {
            type: "number",
            description: "Between 2 and 6. The first scene must be 2 to 3.5.",
          },
          onScreenText: {
            type: "string",
            description: "Text burned onto the video. MAX 8 words. Must be readable in one glance. Empty string if the shot should be clean.",
          },
          voiceLine: {
            type: "string",
            description: "One spoken sentence for the voiceover. Conversational, max 18 words. Empty string for a silent beat.",
          },
          imageStrategy: {
            type: "string",
            enum: ["uploaded", "generate", "tryon"],
            description: "'uploaded' = use one of the seller's real product photos. 'generate' = an AI-made lifestyle/background shot. 'tryon' = the avatar wearing the product. Prefer 'uploaded' for anything showing the actual product — real photos convert better and never distort the product.",
          },
          uploadedImageIndex: {
            type: "number",
            description: "Which uploaded photo to use, 0-based. Use -1 when imageStrategy is not 'uploaded'.",
          },
          imagePrompt: {
            type: "string",
            description: "For 'generate' or 'tryon': a detailed image prompt. Describe setting, lighting, camera angle and mood. Never describe text or logos. Empty string for 'uploaded'.",
          },
          motionStrategy: {
            type: "string",
            enum: ["still", "video"],
            description: "'still' = the still photo is animated with a slow camera move. 'video' = a real AI-generated moving clip. Video costs money and takes minutes, so mark AT MOST 2 scenes as 'video' — pick only the shots where real movement genuinely sells the product (fabric flowing, the model walking or turning, the product being used). Everything else must be 'still'.",
          },
          videoPrompt: {
            type: "string",
            description: "Only when motionStrategy is 'video': describe the MOVEMENT in one or two sentences — what moves, and how the camera moves. Do not re-describe the product, it is already fixed by the reference image. Empty string for 'still'.",
          },
          motion: {
            type: "string",
            enum: ["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none"],
          },
          transition: {
            type: "string",
            enum: ["fade", "slideleft", "slideright", "slideup", "wipeleft", "circleopen", "dissolve", "smoothleft", "none"],
          },
        },
        required: [
          "purpose", "durationSeconds", "onScreenText", "voiceLine",
          "imageStrategy", "uploadedImageIndex", "imagePrompt",
          "motionStrategy", "videoPrompt", "motion", "transition",
        ],
      },
    },
  },
  required: ["concept", "coverText", "captionSeed", "musicMood", "scenes"],
};

type PlanResponse = {
  concept: string;
  coverText: string;
  captionSeed: string;
  musicMood: string;
  scenes: Array<{
    purpose: string;
    durationSeconds: number;
    onScreenText: string;
    voiceLine: string;
    imageStrategy: string;
    uploadedImageIndex: number;
    imagePrompt: string;
    motionStrategy: string;
    videoPrompt: string;
    motion: string;
    transition: string;
  }>;
};

export type PlanOptions = {
  product: ProductIntelligence;
  trends?: TrendPack;
  /** Ketli image upload kari — AI aemathi j pasand kare che. */
  uploadedImageCount: number;
  /** Ghana product hoy to dareak nu naam — collection reel mate. */
  productNames?: string[];
  mode: "single" | "multi" | "tryon" | "reference";
  targetDuration?: number;
  language?: string;
  tone?: string;
  brandName?: string;
  /** Avatar hoy to eno varnan — tryon/lifestyle scene ma vaparay che. */
  avatarDescription?: string;
  /** Reference reel na aakda — eni style ni nakal karva mate. */
  referenceStyle?: ReferenceStyle;
  price?: string;
  /** AI video (Omni) male che ke nahi, ane ketla clip sudhi. */
  aiVideo?: { enabled: boolean; maxClips: number };
};

export type ReferenceStyle = {
  sceneCount: number;
  averageSceneDuration: number;
  pacing: "slow" | "medium" | "fast";
  shotTypes: string[];
  textStyle: string;
  hookStyle: string;
  mood: string;
  summary: string;
};

export async function planReel(options: PlanOptions): Promise<ReelPlan> {
  const target = clamp(options.targetDuration ?? 40, 15, 90);

  let data: PlanResponse;
  try {
    ({ data } = await directWithAi(options, target));
  } catch (error) {
    // Every provider is unavailable. A plain shot list built from the product
    // facts still produces a reel worth publishing, so the render goes ahead.
    console.warn(
      `[plan] No AI provider available (${(error as Error).message}). Using a template shot list.`,
    );
    const product = options.product;
    const label = productLabel(product, options.brandName);
    return normalisePlan(
      {
        concept: `${label} — straight product showcase`,
        coverText: trimWords(label, 6),
        captionSeed: product.sellingPoints[0] || label,
        musicMood: "upbeat",
        // Empty, so normalisePlan() falls through to fallbackScenes().
        scenes: [],
      },
      options,
      target,
    );
  }

  return normalisePlan(data, options, target);
}

function directWithAi(options: PlanOptions, target: number) {
  return complete<PlanResponse>({
    system: [
      "You are a short-form video director who makes Instagram Reels that actually sell.",
      "You understand the only three things that matter: the first 3 seconds decide the watch rate, a visual change every 2-3 seconds keeps people watching, and the last 2 seconds decide whether they save or share.",
      "You never write on-screen text longer than 8 words — nobody reads a paragraph on a moving video.",
      "You never invent prices, offers, discounts, delivery promises or claims that were not given to you.",
      "You prefer the seller's real product photos for any shot of the product itself. AI-generated shots are for setting and mood only.",
      "Return only the structured output requested.",
    ].join(" "),
    prompt: buildPrompt(options, target),
    schema: PLAN_SCHEMA,
    maxTokens: 5000,
  });
}

function buildPrompt(options: PlanOptions, target: number): string {
  const p = options.product;
  const language = options.language ?? p.language ?? "en";
  const aiVideoMax = options.aiVideo?.enabled ? options.aiVideo.maxClips : 0;

  const languageLine: Record<string, string> = {
    en: "Write on-screen text and voice lines in simple English.",
    hi: "Write on-screen text and voice lines in Hindi (Devanagari script).",
    gu: "Write on-screen text and voice lines in Gujarati script.",
    hinglish: "Write on-screen text and voice lines in Hinglish — Hindi in Latin script, mixed with English, the way Indian creators actually caption reels.",
  };

  const modeLine: Record<PlanOptions["mode"], string> = {
    single: "This reel sells ONE product. Show it from multiple angles and build desire for it.",
    multi: `This reel shows a COLLECTION of ${options.productNames?.length ?? options.uploadedImageCount} products. Give each product its own 2-3 second beat, keep the pace fast, and end on the collection as a whole. Do NOT spend the whole reel on one item.`,
    tryon: "This reel shows the brand's own avatar/model WEARING or USING the product. Lead with the person, not the flat product shot — people stop for faces.",
    reference: "This reel must copy the structure and feel of the reference reel described below, but with THIS product and THIS brand.",
  };

  return [
    `Direct a ${target}-second Instagram Reel.`,
    "",
    modeLine[options.mode],
    languageLine[language] ?? languageLine.en,
    options.tone ? `Tone: ${options.tone}` : "",
    options.brandName ? `Brand: ${options.brandName}` : "",
    "",
    "PRODUCT — these are the only facts you may state:",
    `• ${p.productName} (${p.category} → ${p.subCategory})`,
    p.materials.length ? `• Material: ${p.materials.join(", ")}` : "",
    p.colors.length ? `• Colour: ${p.colors.join(", ")}` : "",
    p.style ? `• Style: ${p.style}` : "",
    p.occasions.length ? `• Occasion: ${p.occasions.join(", ")}` : "",
    p.keyFeatures.length ? `• Features: ${p.keyFeatures.join("; ")}` : "",
    p.sellingPoints.length ? `• Why people buy: ${p.sellingPoints.join("; ")}` : "",
    p.emotionalHooks.length ? `• What the buyer feels: ${p.emotionalHooks.join("; ")}` : "",
    p.objections.length ? `• Doubts to answer: ${p.objections.join("; ")}` : "",
    options.price ? `• Price: ${options.price}` : "",
    `• Audience: ${p.targetAudience || `${p.targetGender} ${p.targetAgeRange}`}`,
    "",
    options.productNames?.length
      ? `PRODUCTS IN THIS COLLECTION (one beat each, in this order):\n${options.productNames.map((n, i) => `  photo ${i}: ${n}`).join("\n")}`
      : "",
    "",
    `AVAILABLE PHOTOS: the seller uploaded ${options.uploadedImageCount} real photo(s), indexed 0 to ${Math.max(0, options.uploadedImageCount - 1)}.`,
    "Photo 0 is usually the best hero shot.",
    options.uploadedImageCount > 1
      ? "Use each uploaded photo at least once before repeating any of them."
      : "You only have one photo, so vary the shots with different motion and different on-screen text rather than repeating the same framing.",
    "",
    options.avatarDescription
      ? `AVATAR (the brand's face — use imageStrategy 'tryon' for shots with them):\n${options.avatarDescription}`
      : "No avatar is configured — do not use imageStrategy 'tryon'.",
    "",
    options.referenceStyle
      ? [
          "REFERENCE REEL to copy the structure of:",
          `• ${options.referenceStyle.summary}`,
          `• ${options.referenceStyle.sceneCount} shots, average ${options.referenceStyle.averageSceneDuration.toFixed(1)}s each, ${options.referenceStyle.pacing} pacing`,
          `• Shot types: ${options.referenceStyle.shotTypes.join(", ")}`,
          `• Text style: ${options.referenceStyle.textStyle}`,
          `• Hook style: ${options.referenceStyle.hookStyle}`,
          `• Mood: ${options.referenceStyle.mood}`,
          "Match this rhythm and this hook style. Do NOT copy its exact words.",
        ].join("\n")
      : "",
    "",
    options.trends?.risingTopics.length
      ? `TRENDING NOW (use only if it honestly fits): ${options.trends.risingTopics.join(", ")}`
      : "",
    options.trends?.keywords.length
      ? `KEYWORDS people search: ${options.trends.keywords.slice(0, 8).join(", ")}`
      : "",
    "",
    aiVideoMax > 0
      ? `LIVE MOTION: you may mark up to ${aiVideoMax} scene(s) as motionStrategy 'video' — a real AI-generated moving clip instead of an animated photo. Spend them where movement actually sells: the hook, or a shot where fabric flows / the model turns / the product is used. A 'video' scene must be between 3 and 8 seconds. Everything else stays 'still'.`
      : "LIVE MOTION is not available. Every scene must use motionStrategy 'still' and videoPrompt must be an empty string.",
    "",
    "RULES:",
    `• Total of all durationSeconds must be ${target} seconds, ±3.`,
    `• Use ${Math.max(4, Math.round(target / 5))} to ${Math.round(target / 2.5)} scenes. More, shorter scenes hold attention better than fewer long ones.`,
    "• Scene 1 is the hook: 2-3.5 seconds, biggest on-screen text, and it must create a question in the viewer's mind. Never open with the brand name or a logo.",
    "• The last scene is the CTA: ask for a comment, a save, a share or a DM. Be specific.",
    "• Alternate motion between scenes — never the same motion twice in a row.",
    "• Leave onScreenText empty on at least one mid-reel scene so the product can breathe.",
    "",
    "Write the shot list now.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ *
 *  Saaf karvu — AI je aape e hamesha barabar na hoy
 * ------------------------------------------------------------------ */

const MOTIONS: MotionPreset[] = [
  "zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none",
];
const TRANSITIONS: TransitionType[] = [
  "fade", "slideleft", "slideright", "slideup", "wipeleft",
  "circleopen", "dissolve", "smoothleft", "none",
];
const PURPOSES: ScenePurpose[] = [
  "hook", "reveal", "detail", "benefit", "lifestyle", "proof", "offer", "cta",
];

function normalisePlan(
  raw: PlanResponse,
  options: PlanOptions,
  target: number,
): ReelPlan {
  const imageCount = Math.max(0, options.uploadedImageCount);
  const hasAvatar = Boolean(options.avatarDescription);

  let scenes = (Array.isArray(raw.scenes) ? raw.scenes : [])
    .filter((s) => s && Number(s.durationSeconds) > 0)
    .slice(0, 24)
    .map((s, index): PlannedScene => {
      let strategy = (
        ["uploaded", "generate", "tryon"].includes(s.imageStrategy)
          ? s.imageStrategy
          : "uploaded"
      ) as ImageStrategy;

      // Avatar nathi to tryon shakya nathi.
      if (strategy === "tryon" && !hasAvatar) strategy = "generate";
      // Ek pan upload nathi to uploaded shakya nathi.
      if (strategy === "uploaded" && imageCount === 0) strategy = "generate";

      const wantedIndex = Number(s.uploadedImageIndex);
      const uploadedImageIndex =
        strategy === "uploaded"
          ? Number.isFinite(wantedIndex) && wantedIndex >= 0
            ? wantedIndex % Math.max(1, imageCount)
            : index % Math.max(1, imageCount)
          : -1;

      return {
        index,
        purpose: (PURPOSES.includes(s.purpose as ScenePurpose)
          ? s.purpose
          : index === 0
            ? "hook"
            : "detail") as ScenePurpose,
        duration: clamp(Number(s.durationSeconds) || 3, 1.5, 8),
        onScreenText: trimWords(String(s.onScreenText ?? ""), 10),
        voiceLine: String(s.voiceLine ?? "").trim().slice(0, 220),
        imageStrategy: strategy,
        uploadedImageIndex,
        imagePrompt: String(s.imagePrompt ?? "").trim().slice(0, 1200),
        motionStrategy: (s.motionStrategy === "video" ? "video" : "still") as MotionStrategy,
        videoPrompt: String(s.videoPrompt ?? "").trim().slice(0, 900),
        motion: (MOTIONS.includes(s.motion as MotionPreset)
          ? s.motion
          : MOTIONS[index % 6]) as MotionPreset,
        transition: (TRANSITIONS.includes(s.transition as TransitionType)
          ? s.transition
          : "fade") as TransitionType,
      };
    });

  if (scenes.length === 0) {
    scenes = fallbackScenes(options, target);
  }

  // Ek j motion be var sathe na aave — video jado lage che.
  for (let i = 1; i < scenes.length; i += 1) {
    if (scenes[i].motion === scenes[i - 1].motion) {
      scenes[i].motion = MOTIONS[(MOTIONS.indexOf(scenes[i].motion) + 3) % 6];
    }
  }

  // Chhello scene CTA hovo j joiye.
  const last = scenes[scenes.length - 1];
  if (last.purpose !== "cta" && scenes.length > 2) last.purpose = "cta";

  // Kul lambai ne target par lai aavo.
  const total = scenes.reduce((sum, s) => sum + s.duration, 0);
  if (total > 0 && Math.abs(total - target) > 1) {
    const factor = target / total;
    for (const scene of scenes) {
      scene.duration = Math.round(clamp(scene.duration * factor, 1.5, 8) * 10) / 10;
    }
  }

  // Pehlo scene hook che — 3.5s thi lambo na hovo joiye.
  scenes[0].duration = Math.min(scenes[0].duration, 3.5);
  scenes[0].transition = "none";
  scenes[0].purpose = "hook";

  applyVideoLimit(scenes, options);

  const finalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);

  return {
    concept: String(raw.concept ?? "").trim() || `${productLabel(options.product, options.brandName)} reel`,
    scenes: scenes.map((s, index) => ({ ...s, index })),
    totalDuration: Math.round(finalDuration * 10) / 10,
    musicMood: String(raw.musicMood ?? "upbeat"),
    coverText: trimWords(String(raw.coverText || productLabel(options.product, options.brandName)), 6),
    captionSeed: String(raw.captionSeed ?? "").trim(),
  };
}

/**
 * AI ne "2 thi vadhu video na karo" kahyu hoy chhata e kyarek badha scene
 * video kari nakhe che. Ek reel na 10 clip etle 15 minute ane motu bill —
 * etle had ahiya CODE ma pan lagavie chie, prompt par bharoso rakhya vagar.
 *
 * Kaya scene rakhva: hook sauthi pehla (tya j lok atke che), pachi je scene
 * mate AI e kharekhar movement lakhyu hoy e.
 */
function applyVideoLimit(scenes: PlannedScene[], options: PlanOptions): void {
  const max = options.aiVideo?.enabled ? options.aiVideo.maxClips : 0;

  if (max <= 0) {
    for (const scene of scenes) {
      scene.motionStrategy = "still";
      scene.videoPrompt = "";
    }
    return;
  }

  const wanted = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => scene.motionStrategy === "video")
    .sort((a, b) => {
      // Hook pehla, pachi jena mate movement lakhelu hoy, pachi kram pramane.
      const hook = Number(b.scene.purpose === "hook") - Number(a.scene.purpose === "hook");
      if (hook !== 0) return hook;
      const written = Number(Boolean(b.scene.videoPrompt)) - Number(Boolean(a.scene.videoPrompt));
      if (written !== 0) return written;
      return a.index - b.index;
    });

  for (const [rank, { scene }] of wanted.entries()) {
    if (rank < max) {
      // Omni 3-10s j aape che — scene ne e had ma lai aavie chie.
      scene.duration = Math.round(clamp(scene.duration, 3, 8) * 10) / 10;
    } else {
      scene.motionStrategy = "still";
      scene.videoPrompt = "";
    }
  }
}

/** AI sav fail thay to pan reel to banvi j joiye. */
function fallbackScenes(options: PlanOptions, target: number): PlannedScene[] {
  const count = Math.max(4, Math.min(8, Math.round(target / 5)));
  const per = Math.round((target / count) * 10) / 10;
  const p = options.product;
  const imageCount = Math.max(1, options.uploadedImageCount);

  const texts = [
    p.sellingPoints[0] || productLabel(p, options.brandName),
    p.colors.length ? p.colors.join(" · ") : p.subCategory,
    p.materials.length ? p.materials.join(" · ") : p.style,
    p.occasions[0] ?? "",
    p.keyFeatures[0] ?? "",
    "Link in bio",
  ];

  return Array.from({ length: count }, (_, index) => ({
    index,
    purpose: (index === 0 ? "hook" : index === count - 1 ? "cta" : "detail") as ScenePurpose,
    duration: index === 0 ? Math.min(per, 3.2) : per,
    onScreenText: trimWords(texts[index % texts.length] ?? "", 8),
    voiceLine: "",
    imageStrategy: "uploaded" as ImageStrategy,
    uploadedImageIndex: index % imageCount,
    imagePrompt: "",
    // Fallback ma AI par bharoso nathi — sadhu still j saru.
    motionStrategy: "still" as MotionStrategy,
    videoPrompt: "",
    motion: MOTIONS[index % 6],
    transition: (index === 0 ? "none" : "fade") as TransitionType,
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function trimWords(text: string, maxWords: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}
