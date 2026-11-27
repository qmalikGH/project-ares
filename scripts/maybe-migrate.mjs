// scripts/maybe-migrate.mjs
//
// Build-time guard for `prisma migrate deploy`. The schema references
// env("DATABASE_URL") and env("DIRECT_URL") directly, so the CLI exits
// with P1012 if either is unset — that breaks Vercel preview deploys
// where env vars are scoped to Production.
//
// Behaviour:
//   - Vercel preview/development build → skip, ALWAYS (see below)
//   - Both URLs set                    → run `prisma migrate deploy`
//   - Either URL missing               → log + skip (ephemeral builds)
//
// Runtime DB access still fails fast against the placeholder URL on
// preview, which is the right outcome — the UI renders, queries throw.
//
// Sprint 3.4 (#28, Teil 0.1): the comment above assumed preview builds have
// no database URLs. They do — the preview of every PR ran `migrate deploy`
// against the PRODUCTION database (the 3.4 migrations landed there before
// any merge). And on 31.10. the preview of #27 and the production build ran
// it at the same time; the production build timed out three times on
// Prisma's advisory lock (P1002) and failed, so #27 never went live.
// Migrations now run only where VERCEL_ENV says "production" (or outside
// Vercel, where VERCEL_ENV is unset).

import { execSync } from "node:child_process";

const hasDb = !!process.env.DATABASE_URL;
const hasDirect = !!process.env.DIRECT_URL;
const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv && vercelEnv !== "production") {
  console.log(
    `[maybe-migrate] VERCEL_ENV=${vercelEnv} → skipping prisma migrate deploy ` +
      "(only production builds migrate the database)",
  );
} else if (hasDb && hasDirect) {
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
