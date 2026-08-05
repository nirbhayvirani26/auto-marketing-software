import { AiError, type AiProvider, type CompletionRequest } from "./types";

/**
 * Ollama — 100% FREE, tamara potana computer par chale che.
 * Koi API key nahi, koi limit nahi, internet pan nahi joiye.
 *
 * Setup:
 *   1. ollama.com par thi install karo
 *   2. terminal ma:  ollama pull llama3.2
 *   3. .env ma:      OLLAMA_MODEL=llama3.2
 */
function host(): string {
  return (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
}

function modelName(): string {
  return process.env.OLLAMA_MODEL ?? "llama3.2";
}

export const ollamaProvider: AiProvider = {
  key: "ollama",
  label: "Ollama (local — sav free)",
  free: true,
  get model() {
    return modelName();
  },

  configured() {
    // Fakt HOST set hovathi Ollama vaparva jevu nathi — model nakki hovo
    // joiye, nahi to dareak call "model is required" thi fail thay.
    return Boolean(process.env.OLLAMA_MODEL?.trim());
  },

  async complete<T>(request: CompletionRequest): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${host()}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: modelName(),
          stream: false,
          // Ollama JSON schema ne format tarike support kare che.
          format: request.schema,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          options: { num_predict: request.maxTokens ?? 4000 },
        }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (error) {
      throw new AiError(
        `Ollama sudhi pahonchi na shakaya (${host()}). Chalu che? \`ollama serve\` chalavo. [${(error as Error).message}]`,
        "ollama",
        true,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new AiError(
          `Model "${modelName()}" download thayelo nathi. Chalavo: ollama pull ${modelName()}`,
          "ollama",
        );
      }
      throw new AiError(
        `Ollama: HTTP ${response.status} ${text.slice(0, 160)}`,
        "ollama",
        response.status >= 500,
      );
    }

    const json = (await response.json()) as {
      message?: { content?: string };
      error?: string;
    };

    if (json.error) throw new AiError(`Ollama: ${json.error}`, "ollama");

    const content = json.message?.content;
    if (!content) throw new AiError("Ollama e khali response aapyo", "ollama", true);

    try {
      return JSON.parse(content) as T;
    } catch {
      throw new AiError(
        "Ollama no response JSON ma nathi — motto model vapro (llama3.1:8b ke uper)",
        "ollama",
        true,
      );
    }
  },
};

/** Ollama kharekhar chalu che ke nahi ane kaya models che. */
export async function ollamaPing(): Promise<{
  up: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const response = await fetch(`${host()}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { up: false, models: [], error: `HTTP ${response.status}` };
    const json = (await response.json()) as { models?: Array<{ name: string }> };
    return { up: true, models: (json.models ?? []).map((m) => m.name) };
  } catch (error) {
    return { up: false, models: [], error: (error as Error).message };
  }
}
