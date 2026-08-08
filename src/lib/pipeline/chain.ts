/**
 * Multi-API pipeline runner.
 *
 * Aakha app ma jya pan bahar ni service par aadhaar rakhvo pade — text AI,
 * vision, image, video, TTS, trends, hosting — tya aa j runner vaparie chie.
 * Ek provider ni limit lage, key khute, ke service down thay to biju provider
 * apoaap try thay che. Etle marketing kyarey atkatu nathi.
 *
 * Traney rakshan sathe aave che:
 *   • timeout        — hang thayelo provider aakha job ne roki na shake
 *   • retry+backoff  — kaamchalau error (429 / 5xx / network) par fari try
 *   • circuit breaker— vaar vaar fail thato provider thodo vakhat skip thay
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
  /** Kul kaam no samay (ms). */
  ms: number;
};

export type Candidate<T> = {
  /** Log ma dekhaay evu naam, dakhla tarike "gemini". */
  name: string;
  /** Human-friendly label — UI ma batavva mate. */
  label?: string;
  /** Free service che? Free ne pehli pasandgi apay che. */
  free?: boolean;
  /** Key/config hajar che ke nahi. false hoy to chhodine aagal vadhay che. */
  configured?: () => boolean;
  /** Aa provider nu kaam. */
  run: (signal: AbortSignal) => Promise<T>;
  /** Aa provider mate alag timeout joito hoy to. */
  timeoutMs?: number;
  /** Aa provider mate alag retry count joito hoy to. */
  retries?: number;
};

export type ChainOptions = {
  /** Log ma dekhaay evu kaam nu naam. */
  label: string;
  /** Provider dith default timeout. */
  timeoutMs?: number;
  /** Ek provider par ketli var retry (pehla prayatna sivay). */
  retries?: number;
  /** Retry vachhe no pehlo wait. */
  backoffMs?: number;
  /** true = free provider pehla try thay. */
  preferFree?: boolean;
  /** Aa naam nu provider sauthi pehla try thay (user ni pasandgi). */
  prefer?: string;
  /** Dareak attempt pachi call thay — logging mate. */
  onAttempt?: (attempt: Attempt) => void;
};

/** Retry karva jevi bhool che ke kaayami bhool — e nakki kare che. */
export class RetryableError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

/** Aa bhool retry thi sudhrse nahi (khoti key, khotu input). */
export class FatalError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}

/** Aakhi chain fail thai — dareak provider e su kahyu e andar che. */
export class ChainError extends Error {
  constructor(
    message: string,
    readonly attempts: Attempt[],
  ) {
    super(message);
    this.name = "ChainError";
  }

  /** UI ma batavva layak tunku karan. */
  get summary(): string {
    return this.attempts
      .filter((a) => !a.ok)
      .map((a) => `${a.provider}: ${a.skipped ?? a.error}`)
      .join(" | ");
  }
}

/* ------------------------------------------------------------------ *
 *  Circuit breaker — vaar vaar fail thato provider thodi var skip
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
    // Cooldown puro — fari ek mauko aapo.
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

/** Test / admin mate — badha breakers saaf karo. */
export function resetBreakers(): void {
  breakers.clear();
}

/** Admin panel mate — atyare kaya providers "open" (skip thai rahya) che. */
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
  // HTTP status jevu kaink message ma hoy to.
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
 * Candidates ne kram ma try kare. Pehlo je safal thay e no jawab pacho aape.
 * Badha fail thay to ChainError — jema dareak provider e su kahyu e hoy che.
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
      `${options.label}: ek pan provider configure nathi. Setup page ma javo ane key nakho.`,
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
        // Exponential backoff + jitter — badha client ek saathe pacha na aave.
        const wait = backoff * 2 ** tryIndex + Math.floor(Math.random() * 250);
        await sleep(wait);
      }
    }
  }

  const detail = attempts
    .map((a) => `• ${a.provider}: ${a.skipped ?? a.error ?? "fail"}`)
    .join("\n");

  throw new ChainError(`${options.label} — koi pan provider chalyo nahi.\n${detail}`, attempts);
}

/**
 * runChain no "fail thay to undefined" variant. Optional step mate — jem ke
 * voiceover ke trend lookup — jya kaam atakvu na joiye.
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
 *  HTTP helper — badha providers aa vaparé che
 * ------------------------------------------------------------------ */

export type FetchJsonOptions = RequestInit & {
  signal?: AbortSignal;
  /** JSON ni jagya e binary joitu hoy to. */
  expect?: "json" | "buffer" | "text";
};

/**
 * fetch nu wrapper je HTTP status ne saachi RetryableError / FatalError ma
 * badle che, jethi upar no runner samji shake ke fari try karvu ke nahi.
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
    const message = `HTTP ${response.status} ${body.slice(0, 300)}`;

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
    throw new RetryableError(`Jawab JSON ma nathi: ${text.slice(0, 200)}`);
  }
}
