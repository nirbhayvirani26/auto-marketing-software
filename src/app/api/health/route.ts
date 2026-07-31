import { handle, ok, requireAuth } from "@/lib/api";
import { isDbReachable } from "@/lib/db";
import { SocialAccount } from "@/models/SocialAccount";

export const dynamic = "force-dynamic";

/**
 * Setup checklist — admin panel ne batave che ke su configure thai gayu che
 * ane su baaki che. Secrets kadi return nathi thata, fakt "set che ke nahi".
 */
export const GET = handle(async () => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const [dbUp, accountsWithToken] = await Promise.all([
    isDbReachable(),
    SocialAccount.countDocuments({ accessToken: { $exists: true, $ne: "" } }),
  ]);

  return ok({
    database: { ok: dbUp, label: "MongoDB connection" },
    ai: {
      ok: Boolean(process.env.ANTHROPIC_API_KEY),
      label: "Anthropic API key (AI content generation)",
      hint: ".env ma ANTHROPIC_API_KEY nakho",
    },
    publishing: {
      ok: accountsWithToken > 0,
      label: "Social account access token",
      hint: "Accounts page ma Page access token saathe account add karo",
    },
    cron: {
      ok: Boolean(process.env.CRON_SECRET),
      label: "Scheduler secret",
      hint: ".env ma CRON_SECRET nakho",
    },
    n8n: {
      ok: Boolean(process.env.N8N_WEBHOOK_URL),
      label: "n8n webhook URL (optional)",
      hint: ".env ma N8N_WEBHOOK_URL nakho",
      optional: true,
    },
  });
});
