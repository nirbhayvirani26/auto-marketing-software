import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth";

const PUBLIC_PATHS = ["/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const session = await verifySession(token);

  // Logged-in user login page par jay to admin ma moklo.
  if (PUBLIC_PATHS.includes(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // API routes potano auth check kare che (ane cron/webhook secret vaapre che),
  // etle middleware fakt page routes par chale.
  matcher: ["/admin/:path*", "/login"],
};
