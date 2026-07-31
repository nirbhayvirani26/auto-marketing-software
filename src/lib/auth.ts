import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";

export const AUTH_COOKIE = "am_session";

export type UserRole = "superadmin" | "owner" | "admin" | "member";

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  /** superadmin mate undefined — e koi organization ma nathi. */
  org?: string;
};

export function isSuperAdmin(session: SessionPayload | null): boolean {
  return session?.role === "superadmin";
}

/** Organization settings/billing badalvano hakk kone che. */
export function canManageOrg(session: SessionPayload | null): boolean {
  return (
    session?.role === "superadmin" ||
    session?.role === "owner" ||
    session?.role === "admin"
  );
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.jwtSecret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.jwtExpiresIn)
    .sign(secretKey());
}

export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** Server components / route handlers ma current user. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(AUTH_COOKIE)?.value);
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
}
