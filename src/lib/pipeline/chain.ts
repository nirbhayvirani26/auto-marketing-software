/**
 * Multi-provider pipeline runner.
 *
 * Everywhere this app depends on an outside service — text AI, vision, image,
 * video, text-to-speech, trends, hosting — it goes through this runner. If one
 * provider hits its rate limit, runs out of key, or goes down, the next one
 * takes over automatically. The marketing never stops because of one outage.
 *
 * Three protections come built in:
 *   • timeout        — a hung provider cannot stall the whole job
 *   • retry+backoff  — transient errors (429 / 5xx / network) are retried
 *   • circuit breaker— a repeatedly failing provider is skipped for a while
 */

export type Attempt = {
  provider: string;
  ok: boolean;
  ms: number;
  error?: string;
  skipped?: "circuit-open" | "not-configured";
};

export type ChainResult<T> = {
  data: T;
  provider: string;
  attempts: Attempt[];
  /** Total time for the whole chain, in milliseconds. */
  ms: number;
};

export type Candidate<T> = {
  /** The name used in logs, for example "gemini". */
  name: string;
  /** A human-readable label, shown in the UI. */
  label?: string;
  /** Is it free? Free providers are tried first by default. */
  free?: boolean;
  /** Whether the key or config exists. When false the provider is skipped. */
  configured?: () => boolean;
  /** The actual call. */
  run: (signal: AbortSignal) => Promise<T>;
  /** A timeout just for this provider. */
  timeoutMs?: number;
  /** A retry count just for this provider. */
  retries?: number;
};

export type ChainOptions = {
  /** The name of the task, used in logs and error messages. */
  label: string;
  /** Default timeout per provider. */
  timeoutMs?: number;
  /** Retries per provider, on top of the first attempt. */
  retries?: number;
  /** The first wait between retries. */
  backoffMs?: number;
  /** true means free providers are tried first. */
  preferFree?: boolean;
  /** Force this provider to the front of the queue. */
  prefer?: string;
  /** Called after every attempt, for logging. */
  onAttempt?: (attempt: Attempt) => void;
};

/** A failure worth retrying — a rate limit, a 5xx, a dropped connection. */
export class RetryableError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

/** A failure retrying will not fix: a bad key, invalid input, a blocked prompt. */
export class FatalError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}

/** Every provider failed. The individual reasons are attached. */
export class ChainError extends Error {
  constructor(
    message: string,
    readonly attempts: Attempt[],
  ) {
    super(message);
    this.name = "ChainError";
  }

  /** A short reason suitable for showing in the UI. */
  get summary(): string {
    const seen = new Map<string, string>();
    for (const attempt of this.attempts) {
      if (attempt.ok) continue;
      if (seen.has(attempt.provider)) continue;
      seen.set(attempt.provider, attempt.skipped ?? attempt.error ?? "failed");
    }
    return [...seen.entries()]
      .map(([provider, reason]) => `${provider}: ${reason}`)
      .join(" | ");
  }
}

/* ------------------------------------------------------------------ *
 *  Circuit breaker — a provider that keeps failing is skipped for a while
 * ------------------------------------------------------------------ */

type BreakerState = { failures: number; openUntil: number };
const breakers = new Map<string, BreakerState>();

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

function breakerOpen(name: string): boolean {
  const state = breakers.get(name);
  if (!state) return false;
  if (state.openUntil > Date.now()) return true;
  if (state.openUntil !== 0) {
    // The cooldown is over — give it another chance.
    breakers.set(name, { failures: 0, openUntil: 0 });
  }
  return false;
}

function breakerRecord(name: string, ok: boolean): void {
  if (ok) {
    breakers.delete(name);
    return;
  }
  const state = breakers.get(name) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= BREAKER_THRESHOLD) {
    state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  }
  breakers.set(name, state);
}

/** Clears every breaker. Used by tests and by the admin panel. */
export function resetBreakers(): void {
  breakers.clear();
}

