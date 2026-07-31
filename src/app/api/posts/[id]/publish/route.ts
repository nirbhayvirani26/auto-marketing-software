import { fail, handle, ok, requireAuth } from "@/lib/api";
import { publishPost } from "@/lib/publisher";

export const POST = handle(async (_request, { params }) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const result = await publishPost(id);
  if (!result.ok) return fail(result.error ?? "Publish fail thayu", 502);
  return ok(result);
});
