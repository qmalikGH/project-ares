// Stateless session cookie (Sprint 2.5).
//
// WHY NOT next-auth: it is a direct dependency (5.0.0-beta.31) and it declares
// Next 16 as a supported peer, but it predates Next 16's rename of
// `middleware.ts` → `proxy.ts` and still documents/export-shapes around the old
// convention. For a single-user app with one password, the stateless-session
// pattern from the official Next 16 auth guide is ~100 lines, edge-compatible,
// and has no beta surface. Swapping to next-auth later means replacing this
// module and `proxy.ts` — nothing else imports the internals.
//
// This module must stay EDGE-SAFE: it is imported by proxy.ts. `jose` is; the
// node:crypto password check deliberately lives in ./password.ts instead.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ares_session";
/**
 * One year. This is a single-athlete app on personal devices, and the 30-day
 * default meant re-entering a password roughly monthly for no security gain
 * anyone was actually collecting — the realistic threat is not a stolen laptop,
 * it is the URL being public, which the gate itself closes.
 *
 * Revocation is not lost: rotating AUTH_SECRET invalidates every issued session
 * immediately, because the signature no longer verifies. That is the kill switch
 * if a device is ever lost.
 */
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: string;
  expiresAt: number;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    // Fail closed: a missing/short secret must never degrade to "everyone is
    // authenticated". Throwing here surfaces a misconfigured deploy loudly.
    throw new Error(
      "AUTH_SECRET is missing or shorter than 32 characters — refusing to sign or verify sessions.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(new Date(payload.expiresAt))
    .sign(secretKey());
}

/** Verify + decode. Returns null for anything that is not a valid, unexpired session. */
export async function decryptSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const userId = payload.userId;
    if (typeof userId !== "string" || userId.length === 0) return null;
    const exp = typeof payload.exp === "number" ? payload.exp * 1000 : 0;
    return { userId, expiresAt: exp };
  } catch {
    // Expired, tampered, wrong secret, malformed — all the same answer.
    return null;
  }
}

export function sessionExpiry(now: number = Date.now()): number {
  return now + SESSION_TTL_MS;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;
