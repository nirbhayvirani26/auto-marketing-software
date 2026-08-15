/**
 * Post ranking — "meri post upar aave" e mate je kharekhar kaam kare che.
 *
 * Instagram have caption na shabdo pan search ma index kare che (fakt
 * hashtag nahi). Ane Reels no ranking mukhyatve WATCH TIME, SHARES ane
 * SAVES par chale che. Etle ahiya be vastu che:
 *
 *   1. scoreCaption() — caption ne 100 ma marks aape ane su sudharvu e kahe
 *   2. bestPostTimes() — kaya vakhate mukvathi pehla kalak ma vadhu reach
 *
 * Aa koi jaadu nathi — aa jaher rite jaanita signals nu checklist che, je
 * dareak post par apoaap lagu pade che.
 */

export type CaptionCheck = {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  hint: string;
};

export type CaptionScore = {
  score: number;
  grade: "A" | "B" | "C" | "D";
  checks: CaptionCheck[];
  /** Sudharva jevi sauthi agatya ni traan vaat. */
  topFixes: string[];
};

const CTA_WORDS = [
  "comment", "save", "share", "tag", "dm", "link in bio", "shop", "order",
  "buy", "swipe", "follow", "kaho", "lakho", "moklo", "save karo", "kahejo",
];

const WEAK_OPENERS = [
  "in today's", "we are excited", "introducing", "check out our",
  "we are thrilled", "look no further", "are you looking for",
];

/**
 * Caption ne ranking na najariya thi tapase.
 * `keywords` ma primary keyword pehlo hovo joiye.
 */
