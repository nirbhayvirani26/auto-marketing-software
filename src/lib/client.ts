"use client";

/** Browser-side fetch wrapper — API no `{ ok, data, error }` envelope unwrap kare. */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(path, {
    ...rest,
    headers: {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json ? JSON.stringify(json) : rest.body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `Request fail thayu (${response.status})`);
  }
  return payload.data as T;
}
