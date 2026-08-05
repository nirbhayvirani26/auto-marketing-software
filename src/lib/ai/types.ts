/** Badha AI providers ne ek j interface — code ne khabar nathi kayo provider che. */

export type ProviderKey = "anthropic" | "gemini" | "ollama";

export type JsonSchema = Record<string, unknown>;

export type CompletionRequest = {
  system: string;
  prompt: string;
  /** JSON schema — response aa shape ma j aavvo joiye. */
  schema: JsonSchema;
  maxTokens?: number;
};

export interface AiProvider {
  key: ProviderKey;
  label: string;
  /** Free tier che ke nahi — UI ma batavva mate. */
  free: boolean;
  model: string;
  /** Configure thayelu che ke nahi (key/host set che?) */
  configured(): boolean;
  /** JSON schema pramane structured output pacho aape. */
  complete<T>(request: CompletionRequest): Promise<T>;
}

/** Provider na error ne samajay evi bhasha ma badle. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderKey,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiError";
  }
}
