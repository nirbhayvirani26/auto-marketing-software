import { handle, ok, requireAuth } from "@/lib/api";
import { databaseLocation, isDbReachable } from "@/lib/db";
import { SocialAccount } from "@/models/SocialAccount";
import { providerStatus, ollamaPing } from "@/lib/ai";
import { imageProviderStatus } from "@/lib/image-gen";
import { getSession } from "@/lib/auth";
import { getActiveBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * The setup checklist: what is ready and what is still missing. Secrets are
 * never returned — only whether each one is set.
 */
export const GET = handle(async () => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const session = await getSession();
  const brand = session?.org ? await getActiveBrand(session.org) : null;

  const [dbUp, ollama] = await Promise.all([isDbReachable(), ollamaPing()]);

  const byPlatform = brand
    ? await SocialAccount.groupCount("platform", { brand: brand._id })
    : {};

  const providers = providerStatus();
  const aiReady = providers.some((provider) => provider.configured);
  const metaReady = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);

  return ok({
    // --- the checklist, rendered by the SetupChecklist component ---
    database: { ok: dbUp, label: "Local database" },
    ai: {
      ok: aiReady,
      label: "AI provider (writes your posts)",
      hint: "Free: get a key at aistudio.google.com/apikey and set GEMINI_API_KEY",
    },
    metaApp: {
      ok: metaReady,
      label: "Meta app (Instagram and Facebook publishing)",
      hint: "Create an app at developers.facebook.com, then set META_APP_ID and META_APP_SECRET",
    },
    facebook: {
      ok: (byPlatform.facebook ?? 0) > 0,
      label: "Facebook Page connected",
      hint: "Social Accounts page → Connect with Facebook",
    },
    instagram: {
      ok: (byPlatform.instagram ?? 0) > 0,
      label: "Instagram account connected",
      hint: "The Instagram Business account must be linked to a Facebook Page",
    },
    cron: {
      ok: Boolean(process.env.CRON_SECRET),
      label: "Scheduler secret",
      hint: "Set CRON_SECRET in .env",
    },
    n8n: {
      ok: Boolean(process.env.N8N_WEBHOOK_URL),
      label: "n8n webhook (optional)",
      hint: "Set N8N_WEBHOOK_URL in .env",
      optional: true,
    },

    // --- everything else, for the Setup and Settings pages ---
    detail: {
      aiProviders: providers,
      ollama,
      imageProviders: imageProviderStatus(),
      accounts: {
        facebook: byPlatform.facebook ?? 0,
        instagram: byPlatform.instagram ?? 0,
      },
      appUrl: process.env.APP_URL || "http://localhost:3000",
      webhookVerifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      storage: {
        engine: "Local JSON database",
        location: databaseLocation(),
      },
    },
  });
});
