/**
 * Trending keywords ane hashtags.
 *
 * ⚠️ Ek saachi vaat pehla: Instagram pase "trending hashtag" no koi jaher
 * API nathi. Je tools "IG trending" batave che e badha andaj ke scraping par
 * chale che. Etle ahiya aapne EK thi vadhare saacha free source jodine
 * bharoso layak jawab banaviye chie:
 *
 *   1. Google Autocomplete — log kharekhar su type kare che (key vagar)
 *   2. Google Trends RSS   — aaje su chali rahyu che (key vagar)
 *   3. AI                  — aa data + product ne jodine hashtag ladder
 *
 * Ane sauthi agatya nu — hashtag "ladder". Ek nana account e
 * #fashion (30 crore post) par kadi nahi dekhay. Niche tags par dekhay che.
 * Etle broad/medium/niche no bhaag paadine aapiye chie.
 */

import { connectDB } from "@/lib/db";
import { TrendSnapshot } from "@/models/TrendSnapshot";
import { apiFetch, runChainSoft } from "@/lib/pipeline/chain";
import { complete } from "@/lib/ai/index";
import type { ProductIntelligence } from "@/lib/ai/vision";

export type HashtagTier = "broad" | "medium" | "niche" | "branded";

export type Hashtag = {
  tag: string;
  tier: HashtagTier;
  /** Kem aa tag — user ne samjay e mate. */
  reason?: string;
};

export type TrendPack = {
  /** Log su search kare che — caption ma aa shabdo naakhvana. */
  keywords: string[];
  /** Aaje chali rahela topics je aa product sathe bese che. */
  risingTopics: string[];
  /** Ready-to-post hashtag set, tier pramane gothvayelu. */
  hashtags: Hashtag[];
  /** Sidhu post ma mukvа layak string. */
  hashtagLine: string;
  sources: string[];
};

const CACHE_HOURS = 6;

/* ------------------------------------------------------------------ *
 *  Source 1 — Google Autocomplete (key vagar)
 * ------------------------------------------------------------------ */

/**
 * Log search bar ma su type kare che e sidhu Google pase thi. Aa keyword
 * research nu sauthi saachu ane sauthi sastu (free) source che.
 */
export async function googleAutocomplete(
  seed: string,
  geo = "IN",
): Promise<string[]> {
  const url = new URL("https://suggestqueries.google.com/complete/search");
  url.searchParams.set("client", "firefox");
  url.searchParams.set("hl", geo === "IN" ? "en-IN" : "en");
  url.searchParams.set("gl", geo);
  url.searchParams.set("q", seed);

  const raw = await apiFetch<string>(url.toString(), {
    expect: "text",
    headers: { "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12_000),
  });

  try {
    const parsed = JSON.parse(raw) as [string, string[]];
    return Array.isArray(parsed?.[1]) ? parsed[1].slice(0, 12) : [];
  } catch {
    return [];
  }
}

/** Words too common to prove a suggestion is actually about the product. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "in", "on", "at", "to", "of",
  "best", "online", "new", "buy", "shop", "price", "near", "me", "top", "your",
  "everyday", "relaxed", "fit", "wear", "style", "look",
]);

/** The words that actually identify this product. */
function contentWords(phrases: Array<string | undefined>): Set<string> {
  const words = new Set<string>();
  for (const phrase of phrases) {
    for (const word of String(phrase ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length >= 3 && !STOP_WORDS.has(word)) words.add(word);
    }
  }
  return words;
}

/**
 * Turns a few seeds into many long-tail keywords, using the autocomplete
 * prefix trick.
 *
 * Suggestions are then filtered back down to those that still mention the
 * product. Autocomplete happily wanders — seed it with "navy blue cotton
 * kurta" and it will offer "navyug college surat" — and an unfiltered list
 * produces hashtags that have nothing to do with what is being sold.
 */
async function expandKeywords(
  seeds: string[],
  geo: string,
  anchors: Set<string>,
): Promise<string[]> {
  const modifiers = ["", " for ", " best ", " online "];
  const jobs: Array<Promise<string[]>> = [];

  for (const seed of seeds.slice(0, 4)) {
    // A long sentence is a poor prefix; keep it to the first few real words.
    const trimmed = seed.split(/\s+/).slice(0, 4).join(" ");
    for (const modifier of modifiers) {
      jobs.push(googleAutocomplete(`${trimmed}${modifier}`, geo).catch(() => []));
    }
  }

  const results = dedupe((await Promise.all(jobs)).flat());
  if (anchors.size === 0) return results;

  const onTopic = results.filter((phrase) => {
    const words = phrase.toLowerCase().split(/[^a-z0-9]+/);
    return words.some((word) => anchors.has(word));
  });

  // If filtering left almost nothing, the anchors were probably too narrow —
  // better to hand back the raw list than an empty one.
  return onTopic.length >= 4 ? onTopic : results;
}

/* ------------------------------------------------------------------ *
 *  Source 2 — Google Trends daily RSS (key vagar)
 * ------------------------------------------------------------------ */

/** Aaje kaya topics chali rahya che (desh pramane). */
export async function googleDailyTrends(geo = "IN"): Promise<string[]> {
  const raw = await apiFetch<string>(
    `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`,
    {
      expect: "text",
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15_000),
    },
  );

  const titles = [...raw.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)]
    .map((m) => m[1].trim())
    .filter((t) => t && !/daily search trends/i.test(t));

  return dedupe(titles).slice(0, 25);
}

