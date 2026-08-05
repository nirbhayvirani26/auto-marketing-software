import { handle, ok, requireAuth } from "@/lib/api";
import { isDbReachable } from "@/lib/db";
import { SocialAccount } from "@/models/SocialAccount";
import { providerStatus, ollamaPing } from "@/lib/ai";
import { imageProviderStatus } from "@/lib/image-gen";
import { getSession } from "@/lib/auth";
import { getActiveBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Setup checklist — su chalu che ane su baaki. Secrets kadi return nathi
 * thata, fakt "set che ke nahi".
 */
export const GET = handle(async () => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const session = await getSession();
  const brand = session?.org ? await getActiveBrand(session.org) : null;

  const [dbUp, ollama] = await Promise.all([isDbReachable(), ollamaPing()]);

  const accountCounts = brand
    ? await SocialAccount.aggregate<{ _id: string; count: number }>([
        { $match: { brand: brand._id } },
        { $group: { _id: "$platform", count: { $sum: 1 } } },
      ])
    : [];

  const byPlatform = Object.fromEntries(
    accountCounts.map((row) => [row._id, row.count]),
  ) as Record<string, number>;

  const providers = providerStatus();
  const aiReady = providers.some((p) => p.configured);
  const metaReady = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);

  return ok({
    // --- checklist (SetupChecklist component aa vaapre che) ---
    database: { ok: dbUp, label: "MongoDB connection" },
    ai: {
      ok: aiReady,
      label: "AI provider (post lakhva mate)",
      hint: "FREE: aistudio.google.com/apikey → .env ma GEMINI_API_KEY",
    },
    metaApp: {
      ok: metaReady,
      label: "Meta app (Instagram + Facebook publishing)",
      hint: "developers.facebook.com → app banavo → META_APP_ID + META_APP_SECRET",
    },
    facebook: {
      ok: (byPlatform.facebook ?? 0) > 0,
      label: "Facebook Page connected",
      hint: "Accounts page → Connect with Facebook",
    },
    instagram: {
      ok: (byPlatform.instagram ?? 0) > 0,
      label: "Instagram account connected",
      hint: "IG Business account Facebook Page saathe jodelu hovu joiye",
    },
    cron: {
      ok: Boolean(process.env.CRON_SECRET),
      label: "Scheduler secret",
      hint: ".env ma CRON_SECRET",
    },
    n8n: {
      ok: Boolean(process.env.N8N_WEBHOOK_URL),
      label: "n8n webhook (optional)",
      hint: ".env ma N8N_WEBHOOK_URL",
      optional: true,
    },

    // --- vigat (Setup page mate) ---
    detail: {
      aiProviders: providers,
      ollama,
      imageProviders: imageProviderStatus(),
      accounts: {
        facebook: byPlatform.facebook ?? 0,
        instagram: byPlatform.instagram ?? 0,
      },
      appUrl: process.env.APP_URL ?? "http://localhost:3000",
      webhookVerifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
    },
  });
});
