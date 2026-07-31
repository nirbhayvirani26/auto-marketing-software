import { NextResponse } from "next/server";
import { fail, handle } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { authorizeUrl, createState, metaConfigured } from "@/lib/meta-oauth";

export const dynamic = "force-dynamic";

/**
 * "Connect with Facebook" button aa endpoint par mokle che.
 * Ahiya thi user Facebook na permission dialog par jaay che.
 */
export const GET = handle(async () => {
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  if (!metaConfigured()) {
    return fail(
      "META_APP_ID ane META_APP_SECRET .env ma set nathi. developers.facebook.com par app banavo.",
      503,
    );
  }

  return NextResponse.redirect(authorizeUrl(createState()));
});
