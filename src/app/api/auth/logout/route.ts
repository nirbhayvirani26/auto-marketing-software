import { clearSessionCookie } from "@/lib/auth";
import { handle, ok } from "@/lib/api";

export const POST = handle(async () => {
  await clearSessionCookie();
  return ok({ loggedOut: true });
});
