// Regenerate plans → materialize Workout rows → resync to Garmin. Run locally
// with the merged code so the watch gets the new plan without waiting on the
// Vercel deploy. (Sprint 2.2 post-merge, reused after every plan change.)
//
// Sprint 3.3: prints what the run progression decided per week (cap, threshold
// rung, test week), materializes the whole horizon, takes orphaned rows off the
// watch before deleting them, and pushes only this week + next (the window the
// nightly cron keeps current). After any DATE shift still run
// purge-stale-garmin.ts --all first.
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";
import { pushWindowEnd, removeWorkoutFromGarmin, resyncFutureWorkoutsToGarmin } from "@/lib/garmin/workout-sync";

const LADDER = ["2×10", "3×8", "3×10", "2×15"];
/** Comfortably past the planning horizon. */
const HORIZON_DAYS = 400;

async function main() {
  const u = await db.user.findFirst({ select: { id: true, email: true } });
  if (!u) { console.error("no user"); process.exit(1); }
  console.log("user:", u.email);
  const today0 = userToday();
  console.log("today:", today0.toISOString().slice(0, 10));

  console.log("\n1) regeneratePlansFromNow (cap + ladder + test week, shin/RHR gate, comeback ramp)…");
  const regen = await regeneratePlansFromNow(u.id);
  console.log("   regenerated weeks:", regen.regenerated);
  console.log(`   gate: ${regen.gate} (${regen.gateReason})`);
  console.log(
    `   layoff: active=${regen.layoff.active} gapDays=${regen.layoff.gapDays}` +
      ` restartWeek=${regen.layoff.restartWeekStart?.toISOString().slice(0, 10) ?? "—"}`,
  );
  for (const p of regen.progression) {
    console.log(
      `   ${p.weekStart}  cap ${String(p.capMin).padStart(3)} min  ladder ${LADDER[p.thresholdIndex]}` +
        (p.timeTrial ? "  · 3-km-Test" : ""),
    );
  }

  // Whole horizon, so the app shows the regenerated plan everywhere.
  console.log("2) materializeWorkouts (whole horizon)…");
  const mat = await materializeWorkouts(u.id, today0, new Date(today0.getTime() + HORIZON_DAYS * 86400000), {
    removeFromGarmin: removeWorkoutFromGarmin,
  });
  console.log("   materialized:", JSON.stringify(mat));

  // The watch only gets the push window (this week + next); later pushes come off.
  const until = pushWindowEnd(today0);
  console.log(`3) resyncFutureWorkoutsToGarmin (bis ${until.toISOString().slice(0, 10)})…`);
  const resync = await resyncFutureWorkoutsToGarmin(u.id, today0, undefined, until);
  console.log("   resync:", JSON.stringify(resync));

  console.log("\n=== Verify: upcoming quality sessions in Workout rows ===");
  const qs = await db.workout.findMany({
    where: { userId: u.id, type: { in: ["threshold_run", "time_trial_5k"] }, date: { gte: today0 } },
    orderBy: { date: "asc" },
    take: 6,
    select: { date: true, type: true, plannedSession: true, garminWorkoutId: true },
  });
  for (const t of qs) {
    const s = t.plannedSession as { durationMin?: number; structure?: unknown } | null;
    console.log(
      `   ${t.date.toISOString().slice(0, 10)} ${t.type} dur=${s?.durationMin} ` +
        `garmin=${t.garminWorkoutId ? "yes" : "—"} structure=${JSON.stringify(s?.structure)}`,
    );
  }

  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
