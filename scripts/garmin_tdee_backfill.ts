// scripts/garmin_tdee_backfill.ts
//
// Pulls totalKilocalories / activeKilocalories / bmrKilocalories (plus
// bodyBatteryEnd + averageStress, same endpoint) from Garmin Connect for a range
// of days and writes them onto DailySensorData.
//
// Sprint 2.8 rework. The original had two defects that between them wrote
// permanent nonsense into production:
//
//   1. It walked through TODAY INCLUSIVE. These are cumulative day totals, so a
//      mid-morning run captured ~45 % of a day — that is where 2026-08-10's
//      impossible BMR of 847 came from (a full day is ~1890).
//   2. It skipped any row that already had a value AND re-asserted the old value
//      on the write path (`existing.x ?? fetched`). So the partial value it had
//      just written could never be corrected — not by this script, not by
//      anything.
//
// Now: the current day is never touched, and --force lets an operator replace a
// value that is known to be wrong.
//
// Usage:
//   npx tsx scripts/garmin_tdee_backfill.ts                        # dry run, full range
//   npx tsx scripts/garmin_tdee_backfill.ts --from=2026-08-10 --to=2026-08-11 --force
//   npx tsx scripts/garmin_tdee_backfill.ts --from=2026-08-10 --to=2026-08-11 --force --apply
//
// Dry-run by default (convention: scripts/purge-stale-garmin.ts).
//
// Rate limiting: 1.5s delay between requests to stay under Garmin's
// undocumented rate limits (~60 req/min observed ceiling).

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getGarminClient } from "@/lib/garmin/client";
import { userTodayForUser } from "@/lib/date";
import { mergeEnergyColumns } from "@/lib/garmin/persist";
import { TDEE_PLAUSIBILITY_FLOOR } from "@/lib/nutrition/constants";

const GC_API = "https://connectapi.garmin.com";
const DEFAULT_START = new Date("2026-04-27T00:00:00.000Z");
const DELAY_MS = 1500;

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

function argValue(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UserSummary {
  totalKilocalories?: number;
  activeKilocalories?: number;
  bmrKilocalories?: number;
  bodyBatteryMostRecentValue?: number;
  averageStressLevel?: number;
}

async function main() {
  const userId = await getCurrentUserId();
  console.log(`User: ${userId}`);
  console.log(APPLY ? "MODE: APPLY (writes)" : "MODE: DRY RUN (pass --apply to write)");
  if (FORCE) console.log("FORCE: existing values will be replaced");

  const client = (await getGarminClient()) as unknown as {
    get<T>(url: string): Promise<T>;
    getUserProfile(): Promise<{ displayName?: string }>;
  };
  const profile = await client.getUserProfile();
  const displayName = profile?.displayName ?? process.env.GARMIN_DISPLAY_NAME;
  if (!displayName) {
    throw new Error("Could not get Garmin displayName — check credentials");
  }
  console.log(`Garmin profile: ${displayName}`);

  // ── Date range ──
  // The current day is EXCLUDED: these are cumulative totals, so today's value
  // is a fraction of a day, not a measurement.
  const today = await userTodayForUser(userId);
  const fromArg = argValue("from");
  const toArg = argValue("to");
  const start = fromArg ? new Date(`${fromArg}T00:00:00.000Z`) : DEFAULT_START;
  const requestedEnd = toArg ? new Date(`${toArg}T00:00:00.000Z`) : new Date(today.getTime() - 86400000);
  const end = requestedEnd.getTime() >= today.getTime()
    ? new Date(today.getTime() - 86400000)
    : requestedEnd;

  if (toArg && end.getTime() !== requestedEnd.getTime()) {
    console.log(`NOTE: --to=${toArg} clamped to ${formatDate(end)} — the current day is never written.`);
  }
  if (end < start) {
    console.log("Nothing to do — the range is empty once the current day is excluded.");
    await db.$disconnect();
    return;
  }

  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  console.log(`Range: ${formatDate(start)} → ${formatDate(end)} (${totalDays} days)\n`);

  let written = 0;
  let skippedExisting = 0;
  let noGarminData = 0;
  let errors = 0;
  let implausible = 0;

  const current = new Date(start);
  while (current <= end) {
    const dateStr = formatDate(current);
    const dateKey = new Date(dateStr + "T00:00:00.000Z");

    const existing = await db.dailySensorData.findFirst({ where: { userId, date: dateKey } });

    if (!FORCE && existing?.totalKilocalories != null) {
      skippedExisting++;
      console.log(`  ${dateStr}: ✓ already has data (${existing.totalKilocalories} kcal) — use --force to replace`);
      current.setUTCDate(current.getUTCDate() + 1);
      continue;
    }

    try {
      const url = `${GC_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${dateStr}`;
      const summary = await client.get<UserSummary>(url);

      const num = (v: unknown) => (typeof v === "number" ? Math.round(v) : null);
      const fetched = {
        totalKilocalories: num(summary?.totalKilocalories),
        activeKilocalories: num(summary?.activeKilocalories),
        bmrKilocalories: num(summary?.bmrKilocalories),
        bodyBatteryEnd: num(summary?.bodyBatteryMostRecentValue),
        averageStress:
          typeof summary?.averageStressLevel === "number" && summary.averageStressLevel >= 0
            ? summary.averageStressLevel
            : null,
      };

      if (fetched.totalKilocalories == null) {
        noGarminData++;
        console.log(`  ${dateStr}: — no TDEE data from Garmin`);
        current.setUTCDate(current.getUTCDate() + 1);
        await sleep(DELAY_MS);
        continue;
      }

      // Warn, don't refuse: an operator repairing a known-bad day should see
      // that the replacement is also suspicious rather than be blocked by it.
      if (fetched.totalKilocalories < TDEE_PLAUSIBILITY_FLOOR) {
        implausible++;
        console.log(`  ${dateStr}: ⚠ fetched total ${fetched.totalKilocalories} is below the plausibility floor ${TDEE_PLAUSIBILITY_FLOOR}`);
      }

      const { patch } = mergeEnergyColumns(existing, fetched, { force: FORCE });
      if (Object.keys(patch).length === 0) {
        skippedExisting++;
        console.log(`  ${dateStr}: nothing to write`);
        current.setUTCDate(current.getUTCDate() + 1);
        await sleep(DELAY_MS);
        continue;
      }

      const diff = Object.entries(patch)
        .map(([k, v]) => `${k} ${existing?.[k as keyof typeof existing] ?? "—"} → ${v}`)
        .join(", ");
      console.log(`  ${dateStr}: ${APPLY ? "✓ written" : "would write"} — ${diff}`);

      if (APPLY) {
        if (existing) {
          await db.dailySensorData.update({ where: { id: existing.id }, data: patch });
        } else {
          await db.dailySensorData.create({ data: { userId, date: dateKey, ...patch } });
        }
      }
      written++;
    } catch (e) {
      errors++;
      console.error(`  ${dateStr}: ✗ ERROR — ${e instanceof Error ? e.message : String(e)}`);
    }

    await sleep(DELAY_MS);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  console.log("\n══════════════════════════════════════");
  console.log(`${APPLY ? "Written" : "Would write"}:  ${written} days`);
  console.log(`Skipped (had data): ${skippedExisting} days`);
  console.log(`No Garmin data:     ${noGarminData} days`);
  console.log(`Implausible totals: ${implausible}`);
  console.log(`Errors:             ${errors}`);
  console.log("══════════════════════════════════════");
  if (!APPLY) console.log("\nDRY RUN — nothing was written. Re-run with --apply.");

  await db.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
