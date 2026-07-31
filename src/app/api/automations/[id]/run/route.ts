import { handle, ok, requireAuth } from "@/lib/api";
import { runAutomation } from "@/lib/automation-runner";

/** "Run now" button — schedule ni raah joya vagar automation chalave. */
export const POST = handle(async (_request, { params }) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const result = await runAutomation(id);
  return ok(result);
});
