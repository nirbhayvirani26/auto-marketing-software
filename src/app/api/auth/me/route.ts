import { getSession } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/api";

export const GET = handle(async () => {
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);
  return ok(session);
});
