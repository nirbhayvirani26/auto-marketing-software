/**
 * Product link mathi information kadhe che.
 *
 * Traney rite try kare che (sauthi bharosalayak thi shuru):
 *   1. JSON-LD  (schema.org/Product) — Amazon, Shopify, WooCommerce badha aape che
 *   2. Open Graph meta tags (og:title, og:image, product:price:amount)
 *   3. Sadha <title> ane <meta name="description">
 */

export type ScrapedProduct = {
  url: string;
  title: string;
  description: string;
  price?: number;
  currency?: string;
  images: string[];
  brand?: string;
  availability?: string;
  siteName?: string;
  /** Kai rite malyu — debugging mate. */
  source: "json-ld" | "open-graph" | "html" | "mixed";
};

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function meta(html: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // property="og:title" content="..."  ane ulto kram — banne
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeEntities(match[1]);
    }
  }
  return undefined;
}

/** Page na badha JSON-LD blocks mathi Product node shodhe. */
function findProductJsonLd(html: string): Record<string, unknown> | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      continue;
    }

    // JSON-LD ek object, array, ke @graph hoi shake.
    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : [
          parsed,
          ...(((parsed as Record<string, unknown>)?.["@graph"] as unknown[]) ?? []),
        ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const node = candidate as Record<string, unknown>;
      const type = node["@type"];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((t) => String(t).toLowerCase() === "product")) {
        return node;
      }
    }
  }
  return null;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/**
 * Product page fetch karine information kadhe.
 * Site block kare to samajay evo error aape che.
 */
export async function scrapeProduct(rawUrl: string): Promise<ScrapedProduct> {
  let target: URL;
  try {
    target = new URL(rawUrl.trim());
  } catch {
    throw new Error("That URL is not valid — paste the full link including https://");
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Only http and https links are supported");
  }

  let response: Response;
  try {
    response = await fetch(target, {
      headers: {
        // Ghani sites bot ne block kare che — sadho browser UA vaparie.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    throw new Error(
      `Aa link kholi na shakai: ${(error as Error).message}. Link barabar che e check karo.`,
    );
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new Error(
        `Site e block karyu (HTTP ${response.status}). Aa site bots ne block kare che — vigat jate bharo.`,
      );
    }
    throw new Error(`Page load na thayu (HTTP ${response.status})`);
  }

  const html = await response.text();
  const finalUrl = response.url || target.toString();

  const images: string[] = [];
  let title = "";
  let description = "";
  let price: number | undefined;
  let currency: string | undefined;
  let brand: string | undefined;
  let availability: string | undefined;
  let source: ScrapedProduct["source"] = "html";

  // ---- 1. JSON-LD ----
  const node = findProductJsonLd(html);
  if (node) {
    source = "json-ld";
    title = String(node.name ?? "");
    description = String(node.description ?? "");

    for (const image of asArray(node.image as string | string[])) {
      if (typeof image === "string") images.push(absolute(image, finalUrl));
      else if (image && typeof image === "object") {
        const url = (image as Record<string, unknown>).url;
        if (typeof url === "string") images.push(absolute(url, finalUrl));
      }
    }

    const brandNode = node.brand;
    if (typeof brandNode === "string") brand = brandNode;
    else if (brandNode && typeof brandNode === "object") {
      brand = String((brandNode as Record<string, unknown>).name ?? "");
    }

    const offer = asArray(node.offers as Record<string, unknown>)[0] as
      | Record<string, unknown>
      | undefined;
    if (offer && typeof offer === "object") {
      const value = offer.price ?? offer.lowPrice;
      const parsed = Number(String(value).replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) price = parsed;
      if (offer.priceCurrency) currency = String(offer.priceCurrency);
      if (offer.availability) {
        availability = String(offer.availability).split("/").pop();
      }
    }
  }

  // ---- 2. Open Graph (jya khali hoy tya bharo) ----
  const ogTitle = meta(html, "og:title", "twitter:title");
  const ogDescription = meta(
    html,
    "og:description",
    "twitter:description",
    "description",
  );
  const ogImage = meta(html, "og:image", "og:image:secure_url", "twitter:image");
  const ogPrice = meta(html, "product:price:amount", "og:price:amount");
  const ogCurrency = meta(html, "product:price:currency", "og:price:currency");
  const siteName = meta(html, "og:site_name");

  if (!title && ogTitle) {
    title = ogTitle;
    source = source === "html" ? "open-graph" : "mixed";
  }
  if (!description && ogDescription) description = ogDescription;
  if (ogImage) images.push(absolute(ogImage, finalUrl));
  if (price === undefined && ogPrice) {
    const parsed = Number(ogPrice.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) price = parsed;
  }
  if (!currency && ogCurrency) currency = ogCurrency;

  // ---- 3. Sadhu HTML ----
  if (!title) {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (match) title = decodeEntities(match[1]).slice(0, 200);
  }

  if (!title) {
    throw new Error(
      "Aa page mathi product ni vigat na madi. Vigat jate bharo, ke biji link try karo.",
    );
  }

  return {
    url: finalUrl,
    title: title.slice(0, 300),
    description: description.slice(0, 2000),
    price,
    currency: currency?.slice(0, 8),
    // Duplicate ane data: URLs kadhi naakho.
    images: Array.from(new Set(images.filter((i) => i.startsWith("http")))).slice(0, 8),
    brand: brand || undefined,
    availability,
    siteName,
    source,
  };
}
