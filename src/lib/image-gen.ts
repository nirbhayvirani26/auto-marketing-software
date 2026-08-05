/**
 * Image generation — FREE options pehla.
 *
 * Instagram ne PUBLIC https URL joiye j che, etle je provider sidho public
 * URL aape e sauthi saralo che.
 *
 *   pollinations — sav free, koi API key nahi, URL j image che
 *   gemini       — Google Imagen (free tier), base64 pacho aape
 *   none         — koi generation nahi (product ni potani image vaparo)
 */

export type ImageProviderKey = "pollinations" | "gemini";

export type GeneratedImage = {
  url: string;
  provider: ImageProviderKey;
  prompt: string;
  /** base64 hoy to — host karvu pade. */
  base64?: string;
};

/**
 * Pollinations.ai — API key vagar. Prompt URL ma j jaay che ane e URL
 * kayam ek image aape che, etle Instagram ne sidho aapi shakay.
 */
function pollinationsUrl(prompt: string, seed?: number): string {
  const encoded = encodeURIComponent(prompt.slice(0, 900));
  const params = new URLSearchParams({
    width: "1080",
    height: "1080",
    nologo: "true",
    model: "flux",
  });
  if (seed !== undefined) params.set("seed", String(seed));
  return `https://image.pollinations.ai/prompt/${encoded}?${params.toString()}`;
}

/** URL kharekhar image aape che ke nahi e check kare. */
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

export function imageProviderStatus() {
  return [
    {
      key: "pollinations" as const,
      label: "Pollinations (free, key vagar)",
      free: true,
      configured: true,
      note: "Koi setup nahi — turant chale che",
    },
    {
      key: "gemini" as const,
      label: "Google Imagen (free tier)",
      free: true,
      configured: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
      note: "GEMINI_API_KEY joiye",
    },
  ];
}

/**
 * Product mate image banave. Default provider free che, etle koi key
 * vagar pan kaam kare che.
 */
export async function generateImage(opts: {
  prompt: string;
  provider?: ImageProviderKey;
  seed?: number;
}): Promise<GeneratedImage> {
  const provider =
    opts.provider ??
    (process.env.IMAGE_PROVIDER as ImageProviderKey | undefined) ??
    "pollinations";

  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (key) {
      try {
        return await generateWithGemini(opts.prompt, key);
      } catch {
        // Gemini fail thay to free pollinations par pacha vado.
      }
    }
  }

  const url = pollinationsUrl(opts.prompt, opts.seed);

  // Pehli var URL hit karvathi image generate thay che (thodi var lage che).
  // Instagram ne aapya pehla khatri kari laiye.
  const ok = await verifyImageUrl(url);
  if (!ok) {
    throw new Error(
      "Image generate na thai — thodi var pachi try karo, athva product ni potani image vapro.",
    );
  }

  return { url, provider: "pollinations", prompt: opts.prompt };
}

async function generateWithGemini(
  prompt: string,
  key: string,
): Promise<GeneratedImage> {
  const model = process.env.GEMINI_IMAGE_MODEL ?? "imagen-3.0-generate-002";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: "1:1" },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  const json = (await response.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string }>;
    error?: { message?: string };
  };

  if (!response.ok || json.error) {
    throw new Error(json.error?.message ?? `Imagen HTTP ${response.status}`);
  }

  const base64 = json.predictions?.[0]?.bytesBase64Encoded;
  if (!base64) throw new Error("Imagen e image na aapi");

  // Base64 ne data URL tarike aapiye — UI preview mate. Instagram mate
  // aane koi public host par mukvu pade (niche note jovo).
  return {
    url: `data:image/png;base64,${base64}`,
    base64,
    provider: "gemini",
    prompt,
  };
}
