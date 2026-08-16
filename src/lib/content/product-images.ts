/**
 * Pulling a product's real photographs off its own page.
 *
 * This exists because of one specific failure: when a post is created from a
 * product *link* rather than an upload, there is no photograph to work from,
 * so the image model is asked to draw the product from a text description. It
 * happily obliges — and produces a different ring, a different fabric, a
 * different colour. A beautiful advert for something the seller does not sell.
 *
 * So before anything is generated, the product's own images are fetched and
 * become the reference. The model is then editing a real photograph rather
 * than inventing from words, and what comes out is the actual product.
 */

import { apiFetch } from "@/lib/pipeline/chain";

const USER_AGENT =
  "Mozilla/5.0 (compatible; AutoMarketingBot/1.0; +product-image-fetch)";
const PAGE_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 12_000;
/** Hard ceiling for the whole operation. */
const OVERALL_TIMEOUT_MS = 45_000;

/** Enough angles to work from; more just costs time. */
const MAX_IMAGES = 6;
/** Below this a file is a logo, an icon or a tracking pixel. */
const MIN_BYTES = 8_000;

export type ProductPhoto = {
  url: string;
  data: Buffer;
  mimeType: string;
};

/* ------------------------------------------------------------------ */

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Shopify and most CDNs encode the size in the filename; ask for the big one. */
function upscale(url: string): string {
  return url
    .replace(/_(\d{2,4})x(\d{2,4})?(_crop_[a-z]+)?\.(jpe?g|png|webp)/i, ".$4")
    .replace(/([?&])width=\d+/i, "$1width=1600")
    .replace(/([?&])w=\d+/i, "$1w=1600");
}

function looksLikeChrome(url: string): boolean {
  return /(logo|icon|favicon|sprite|placeholder|badge|payment|trustpilot|instagram|facebook|whatsapp|avatar|banner|loader|spinner)/i.test(
    url,
  );
}

/**
 * Every image URL on a product page, best first.
 *
 * Open Graph comes first because a shop chooses that image deliberately — it
 * is the one they would put on a billboard.
 */
export function extractImageUrls(html: string, pageUrl: string): string[] {
  // Declared images (Open Graph, JSON-LD) are THE product. Gallery <img> tags
  // are a mix of the product and whatever else the page shows — related items,
  // "you may also like", recently viewed. Keeping them apart matters: three
  // photographs of somebody else's ring is worse reference material than one
  // photograph of the right one.
  const declared: string[] = [];
  const gallery: string[] = [];
  const seen = new Set<string>();

  const add = (list: string[], raw: string | undefined) => {
    if (!raw) return;
    const resolved = absolute(decode(raw), pageUrl);
    if (!resolved) return;
    if (looksLikeChrome(resolved)) return;

    const big = upscale(resolved);
    // http:// and https:// versions of the same file are the same file.
    const key = big.replace(/^https?:\/\//i, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(big);
  };

  const push = (raw: string | undefined) => add(declared, raw);
  const pushGallery = (raw: string | undefined) => add(gallery, raw);

  // 1. Open Graph and Twitter cards — the shop's own pick.
  for (const match of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/gi,
  )) {
    push(match[1]);
  }

  // 2. Structured data — reliable when present.
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const image = (node as { image?: unknown }).image;
        if (typeof image === "string") push(image);
        else if (Array.isArray(image)) {
          for (const item of image) {
            if (typeof item === "string") push(item);
            else if (item && typeof item === "object") push((item as { url?: string }).url);
          }
        } else if (image && typeof image === "object") {
          push((image as { url?: string }).url);
        }
      }
    } catch {
      // Malformed JSON-LD is common; the other sources still work.
    }
  }

  // 3. Gallery <img> tags, including the lazy-loaded variants.
  for (const match of html.matchAll(/<img[^>]+>/gi)) {
    const tag = match[0];
    const src =
      tag.match(/\bdata-zoom(?:-image)?=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bdata-(?:large|original|full)(?:-image|-src)?=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (src && !/^data:/i.test(src)) pushGallery(src);

    // srcset — take the widest entry.
    const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1];
    if (srcset) {
      const widest = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/))
        .filter((parts) => parts[0])
        .sort((a, b) => (parseInt(b[1] ?? "0", 10) || 0) - (parseInt(a[1] ?? "0", 10) || 0))[0];
      if (widest?.[0] && !/^data:/i.test(widest[0])) pushGallery(widest[0]);
    }
  }

  // The declared images are authoritative. Only when a page declares none do
  // we fall back to scraping the gallery and accept the risk of stray items.
  return declared.length > 0 ? declared : gallery;
}

/* ------------------------------------------------------------------ */

async function download(url: string): Promise<ProductPhoto | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "image/*" },
      // Next.js wraps global fetch in its own cache. For third-party binaries
      // fetched from a background job that wrapper can hang, so bypass it.
      cache: "no-store",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const mimeType = response.headers.get("content-type") ?? "";
    if (!mimeType.startsWith("image/")) return null;

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < MIN_BYTES) return null;

    return { url, data, mimeType: mimeType.split(";")[0] };
  } catch {
    return null;
  }
}

/**
 * Fetches a product page and returns its photographs.
 *
 * Returns an empty array rather than throwing — a link that cannot be read is
 * a reason to warn the seller, not to abandon the post.
 */
export async function fetchProductImages(
  productUrl: string,
  options: { limit?: number; extraUrls?: string[] } = {},
): Promise<{ photos: ProductPhoto[]; foundUrls: string[]; error?: string }> {
  // No matter what goes wrong upstream, this call returns. A background job
  // blocked here shows no progress at all, which is the worst failure mode.
  return Promise.race([
    collectProductImages(productUrl, options),
    new Promise<{ photos: ProductPhoto[]; foundUrls: string[]; error?: string }>(
      (resolve) =>
        setTimeout(
          () => resolve({ photos: [], foundUrls: [], error: "timed out fetching the product page" }),
          OVERALL_TIMEOUT_MS,
        ).unref?.(),
    ),
  ]);
}

async function collectProductImages(
  productUrl: string,
  options: { limit?: number; extraUrls?: string[] } = {},
): Promise<{ photos: ProductPhoto[]; foundUrls: string[]; error?: string }> {
  const limit = options.limit ?? MAX_IMAGES;
  const candidates: string[] = [];

  // A URL the caller already knows about — the store listing's thumbnail —
  // is the most trustworthy starting point.
  for (const url of options.extraUrls ?? []) {
    const big = upscale(url);
    if (!candidates.includes(big)) candidates.push(big);
  }

  let error: string | undefined;

  try {
    const html = await apiFetch<string>(productUrl, {
      expect: "text",
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      cache: "no-store",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    for (const url of extractImageUrls(html, productUrl)) {
      if (!candidates.includes(url)) candidates.push(url);
    }
  } catch (problem) {
    error = (problem as Error).message.slice(0, 160);
  }

  /**
   * Download in parallel, and only from a bounded shortlist.
   *
   * A product page can easily yield forty image URLs, most of them dead ends.
   * Trying them one after another, each with a twenty-second timeout, is how a
   * step that should take five seconds ends up taking ten minutes.
   */
  const shortlist = candidates.slice(0, Math.max(limit * 3, 12));
  const settled = await Promise.all(shortlist.map((url) => download(url)));

  const photos: ProductPhoto[] = [];
  for (const photo of settled) {
    if (!photo) continue;
    if (photos.length >= limit) break;
    photos.push(photo);
  }

  return { photos, foundUrls: candidates.slice(0, 40), error };
}