/* ------------------------------------------------------------------ *
 *  Source 3 — AI je badhu jode
 * ------------------------------------------------------------------ */

const HASHTAG_SCHEMA = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "12 buyer-intent search phrases to weave into the caption.",
    },
    risingTopics: {
      type: "array",
      items: { type: "string" },
      description: "Up to 5 currently-trending angles from the supplied trend list that this product can genuinely ride. Leave empty if none fit — do not force it.",
    },
    broad: {
      type: "array",
      items: { type: "string" },
      description: "4 huge hashtags (10M+ posts). Reach, not ranking.",
    },
    medium: {
      type: "array",
      items: { type: "string" },
      description: "10 mid-size hashtags (100k-2M posts). The sweet spot.",
    },
    niche: {
      type: "array",
      items: { type: "string" },
      description: "12 small, very specific hashtags (under 100k posts). This is where a small account actually ranks — be specific about product, style, city, occasion.",
    },
  },
  required: ["keywords", "risingTopics", "broad", "medium", "niche"],
};

type HashtagResponse = {
  keywords: string[];
  risingTopics: string[];
  broad: string[];
  medium: string[];
  niche: string[];
};

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

export type TrendPackOptions = {
  product: Pick<
    ProductIntelligence,
    | "productName"
    | "category"
    | "subCategory"
    | "style"
    | "occasions"
    | "targetGender"
    | "searchKeywords"
    | "seedHashtags"
    | "apparelType"
    | "materials"
    | "degraded"
  >;
  geo?: string;
  /** The brand's own hashtag, always appended last. */
  brandTag?: string;
  /** How many hashtags to return. Instagram allows at most 30. */
  limit?: number;
  platform?: "instagram" | "facebook";
};

