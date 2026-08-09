// Sprint 2.5 — session token + password verification.
//
// These are the primitives the whole gate rests on. The properties that matter
// are the negative ones: a tampered, expired, foreign-signed or absent token
// must never resolve to a user.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { encryptSession, decryptSession, sessionExpiry } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const SECRET = "a".repeat(32);
const OTHER_SECRET = "b".repeat(32);

describe("session token", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("round-trips a user id", async () => {
    const token = await encryptSession({ userId: "user-123", expiresAt: sessionExpiry() });
    await expect(decryptSession(token)).resolves.toMatchObject({ userId: "user-123" });
  });

  it("rejects a missing or empty token", async () => {
    await expect(decryptSession(undefined)).resolves.toBeNull();
    await expect(decryptSession("")).resolves.toBeNull();
  });

  it("rejects a malformed token", async () => {
    await expect(decryptSession("not.a.jwt")).resolves.toBeNull();
    await expect(decryptSession("garbage")).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await encryptSession({ userId: "user-123", expiresAt: sessionExpiry() });
    process.env.AUTH_SECRET = OTHER_SECRET;
    await expect(decryptSession(token)).resolves.toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await encryptSession({ userId: "user-123", expiresAt: sessionExpiry() });
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "someone-else" })).toString("base64url");
    await expect(decryptSession(`${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await encryptSession({ userId: "user-123", expiresAt: Date.now() - 1000 });
    await expect(decryptSession(token)).resolves.toBeNull();
  });

  it("refuses to sign or verify without a strong secret — fails closed", async () => {
    delete process.env.AUTH_SECRET;
    await expect(
      encryptSession({ userId: "user-123", expiresAt: sessionExpiry() }),
    ).rejects.toThrow(/AUTH_SECRET/);

    process.env.AUTH_SECRET = "too-short";
    await expect(
      encryptSession({ userId: "user-123", expiresAt: sessionExpiry() }),
    ).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("password verification", () => {
  it("accepts the correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
  });

  it("produces a different hash each time (salted)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same password", a)).resolves.toBe(true);
    await expect(verifyPassword("same password", b)).resolves.toBe(true);
  });

  it("fails closed on a missing or malformed stored hash", async () => {
    // A broken AUTH_PASSWORD_HASH must deny, not throw and not accept.
    await expect(verifyPassword("anything", undefined)).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "plaintext")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$onlytwo")).resolves.toBe(false);
    await expect(verifyPassword("anything", "bcrypt$aa$bb")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$zz$zz")).resolves.toBe(false);
  });
});
