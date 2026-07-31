import { z } from "zod";
import { SocialAccount } from "@/models/SocialAccount";
import { handle, ok, requireBrand, requireLimit } from "@/lib/api";
import { logActivity } from "@/models/ActivityLog";

const createSchema = z
  .object({
    platform: z.enum(["facebook", "instagram"]),
    displayName: z.string().min(1),
    pageId: z.string().optional(),
    igUserId: z.string().optional(),
    accessToken: z.string().optional(),
    avatarUrl: z.string().url().optional().or(z.literal("")),
  })
  .refine(
    (value) =>
      value.platform === "facebook" ? Boolean(value.pageId) : Boolean(value.igUserId),
    {
      message:
        "Facebook mate Page ID joiye; Instagram mate IG Business Account ID joiye.",
      path: ["pageId"],
    },
  );

export const GET = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const accounts = await SocialAccount.find({ brand: ctx.brandId })
    .sort({ createdAt: -1 })
    .lean();
  return ok(accounts);
});

export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const limited = await requireLimit(ctx.tenant, "socialAccounts");
  if (limited) return limited;

  const body = createSchema.parse(await request.json());
  const account = await SocialAccount.create({
    ...body,
    brand: ctx.brandId,
    avatarUrl: body.avatarUrl || undefined,
    createdBy: ctx.session.sub,
    status: "connected",
  });

  await logActivity({
    level: "success",
    action: "account.created",
    message: `${body.platform} account add thayu: ${body.displayName}`,
    actor: ctx.session.email,
  });

  return ok({ id: String(account._id) }, 201);
});