export function scoreCaption(input: {
  caption: string;
  hashtags: string[];
  keywords: string[];
  platform: "instagram" | "facebook";
  format?: "reel" | "image" | "carousel" | "story";
}): CaptionScore {
  const caption = input.caption.trim();
  const lower = caption.toLowerCase();
  const firstLine = caption.split("\n")[0] ?? "";
  const hook = caption.slice(0, 125).toLowerCase();
  const primary = (input.keywords[0] ?? "").toLowerCase();
  const words = caption.split(/\s+/).filter(Boolean);

  const keywordHits = input.keywords
    .slice(0, 6)
    .filter((k) => k.length > 3 && lower.includes(k.toLowerCase())).length;

  const checks: CaptionCheck[] = [
    {
      id: "hook-length",
      label: "The first line is 40-90 characters",
      weight: 12,
      passed: firstLine.length >= 25 && firstLine.length <= 100,
      hint: "Instagram shows only the first line before 'more' — that line is the hook.",
    },
    {
      id: "keyword-in-hook",
      label: "The main keyword appears in the first 125 characters",
      weight: 18,
      passed: Boolean(primary) && hook.includes(primary),
      hint: "Instagram search weights the opening words of a caption most heavily.",
    },
    {
      id: "keyword-density",
      label: "Other keywords are woven in as well",
      weight: 12,
      passed: keywordHits >= 2,
      hint: "Weave in 2-4 related keywords naturally — do not stuff them.",
    },
    {
      id: "no-weak-opener",
      label: "It does not open with a cliché",
      weight: 10,
      passed: !WEAK_OPENERS.some((phrase) => lower.startsWith(phrase)),
      hint: "'Introducing…' and 'Check out our…' do not stop anyone scrolling.",
    },
    {
      id: "cta",
      label: "There is a clear call to action",
      weight: 14,
      passed: CTA_WORDS.some((word) => lower.includes(word)),
      hint: "Ask for a comment, save or share — all three lift ranking.",
    },
    {
      id: "length",
      label: "Length is right",
      weight: 10,
      passed:
        input.platform === "instagram"
          ? words.length >= 20 && words.length <= 150
          : words.length >= 15 && words.length <= 120,
      hint: "Too short says nothing; too long and nobody reads it.",
    },
    {
      id: "hashtag-count",
      label: "The hashtag count is right",
      weight: 10,
      passed:
        input.platform === "instagram"
          ? input.hashtags.length >= 12 && input.hashtags.length <= 30
          : input.hashtags.length >= 2 && input.hashtags.length <= 8,
      hint:
        input.platform === "instagram"
          ? "IG par 15-30 vachhe rakho, ane niche tags vadhare."
          : "Facebook par 3-5 j — vadhare hoy to spam lage.",
    },
    {
      id: "line-breaks",
      label: "It is broken into paragraphs",
      weight: 8,
      passed: caption.includes("\n") || words.length < 30,
      hint: "Nobody reads one solid block — add line breaks.",
    },
    {
      id: "no-hashtag-in-body",
      label: "No hashtags are mixed into the caption text",
      weight: 6,
      passed: (caption.match(/#/g) ?? []).length <= 1,
      hint: "Keep hashtags at the end, separate from the text — it reads better.",
    },
  ];

  if (input.format === "reel") {
    checks.push({
      id: "reel-hook",
      label: "The hook is written for the first 3 seconds",
      weight: 10,
      passed: /\?|!|\d/.test(firstLine),
      hint: "A question, a number or a surprising claim — reels rank on watch time.",
    });
  }

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const score = Math.round((earned / total) * 100);

  return {
    score,
    grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D",
    checks,
    topFixes: checks
      .filter((c) => !c.passed)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((c) => c.hint),
  };
}

/* ------------------------------------------------------------------ *
 *  Kaya vakhate post karvu
 * ------------------------------------------------------------------ */

export type PostSlot = {
  /** 0 = Ravivar ... 6 = Shanivar */
  weekday: number;
  hour: number;
  minute: number;
  label: string;
  strength: "best" | "good";
};

/**
 * Category pramane sauthi saara slot.
 *
 * Aa aankda jaher engagement study par aadharit "shuruaat" che — aa app
 * tamara potana published posts na aankda thi aane sudharti jashe
 * (jovo: learnFromHistory).
 */
const BASE_SLOTS: Record<string, PostSlot[]> = {
  fashion: [
    { weekday: 2, hour: 11, minute: 0, label: "Mangal savare", strength: "best" },
    { weekday: 4, hour: 19, minute: 30, label: "Guruvar sanje", strength: "best" },
    { weekday: 6, hour: 11, minute: 30, label: "Shanivar savare", strength: "good" },
    { weekday: 0, hour: 20, minute: 0, label: "Ravivar raate", strength: "good" },
  ],
  food: [
    { weekday: 3, hour: 12, minute: 0, label: "Budhvar bapore", strength: "best" },
    { weekday: 5, hour: 19, minute: 0, label: "Shukravar sanje", strength: "best" },
    { weekday: 6, hour: 13, minute: 0, label: "Shanivar bapore", strength: "good" },
  ],
  beauty: [
    { weekday: 1, hour: 20, minute: 0, label: "Somvar raate", strength: "best" },
    { weekday: 4, hour: 21, minute: 0, label: "Guruvar raate", strength: "best" },
    { weekday: 0, hour: 11, minute: 0, label: "Ravivar savare", strength: "good" },
  ],
  default: [
    { weekday: 2, hour: 11, minute: 0, label: "Mangal savare", strength: "best" },
    { weekday: 3, hour: 19, minute: 0, label: "Budhvar sanje", strength: "best" },
    { weekday: 5, hour: 18, minute: 30, label: "Shukravar sanje", strength: "good" },
    { weekday: 0, hour: 20, minute: 0, label: "Ravivar raate", strength: "good" },
  ],
};

function slotsFor(category: string): PostSlot[] {
  const key = category.toLowerCase();
  if (/apparel|fashion|cloth|wear|saree|kurti|shoe|jewel|accessor/.test(key)) {
    return BASE_SLOTS.fashion;
  }
  if (/food|snack|restaurant|bakery|cafe|sweet/.test(key)) return BASE_SLOTS.food;
  if (/beauty|skin|cosmetic|makeup|hair|wellness/.test(key)) return BASE_SLOTS.beauty;
  return BASE_SLOTS.default;
}

/**
 * Have thi pachi na `count` sauthi saara post-time aape.
 * `timezoneOffsetMinutes` — audience na timezone no offset (IST = 330).
 */
export function bestPostTimes(options: {
  category: string;
  count?: number;
  from?: Date;
  timezoneOffsetMinutes?: number;
}): Array<{ at: Date; label: string; strength: "best" | "good" }> {
  const count = options.count ?? 3;
  const from = options.from ?? new Date();
  const offset = options.timezoneOffsetMinutes ?? Number(process.env.AUDIENCE_TZ_OFFSET || 330);
  const slots = slotsFor(options.category);

  const out: Array<{ at: Date; label: string; strength: "best" | "good" }> = [];

  // Aavta 14 divas ma je slot aave e badha gothvo.
  for (let dayAhead = 0; dayAhead < 14 && out.length < count; dayAhead += 1) {
    const day = new Date(from.getTime() + dayAhead * 86_400_000);

    // Audience na timezone ma aa kayo vaar che.
    const local = new Date(day.getTime() + offset * 60_000);
    const weekday = local.getUTCDay();

    for (const slot of slots) {
      if (slot.weekday !== weekday) continue;

      // Audience na local time ne UTC ma pacha convert karo.
      const at = new Date(
        Date.UTC(
          local.getUTCFullYear(),
          local.getUTCMonth(),
          local.getUTCDate(),
          slot.hour,
          slot.minute,
        ) - offset * 60_000,
      );

      if (at.getTime() <= from.getTime() + 5 * 60_000) continue;
      out.push({ at, label: slot.label, strength: slot.strength });
      if (out.length >= count) break;
    }
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Ek j product na ghana posts ne fela do — badha ek j vakhate na jaay.
 * Instagram ek pachi ek turant post thay to reach ghatade che.
 */
export function spreadSchedule(
  count: number,
  options: { category: string; from?: Date; minGapHours?: number },
): Date[] {
  const gap = (options.minGapHours ?? 20) * 3600_000;
  const slots = bestPostTimes({
    category: options.category,
    count: count * 3,
    from: options.from,
  });

  const chosen: Date[] = [];
  for (const slot of slots) {
    if (chosen.length >= count) break;
    const last = chosen[chosen.length - 1];
    if (!last || slot.at.getTime() - last.getTime() >= gap) {
      chosen.push(slot.at);
    }
  }

  // Slot khuti gaya to gap pramane aagal vadhata jao.
  let cursor =
    chosen[chosen.length - 1]?.getTime() ?? (options.from ?? new Date()).getTime();
  while (chosen.length < count) {
    cursor += gap;
    chosen.push(new Date(cursor));
  }

  return chosen;
}
