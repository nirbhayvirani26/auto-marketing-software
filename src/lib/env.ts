/**
 * Centralised env access. Missing values fail loudly at first use instead of
 * silently producing `undefined` deep inside a request handler.
 */
function required(name: string, fallback?: string): string {
  // `||` jaani joine — .env ma `KEY=` (khali) hoy tyare pan fallback lagu
  // padvu joiye. `??` khali string ne "set thayelu" gane che.
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] || fallback;
}

export const env = {
  get appUrl() {
    return optional("APP_URL", "http://localhost:3000");
  },
  get mongodbUri() {
    return required("MONGODB_URI", "mongodb://127.0.0.1:27017/auto_marketing");
  },
  get jwtSecret() {
    return required("JWT_SECRET");
  },
  get jwtExpiresIn() {
    return optional("JWT_EXPIRES_IN", "7d");
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
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
      name: optional("SEED_ADMIN_NAME", "Super Admin"),
    };
  },
};
