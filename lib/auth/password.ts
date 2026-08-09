// Password verification (Sprint 2.5). Node runtime only — node:crypto's scrypt
// is not available on the edge, which is why proxy.ts never imports this.
//
// One user, one password. The hash lives in AUTH_PASSWORD_HASH as
// `scrypt$<saltHex>$<hashHex>`; generate it with scripts/hash-password.ts.
// scrypt is in the standard library, so this adds no dependency.
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;
const PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LEN);
  return `${PREFIX}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Constant-time verification. Returns false for a malformed or missing hash
 * rather than throwing — a broken AUTH_PASSWORD_HASH must fail closed, not
 * crash the login route into a 500 that reveals the difference.
 */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;

  const [, saltHex, hashHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;

  const derived = await scryptAsync(password, salt, KEY_LEN);
  return timingSafeEqual(derived, expected);
}
