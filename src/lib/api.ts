import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { connectDB } from "./db";
import { getSession, type SessionPayload } from "./auth";

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
