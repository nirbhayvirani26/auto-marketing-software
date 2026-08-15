/**
 * Store crawler — finds every product on a website.
 *
 * The order of attack matters, because it goes from "cheap and complete" to
 * "slow and partial":
 *
 *   1. Shopify's products.json — one request returns the whole catalogue with
 *      titles, prices and images. Perfect, when the store runs Shopify.
 *   2. sitemap.xml — nearly every real store publishes one, and product pages
 *      are almost always distinguishable by their URL shape (/product/, /p/,
 *      /products/…). Cheap and close to complete.
 *   3. An HTML crawl of the home page and its collection pages — the fallback
 *      for a hand-built site with no sitemap.
 *
 * Whatever is found gets titles and images filled in from Open Graph tags.
 *
 * This is deliberately polite: a capped number of pages, a concurrency limit,
 * a per-request timeout, and it respects nothing it was not pointed at. It
 * only ever reads pages the seller told us they own.
 */

import { apiFetch } from "@/lib/pipeline/chain";

export type FoundProduct = {
  url: string;
  title: string;
  imageUrl?: string;
  price?: string;
  source: "sitemap" | "crawl" | "manual";
};

export type CrawlResult = {
  products: FoundProduct[];
  platform: "shopify" | "woocommerce" | "wix" | "magento" | "custom";
  sources: string[];
};

/** Hard limits, so one crawl can never run away with the server. */
const MAX_PRODUCTS = 300;
const MAX_HTML_PAGES = 40;
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; AutoMarketingBot/1.0; +product-catalogue-sync)";

/**
 * URL shapes that almost always mean "this is a product page".
 *
 * Deliberately broad — a false positive costs one wasted fetch, whereas a
 * false negative means the seller's product never appears at all. Anything
 * this misses is caught by the `looksLikeProduct()` pass below.
 */
const PRODUCT_PATH =
  /\/(products?|product-page|p|pd|item|items|shop|dp|buy|catalogue|catalog|collections\/[^/]+\/products)\//i;

/**
 * Paths that are listings, not products — categories, tags, paginated pages,
 * carts and accounts.
 *
 * Without this, `/catalogue/category/books/philosophy_7/` matches PRODUCT_PATH
 * on the `/catalogue/` segment and every category page is imported as though
 * it were an item for sale.
 */
const LISTING_PATH =
  /\/(category|categories|collections?\/?$|tag|tags|page|pages|search|cart|account|login|checkout|blog|policies)\//i;

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

export function normaliseSiteUrl(input: string): { url: string; host: string } {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  return {
    url: `${parsed.protocol}//${parsed.host}`,
    host: parsed.host.toLowerCase().replace(/^www\./, ""),
  };
}

async function getText(url: string): Promise<string> {
  return apiFetch<string>(url, {
    expect: "text",
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Runs jobs a few at a time rather than all at once. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results.push(await worker(items[index]));
      } catch {
        // One bad page must never fail the whole crawl.
      }
    }
  });

  await Promise.all(runners);
  return results;
}

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function meta(html: string, property: string): string | undefined {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1].trim());
  }
  return undefined;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace — page titles are often wrapped across lines.
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(html: string): string | undefined {
  const og = meta(html, "og:title");
  if (og) return og;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? decodeEntities(match[1]) : undefined;
}

/* ------------------------------------------------------------------ *
 *  1. Shopify — the whole catalogue in one request
 * ------------------------------------------------------------------ */

type ShopifyProduct = {
  title?: string;
  handle?: string;
  images?: Array<{ src?: string }>;
  variants?: Array<{ price?: string }>;
};

