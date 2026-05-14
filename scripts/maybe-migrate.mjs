// scripts/maybe-migrate.mjs
//
// Build-time guard for `prisma migrate deploy`. The schema references
// env("DATABASE_URL") and env("DIRECT_URL") directly, so the CLI exits
// with P1012 if either is unset — that breaks Vercel preview deploys
// where env vars are scoped to Production.
//
// Behaviour:
//   - Both URLs set       → run `prisma migrate deploy` (production path)
//   - Either URL missing  → log + skip (preview deploys, ephemeral builds)
//
// Runtime DB access still fails fast against the placeholder URL on
// preview, which is the right outcome — the UI renders, queries throw.

import { execSync } from "node:child_process";

const hasDb = !!process.env.DATABASE_URL;
const hasDirect = !!process.env.DIRECT_URL;

if (hasDb && hasDirect) {
  console.log("[maybe-migrate] DATABASE_URL + DIRECT_URL present → prisma migrate deploy");
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync("npx prisma migrate deploy", { stdio: "inherit" });
      break;
    } catch (err) {
      if (attempt < maxRetries) {
        console.log(`[maybe-migrate] attempt ${attempt} failed, retrying in 5s...`);
        execSync("node -e \"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000)\"");
      } else {
        throw err;
      }
    }
  }
} else {
  const missing = [!hasDb && "DATABASE_URL", !hasDirect && "DIRECT_URL"].filter(Boolean).join(", ");
  console.log(
    `[maybe-migrate] ${missing} not set → skipping prisma migrate deploy ` +
      "(preview deploy or local dev without DB access)",
  );
}
