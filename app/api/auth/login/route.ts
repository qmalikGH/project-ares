// POST /api/auth/login — the only way to obtain a session (Sprint 2.5).
//
// Public by design (proxy.ts allow-lists it). Node runtime: the scrypt check in
// lib/auth/password.ts is not edge-compatible.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  encryptSession,
  sessionExpiry,
} from "@/lib/auth/session";
import { getServiceUserId } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Without these the gate denies every request and login cannot mint a
  // session — the app is simply down. Say so instead of throwing a 500, so a
  // misconfigured deploy is diagnosable from the response alone.
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    return NextResponse.json(
      { error: "server_misconfigured", detail: "AUTH_SECRET missing or too short" },
      { status: 503 },
    );
  }
  if (!process.env.AUTH_PASSWORD_HASH) {
    return NextResponse.json(
      { error: "server_misconfigured", detail: "AUTH_PASSWORD_HASH not set" },
      { status: 503 },
    );
  }

  const ok = await verifyPassword(parsed.data.password, process.env.AUTH_PASSWORD_HASH);
  if (!ok) {
    // One generic answer for wrong password, missing hash and malformed hash —
    // a misconfigured deploy must not be distinguishable from a bad guess.
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const userId = await getServiceUserId();
  const expiresAt = sessionExpiry();
  const token = await encryptSession({ userId, expiresAt });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    ...SESSION_COOKIE_OPTIONS,
    expires: new Date(expiresAt),
  });

  return NextResponse.json({ status: "ok" });
}
