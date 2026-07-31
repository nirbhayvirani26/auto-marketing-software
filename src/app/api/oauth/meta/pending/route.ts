import { z } from "zod";
import { handle, ok, requireAuth, fail } from "@/lib/api";
import { PendingConnection } from "@/models/PendingConnection";
import { SocialAccount } from "@/models/SocialAccount";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

/** OAuth pachi malela accounts — token vagar (UI ne token ni jarur nathi). */
export const GET = handle(async () => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const pending = await PendingConnection.findOne({ user: auth.session.sub });
  if (!pending) return ok({ accounts: [] });

  const existing = await SocialAccount.find().select("pageId igUserId").lean();
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
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { indexes } = confirmSchema.parse(await request.json());

  const pending = await PendingConnection.findOne({ user: auth.session.sub });
  if (!pending) {
    return fail("Connection session puri thai gai — fari connect karo", 410);
  }

  const saved: string[] = [];

  for (const index of indexes) {
    const account = pending.accounts[index];
    if (!account) continue;

    const key = account.igUserId
      ? { platform: "instagram", igUserId: account.igUserId }
      : { platform: "facebook", pageId: account.pageId };

    await SocialAccount.findOneAndUpdate(
      key,
      {
        ...key,
        displayName: account.displayName,
        accessToken: account.accessToken,
        avatarUrl: account.avatarUrl,
        status: "connected",
        lastError: undefined,
        createdBy: auth.session.sub,
      },
      { upsert: true, new: true },
    );

    saved.push(account.displayName ?? "");
  }

  await PendingConnection.deleteOne({ _id: pending._id });

  await logActivity({
    level: "success",
    action: "account.connected",
    message: `${saved.length} account connect thaya: ${saved.join(", ")}`,
    actor: auth.session.email,
  });

  return ok({ connected: saved.length, accounts: saved });
});
