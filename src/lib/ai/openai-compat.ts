import { AiError, type CompletionRequest, type ProviderKey } from "./types";

/**
 * Ghana providers (OpenRouter, Groq, Together, DeepSeek, Mistral, local
 * llama.cpp...) OpenAI nu j `/chat/completions` format vapre che. Etle ek j
 * factory thi badha bani jay che — navu provider umervu hoy to fakt base URL
 * ane model naam aapo.
 */

export type OpenAiCompatConfig = {
  key: ProviderKey;
  label: string;
  free: boolean;
  baseUrl: string;
  apiKey: () => string;
  model: () => string;
  /** OpenRouter ne aa headers game che. */
  extraHeaders?: () => Record<string, string>;
  /** Aa provider `json_schema` response_format samje che? */
  supportsJsonSchema?: boolean;
  /** Key nathi tyare su kehvu. */
  missingKeyHint: string;
};

export function createOpenAiCompatProvider(config: OpenAiCompatConfig) {
  async function request<T>(
    req: CompletionRequest,
    useSchema: boolean,
  ): Promise<T> {
    const key = config.apiKey();
    if (!key) throw new AiError(config.missingKeyHint, config.key);

    const responseFormat = useSchema
      ? {
          type: "json_schema" as const,
          json_schema: {
            name: "response",
            strict: true,
            schema: req.schema,
          },
        }
      : { type: "json_object" as const };

    // json_object mode ma model ne schema prompt ma j batavvo pade che.
    const systemText = useSchema
      ? req.system
      : `${req.system}\n\nReply with ONLY a JSON object matching this JSON Schema (no markdown fence, no commentary):\n${JSON.stringify(req.schema)}`;

    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          ...(config.extraHeaders?.() ?? {}),
        },
        body: JSON.stringify({
          model: config.model(),
          messages: [
            { role: "system", content: systemText },
            { role: "user", content: req.prompt },
          ],
          response_format: responseFormat,
          max_tokens: req.maxTokens ?? 4000,
          temperature: 0.8,
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new AiError(
        `${config.label} sudhi pahonchi na shakaya: ${(error as Error).message}`,
        config.key,
        true,
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string; code?: string };
    };

    if (!response.ok || json.error) {
      const message = json.error?.message ?? `HTTP ${response.status}`;

      if (response.status === 429) {
        throw new AiError(
          `${config.label} ni rate limit lagi. Thodi var pachi apoaap fari try thashe.`,
          config.key,
          true,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new AiError(`${config.label}: key khoti che`, config.key);
      }
      // json_schema support na hoy to json_object thi fari try karo.
      if (useSchema && /schema|response_format|not support/i.test(message)) {
        return request<T>(req, false);
      }
      throw new AiError(
        `${config.label}: ${message}`,
        config.key,
        response.status >= 500,
      );
    }

    const text = json.choices?.[0]?.message?.content;
    if (!text) {
      throw new AiError(`${config.label} e khali jawab aapyo`, config.key, true);
    }

    return parseJsonLoose<T>(text, config.key, config.label);
  }

  return {
    key: config.key,
    label: config.label,
    free: config.free,
    get model() {
      return config.model();
    },
    configured() {
      return Boolean(config.apiKey());
    },
    complete<T>(req: CompletionRequest): Promise<T> {
      return request<T>(req, config.supportsJsonSchema !== false);
    },
  };
}

/**
 * Nana models kyarek ```json fence ke aagal-pachhal lakhan umeri de che.
 * Sadho JSON.parse fail thay to pehla `{` thi chhella `}` sudhi kaadhi laiye.
 */
export function parseJsonLoose<T>(
  text: string,
  provider: ProviderKey,
  label: string,
): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* niche error aapiye */
      }
    }
    throw new AiError(`${label} no jawab JSON ma nathi`, provider, true);
  }
}
