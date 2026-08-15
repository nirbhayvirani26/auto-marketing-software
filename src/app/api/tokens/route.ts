import { z } from "zod";
import { fail, handle, ok, requireModule, requireOrg } from "@/lib/api";
import { ApiToken, generateToken } from "@/models/ApiToken";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

const SCOPES = [
  "posts:read",
  "posts:write",
  "posts:publish",
  "ai:generate",
  "automations:run",
  "accounts:read",
] as const;

export const GET = handle(async () => {
  const ctx = await requireOrg();
  if ("response" in ctx) return ctx.response;

  const gated = requireModule(ctx.tenant, "apiTokens");
  if (gated) return gated;

  const tokens = await ApiToken.find({ organization: ctx.orgId, revokedAt: null })
    .select("name tokenSuffix scopes lastUsedAt useCount createdAt expiresAt")
    .sort({ createdAt: -1 })
    .lean();

  return ok({ tokens, availableScopes: SCOPES });
});

const createSchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

/** Navo token — plain value FAKT AA EK VAAR pacho aave che. */
export const POST = handle(async (request) => {
  const ctx = await requireOrg();
  if ("response" in ctx) return ctx.response;

  const gated = requireModule(ctx.tenant, "apiTokens");
  if (gated) return gated;

  const body = createSchema.parse(await request.json());
  const { token, hash, suffix } = generateToken();

  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 86_400_000)
    : undefined;

  const created = await ApiToken.create({
    organization: ctx.orgId,
    name: body.name,
    tokenHash: hash,
    tokenSuffix: suffix,
    scopes: body.scopes,
    expiresAt,
    createdBy: ctx.session.sub,
  });

  await logActivity({
    level: "warning",
    action: "token.created",
    message: `Navo API token banyo: ${body.name}`,
    actor: ctx.session.email,
  });

  return ok(
    {
      id: String(created._id),
      name: created.name,
      // Aa value fari kadi nahi dekhaay — user ne turant copy karvanu kehvu.
      token,
      scopes: created.scopes,
      expiresAt,
    },
    201,
  );
});

export const DELETE = handle(async (request) => {
  const ctx = await requireOrg();
  if ("response" in ctx) return ctx.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return fail("A token id is required", 400);

  const token = await ApiToken.findOneAndUpdate(
    { _id: id, organization: ctx.orgId },
    { revokedAt: new Date() },
  );
  if (!token) return fail("Token not found", 404);

  await logActivity({
    level: "warning",
    action: "token.revoked",
    message: `API token revoke thayo: ${token.name}`,
    actor: ctx.session.email,
  });

  return ok({ revoked: true });
});
