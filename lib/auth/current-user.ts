// Session-backed user resolution (Sprint 2.5).
//
// BEFORE 2.5 this was a shim: it looked Q up by a hardcoded email and CREATED
// him if absent. There was no proxy/middleware, next-auth was installed but
// never imported, and `GET /api/progress` on the public Vercel URL returned 200
// to anyone. Health data — weight, resting HR, HRV, sleep, injuries — was world
// readable and writable.
//
// Two layers now, deliberately:
//   1. proxy.ts rejects unauthenticated requests at the edge.
//   2. getCurrentUserId() verifies the session again here.
// Layer 2 exists so a proxy matcher mistake fails CLOSED. Never soften it into
// a fallback that resolves a user without a session.
import { cookies } from "next/headers";

import { db } from "@/lib/db/client";
import { SESSION_COOKIE, decryptSession } from "@/lib/auth/session";

/**
 * Thrown when no valid session is present.
 *
 * Route handlers do NOT catch this: proxy.ts already rejected the request
 * before it could reach them, so a throw here means the gate was misconfigured.
 * Surfacing that as a 500 is intentional — loud and safe beats quiet and open.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** The single athlete this deployment serves. Used only by service-token paths. */
const Q_EMAIL = "quentinmalik.career@gmail.com";

/** Session user id, or null when unauthenticated. Does not throw. */
export async function getCurrentUserIdOrNull(): Promise<string | null> {
  const store = await cookies();
  const session = await decryptSession(store.get(SESSION_COOKIE)?.value);
  return session?.userId ?? null;
}

/** Session user id. Throws UnauthorizedError when unauthenticated. */
export async function getCurrentUserId(): Promise<string> {
  const userId = await getCurrentUserIdOrNull();
  if (!userId) throw new UnauthorizedError();
  return userId;
}

export async function getCurrentUser() {
  const userId = await getCurrentUserId();
  return db.user.findUniqueOrThrow({ where: { id: userId } });
}

/**
 * Resolve the athlete for SERVICE callers — cron jobs and the external coach —
 * which authenticate with a bearer token or a shared secret instead of a
 * session. Callers MUST have verified that token before calling this.
 *
 * Unlike the pre-2.5 shim this never creates a user: an empty database should
 * surface as an error, not silently mint an account on a GET.
 */
export async function getServiceUserId(): Promise<string> {
  const user = await db.user.findUnique({ where: { email: Q_EMAIL }, select: { id: true } });
  if (!user) throw new Error(`No user provisioned for ${Q_EMAIL}`);
  return user.id;
}
