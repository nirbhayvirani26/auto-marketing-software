import { NextResponse } from "next/server";
import { connectDB } from "./db";
import { getSession, type SessionPayload } from "./auth";
import { fail } from "./api";

/**
 * Fakt superadmin role vada ne j andar aavva de che.
 * Platform-wide data (badhi organizations, users, plans) aa guard pachhal che.
 */
export async function requireSuperAdmin(): Promise<
  { session: SessionPayload } | { response: NextResponse }
> {
  const session = await getSession();
  if (!session) return { response: fail("Unauthorized", 401) };
  if (session.role !== "superadmin") {
    return { response: fail("Fakt super admin mate", 403) };
  }
  try {
    await connectDB();
  } catch (error) {
    return {
      response: fail(`Database connect na thayu: ${(error as Error).message}`, 503),
    };
  }
  return { session };
}
