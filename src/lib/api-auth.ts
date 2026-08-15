import { NextResponse } from "next/server";
import { connectDB } from "./db";
import { fail } from "./api";
import { ApiToken, hashToken } from "@/models/ApiToken";
import { Brand } from "@/models/Brand";
import { loadTenant, moduleEnabled, type TenantContext } from "./tenant";

export type ApiAuthContext = {
  orgId: string;
  tenant: TenantContext;
  tokenName: string;
  scopes: string[];
};

/**
 * n8n (ke koi pan external service) `Authorization: Bearer amk_...` header
 * thi authenticate kare che. Session cookie ni jarur nathi.
 *
 * Token organization saathe jodayelo che, etle e organization no j data
 * accessible rahe che.
 */
export async function requireApiToken(
  request: Request,
  scope?: string,
): Promise<{ ctx: ApiAuthContext } | { response: NextResponse }> {
  const header =
    request.headers.get("authorization") ?? request.headers.get("x-api-key");
  const raw = header?.replace(/^Bearer\s+/i, "").trim();

  if (!raw) {
    return {
      response: fail(
        "API token joiye — header ma `Authorization: Bearer amk_...` moklo",
        401,
      ),
    };
  }

  try {
    await connectDB();
  } catch (error) {
    return {
      response: fail(`Database connect na thayu: ${(error as Error).message}`, 503),
    };
  }

  const token = await ApiToken.findOne({
    tokenHash: hashToken(raw),
    revokedAt: null,
  });

  if (!token) return { response: fail("The token is invalid or has been revoked", 401) };
  if (token.expiresAt && token.expiresAt < new Date()) {
    return { response: fail("The token has expired", 401) };
  }
  if (scope && !token.scopes.includes(scope)) {
    return {
      response: fail(`Aa token pase "${scope}" scope nathi`, 403),
    };
  }

  const tenant = await loadTenant(token.organization);
  if (!tenant) return { response: fail("Organization not found", 404) };

  if (!moduleEnabled(tenant, "apiTokens")) {
    return {
      response: fail(
        `API access tamara "${tenant.plan.name}" plan ma nathi. Plan upgrade karo.`,
        402,
      ),
    };
  }

  // Usage tracking — chhelli var kyare vaparyo.
  token.lastUsedAt = new Date();
  token.useCount = (token.useCount ?? 0) + 1;
  await token.save();

  return {
    ctx: {
      orgId: String(token.organization),
      tenant,
      tokenName: token.name,
      scopes: token.scopes,
    },
  };
}

/**
 * Request ma brand nakki kare — `brandId` ke `brandSlug` aapo, nahi to
 * organization no pehlo brand vaparay che.
 */
export async function resolveBrand(
  ctx: ApiAuthContext,
  input: { brandId?: string; brandSlug?: string },
) {
  if (input.brandId) {
    return Brand.findOne({ _id: input.brandId, organization: ctx.orgId });
  }
  if (input.brandSlug) {
    return Brand.findOne({ slug: input.brandSlug, organization: ctx.orgId });
  }
  return Brand.findOne({ organization: ctx.orgId, active: true }).sort({
    createdAt: 1,
  });
}
