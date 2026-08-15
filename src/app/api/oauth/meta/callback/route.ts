import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  discoverAccounts,
  exchangeCodeForUserToken,
  verifyState,
} from "@/lib/meta-oauth";
import { PendingConnection } from "@/models/PendingConnection";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

function back(params: Record<string, string>) {
  const url = new URL("/admin/accounts", env.appUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

/**
 * Facebook ahiya pacho mokle che. Aa endpoint accounts save nathi karto —
 * fakt "malela accounts" no list banave che, ane user Accounts page par
 * pasand kare ke kaya connect karva.
 */
export const GET = handle(async (request) => {
  const session = await getSession();
  if (!session) {
    return back({ error: "Your session has ended — please sign in again" });
  }

  const url = new URL(request.url);

  // User e "Cancel" dabavyu hoy tyare Facebook error params saathe pacho mokle.
  const fbError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (fbError) {
    return back({ error: `Facebook: ${fbError}` });
  }

  if (!verifyState(url.searchParams.get("state"))) {
    return back({ error: "The security check failed. Please try again." });
  }

  const code = url.searchParams.get("code");
  if (!code) return back({ error: "Facebook e code na aapyo" });

  try {
    await connectDB();

    const userToken = await exchangeCodeForUserToken(code);
    const discovered = await discoverAccounts(userToken);

    if (discovered.length === 0) {
      return back({
        error:
          "Tamara Facebook account saathe koi Page jodayelu nathi. Pehla Facebook Page banavo.",
      });
    }

    // Ek j user mate juno pending record hoy to badli naakho.
    await PendingConnection.findOneAndUpdate(
      { user: session.sub },
      { user: session.sub, accounts: discovered, createdAt: new Date() },
      { upsert: true },
    );

    await logActivity({
      action: "oauth.meta",
      message: `Facebook login safal — ${discovered.length} account madya`,
      actor: session.email,
    });

    return back({ connect: "1", found: String(discovered.length) });
  } catch (error) {
    return back({ error: (error as Error).message });
  }
});