export async function buildTrendPack(
  options: TrendPackOptions,
): Promise<TrendPack> {
  const geo = options.geo || process.env.TRENDS_GEO || "IN";
  const product = options.product;
  // Keyed on the product too, so two different items in the same category do
  // not share one cached hashtag ladder.
  const subject = `${product.category}|${product.subCategory}|${product.productName}`
    .toLowerCase()
    .slice(0, 120);

  const cached = await readCache("hashtags", subject, geo);
  const sources: string[] = [];

  // ---- 1. Bahar na free sources (cache hoy to skip) ----
  let autoKeywords: string[] = cached?.keywords ?? [];
  let daily: string[] = cached?.rising ?? [];

  // When vision could not read the photo there is nothing honest to search
  // for. Expanding whatever string happens to be around produces confidently
  // wrong tags — a brand name once expanded to "#mycompanyisnotgivingmysalary"
  // — so the search step is skipped entirely and only the brand tag is used.
  if (product.degraded) {
    const brandTag = options.brandTag?.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const hashtags: Hashtag[] = brandTag
      ? [{ tag: brandTag, tier: "branded", reason: "brand" }]
      : [];

    return {
      keywords: [],
      risingTopics: [],
      hashtags,
      hashtagLine: hashtags.map((tag) => `#${tag.tag}`).join(" "),
      sources: ["skipped — the product could not be identified"],
    };
  }

  if (!cached) {
    // Placeholder values from normalise() must never become a search seed:
    // asking Google to expand "General" returns hashtags about general
    // physicians, which is worse than returning nothing.
    const placeholder = new Set(["general", "product", "unknown", "other", ""]);
    const seeds = dedupe([
      product.subCategory,
      product.productName,
      product.category,
      ...(product.searchKeywords ?? []).slice(0, 2),
    ]).filter((seed) => seed && !placeholder.has(seed.toLowerCase().trim()));

    const anchors = contentWords([
      product.productName,
      product.subCategory,
      product.category,
      product.apparelType,
      ...(product.searchKeywords ?? []),
      ...(product.materials ?? []),
    ]);

    const [expanded, trending] = await Promise.all([
      runChainSoft<string[]>(
        [
          {
            name: "google-autocomplete",
            free: true,
            run: () => expandKeywords(seeds, geo, anchors),
          },
        ],
        { label: "Keyword expansion", timeoutMs: 25_000, retries: 1 },
      ),
      runChainSoft<string[]>(
        [{ name: "google-trends-rss", free: true, run: () => googleDailyTrends(geo) }],
        { label: "Daily trends", timeoutMs: 20_000, retries: 1 },
      ),
    ]);

    if (expanded?.data.length) {
      autoKeywords = expanded.data;
      sources.push("google-autocomplete");
    }
    if (trending?.data.length) {
      daily = trending.data;
      sources.push("google-trends");
    }

    await writeCache("hashtags", subject, geo, {
      keywords: autoKeywords,
      rising: daily,
      source: sources.join(","),
    });
  } else {
    sources.push(`cache(${cached.source ?? "?"})`);
  }

  // ---- 2. AI badhu jode ne ladder banave ----
  let ai: HashtagResponse | null = null;
  try {
    const { data } = await complete<HashtagResponse>({
      system: [
        "You are an Instagram SEO strategist for small and mid-size commerce brands.",
        "You know that hashtag reach is a ladder: huge tags give impressions but never rank a small account, niche tags are where posts actually get discovered.",
        "You never invent hashtags that no one uses, and you never use banned or spammy tags (no #like4like, #followforfollow, #f4f).",
        "Hashtags must be lowercase, no spaces, no punctuation, no leading #.",
      ].join(" "),
      prompt: [
        `Product: ${product.productName}`,
        `Category: ${product.category} → ${product.subCategory}`,
        product.style ? `Style: ${product.style}` : "",
        product.occasions?.length ? `Occasions: ${product.occasions.join(", ")}` : "",
        `Audience: ${product.targetGender}`,
        `Market: ${geo}`,
        `Platform: ${options.platform ?? "instagram"}`,
        "",
        autoKeywords.length
          ? `What real people are typing into Google right now (use these, they are real demand):\n${autoKeywords.slice(0, 40).join("\n")}`
          : "",
        "",
        daily.length
          ? `Topics trending in this country today (only use one if it HONESTLY connects to the product):\n${daily.slice(0, 20).join(", ")}`
          : "",
        "",
        product.seedHashtags?.length
          ? `Starting hashtag ideas from image analysis: ${product.seedHashtags.slice(0, 20).join(", ")}`
          : "",
        "",
        "Build the hashtag ladder now.",
      ]
        .filter(Boolean)
        .join("\n"),
      schema: HASHTAG_SCHEMA,
      maxTokens: 2000,
    });
    ai = data;
    sources.push("ai");
  } catch {
    // AI na chalyu to pan image analysis na seed hashtags thi kaam chali jashe.
  }

  const clean = (list: unknown, limit: number): string[] =>
    (Array.isArray(list) ? list : [])
      .map((t) =>
        String(t)
          .toLowerCase()
          .replace(/^#/, "")
          .replace(/[^a-z0-9_]/g, ""),
      )
      .filter((t) => t.length >= 3 && t.length <= 30)
      .slice(0, limit);

  const broad = clean(ai?.broad, 4);
  const medium = clean(ai?.medium, 10);
  const niche = clean(ai?.niche, 12);

  let tagged: Hashtag[] = [
    ...broad.map((tag) => ({ tag, tier: "broad" as const, reason: "reach" })),
    ...medium.map((tag) => ({ tag, tier: "medium" as const, reason: "discovery" })),
    ...niche.map((tag) => ({ tag, tier: "niche" as const, reason: "ranking" })),
  ];

  if (tagged.length < 8) {
    // The AI step did not run. Build the ladder from what is still real: the
    // hashtag seeds the vision pass produced, the phrases people are actually
    // typing into Google, and the product's own words. Autocomplete needs no
    // key, so this path stays useful even with every AI account switched off.
    const fallbackSource = dedupe([
      ...clean(product.seedHashtags, 24),
      ...clean(
        autoKeywords.map((phrase) => phrase.replace(/\s+/g, "")),
        24,
      ),
      ...clean(
        [product.subCategory, product.category, product.style, ...(product.occasions ?? [])].map(
          (word) => String(word ?? "").replace(/\s+/g, ""),
        ),
        8,
      ),
    ]);

    tagged = fallbackSource.map((tag, index) => ({
      tag,
      tier: (index < 4 ? "broad" : index < 12 ? "medium" : "niche") as HashtagTier,
      reason: "search demand",
    }));
  }

  if (options.brandTag) {
    const brandTag = options.brandTag.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (brandTag) {
      tagged.push({ tag: brandTag, tier: "branded", reason: "brand" });
    }
  }

  // Duplicate kadho, ane platform ni limit ma raho.
  const seen = new Set<string>();
  const maxTags =
    options.limit ?? (options.platform === "facebook" ? 6 : 30);
  const hashtags = tagged
    .filter((h) => (seen.has(h.tag) ? false : (seen.add(h.tag), true)))
    .slice(0, maxTags);

  const keywords = dedupe([
    ...clean(ai?.keywords, 12).map((k) => k.replace(/_/g, " ")),
    ...(ai?.keywords ?? []).map((k) => String(k).trim()),
    ...autoKeywords.slice(0, 12),
    ...(product.searchKeywords ?? []),
  ]).slice(0, 20);

  return {
    keywords,
    risingTopics: (ai?.risingTopics ?? []).map(String).filter(Boolean).slice(0, 5),
    hashtags,
    hashtagLine: hashtags.map((h) => `#${h.tag}`).join(" "),
    sources,
  };
}

/* ------------------------------------------------------------------ *
 *  Cache helpers
 * ------------------------------------------------------------------ */

async function readCache(kind: string, subject: string, geo: string) {
  try {
    await connectDB();
    return await TrendSnapshot.findOne({
      kind,
      subject,
      geo,
      expiresAt: { $gt: new Date() },
    }).lean();
  } catch {
    return null;
  }
}

async function writeCache(
  kind: string,
  subject: string,
  geo: string,
  data: { keywords: string[]; rising: string[]; source: string },
) {
  try {
    await connectDB();
    await TrendSnapshot.findOneAndUpdate(
      { kind, subject, geo },
      {
        ...data,
        expiresAt: new Date(Date.now() + CACHE_HOURS * 3600_000),
      },
      { upsert: true },
    );
  } catch {
    // Cache lakhi na shakaya to pan jawab to malyo j che.
  }
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const value = item.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
