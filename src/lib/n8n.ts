import { env } from "./env";

export type N8nEvent =
  | "post.created"
  | "post.scheduled"
  | "post.published"
  | "post.failed"
  | "automation.completed";

/**
 * n8n na webhook ne outbound event moklave.
 * Fail thay to throw nathi karto — marketing pipeline n8n na hova thi rokay nahi.
 */
export async function notifyN8n(
  event: N8nEvent,
  payload: Record<string, unknown>,
): Promise<{ delivered: boolean; error?: string }> {
  const url = env.n8nWebhookUrl;
  if (!url) return { delivered: false, error: "N8N_WEBHOOK_URL set nathi" };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-n8n-secret": env.n8nWebhookSecret,
      },
      body: JSON.stringify({ event, sentAt: new Date().toISOString(), payload }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { delivered: false, error: `n8n responded ${response.status}` };
    }
    return { delivered: true };
  } catch (error) {
    return { delivered: false, error: (error as Error).message };
  }
}

/** Inbound n8n request no shared-secret verify kare. */
export function verifyN8nSecret(request: Request): boolean {
  const expected = env.n8nWebhookSecret;
  if (!expected) return false;
  return request.headers.get("x-n8n-secret") === expected;
}
