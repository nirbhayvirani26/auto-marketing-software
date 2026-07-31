import { z } from "zod";
import { SocialAccount } from "@/models/SocialAccount";
import { fail, handle, ok, requireBrand } from "@/lib/api";
import { logActivity } from "@/models/ActivityLog";

const updateSchema = z.object({
  displayName: z.string().min(1).optional(),
  pageId: z.string().optional(),
  igUserId: z.string().optional(),
  accessToken: z.string().optional(),
  avatarUrl: z.string().optional(),
  status: z.enum(["connected", "disconnected", "error"]).optional(),
});

export const PATCH = handle(async (request, { params }) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  // Khali string thi existing token overwrite na thay.
  if (body.accessToken === "") delete body.accessToken;

  const account = await SocialAccount.findOneAndUpdate(
    { _id: id, brand: ctx.brandId },
    body,
    { new: true },
  );
  if (!account) return fail("Account madyu nahi", 404);

  return ok({ id: String(account._id) });
});

export const DELETE = handle(async (_request, { params }) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const account = await SocialAccount.findOneAndDelete({
    _id: id,
    brand: ctx.brandId,
  });
  if (!account) return fail("Account madyu nahi", 404);

  await logActivity({
    level: "warning",
    action: "account.deleted",
    message: `Account delete thayu: ${account.displayName}`,
    actor: ctx.session.email,
  });

  return ok({ deleted: true });
});
