import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { ollamaProvider } from "./ollama";
import { AiError, type AiProvider, type CompletionRequest, type ProviderKey } from "./types";

export { AiError };
export type { AiProvider, ProviderKey };
export { ollamaPing } from "./ollama";

const PROVIDERS: Record<ProviderKey, AiProvider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
};

export function allProviders(): AiProvider[] {
  return Object.values(PROVIDERS);
}

/**
 * Kayo provider vaparvo:
 *   1. .env no AI_PROVIDER (explicit choice)
 *   2. nahi to je configure thayelo hoy — FREE ne pehli pasandgi
 *
 * Fallback chain: pasand karelo fail thay to bija try thay che, jethi
 * ek key khutay to pan marketing atkatu nathi.
 */
export function resolveProviderChain(preferred?: string): AiProvider[] {
  const wanted = (preferred ?? process.env.AI_PROVIDER ?? "").toLowerCase();

  const configured = allProviders().filter((p) => p.configured());
  // Free pehla — paid chhelle.
  const byPreference = [...configured].sort(
    (a, b) => Number(b.free) - Number(a.free),
  );

  if (wanted && wanted !== "auto") {
    const chosen = PROVIDERS[wanted as ProviderKey];
    if (chosen) {
      return [chosen, ...byPreference.filter((p) => p.key !== chosen.key)];
    }
  }

  return byPreference;
}

export type CompletionResult<T> = {
  data: T;
  provider: ProviderKey;
  model: string;
};

/**
 * Chain ma jе pehlo chale ene vapre. Badha fail thay to badha errors
 * saathe ek j samajay evo message aape.
 */
export async function complete<T>(
  request: CompletionRequest,
  preferred?: string,
): Promise<CompletionResult<T>> {
  const chain = resolveProviderChain(preferred);

  if (chain.length === 0) {
    throw new AiError(
      "Ek pan AI provider configure nathi. Sauthi saralo FREE vikalp: aistudio.google.com/apikey par thi key lo ane .env ma GEMINI_API_KEY nakho.",
      "gemini",
    );
  }

  const failures: string[] = [];

  for (const provider of chain) {
    try {
      const data = await provider.complete<T>(request);
      return { data, provider: provider.key, model: provider.model };
    } catch (error) {
      const message =
        error instanceof AiError ? error.message : (error as Error).message;
      failures.push(`${provider.label}: ${message}`);
      // Chain ma aagal vadho — biju provider try karo.
    }
  }

  throw new AiError(
    `Koi pan AI provider kaam na karyo.\n${failures.map((f) => `• ${f}`).join("\n")}`,
    chain[0].key,
  );
}

/** Setup page mate — kayo provider taiyar che. */
export function providerStatus() {
  const chain = resolveProviderChain();
  return allProviders().map((provider) => ({
    key: provider.key,
    label: provider.label,
    free: provider.free,
    model: provider.model,
    configured: provider.configured(),
    active: chain[0]?.key === provider.key,
  }));
}
