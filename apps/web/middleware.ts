import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * In development, prevent the browser from caching the HTML shell. Cached HTML often
 * points at old `/_next/static/...` chunk URLs after HMR or restarts → 404 on layout.css / main-app.js.
 */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export const config = {
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
