import Anthropic from "@anthropic-ai/sdk";
import { AiError, type AiProvider, type CompletionRequest } from "./types";

let client: Anthropic | null = null;

function apiKey(): string {
  return process.env.ANTHROPIC_API_KEY || "";
}

function modelName(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5";
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: apiKey() });
  return client;
}

export const anthropicProvider: AiProvider = {
  key: "anthropic",
  label: "Anthropic Claude (paid)",
  free: false,
  get model() {
    return modelName();
  },

  configured() {
    return Boolean(apiKey());
  },

  async complete<T>(request: CompletionRequest): Promise<T> {
    if (!apiKey()) {
      throw new AiError("ANTHROPIC_API_KEY is not set", "anthropic");
    }

    let response;
    try {
      response = await getClient().messages.create({
        model: modelName(),
        max_tokens: request.maxTokens ?? 4000,
        system: request.system,
        output_config: {
          format: { type: "json_schema", schema: request.schema },
        },
        messages: [{ role: "user", content: request.prompt }],
      });
    } catch (error) {
      throw translate(error);
    }

    if (response.stop_reason === "refusal") {
      throw new AiError(
        "Claude e aa content par kaam karvani na paadi. Topic badlo.",
        "anthropic",
      );
    }

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new AiError("Claude e khali response aapyu", "anthropic", true);
    }

    return JSON.parse(block.text) as T;
  },
};

function translate(error: unknown): AiError {
  if (error instanceof Anthropic.APIError) {
    const message = String(
      (error.error as { error?: { message?: string } })?.error?.message ??
        error.message,
    );

    if (/credit balance is too low/i.test(message)) {
      return new AiError(
        "The Anthropic account is out of credit. Free alternatives: Groq (console.groq.com/keys) or Ollama, which runs on this machine.",
        "anthropic",
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return new AiError("ANTHROPIC_API_KEY is invalid or has expired", "anthropic");
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new AiError("Anthropic rate limit reached — try again shortly", "anthropic", true);
    }
    return new AiError(`Anthropic: ${message}`, "anthropic", (error.status ?? 0) >= 500);
  }
  return new AiError((error as Error).message, "anthropic", true);
}
