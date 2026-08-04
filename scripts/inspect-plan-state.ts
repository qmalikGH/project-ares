// Read-only snapshot of the training-plan state.
//
// Writes NOTHING. Run this before any block reset so the reset is decided
// against real data instead of assumptions:
//
//   npx tsx scripts/inspect-plan-state.ts
//
// Prints: the active macrocycle, every Phase with its date range (marking
// which one contains today), the WeeklyPlan rows per phase, Workout rows by
// status per block, Garmin push state, the newest ExerciseLog entries (these
// drive inter-block progressive overload) and the active MealPlan.
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const user = await db.user.findFirst({ select: { id: true, email: true } });
  if (!user) {
    console.error("No user found");
    process.exit(1);
  }

  const today = userToday();
  console.log(`User:  ${user.email}`);
  console.log(`Today: ${iso(today)} (userToday, timezone-adjusted)`);

  const macro = await db.macrocycle.findFirst({
    where: { userId: user.id, status: "active" },
    include: {
      phases: {
        orderBy: { blockNumber: "asc" },
        include: { weeklyPlans: { orderBy: { startDate: "asc" } } },
      },
    },
  });
  if (!macro) {
    console.error("No active macrocycle");
    process.exit(1);
  }

  console.log(`\n─── Macrocycle ${macro.id} ───`);
  console.log(`  ${iso(macro.startDate)} → ${iso(macro.endDate)}`);
  console.log(`  totalWeeks=${macro.totalWeeks}  status=${macro.status}  focusMode=${macro.focusMode}`);

  console.log(`\n─── Phases ───`);
  for (const p of macro.phases) {
    const containsToday = p.startDate <= today && p.plannedEndDate > today;
    const marker = containsToday ? "  <<< TODAY IS HERE" : "";
    console.log(
      `  Block ${p.blockNumber}  ${iso(p.startDate)} → ${iso(p.plannedEndDate)}` +
        `  weeks=${p.durationWeeks}  status=${p.status}` +
        `  review=${p.blockReviewId ? "yes" : "no"}${marker}`,
    );
    console.log(`    name=${p.name}`);
    if (p.actualEndDate) console.log(`    actualEndDate=${iso(p.actualEndDate)}`);
    for (const wp of p.weeklyPlans) {
      const n = Array.isArray(wp.plannedSessions)
        ? (wp.plannedSessions as unknown[]).length
        : 0;
      const ovr = wp.loadOverrideWeek ? `  loadOverrideWeek=${wp.loadOverrideWeek}` : "";
      console.log(
        `      W${wp.weekNumber}  ${iso(wp.startDate)} → ${iso(wp.endDate)}  sessions=${n}${ovr}`,
      );
    }
    if (p.weeklyPlans.length === 0) console.log("      (no WeeklyPlan rows)");
  }

  // Gaps / overlaps between consecutive blocks — the thing close-block-gap.ts fixed once.
  console.log(`\n─── Block boundaries ───`);
  for (let i = 0; i < macro.phases.length - 1; i++) {
    const a = macro.phases[i];
    const b = macro.phases[i + 1];
    const days = Math.round(
      (b.startDate.getTime() - a.plannedEndDate.getTime()) / 86400000,
    );
    const label = days === 0 ? "back-to-back" : days > 0 ? `GAP ${days}d` : `OVERLAP ${-days}d`;
    console.log(`  Block ${a.blockNumber} → ${b.blockNumber}: ${label}`);
  }

  // Workout rows per block, split by status.
  console.log(`\n─── Workout rows per block ───`);
  for (const p of macro.phases) {
    const rows = await db.workout.groupBy({
      by: ["status"],
      where: {
        userId: user.id,
        date: { gte: p.startDate, lt: p.plannedEndDate },
      },
      _count: { _all: true },
    });
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    const detail = rows.map((r) => `${r.status}=${r._count._all}`).join("  ") || "none";
    console.log(`  Block ${p.blockNumber}: ${total} rows   ${detail}`);
  }

  // Anything materialized beyond the macrocycle window is a leftover.
  const strays = await db.workout.count({
    where: {
      userId: user.id,
      OR: [{ date: { lt: macro.startDate } }, { date: { gte: macro.endDate } }],
    },
  });
  console.log(`  Outside macrocycle window: ${strays} rows`);

  // Garmin push state for everything still in the future — these sit on the
  // watch and must be removed/re-pushed if the plan changes underneath them.
  const pushedFuture = await db.workout.findMany({
    where: {
      userId: user.id,
      date: { gte: today },
      garminScheduledWorkoutId: { not: null },
    },
    select: { date: true, type: true, garminPushStatus: true },
    orderBy: { date: "asc" },
  });
  console.log(`\n─── Garmin: pushed workouts from today onwards (${pushedFuture.length}) ───`);
  for (const w of pushedFuture.slice(0, 15)) {
    console.log(`  ${iso(w.date)}  ${w.type.padEnd(18)} ${w.garminPushStatus}`);
  }
  if (pushedFuture.length > 15) console.log(`  … +${pushedFuture.length - 15} more`);

  // Training recency — how long the break actually was.
  const lastCompleted = await db.workout.findFirst({
    where: { userId: user.id, status: "completed" },
    orderBy: { date: "desc" },
    select: { date: true, type: true },
  });
  console.log(`\n─── Recency ───`);
  if (lastCompleted) {
    const daysAgo = Math.round((today.getTime() - lastCompleted.date.getTime()) / 86400000);
    console.log(`  Last completed workout: ${iso(lastCompleted.date)} (${lastCompleted.type}) — ${daysAgo} days ago`);
  } else {
    console.log("  No completed workouts on record");
  }

  // ExerciseLog feeds inter-block progressive overload (strength-coach/block-transition.ts).
  const logs = await db.exerciseLog.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 10,
    select: { date: true, exerciseName: true, weightKg: true, repsCompleted: true, estimatedOneRM: true, weekInBlock: true },
  });
  console.log(`\n─── Newest ExerciseLog entries (drive next block's loads) ───`);
  for (const l of logs) {
    console.log(
      `  ${iso(l.date)}  ${l.exerciseName.padEnd(22)} ${l.weightKg}kg x${l.repsCompleted}` +
        `  e1RM=${l.estimatedOneRM.toFixed(1)}  weekInBlock=${l.weekInBlock ?? "-"}`,
    );
  }
  if (logs.length === 0) console.log("  (none)");

  const mealPlan = await db.mealPlan.findFirst({
    where: { userId: user.id, status: "active" },
    include: { dayPlans: { select: { dayType: true } } },
  });
  console.log(`\n─── Nutrition ───`);
  console.log(
    mealPlan
      ? `  Active MealPlan ${mealPlan.id} with ${mealPlan.dayPlans.length} DayPlans`
      : "  No active MealPlan",
  );

  const nutritionLogs = await db.dailyNutritionLog.count({ where: { userId: user.id } });
  console.log(`  DailyNutritionLog rows: ${nutritionLogs}`);

  await db.$disconnect();
  console.log("\nRead-only — nothing was modified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
