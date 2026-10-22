// Removes every workout that is still only PLANNED but was already pushed to
// Garmin Connect. Run before any regenerate that SHIFTS DATES (restart after a
// break, block reset, horizon extension): otherwise the watch calendar keeps
// sessions on days the plan no longer has.
//
// WHY THIS MUST RUN BEFORE THE REGENERATE:
// materializeWorkouts() hard-deletes orphaned `planned` rows inside its window
// (lib/coach-engine/materialize.ts). Since Sprint 3.3 it can take them off the
// watch first, but only for the rows IT deletes. A date shift moves rows rather
// than deleting them, and the old Garmin schedule stays behind. So: unschedule
// first, regenerate later.
//
// Never touches completed / skipped / in_progress rows.
//
// Dry-run by default; pass --apply to write.
// Scope: --future (default, date >= today) | --past | --all
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";
import { removeWorkoutFromGarmin } from "@/lib/garmin/workout-sync";

const APPLY = process.argv.includes("--apply");
const SCOPE = process.argv.includes("--all")
  ? "all"
  : process.argv.includes("--past")
    ? "past"
    : "future";

async function main() {
  const u = await db.user.findFirst({ select: { id: true, email: true } });
  if (!u) { console.error("no user"); process.exit(1); }
  const today0 = userToday();
  console.log(`user: ${u.email} | today: ${today0.toISOString().slice(0, 10)}`);
  console.log(`scope: ${SCOPE} | mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const dateFilter =
    SCOPE === "future" ? { gte: today0 } : SCOPE === "past" ? { lt: today0 } : undefined;

  const rows = await db.workout.findMany({
    where: {
      userId: u.id,
      status: "planned",
      garminWorkoutId: { not: null },
      ...(dateFilter ? { date: dateFilter } : {}),
    },
    orderBy: { date: "asc" },
    select: { id: true, date: true, type: true, garminWorkoutId: true, garminScheduledWorkoutId: true },
  });

  console.log(`\n=== ${rows.length} pushed-but-unfinished workouts ===`);
  for (const w of rows) {
    console.log(
      `${w.date.toISOString().slice(0, 10)} ${w.type.padEnd(18)} garminWorkoutId=${w.garminWorkoutId}`,
    );
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — nothing removed. Re-run with --apply to commit.");
    await db.$disconnect();
    return;
  }

  let removed = 0;
  const errors: string[] = [];
  for (const w of rows) {
    try {
      const res = await removeWorkoutFromGarmin(w.id);
      if (res.removed) removed += 1;
      else errors.push(`${w.date.toISOString().slice(0, 10)} ${w.type}: not removed`);
    } catch (e) {
      errors.push(`${w.date.toISOString().slice(0, 10)} ${w.type}: ${(e as Error).message}`);
    }
  }
  console.log(`\nAPPLIED → removed from Garmin: ${removed}/${rows.length}`);
  if (errors.length) {
    console.log(`errors (${errors.length}):`);
    for (const e of errors) console.log(`  ${e}`);
  }

  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