async function fromShopify(base: string): Promise<FoundProduct[]> {
  const found: FoundProduct[] = [];

  // Shopify paginates at 250; two pages is plenty for our cap.
  for (const page of [1, 2]) {
    const raw = await getText(`${base}/products.json?limit=250&page=${page}`);
    const parsed = JSON.parse(raw) as { products?: ShopifyProduct[] };
    const products = parsed.products ?? [];
    if (products.length === 0) break;

    for (const product of products) {
      if (!product.handle || !product.title) continue;
      found.push({
        url: `${base}/products/${product.handle}`,
        title: decodeEntities(product.title),
        imageUrl: product.images?.[0]?.src,
        price: product.variants?.[0]?.price,
        source: "sitemap",
      });
    }

    if (found.length >= MAX_PRODUCTS) break;
  }

  return found.slice(0, MAX_PRODUCTS);
}

/* ------------------------------------------------------------------ *
 *  2. sitemap.xml
 * ------------------------------------------------------------------ */

function locsIn(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) =>
    decodeEntities(match[1]),
  );
}

async function fromSitemap(base: string): Promise<string[]> {
  const candidates = [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap_products_1.xml`,
  ];

  const urls = new Set<string>();

  for (const candidate of candidates) {
    let xml: string;
    try {
      xml = await getText(candidate);
    } catch {
      continue;
    }

    const locs = locsIn(xml);

    // An index points at more sitemaps. Follow the product-looking ones.
    const nested = locs.filter((loc) => /\.xml(\?|$)/i.test(loc));
    if (nested.length > 0) {
      const interesting = nested
        .filter((loc) => /product|item|shop/i.test(loc))
        .slice(0, 5);

      // No obviously-product sitemap? Take the first few and let the URL
      // filter below decide.
      const toFetch = interesting.length ? interesting : nested.slice(0, 3);

      await pooled(toFetch, CONCURRENCY, async (child) => {
        const childXml = await getText(child);
        for (const loc of locsIn(childXml)) urls.add(loc);
      });
    }

    for (const loc of locs) {
      if (!/\.xml(\?|$)/i.test(loc)) urls.add(loc);
    }

    if (urls.size > 0) break;
  }

  return [...urls];
}

/* ------------------------------------------------------------------ *
 *  3. HTML crawl — the fallback
 * ------------------------------------------------------------------ */

/** Does this page declare itself a product, in markup rather than in its URL? */
function looksLikeProduct(html: string): boolean {
  if (/<meta[^>]+property=["']og:type["'][^>]+content=["']product/i.test(html)) {
    return true;
  }
  if (/schema\.org\/Product|"@type"\s*:\s*"Product"/i.test(html)) return true;
  // Open Graph price tags only appear on something being sold.
  if (/property=["'](?:product:price:amount|og:price:amount)["']/i.test(html)) {
    return true;
  }
  return false;
}

async function fromHtmlCrawl(base: string, host: string): Promise<string[]> {
  const seen = new Set<string>();
  const productUrls = new Set<string>();
  const otherPages = new Set<string>();
  const queue: string[] = [base];

  while (queue.length > 0 && seen.size < MAX_HTML_PAGES) {
    const batch = queue.splice(0, CONCURRENCY).filter((url) => !seen.has(url));
    if (batch.length === 0) continue;
    for (const url of batch) seen.add(url);

    await pooled(batch, CONCURRENCY, async (url) => {
      const html = await getText(url);

      for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
        const resolved = absolute(match[1], url);
        if (!resolved) continue;

        const parsed = new URL(resolved);
        if (parsed.host.toLowerCase().replace(/^www\./, "") !== host) continue;
        // Skip assets and anything that clearly is not a page.
        if (/\.(jpe?g|png|gif|webp|svg|css|js|pdf|zip|xml|ico)$/i.test(parsed.pathname)) {
          continue;
        }

        if (PRODUCT_PATH.test(parsed.pathname) && !LISTING_PATH.test(parsed.pathname)) {
          productUrls.add(resolved);
          continue;
        }

        // Collection and category pages are worth following once.
        if (
          /\/(collections?|categor|shop|catalog|store)/i.test(parsed.pathname) &&
          !seen.has(resolved) &&
          queue.length < MAX_HTML_PAGES
        ) {
          queue.push(resolved);
          continue;
        }

        if (otherPages.size < 120) otherPages.add(resolved);
      }
    });
  }

  if (productUrls.size > 0) return [...productUrls];

  // Nothing matched by URL shape. Plenty of real stores use paths that give
  // nothing away — /catalogue/a-light-in-the-attic/index.html and the like —
  // so sample the ordinary pages and keep the ones whose markup says
  // "product". Slower, but it is the difference between finding the
  // catalogue and telling the seller we found nothing.
  const sample = [...otherPages].slice(0, 60);
  const confirmed = await pooled(sample, CONCURRENCY, async (url) => {
    const html = await getText(url);
    return looksLikeProduct(html) ? url : null;
  });

  return confirmed.filter((url): url is string => url !== null);
}

/* ------------------------------------------------------------------ *
 *  Filling in titles and images
 * ------------------------------------------------------------------ */

async function describe(url: string): Promise<FoundProduct | null> {
  const html = await getText(url);
  const title = titleOf(html);
  if (!title) return null;

  return {
    url,
    title: title.slice(0, 200),
    imageUrl: meta(html, "og:image"),
    price:
      meta(html, "product:price:amount") ??
      meta(html, "og:price:amount") ??
      undefined,
    source: "sitemap",
  };
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

/**
 * Crawls a store and returns everything that looks like a product.
 *
 * Never throws for an ordinary "nothing found" — an empty list with the
 * sources it tried is a legitimate answer, and the UI says so.
 */
export async function crawlWebsite(siteUrl: string): Promise<CrawlResult> {
  const { url: base, host } = normaliseSiteUrl(siteUrl);
  const sources: string[] = [];

  /* ---- 1. Shopify ---- */
  try {
    const shopify = await fromShopify(base);
    if (shopify.length > 0) {
      sources.push(`Shopify catalogue (${shopify.length} products)`);
      return { products: shopify, platform: "shopify", sources };
    }
  } catch {
    // Not Shopify, or the endpoint is closed. Carry on.
  }

  /* ---- Detect the platform from the home page, for display ---- */
  let platform: CrawlResult["platform"] = "custom";
  let homeHtml = "";
  try {
    homeHtml = await getText(base);
    // Word-boundaried on purpose: a bare /mage/ matches inside "image", and
    // every site on earth contains the word "image".
    if (/cdn\.shopify\.com|\bshopify\b/i.test(homeHtml)) platform = "shopify";
    else if (/wp-content|\bwoocommerce\b/i.test(homeHtml)) platform = "woocommerce";
    else if (/wix\.com|wixstatic/i.test(homeHtml)) platform = "wix";
    else if (/\bmagento\b|Mage\.Cookies/i.test(homeHtml)) platform = "magento";
  } catch {
    // A home page we cannot read is not fatal; the sitemap may still work.
  }

  /* ---- 2. sitemap ---- */
  let candidates: string[] = [];
  try {
    const sitemapUrls = await fromSitemap(base);
    candidates = sitemapUrls.filter((url) => {
      const path = new URL(url).pathname;
      return PRODUCT_PATH.test(path) && !LISTING_PATH.test(path);
    });
    if (candidates.length > 0) {
      sources.push(`sitemap.xml (${candidates.length} product URLs)`);
    } else if (sitemapUrls.length > 0) {
      sources.push(`sitemap.xml found, but no product-shaped URLs in it`);
    }
  } catch {
    // No sitemap.
  }

  /* ---- 3. HTML crawl ---- */
  if (candidates.length === 0) {
    try {
      candidates = await fromHtmlCrawl(base, host);
      if (candidates.length > 0) {
        sources.push(`page crawl (${candidates.length} product URLs)`);
      }
    } catch {
      // Nothing readable.
    }
  }

  if (candidates.length === 0) {
    sources.push("no product pages could be found automatically");
    return { products: [], platform, sources };
  }

  /* ---- Titles and images ---- */
  const limited = candidates.slice(0, MAX_PRODUCTS);
  const described = await pooled(limited, CONCURRENCY, describe);
  const products = described.filter((item): item is FoundProduct => item !== null);

  sources.push(`read ${products.length} product pages for titles and images`);

  return { products, platform, sources };
}
