import { AiError, type AiProvider, type CompletionRequest } from "./types";

/**
 * Google Gemini — FREE tier che (aistudio.google.com par key lo).
 * Free limits: ~15 request/minute, 1500/divas. Nana business mate puratu.
 *
 * REST API j vaparie chie — koi extra npm package ni jarur nathi.
 */
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function apiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

/**
 * ⚠️ Google dareak key ne badha model nu free tier NATHI aapto.
 * Ketlik key par `gemini-2.0-flash` "limit: 0" aape che pan
 * `gemini-flash-latest` (alias) barabar chale che.
 *
 * Etle default `-latest` alias rakhyo che — e sauthi vadhu key par chale.
 */
function modelName(): string {
  return process.env.GEMINI_MODEL || "gemini-flash-latest";
}

/**
 * Gemini na responseSchema ma `additionalProperties` ane `$schema` support
 * nathi — e keys kadhi naakhvi pade, nahi to 400 aave che.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "additionalProperties" || key === "$schema") continue;
      out[key] = toGeminiSchema(value);
    }
    return out;
  }
  return schema;
}

export const geminiProvider: AiProvider = {
  key: "gemini",
  label: "Google Gemini (free tier)",
  free: true,
  get model() {
    return modelName();
  },

  configured() {
    return Boolean(apiKey());
  },

  async complete<T>(request: CompletionRequest): Promise<T> {
    const key = apiKey();
    if (!key) {
      throw new AiError(
        "GEMINI_API_KEY set nathi. aistudio.google.com/apikey par thi FREE key lo.",
        "gemini",
      );
    }

    const url = `${BASE}/models/${modelName()}:generateContent?key=${key}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(request.schema),
            // ⚠️ THINKING TOKENS: nava flash models jawab aapta pehla
            // andar-khane vichare che, ane E VICHAR PAN aa limit ma thi
            // gane che. Nanu limit aapo to jawab KHALI aave — koi error
            // vagar. Etle jagya vadhari daiye chie.
            maxOutputTokens: Math.max(request.maxTokens ?? 4000, 512) + 2048,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new AiError(
        `Gemini sudhi pahonchi na shakaya: ${(error as Error).message}`,
        "gemini",
        true,
      );
    }

    const json = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      error?: { message?: string; status?: string };
    };

    if (!response.ok || json.error) {
      const message = json.error?.message ?? `HTTP ${response.status}`;

      if (response.status === 429) {
        // "limit: 0" = aa key ne AA MODEL nu free tier apayu j nathi.
        // E rate limit NATHI — raah jovathi kai nahi thay, bijo model
        // ke bijo provider joiye.
        if (message.includes("limit: 0")) {
          throw new AiError(
            `Gemini: "${modelName()}" aa key mate chalu nathi (free tier quota 0). ` +
              `.env ma GEMINI_MODEL=gemini-flash-latest karo, athva Groq vapro (free).`,
            "gemini",
          );
        }
        throw new AiError(
          "Gemini ni rate limit lagi gai. Thodi var pachi apoaap fari try thashe.",
          "gemini",
          true,
        );
      }
      if (response.status === 400 && /API key not valid/i.test(message)) {
        throw new AiError(
          "GEMINI_API_KEY khoto che. aistudio.google.com/apikey par thi navo lo.",
          "gemini",
        );
      }
      throw new AiError(`Gemini: ${message}`, "gemini", response.status >= 500);
    }

    const candidate = json.candidates?.[0];
    if (candidate?.finishReason === "SAFETY") {
      throw new AiError(
        "Gemini e aa content par kaam karvani na paadi. Topic badlo.",
        "gemini",
      );
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) throw new AiError("Gemini e khali response aapyo", "gemini", true);

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AiError("Gemini no response JSON ma nathi", "gemini", true);
    }
  },
};
