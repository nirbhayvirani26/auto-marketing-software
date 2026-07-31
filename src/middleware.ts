import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth";

/** Login karela user aa pages par jay to andar moklo. */
const AUTH_PAGES = ["/login", "/register", "/verify"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const session = await verifySession(request.cookies.get(AUTH_COOKIE)?.value);
  const home = session?.role === "superadmin" ? "/superadmin" : "/admin";

  if (AUTH_PAGES.includes(pathname)) {
    return session
      ? NextResponse.redirect(new URL(home, request.url))
      : NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Super admin panel fakt superadmin mate.
  if (pathname.startsWith("/superadmin") && session.role !== "superadmin") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  // Superadmin no potano organization nathi, etle user panel ma na moklo.
  if (pathname.startsWith("/admin") && session.role === "superadmin" && !session.org) {
    return NextResponse.redirect(new URL("/superadmin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Landing (/) ane pricing public che. API routes potano auth check kare che.
  matcher: ["/admin/:path*", "/superadmin/:path*", "/login", "/register", "/verify"],
};
