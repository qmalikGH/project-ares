// Import completed sessions from Garmin — Sprint 2.9.
//
// The same code the nightly cron runs, driven by hand over a chosen window.
// Used to backfill sessions the athlete trained but never logged.
//
// Dry-run by default (convention: scripts/purge-stale-garmin.ts).
//
//   npx tsx scripts/import-sessions.ts --days=21
//   npx tsx scripts/import-sessions.ts --days=21 --apply
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { userTodayForUser } from "@/lib/date";
import { listActivitiesForDate } from "@/lib/garmin/activities";
import { matchSessionToActivity } from "@/lib/garmin/match";
import { autoImportRecent } from "@/lib/garmin/auto-import";
import type { SessionType } from "@/lib/coach-engine/types";

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Math.max(1, Math.min(90, Number(daysArg.slice(7)) || 7)) : 7;

async function main() {
  const settings = await db.userSettings.findFirst({ select: { userId: true } });
  if (!settings) {
    console.error("No user found");
    process.exit(1);
  }
  const userId = settings.userId;
  const today = await userTodayForUser(userId);
  const end = new Date(today.getTime() - 86400000); // never the running day

  console.log(APPLY ? "MODE: APPLY (writes)" : "MODE: DRY RUN (pass --apply to write)");
  console.log(`Window: ${DAYS} days back from ${end.toISOString().slice(0, 10)}\n`);

  if (APPLY) {
    const r = await autoImportRecent(userId, end, DAYS);
    for (const i of r.imported) console.log(`  ✓ ${i.date} ${i.type} ← activity ${i.activityId} (${i.durationActualMin} min)`);
    for (const n of r.needsConfirmation) console.log(`  ? ${n.date} ${n.type} — ${n.reason}`);
    for (const e of r.errors) console.log(`  ✗ ${e}`);
    console.log(`\nImported ${r.imported.length}, needs confirmation ${r.needsConfirmation.length}, errors ${r.errors.length}`);
    await db.$disconnect();
    return;
  }

  // Dry run: same matching, no writes.
  let wouldImport = 0;
  let needsConfirm = 0;
  for (let i = 0; i < DAYS; i++) {
    const day = new Date(end.getTime() - i * 86400000);
    const dayStr = day.toISOString().slice(0, 10);
    const workouts = await db.workout.findMany({
      where: { userId, date: day, status: "planned" },
      select: { id: true, type: true, garminWorkoutId: true },
    });
    if (workouts.length === 0) continue;

    let activities;
    try {
      activities = await listActivitiesForDate(day);
    } catch (e) {
      console.log(`  ✗ ${dayStr}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (activities.length === 0) continue;

    for (const w of workouts) {
      const m = matchSessionToActivity(w.type as SessionType, activities, w.garminWorkoutId);
      if (m.status === "EXACT_MATCH" && m.bestMatch) {
        wouldImport++;
        console.log(
          `  ✓ ${dayStr} ${w.type.padEnd(14)} would import activity ${m.bestMatch.activityId} ` +
          `(${Math.round(m.bestMatch.durationSec / 60)} min, "${m.bestMatch.activityName}")`,
        );
      } else if (m.status === "AUTO_MATCH" || m.status === "PICKER_NEEDED") {
        needsConfirm++;
        console.log(
          `  ? ${dayStr} ${w.type.padEnd(14)} ${m.status} — ${m.candidates.length} candidate(s), no id link`,
        );
      }
    }
  }

  console.log(`\nWould import ${wouldImport}, needs confirmation ${needsConfirm}.`);
  console.log("DRY RUN — nothing written. Re-run with --apply.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
