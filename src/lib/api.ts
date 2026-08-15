import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { connectDB } from "./db";
import { getSession, type SessionPayload } from "./auth";
import { getActiveBrand } from "./brand";
import { checkLimit, loadTenant, moduleEnabled, type TenantContext } from "./tenant";
import type { BrandDoc } from "@/models/Brand";
import type { LimitKey, ModuleKey } from "@/models/Plan";

export function ok<T>(data: T, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(message: string, status = 400, extra?: unknown) {
  return NextResponse.json({ ok: false, error: message, extra }, { status });
}

/**
 * DB connect + auth check ne ek jagya e rakhe che jethi dareak route handler
 * ma e code repeat na thay.
 */
export async function requireAuth(): Promise<
  { session: SessionPayload } | { response: NextResponse }
> {
  const session = await getSession();
  if (!session) return { response: fail("Unauthorized", 401) };
  try {
    await connectDB();
  } catch (error) {
    return {
      response: fail(
        `Database connect na thayu: ${(error as Error).message}`,
        503,
      ),
    };
  }
  return { session };
}

/** requireAuth() + organization + plan. */
export async function requireOrg(): Promise<
  | { session: SessionPayload; orgId: string; tenant: TenantContext }
  | { response: NextResponse }
> {
  const auth = await requireAuth();
  if ("response" in auth) return auth;

  if (!auth.session.org) {
    return {
      response: fail(
        auth.session.role === "superadmin"
          ? "Super admin koi organization ma nathi — Super Admin panel vapro"
          : "Tamaru organization set nathi",
        409,
      ),
    };
  }

  const tenant = await loadTenant(auth.session.org);
  if (!tenant) return { response: fail("Organization or plan not found", 404) };

  return { session: auth.session, orgId: auth.session.org, tenant };
}

/**
 * requireOrg() + active brand. Brand-scoped data (accounts, posts, campaigns,
 * automations, DM rules) vaparti dareak route aa vaapre che, jethi ek
 * organization/brand no data biji jagya e kadi na dekhay.
 */
export async function requireBrand(): Promise<
  | {
      session: SessionPayload;
      orgId: string;
      tenant: TenantContext;
      brandId: string;
      brand: BrandDoc;
    }
  | { response: NextResponse }
> {
  const ctx = await requireOrg();
  if ("response" in ctx) return ctx;

  const brand = await getActiveBrand(ctx.orgId);
  if (!brand) {
    return {
      response: fail(
        "Ek pan brand nathi. Pehla Brands page ma brand banavo.",
        409,
      ),
    };
  }

  return { ...ctx, brandId: String(brand._id), brand };
}

/** Module band hoy to 402 — UI upgrade prompt dekhaadi shake. */
export function requireModule(
  tenant: TenantContext,
  key: ModuleKey,
): NextResponse | null {
  if (moduleEnabled(tenant, key)) return null;
  return fail(
    `Aa feature tamara "${tenant.plan.name}" plan ma nathi. Plan upgrade karo.`,
    402,
    { module: key, plan: tenant.plan.name },
  );
}

/** Limit vati gai hoy to 402. */
export async function requireLimit(
  tenant: TenantContext,
  key: LimitKey,
): Promise<NextResponse | null> {
  const check = await checkLimit(tenant, key);
  if (check.allowed) return null;
  return fail(
    `Tamara "${tenant.plan.name}" plan ni limit puri thai gai (${check.used}/${check.limit}). Plan upgrade karo.`,
    402,
    { limitKey: key, ...check },
  );
}

/** Route handler ne wrap kare — unexpected error 500 JSON ma convert kare. */
export function handle(
  fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>,
) {
  return async (
    req: Request,
    ctx: { params: Promise<Record<string, string>> },
  ) => {
    try {
      return await fn(req, ctx);
    } catch (error) {
      if (error instanceof ZodError) {
        return fail("Validation failed", 422, error.flatten());
      }
      console.error("[api]", error);
      return fail((error as Error).message || "Internal Server Error", 500);
    }
  };
}
