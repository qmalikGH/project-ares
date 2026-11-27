// Read-only diagnostic (Sprint 3.4, #28 Teil 0.1).
//
// The production build of 0db90a7 failed with P1002: `prisma migrate deploy`
// timed out three times on pg_advisory_lock(72707369). This shows whether that
// lock is held right now, by whom, and the newest applied migrations — over
// DIRECT_URL (not the pooler), so the query itself sees real sessions.
//
//   npx tsx scripts/check-migrate-lock.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";

const PRISMA_MIGRATE_LOCK_KEY = 72707369;

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL not set");
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const locks = await db.$queryRawUnsafe<
      { pid: number; granted: boolean; state: string | null; backend_start: Date | null; application_name: string | null }[]
    >(
      `SELECT l.pid, l.granted, a.state, a.backend_start, a.application_name
         FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.objid = $1`,
      PRISMA_MIGRATE_LOCK_KEY,
    );
    console.log(`Advisory lock ${PRISMA_MIGRATE_LOCK_KEY}: ${locks.length === 0 ? "free" : "HELD"}`);
    for (const l of locks) {
      console.log(`  pid ${l.pid} granted=${l.granted} state=${l.state} since=${l.backend_start?.toISOString()} app=${l.application_name}`);
    }
    const migrations = await db.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 3`,
    );
    console.log("Newest applied migrations:");
    for (const m of migrations) console.log(`  ${m.migration_name}  finished=${m.finished_at?.toISOString() ?? "NO"}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
