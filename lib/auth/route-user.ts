// Route-level user resolution for endpoints reachable BOTH from the browser
// and from a service caller (Sprint 2.5).
//
// Before 2.5 the bearer branches in app/api/debug/* were decorative: they fell
// through to a getCurrentUserId() that could not fail, so an unauthenticated
// request got a user anyway. Now the fall-through is a session check that
// throws, and the bearer path resolves the athlete explicitly.
import { getCurrentUserId, getServiceUserId } from "@/lib/auth/current-user";

export function hasServiceBearer(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Service bearer → the athlete; otherwise the session user (throws
 * UnauthorizedError when there is none).
 *
 * `bodyUserId` lets a service caller name a specific user. It is honoured ONLY
 * on the bearer path — a browser session can never act as someone else.
 */
export async function resolveRouteUserId(req: Request, bodyUserId?: unknown): Promise<string> {
  if (hasServiceBearer(req)) {
    if (typeof bodyUserId === "string" && bodyUserId.length > 0) return bodyUserId;
    return getServiceUserId();
  }
  return getCurrentUserId();
}
