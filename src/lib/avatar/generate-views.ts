/**
 * Avatar view generation.
 *
 * One clear photo goes in; a consistent set of views comes out — full body,
 * side, back, and tight face shots for expression.
 *
 * The whole point is that it is the SAME person every time. That is why every
 * view is generated with the uploaded photos supplied as references rather
 * than from a text description: describing a face in words and asking a model
 * to draw it produces a different person on each call, which is useless for a
 * brand that wants to be recognised.
 *
 * Nano Banana (Gemini 2.5 Flash Image) is the model that matters here — it is
 * the one that reads reference images and holds a face steady. Providers that
 * only accept text are skipped, because a plausible stranger is worse than no
 * image at all.
 */

import { composeImage, type ReferenceImage } from "@/lib/media/image-gen";

export type AvatarViewKey =
  | "full-body"
  | "side-angle"
  | "back"
  | "face-focus"
  | "expression-warm"
  | "expression-confident";

export type AvatarView = {
  key: AvatarViewKey;
  label: string;
  /** What this view is for, shown under the thumbnail. */
  purpose: string;
  prompt: string;
  aspectRatio: "9:16" | "1:1" | "4:5";
};

/**
 * The standard set.
 *
 * Each prompt describes the SHOT — framing, pose, lighting — and never the
 * person. The person comes from the reference photos; describing them again
 * only gives the model licence to change them.
 */
export const AVATAR_VIEWS: AvatarView[] = [
  {
    key: "full-body",
    label: "Full body",
    purpose: "Head-to-toe shot, for showing clothing and for try-on scenes",
    aspectRatio: "9:16",
    prompt:
      "A full-body head-to-toe photograph of this exact person, standing naturally and facing the camera. " +
      "Full figure in frame with clear space above the head and below the feet. " +
      "Soft, even daylight, a clean uncluttered light-grey studio background, shot on an 85mm lens at eye level.",
  },
  {
    key: "side-angle",
    label: "Side angle",
    purpose: "Three-quarter profile, for movement and detail shots",
    aspectRatio: "9:16",
    prompt:
      "A three-quarter side-angle full-body photograph of this exact person, body turned about 45 degrees away from the camera " +
      "with the face turned back towards it. Same soft daylight, same clean light-grey studio background, 85mm lens.",
  },
  {
    key: "back",
    label: "Back view",
    purpose: "Rear view, for showing the back of a garment",
    aspectRatio: "9:16",
    prompt:
      "A full-body photograph of this exact person seen from directly behind, standing naturally, head facing forward away from the camera. " +
      "The back of the outfit and the hair are clearly visible. Same soft daylight and clean light-grey studio background, 85mm lens.",
  },
  {
    key: "face-focus",
    label: "Face close-up",
    purpose: "Tight portrait — the reference that keeps the face consistent",
    aspectRatio: "1:1",
    prompt:
      "A sharp close-up portrait of this exact person from the shoulders up, looking straight into the camera with a relaxed neutral expression. " +
      "Soft window light from the front, shallow depth of field, clean background. Every facial feature clearly visible and true to the reference.",
  },
  {
    key: "expression-warm",
    label: "Warm smile",
    purpose: "Friendly expression, for hooks and lifestyle beats",
    aspectRatio: "4:5",
    prompt:
      "A waist-up portrait of this exact person with a genuine warm smile, looking into the camera, relaxed and approachable. " +
      "Soft natural light, gentle background blur, shot on an 85mm lens.",
  },
  {
    key: "expression-confident",
    label: "Confident look",
    purpose: "Assured expression, for the closing call to action",
    aspectRatio: "4:5",
    prompt:
      "A waist-up portrait of this exact person with a calm, confident expression, chin level, direct eye contact with the camera. " +
      "Clean directional light, subtle background, shot on an 85mm lens.",
  },
];

export function avatarView(key: string): AvatarView | undefined {
  return AVATAR_VIEWS.find((view) => view.key === key);
}

/** Instructions appended to every view, to stop the model drifting. */
const CONSISTENCY_RULES = [
  "",
  "Critical: this must be the SAME person as in the reference photographs.",
  "Keep the face, bone structure, skin tone, hair colour and hair style exactly as they appear in the references.",
  "Do not beautify, slim, age, lighten or otherwise alter the person in any way.",
  "Photorealistic. No text, no watermarks, no logos, no borders.",
].join("\n");

export type GeneratedView = {
  key: AvatarViewKey;
  label: string;
  purpose: string;
  data: Buffer;
  mimeType: string;
  provider: string;
  prompt: string;
};

/**
 * Generates one view from the reference photographs.
 *
 * Throws if no reference-capable provider is available — the caller decides
 * whether that is fatal, and should say so rather than silently substituting
 * a picture of someone else.
 */
export async function generateAvatarView(
  view: AvatarView,
  references: Buffer[],
  extraDirection?: string,
): Promise<GeneratedView> {
  if (references.length === 0) {
    throw new Error("At least one reference photo is required");
  }

  const referenceImages: ReferenceImage[] = references.slice(0, 4).map((data) => ({
    data,
    mimeType: "image/jpeg",
    role: "person" as const,
  }));

  const prompt = [view.prompt, extraDirection?.trim() ?? "", CONSISTENCY_RULES]
    .filter(Boolean)
    .join("\n");

  const result = await composeImage({
    prompt,
    references: referenceImages,
    aspectRatio: view.aspectRatio,
  });

  return {
    key: view.key,
    label: view.label,
    purpose: view.purpose,
    data: result.data.data,
    mimeType: result.data.mimeType,
    provider: result.provider,
    prompt,
  };
}
