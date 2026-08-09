// Sprint 2.5 — the edge gate.
//
// Before 2.5 there was no gate at all: `GET /api/progress` on the public Vercel
// URL returned 200 to anyone. The property under test is that DENY is the
// default — an unlisted route without a credential never reaches a handler.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";
import { SESSION_COOKIE, encryptSession, sessionExpiry } from "@/lib/auth/session";

const SECRET = "a".repeat(32);
const CRON_SECRET = "cron-secret-value";

function request(path: string, opts: { cookie?: string; bearer?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", `${SESSION_COOKIE}=${opts.cookie}`);
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);
  return new NextRequest(new URL(path, "https://ares.test"), { headers });
}

async function validCookie(): Promise<string> {
  return encryptSession({ userId: "user-123", expiresAt: sessionExpiry() });
}

/** The gate lets a request through by returning a plain `next()` response. */
function passedThrough(res: Response): boolean {
  return res.status === 200 && res.headers.get("x-middleware-next") === "1";
}

describe("proxy gate", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
    process.env.CRON_SECRET = CRON_SECRET;
  });
  afterEach(() => {
    delete process.env.AUTH_SECRET;
    delete process.env.CRON_SECRET;
  });

  it("denies an unauthenticated API request with 401", async () => {
    const res = await proxy(request("/api/progress"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("denies unauthenticated admin and debug routes", async () => {
    for (const path of [
      "/api/admin/shift-illness",
      "/api/admin/resync-nutrition",
      "/api/debug/regenerate-from-now",
      "/api/settings",
      "/api/sessions/complete",
    ]) {
      const res = await proxy(request(path));
      expect(res.status, path).toBe(401);
    }
  });

  it("redirects an unauthenticated page request to /login and keeps the target", async () => {
    const res = await proxy(request("/today?tab=plan"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/today?tab=plan");
  });

  it("lets a valid session through", async () => {
    const res = await proxy(request("/api/progress", { cookie: await validCookie() }));
    expect(passedThrough(res)).toBe(true);
  });

  it("lets the cron bearer through without a cookie", async () => {
    const res = await proxy(request("/api/cron/garmin-sync-daily", { bearer: CRON_SECRET }));
    expect(passedThrough(res)).toBe(true);
  });

  it("rejects a wrong bearer", async () => {
    const res = await proxy(request("/api/progress", { bearer: "not-the-secret" }));
    expect(res.status).toBe(401);
  });

  it("rejects a session cookie signed with another secret", async () => {
    const foreign = await encryptSession({ userId: "x", expiresAt: sessionExpiry() });
    process.env.AUTH_SECRET = "b".repeat(32);
    const res = await proxy(request("/api/progress", { cookie: foreign }));
    expect(res.status).toBe(401);
  });

  it("leaves the login and auth routes public", async () => {
    for (const path of ["/login", "/api/auth/login", "/api/auth/logout"]) {
      expect(passedThrough(await proxy(request(path))), path).toBe(true);
    }
  });

  it("lets the self-authenticating coaching routes reach their own token check", async () => {
    for (const path of ["/api/coaching-export", "/api/coaching-update"]) {
      expect(passedThrough(await proxy(request(path))), path).toBe(true);
    }
  });

  it("does not treat an unset CRON_SECRET as a valid bearer", async () => {
    delete process.env.CRON_SECRET;
    const res = await proxy(request("/api/progress", { bearer: "undefined" }));
    expect(res.status).toBe(401);
  });

  it("is not fooled by a path that merely starts with a public prefix", async () => {
    const res = await proxy(request("/loginsomething"));
    expect(res.status).toBe(307);
  });
});
