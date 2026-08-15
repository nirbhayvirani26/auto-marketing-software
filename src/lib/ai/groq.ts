import { createOpenAiCompatProvider } from "./openai-compat";

/**
 * Groq — free tier, ane bahu j fast (sekando ma nahi, millisecond ma).
 * Caption/hashtag jeva nana kaam mate sauthi saaru.
 *
 * Key: console.groq.com/keys (free)
 */
export const groqProvider = createOpenAiCompatProvider({
  key: "groq",
  label: "Groq (free, and the fastest)",
  free: true,
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: () => process.env.GROQ_API_KEY || "",
  model: () => process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  supportsJsonSchema: false,
  missingKeyHint:
    "GROQ_API_KEY is not set. Get a free key at console.groq.com/keys.",
});
