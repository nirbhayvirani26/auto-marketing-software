/**
 * Centralised environment access.
 *
 * This module is imported by the middleware as well as by route handlers, so
 * it must stay runtime-agnostic: no `node:` imports, no filesystem, nothing
 * that the Edge runtime cannot execute.
 *
 * Secrets are generated into `.env` before the server starts — see
 * `scripts/ensure-secrets.mjs`, wired to the `predev` / `prebuild` / `prestart`
 * hooks. That way a fresh clone works with no setup, and both runtimes read
 * the same value.
 */

function optional(name: string, fallback = ""): string {
  // `||` on purpose: `KEY=` with an empty value in .env should still fall back.
  // `??` would treat the empty string as "set".
  return process.env[name] || fallback;
}

/**
 * The sign-in secret.
 *
 * If this is ever empty the app must not quietly fall back to a shared default
 * — that would let anyone forge a session. `npm run dev` generates one, so an
 * empty value here means something skipped that step.
 */
function sessionSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;

  throw new Error(
    "JWT_SECRET is not set. Run `npm run secrets` (or just `npm run dev`, " +
      "which does it for you) to generate one into .env.",
  );
}

export const env = {
  get appUrl() {
    return optional("APP_URL", "http://localhost:3000");
  },
  /** Where the JSON collections live, relative to the project root. */
  get dataDir() {
    return optional("LOCAL_DB_DIR", "data");
  },
  get jwtSecret() {
    return sessionSecret();
  },
  get jwtExpiresIn() {
    return optional("JWT_EXPIRES_IN", "7d");
  },
  get anthropicApiKey() {
    return optional("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return optional("ANTHROPIC_MODEL", "claude-opus-5");
  },
  get n8nWebhookUrl() {
    return optional("N8N_WEBHOOK_URL");
  },
  get n8nWebhookSecret() {
    return optional("N8N_WEBHOOK_SECRET");
  },
  get cronSecret() {
    return optional("CRON_SECRET");
  },
  get metaGraphVersion() {
    return optional("META_GRAPH_VERSION", "v21.0");
  },
  get metaDefaultAccessToken() {
    return optional("META_DEFAULT_ACCESS_TOKEN");
  },
  get seedAdmin() {
    return {
      email: optional("SEED_ADMIN_EMAIL", "admin@example.com"),
      password: optional("SEED_ADMIN_PASSWORD", "Admin@12345"),
      name: optional("SEED_ADMIN_NAME", "Workspace Owner"),
    };
  },
};
