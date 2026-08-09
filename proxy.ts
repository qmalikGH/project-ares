// Edge auth gate (Sprint 2.5).
//
// Next 16 renamed `middleware.ts` → `proxy.ts`; the function is unchanged.
// The Next auth guide is explicit that this layer is an OPTIMISTIC check and
// not a substitute for authorization at the data layer — so `getCurrentUserId()`
// verifies the session again server-side. This file is what stops an
// unauthenticated request from reaching a route handler at all.
//
// ONE gate, two accepted credentials:
//   - a session cookie (the browser)
//   - `Authorization: Bearer $CRON_SECRET` (Vercel cron + the ops scripts)
// Everything else is denied. Deny is the default: a new route is protected
// unless someone deliberately adds it to a list below.
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, decryptSession } from "@/lib/auth/session";

/** No credential of any kind required. */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

/**
 * Routes that carry their OWN shared secret (COACHING_EXPORT_TOKEN, verified
 * in-route) rather than a session or the cron bearer. They are exempt from the
 * gate but not from authentication — see the handlers.
 */
const SELF_AUTHENTICATING = ["/api/coaching-export", "/api/coaching-update"];

function matches(pathname: string, list: string[]): boolean {
  return list.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function hasServiceBearer(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (matches(pathname, PUBLIC_PATHS) || matches(pathname, SELF_AUTHENTICATING)) {
    return NextResponse.next();
  }

  // Vercel cron and the ops scripts. Checked before the cookie so a service
  // call never depends on browser state.
  if (hasServiceBearer(request)) return NextResponse.next();

  const session = await decryptSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  // APIs get a machine-readable 401; pages go to the login form with a return
  // path so a deep link survives the round trip.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next internals and static assets — /api/* included.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|sw.js).*)"],
};
