import { createOpenAiCompatProvider } from "./openai-compat";

/**
 * OpenRouter — ek j key thi 300+ model.
 * `:free` valaa models ni koi kimat nathi (fakt daily limit).
 *
 * Key: openrouter.ai/keys (credit card ni jarur nathi)
 */
export const openrouterProvider = createOpenAiCompatProvider({
  key: "openrouter",
  label: "OpenRouter (free models)",
  free: true,
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: () => process.env.OPENROUTER_API_KEY || "",
  model: () =>
    process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
  extraHeaders: () => ({
    "http-referer": process.env.APP_URL || "http://localhost:3000",
    "x-title": "Auto Marketing Software",
  }),
  // Free models badha json_schema support nathi karta — fallback andar j che.
  supportsJsonSchema: false,
  missingKeyHint:
    "OPENROUTER_API_KEY set nathi. openrouter.ai/keys par thi FREE key lo.",
});
