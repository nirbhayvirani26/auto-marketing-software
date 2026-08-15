/**
 * Post images — one call that returns a URL Instagram will accept.
 *
 * The full pipeline in `media/image-gen.ts` returns raw bytes, because reels
 * need the file on disk to render. Posts need the opposite: a public https URL,
 * because Meta downloads the media from its own servers. This module bridges
 * the two.
 *
 *   1. Nano Banana (Gemini 2.5 Flash Image) generates the picture
 *   2. `media/hosts.ts` uploads it and hands back a public URL
 *   3. If either step fails, Pollinations gives a URL that *is* the image, with
 *      no key and no upload — good enough to keep a campaign moving
 */

import { generateImage as generatePixels } from "./media/image-gen";
import { uploadPublic } from "./media/hosts";

export type ImageProviderKey = "nano-banana" | "pollinations";

export type GeneratedImage = {
  url: string;
  provider: ImageProviderKey;
  prompt: string;
  /** Where the file ended up: cloudinary, imgbb, catbox, pollinations… */
  host?: string;
};

/**
 * Pollinations.ai needs no API key: the prompt goes in the URL and that URL
 * always resolves to an image, so it can be handed straight to Instagram.
 */
function pollinationsUrl(prompt: string, seed?: number): string {
  const encoded = encodeURIComponent(prompt.slice(0, 900));
  const params = new URLSearchParams({
    width: "1080",
    height: "1080",
    nologo: "true",
    model: process.env.POLLINATIONS_MODEL || "flux",
  });
  if (seed !== undefined) params.set("seed", String(seed));
  return `https://image.pollinations.ai/prompt/${encoded}?${params.toString()}`;
}

/** Confirms a URL really serves an image before Meta is asked to fetch it. */
async function verifyImageUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { range: "bytes=0-2048" },
      signal: AbortSignal.timeout(60_000),
    });
    const type = response.headers.get("content-type") ?? "";
    return response.ok && type.startsWith("image/");
  } catch {
    return false;
  }
}

function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export function imageProviderStatus() {
  return [
    {
      key: "nano-banana" as const,
      label: "Nano Banana (Gemini 2.5 Flash Image)",
      free: true,
      configured: geminiConfigured(),
      note: "The default image model. Free tier, and it reads reference photos. Get a key at aistudio.google.com/apikey",
    },
    {
      key: "pollinations" as const,
      label: "Pollinations (no key needed)",
      free: true,
      configured: process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
      note: "The fallback. Nothing to set up, but it cannot work from a reference photo.",
    },
  ];
}

/**
 * Produces an image for a post and returns a publicly reachable URL.
 *
 * Throws only when every route failed — the caller is then expected to fall
 * back to the product's own photography.
 */
export async function generateImage(options: {
  prompt: string;
  provider?: ImageProviderKey;
  seed?: number;
  aspectRatio?: "1:1" | "4:5" | "9:16";
}): Promise<GeneratedImage> {
  const preferred =
    options.provider ??
    (process.env.IMAGE_PROVIDER as ImageProviderKey | undefined) ??
    "nano-banana";

  if (preferred !== "pollinations" && geminiConfigured()) {
    try {
      const generated = await generatePixels({
        prompt: options.prompt,
        aspectRatio: options.aspectRatio ?? "1:1",
        seed: options.seed,
      });

      const hosted = await uploadPublic({
        data: generated.data.data,
        filename: `post-${Date.now()}.jpg`,
        mimeType: generated.data.mimeType,
        kind: "image",
      });

      return {
        url: hosted.data.url,
        provider: "nano-banana",
        prompt: options.prompt,
        host: hosted.data.host,
      };
    } catch {
      // Fall through to the keyless option rather than failing the campaign.
    }
  }

  const url = pollinationsUrl(options.prompt, options.seed);

  // The first request is what actually renders the image, so check it resolves
  // before handing the URL to Meta.
  if (!(await verifyImageUrl(url))) {
    throw new Error(
      "The image could not be generated. Try again in a moment, or use the product's own photo.",
    );
  }

  return {
    url,
    provider: "pollinations",
    prompt: options.prompt,
    host: "pollinations",
  };
}
