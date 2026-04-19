import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/auth";

const PUBLIC_ROUTES = new Set([
  "/login",
  "/api/healthz",
  "/api/auth/register",
  "/api/auth/bootstrap",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) {
    return true;
  }
  if (pathname.startsWith("/api/auth/")) {
    return true;
  }
  return false;
}

type AuthenticatedRequest = NextRequest & { auth: { user?: { id?: string } } | null };

export default auth((req: AuthenticatedRequest) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const loginUrl = new URL("/login", nextUrl.origin);
    loginUrl.searchParams.set("next", `${pathname}${nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
