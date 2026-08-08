/**
 * Reference reel na frames ne vanchvanu.
 *
 * Video na thoda frames vision model ne batavie chie ane puchie chie ke
 * "aa shot ma su thai rahyu che". E varnan pachi style card banavva ma
 * vaparay che.
 */

import { askVision, type VisionImage } from "@/lib/ai/vision";

export type FrameStyleReading = {
  descriptions: string[];
  mood: string;
  colorGrade: string;
  hasOnScreenText: boolean;
  cameraWork: string;
};

const FRAME_SCHEMA = {
  type: "object",
  properties: {
    descriptions: {
      type: "array",
      items: { type: "string" },
      description: "One short line per frame, in the order shown. Say what the shot is (close-up, full body, flat lay, mirror shot), what the subject is doing, and whether text is on screen.",
    },
    mood: { type: "string", description: "Overall mood in a few words." },
    colorGrade: { type: "string", description: "Colour treatment: warm, cool, high contrast, film grain, bright and clean." },
    hasOnScreenText: { type: "boolean", description: "Is text burned onto the video in most frames?" },
    cameraWork: { type: "string", description: "How the camera behaves: handheld, locked off, slow push in, quick whip pans." },
  },
  required: ["descriptions", "mood", "colorGrade", "hasOnScreenText", "cameraWork"],
};

export async function analyzeFramesForStyle(
  frames: Buffer[],
): Promise<FrameStyleReading> {
  const images: VisionImage[] = frames
    .slice(0, 6)
    .map((data) => ({ data, mimeType: "image/jpeg" }));

  const { data } = await askVision<Partial<FrameStyleReading>>(images, {
    system: [
      "You are a video editor studying frames from a short-form reel.",
      "You describe technique — framing, lighting, camera work, text placement — not brand names or the specific words on screen.",
      "Be concise and factual.",
    ].join(" "),
    prompt: `These ${images.length} frames are sampled evenly through one reel, in order. Describe each shot, then the overall look.`,
    schema: FRAME_SCHEMA,
    maxTokens: 2000,
  });

  return {
    descriptions: (Array.isArray(data.descriptions) ? data.descriptions : [])
      .map((d) => String(d).trim())
      .filter(Boolean)
      .slice(0, 8),
    mood: String(data.mood ?? "").trim(),
    colorGrade: String(data.colorGrade ?? "").trim(),
    hasOnScreenText: Boolean(data.hasOnScreenText),
    cameraWork: String(data.cameraWork ?? "").trim(),
  };
}
