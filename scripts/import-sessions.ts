// Link stored Garmin activities to sessions — Sprint 2.9, rebuilt in 3.4 (#28).
//
// The same three passes the nightly cron runs (lib/garmin/auto-import.ts:
// identity → same day → free run ≥ 15 min), driven by hand over a chosen
// window. Reads the raw store only: fill it first with
// scripts/backfill-garmin-history.ts.
//
// One-off for the 3.4 rollout (Q, 27.11.): link everything since the block
// restart once, then the cron keeps a 14-day window:
//
//   npx tsx scripts/import-sessions.ts --from=2026-10-05           # dry run
//   npx tsx scripts/import-sessions.ts --from=2026-10-05 --apply
//
// Or the last N days:  --days=21
// Afterwards: npx tsx scripts/run-resync.ts (regenerate + push to the watch).
//
// Output: counts and dates only — the repo and the issue are public.
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { userTodayForUser } from "@/lib/date";
import { autoImportFromStore } from "@/lib/garmin/auto-import";

const APPLY = process.argv.includes("--apply");
const fromArg = process.argv.find((a) => a.startsWith("--from="))?.slice(7);
const daysArg = process.argv.find((a) => a.startsWith("--days="))?.slice(7);

async function main() {
  const settings = await db.userSettings.findFirst({ select: { userId: true } });
  if (!settings) {
    console.error("No user found");
    process.exit(1);
  }
  const userId = settings.userId;
  const today = await userTodayForUser(userId);
  const to = new Date(today.getTime() - 86400000); // never the running day
  let from: Date;
  if (fromArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) throw new Error("--from must be YYYY-MM-DD");
    from = new Date(`${fromArg}T00:00:00.000Z`);
  } else {
    const days = Math.max(1, Math.min(120, Number(daysArg) || 14));
    from = new Date(to.getTime() - (days - 1) * 86400000);
  }

  const stored = await db.garminActivity.count({
    where: { userId, localDate: { gte: from, lte: to } },
  });
  console.log(APPLY ? "MODE: APPLY (writes)" : "MODE: DRY RUN (pass --apply to write)");
  console.log(`Window: ${from.toISOString().slice(0, 10)} … ${to.toISOString().slice(0, 10)}, ${stored} stored activities`);
  if (stored === 0) {
    console.log("Nothing stored in this window — run scripts/backfill-garmin-history.ts --apply first.");
    await db.$disconnect();
    return;
  }

  const r = await autoImportFromStore(userId, { from, to }, { dryRun: !APPLY });
  for (const i of r.imported) {
    console.log(`  ✓ ${i.date} ${i.type.padEnd(14)} ${i.match.padEnd(9)} ${i.durationActualMin} min`);
  }
  const byReason: Record<string, number> = {};
  for (const x of r.rawOnly) byReason[x.reason] = (byReason[x.reason] ?? 0) + 1;
  const byMatch: Record<string, number> = {};
  for (const i of r.imported) byMatch[i.match] = (byMatch[i.match] ?? 0) + 1;
  for (const e of r.errors) console.log(`  ✗ ${e}`);

  console.log(`\n${APPLY ? "Linked" : "Would link"}: ${JSON.stringify(byMatch)}`);
  console.log(`Raw data only: ${JSON.stringify(byReason)}`);
  console.log(`Reconciled earlier links: ${r.reconciled}, errors: ${r.errors.length}`);
  if (APPLY && r.imported.length > 0) {
    console.log("\nNext: npx tsx scripts/run-resync.ts (regenerate and push to the watch).");
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
