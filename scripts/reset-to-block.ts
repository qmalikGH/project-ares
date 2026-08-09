// Reset the training plan back to the start of a given Block.
//
//   npx tsx scripts/reset-to-block.ts --block=2              # dry run (default)
//   npx tsx scripts/reset-to-block.ts --block=2 --apply      # execute
//
// Flags:
//   --block=N        Block to re-run (1-5). Required.
//   --load=W1|W2     W1 = full ramp-up, W2 = W1 volume + W2 loads. Default W2.
//   --apply          Actually write. Without it nothing is modified.
//   --skip-garmin    Do not re-sync the watch afterwards.
//   --no-backup      Skip the JSON backup (not recommended).
//
// On --apply the script always takes a JSON backup of the macrocycle, its
// phases, all WeeklyPlan rows and every future Workout row FIRST, into
// ./backups/. The reset itself uses deleteMany and is not otherwise reversible.
//
// Two phases run back to back, because resetBlock leaves the new weeks empty:
//   1. resetBlock       — re-date the blocks, create 4 fresh WeeklyPlan rows
//   2. regenerate       — fill plannedSessions, materialize Workouts, re-sync Garmin
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db/client";
import { getNextMonday, userToday } from "@/lib/date";
import { handleCoachingAction } from "@/lib/coaching-update/handle-action";
import { regenerateFuturePlans } from "@/lib/coach-engine/regenerate";

const iso = (d: Date) => d.toISOString().slice(0, 10);

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const blockRaw = arg("block");
  const block = blockRaw ? Number(blockRaw) : NaN;
  if (!Number.isInteger(block) || block < 1 || block > 5) {
    console.error("Usage: npx tsx scripts/reset-to-block.ts --block=<1-5> [--apply] [--load=W1|W2]");
    process.exit(1);
  }

  const load = (arg("load") ?? "W2").toUpperCase();
  if (load !== "W1" && load !== "W2") {
    console.error(`--load must be W1 or W2, got "${load}"`);
    process.exit(1);
  }

  const apply = has("apply");
  const skipGarmin = has("skip-garmin");

  const user = await db.user.findFirst({ select: { id: true, email: true } });
  if (!user) {
    console.error("No user found");
    process.exit(1);
  }

  const today = userToday();
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const start = getNextMonday(today);
  const daysOut = Math.round((start.getTime() - today.getTime()) / 86400000);

  console.log(`User:   ${user.email}`);
  console.log(`Today:  ${iso(today)} (${WEEKDAYS[today.getUTCDay()]})`);
  console.log(`Target: Block ${block}   load=${load}   mode=${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Start:  ${iso(start)} — ${daysOut} day(s) from now`);

  // getNextMonday never returns `from` itself, so running this ON a Monday
  // pushes the restart a full week out. Easy to do by accident when the plan
  // was "start again on Monday".
  if (today.getUTCDay() === 1) {
    console.log(
      `\n  !! Today is Monday. The new block would start ${iso(start)}, a week out,\n` +
        `     not today. Run this the day before the intended start.`,
    );
  }

  // ── Backup ───────────────────────────────────────────────────────────────
  if (apply && !has("no-backup")) {
    const macro = await db.macrocycle.findFirst({
      where: { userId: user.id, status: "active" },
      include: { phases: { include: { weeklyPlans: true } } },
    });
    const workouts = await db.workout.findMany({
      where: { userId: user.id, date: { gte: today } },
    });
    mkdirSync("backups", { recursive: true });
    const file = `backups/pre-reset-block${block}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify({ macro, workouts }, null, 2));
    console.log(`\nBackup written: ${file}`);
    console.log(`  phases=${macro?.phases.length ?? 0}  futureWorkouts=${workouts.length}`);
  }

  // ── Phase 1: reset ───────────────────────────────────────────────────────
  console.log(`\n─── Phase 1: resetBlock ───`);
  const reset = await handleCoachingAction(
    user.id,
    "resetBlock",
    { loadPreset: load, targetBlockNumber: block, dryRun: !apply },
    `manual reset to block ${block} after layoff`,
  );

  if (!reset.success) {
    console.error(`  FAILED: ${reset.error}`);
    if (reset.details) console.error(`  ${JSON.stringify(reset.details)}`);
    await db.$disconnect();
    process.exit(1);
  }
  console.log(JSON.stringify(reset.details, null, 2));

  if (!apply) {
    console.log(
      `\n─── Phase 2: regenerate (skipped in dry run) ───\n` +
        `Would regenerate plannedSessions for every WeeklyPlan ending after today,\n` +
        `materialize Workout rows and re-sync Garmin.\n\n` +
        `Nothing was modified. Re-run with --apply to execute.`,
    );
    await db.$disconnect();
    return;
  }

  // ── Phase 2: regenerate ──────────────────────────────────────────────────
  // Mandatory: resetBlock wrote `plannedSessions: []`, so without this the
  // athlete is left with four empty weeks.
  console.log(`\n─── Phase 2: regenerate ───`);
  const regen = await regenerateFuturePlans(user.id, today, { skipGarmin });
  console.log(`  regenerated WeeklyPlans: ${regen.regenerated}`);
  console.log(
    `  materialized Workouts:  created=${regen.materialized.created} ` +
      `updated=${regen.materialized.updated} deleted=${regen.materialized.deleted}`,
  );
  console.log(
    `  Garmin: considered=${regen.garminResync.considered} ` +
      `removed=${regen.garminResync.removed} repushed=${regen.garminResync.repushed}`,
  );
  if (regen.garminResync.errors.length > 0) {
    console.log(`  Garmin errors: ${regen.garminResync.errors.join("; ")}`);
  }

  // ── Verify ───────────────────────────────────────────────────────────────
  console.log(`\n─── Result ───`);
  const after = await db.macrocycle.findFirst({
    where: { userId: user.id, status: "active" },
    include: {
      phases: {
        orderBy: { blockNumber: "asc" },
        include: { weeklyPlans: { orderBy: { startDate: "asc" } } },
      },
    },
  });
  for (const p of after?.phases ?? []) {
    const empty = p.weeklyPlans.filter(
      (w) => !Array.isArray(w.plannedSessions) || (w.plannedSessions as unknown[]).length === 0,
    ).length;
    console.log(
      `  Block ${p.blockNumber}  ${iso(p.startDate)} → ${iso(p.plannedEndDate)}` +
        `  weeks=${p.weeklyPlans.length}  status=${p.status}` +
        (empty > 0 ? `  EMPTY WEEKS: ${empty}` : ""),
    );
  }

  await db.$disconnect();
  console.log(`\nDone. Verify in the app, then re-run scripts/inspect-plan-state.ts if anything looks off.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
