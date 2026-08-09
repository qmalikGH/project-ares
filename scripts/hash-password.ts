// Generate AUTH_PASSWORD_HASH for the login route (Sprint 2.5).
//
//   npx tsx scripts/hash-password.ts "my password"
//
// Paste the output into Vercel → Settings → Environment Variables as
// AUTH_PASSWORD_HASH, and into .env.local for local dev. The plaintext password
// is never stored anywhere.
import { hashPassword } from "@/lib/auth/password";

async function main() {
  const password = process.argv[2];
  if (!password || password.length < 12) {
    console.error("Usage: npx tsx scripts/hash-password.ts \"<password, min 12 chars>\"");
    process.exit(1);
  }
  console.log(await hashPassword(password));
}
main().catch((e) => { console.error(e); process.exit(1); });
