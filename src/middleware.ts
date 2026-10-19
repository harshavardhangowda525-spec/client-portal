import { NextResponse, type NextRequest } from "next/server";

/**
 * Deep links (e.g. /portal/<project>/app from an email) go through sign-in and come back to the same page.
 * The session itself is still validated on the server by every page and action.
 */
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname + req.nextUrl.search;
  if (!req.cookies.get("iwa_session")) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  const headers = new Headers(req.headers);
  headers.set("x-pathname", path);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/portal/:path*", "/admin/:path*"] };
