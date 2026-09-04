import { NextRequest, NextResponse } from "next/server";
import { SESSION_VERSION } from "./lib/session-version";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const sessionVersion = req.cookies.get("he_session_version")?.value;
  const valid = req.cookies.get("he_auth")?.value === "1" && sessionVersion === SESSION_VERSION;

  if ((pathname.startsWith("/dashboard") || pathname.startsWith("/historico")) && !valid) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (pathname.startsWith("/login") && valid) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/historico/:path*", "/login"],
};
