import { z } from "zod";
import { handle, ok, requireBrand, fail } from "@/lib/api";
import { PendingConnection } from "@/models/PendingConnection";
import { SocialAccount } from "@/models/SocialAccount";
import { subscribePageWebhooks } from "@/lib/social";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

/** OAuth pachi malela accounts — token vagar (UI ne token ni jarur nathi). */
export const GET = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const pending = await PendingConnection.findOne({ user: ctx.session.sub });
  if (!pending) return ok({ accounts: [] });

  // "alreadyConnected" aa brand ni andar j joyu jay che.
  const existing = await SocialAccount.find({ brand: ctx.brandId })
    .select("pageId igUserId")
    .lean();
  const connectedKeys = new Set(
    existing.map((account) => account.igUserId || account.pageId),
  );

  return ok({
    accounts: pending.accounts.map((account, index) => ({
      index,
      platform: account.platform,
      displayName: account.displayName,
      pageId: account.pageId,
      igUserId: account.igUserId,
      avatarUrl: account.avatarUrl,
      alreadyConnected: connectedKeys.has(account.igUserId || account.pageId),
    })),
  });
});

const confirmSchema = z.object({
  indexes: z.array(z.number().int().min(0)).min(1),
});

/**
 * User e pasand karela accounts ne kharekhar save kare che.
 * Pehla thi hoy to token update thay che (re-connect kare tyare kaam lage).
 */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const { indexes } = confirmSchema.parse(await request.json());

  const pending = await PendingConnection.findOne({ user: ctx.session.sub });
  if (!pending) {
    return fail("Connection session puri thai gai — fari connect karo", 410);
  }

  const saved: string[] = [];
  const webhookWarnings: string[] = [];

  for (const index of indexes) {
    const account = pending.accounts[index];
    if (!account?.accessToken) continue;

    // Account atyare na active brand ma jaay che.
    const filter =
      account.platform === "instagram"
        ? { brand: ctx.brandId, igUserId: account.igUserId ?? "" }
        : { brand: ctx.brandId, pageId: account.pageId ?? "" };

    await SocialAccount.findOneAndUpdate(
      filter,
      {
        ...filter,
        platform: account.platform,
        displayName: account.displayName,
        accessToken: account.accessToken,
        avatarUrl: account.avatarUrl,
        status: "connected",
        lastError: undefined,
        createdBy: ctx.session.sub,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Auto-DM chale e mate Meta ne kaho ke aa Page na comments moklo.
    if (account.platform === "facebook" && account.pageId) {
      try {
        await subscribePageWebhooks({
          pageId: account.pageId,
          accessToken: account.accessToken,
        });
      } catch (error) {
        webhookWarnings.push(
          `${account.displayName}: ${(error as Error).message}`,
        );
      }
    }

    saved.push(account.displayName ?? "");
  }

  await PendingConnection.deleteOne({ _id: pending._id });

  await logActivity({
    level: "success",
    action: "account.connected",
    message: `${saved.length} account connect thaya: ${saved.join(", ")}`,
    actor: ctx.session.email,
    meta: { webhookWarnings },
  });

  return ok({
    connected: saved.length,
    accounts: saved,
    webhookWarnings,
  });
});