/** Which providers are currently being skipped, for the admin panel. */
export function breakerStatus(): Array<{
  provider: string;
  failures: number;
  openForMs: number;
}> {
  const now = Date.now();
  return [...breakers.entries()].map(([provider, state]) => ({
    provider,
    failures: state.failures,
    openForMs: Math.max(0, state.openUntil - now),
  }));
}

/* ------------------------------------------------------------------ *
 *  Runner
 * ------------------------------------------------------------------ */

function isRetryable(error: unknown): boolean {
  if (error instanceof FatalError) return false;
  if (error instanceof RetryableError) return true;

  const message = String((error as Error)?.message ?? error).toLowerCase();
  if (message.includes("abort") || message.includes("timeout")) return true;
  if (message.includes("econnreset") || message.includes("enotfound")) return true;
  if (message.includes("fetch failed") || message.includes("socket")) return true;
  // A status code that leaked into the message.
  if (/\b(429|500|502|503|504)\b/.test(message)) return true;
  if (message.includes("rate limit") || message.includes("quota")) return true;
  if (message.includes("overloaded") || message.includes("unavailable")) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tries each candidate in order and returns the first success. If they all
 * fail it throws a ChainError carrying what every provider said.
 */
export async function runChain<T>(
  candidates: Array<Candidate<T>>,
  options: ChainOptions,
): Promise<ChainResult<T>> {
  const started = Date.now();
  const attempts: Attempt[] = [];

  const ordered = orderCandidates(candidates, options);

  if (ordered.length === 0) {
    throw new ChainError(
      `${options.label}: no provider is configured. Open the Setup page and add a key.`,
      attempts,
    );
  }

  const defaultTimeout = options.timeoutMs ?? 60_000;
  const defaultRetries = options.retries ?? 1;
  const backoff = options.backoffMs ?? 700;

  for (const candidate of ordered) {
    if (candidate.configured && !candidate.configured()) {
      const attempt: Attempt = {
        provider: candidate.name,
        ok: false,
        ms: 0,
        skipped: "not-configured",
      };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
      continue;
    }

    if (breakerOpen(candidate.name)) {
      const attempt: Attempt = {
        provider: candidate.name,
        ok: false,
        ms: 0,
        skipped: "circuit-open",
      };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
      continue;
    }

    const retries = candidate.retries ?? defaultRetries;
    const timeoutMs = candidate.timeoutMs ?? defaultTimeout;

    for (let tryIndex = 0; tryIndex <= retries; tryIndex += 1) {
      const attemptStart = Date.now();
      try {
        const data = await withTimeout(candidate.run, timeoutMs);
        const attempt: Attempt = {
          provider: candidate.name,
          ok: true,
          ms: Date.now() - attemptStart,
        };
        attempts.push(attempt);
        options.onAttempt?.(attempt);
        breakerRecord(candidate.name, true);

        return {
          data,
          provider: candidate.name,
          attempts,
          ms: Date.now() - started,
        };
      } catch (error) {
        const message = normaliseError(error);
        const attempt: Attempt = {
          provider: candidate.name,
          ok: false,
          ms: Date.now() - attemptStart,
          error: message,
        };
        attempts.push(attempt);
        options.onAttempt?.(attempt);

        const canRetry = tryIndex < retries && isRetryable(error);
        if (!canRetry) {
          breakerRecord(candidate.name, false);
          break;
        }
        // Exponential backoff with jitter, so retries do not arrive in lockstep.
        const wait = backoff * 2 ** tryIndex + Math.floor(Math.random() * 250);
        await sleep(wait);
      }
    }
  }

  throw new ChainError(
    `${options.label} — every provider failed.\n${summariseAttempts(attempts)}`,
    attempts,
  );
}

/**
 * One line per provider, with retries of the same failure collapsed.
 *
 * A provider that is retried twice produces the identical message twice, and
 * repeating it only makes the real problem harder to spot.
 */
function summariseAttempts(attempts: Attempt[]): string {
  const seen = new Map<string, string>();

  for (const attempt of attempts) {
    if (attempt.ok) continue;
    const reason = attempt.skipped ?? attempt.error ?? "failed";
    // Keep the first reason per provider; later ones are retries of it.
    if (!seen.has(attempt.provider)) seen.set(attempt.provider, reason);
  }

  return [...seen.entries()]
    .map(([provider, reason]) => `• ${provider}: ${reason}`)
    .join("\n");
}

/**
 * The forgiving variant of runChain: returns null instead of throwing. For
 * optional steps such as voiceover or a trend lookup, where failure should not
 * stop the job.
 */
export async function runChainSoft<T>(
  candidates: Array<Candidate<T>>,
  options: ChainOptions,
): Promise<ChainResult<T> | null> {
  try {
    return await runChain(candidates, options);
  } catch {
    return null;
  }
}

function orderCandidates<T>(
  candidates: Array<Candidate<T>>,
  options: ChainOptions,
): Array<Candidate<T>> {
  const list = [...candidates];

  if (options.preferFree !== false) {
    list.sort((a, b) => Number(b.free ?? false) - Number(a.free ?? false));
  }

  if (options.prefer) {
    const wanted = options.prefer.toLowerCase();
    const index = list.findIndex((c) => c.name.toLowerCase() === wanted);
    if (index > 0) list.unshift(...list.splice(index, 1));
  }

  return list;
}

function normaliseError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return "timeout";
    }
    return error.message.slice(0, 400);
  }
  return String(error).slice(0, 400);
}

