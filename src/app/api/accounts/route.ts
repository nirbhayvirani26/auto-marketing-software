import { z } from "zod";
import { SocialAccount } from "@/models/SocialAccount";
import { handle, ok, requireAuth } from "@/lib/api";
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
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const accounts = await SocialAccount.find().sort({ createdAt: -1 }).lean();
  return ok(accounts);
});

export const POST = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const body = createSchema.parse(await request.json());
  const account = await SocialAccount.create({
    ...body,
    avatarUrl: body.avatarUrl || undefined,
    createdBy: auth.session.sub,
    status: "connected",
  });

  await logActivity({
    level: "success",
    action: "account.created",
    message: `${body.platform} account add thayu: ${body.displayName}`,
    actor: auth.session.email,
  });

  return ok({ id: String(account._id) }, 201);
});
