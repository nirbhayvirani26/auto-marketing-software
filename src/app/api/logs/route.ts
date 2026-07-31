import { ActivityLog } from "@/models/ActivityLog";
import { handle, ok, requireAuth } from "@/lib/api";

export const GET = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const level = url.searchParams.get("level");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const logs = await ActivityLog.find(level ? { level } : {})
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return ok(logs);
});