/* ------------------------------------------------------------------ *
 *  HTTP helper — every provider goes through this
 * ------------------------------------------------------------------ */

export type FetchJsonOptions = RequestInit & {
  signal?: AbortSignal;
  /** Ask for binary or plain text instead of JSON. */
  expect?: "json" | "buffer" | "text";
};

/**
 * Turns a provider's error body into one readable sentence.
 *
 * Google, OpenAI, Anthropic, Groq and OpenRouter all wrap their message the
 * same way — `{"error":{"message":"…"}}`. Dumping the raw JSON into the UI, as
 * this used to, buries the one useful sentence inside three hundred characters
 * of braces and status codes. Pull the sentence out and, where the cause is
 * unmistakable, say what to do about it.
 */
export function describeApiError(status: number, body: string): string {
  let detail = "";

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string } | string;
      message?: string;
      detail?: string;
    };
    const inner = parsed.error;
    detail =
      (typeof inner === "string" ? inner : inner?.message) ||
      parsed.message ||
      parsed.detail ||
      "";
  } catch {
    // Not JSON — an HTML error page, or plain text.
    detail = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  detail = detail.trim().slice(0, 220);

  // The handful of failures worth naming explicitly, because the fix differs.
  const lower = detail.toLowerCase();
  if (lower.includes("credits are depleted") || lower.includes("credit balance is too low")) {
    return "the account is out of credit — top it up, or switch to another provider";
  }
  if (status === 429) {
    return detail
      ? `rate limited — ${detail}`
      : "rate limited — it will be retried automatically";
  }
  if (status === 401 || status === 403) {
    return detail ? `the key was rejected — ${detail}` : "the key was rejected";
  }
  if (status === 404 && lower.includes("model")) {
    return `that model is no longer available — ${detail}`;
  }

  return detail || "no detail returned";
}

/**
 * A fetch wrapper that turns HTTP status codes into RetryableError or
 * FatalError, so the runner above knows whether trying again is worth it.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const { expect = "json", ...init } = options;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new RetryableError(`network: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = `HTTP ${response.status} — ${describeApiError(response.status, body)}`;

    if (response.status === 429 || response.status >= 500) {
      throw new RetryableError(message);
    }
    throw new FatalError(message);
  }

  if (expect === "buffer") {
    return Buffer.from(await response.arrayBuffer()) as T;
  }
  if (expect === "text") {
    return (await response.text()) as T;
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RetryableError(`Response was not JSON: ${text.slice(0, 200)}`);
  }
}
