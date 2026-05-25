// One-shot: Close the 1-week gap between Block 1 (ends 2026-06-22)
// and Block 2 (starts 2026-06-29) by shifting Phase 2-5 dates by -7 days.
// Gap is a leftover from the Illness-Shift in Sprint v1.5.
//
// Run: npx tsx scripts/close-block-gap.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";

const SHIFT_MS = 7 * 86400000; // 7 days in ms

async function main() {
  const user = await db.user.findFirst({ select: { id: true, email: true } });
  if (!user) {
    console.error("No user found");
    process.exit(1);
  }
  console.log("User:", user.email);

  const macro = await db.macrocycle.findFirst({
    where: { userId: user.id, status: "active" },
    include: {
      phases: {
        orderBy: { blockNumber: "asc" },
        include: { weeklyPlans: { orderBy: { weekNumber: "asc" } } },
      },
    },
  });
  if (!macro) {
    console.error("No active macrocycle");
    process.exit(1);
  }

  console.log(`\nMacrocycle: ${macro.id}`);
  console.log(`  start: ${macro.startDate.toISOString().slice(0, 10)}`);
  console.log(`  end:   ${macro.endDate.toISOString().slice(0, 10)}`);
  console.log(`  totalWeeks: ${macro.totalWeeks}`);

  // Show current phase dates
  console.log("\nBefore shift:");
  for (const p of macro.phases) {
    console.log(
      `  Block ${p.blockNumber}: ${p.startDate.toISOString().slice(0, 10)} → ${p.plannedEndDate.toISOString().slice(0, 10)} (${p.weeklyPlans.length} weekly plans)`,
    );
  }

  // Check Block 1→2 gap
  const block1 = macro.phases.find((p) => p.blockNumber === 1);
  const block2 = macro.phases.find((p) => p.blockNumber === 2);
  if (!block1 || !block2) {
    console.error("Block 1 or 2 not found");
    process.exit(1);
  }

  const gapMs = block2.startDate.getTime() - block1.plannedEndDate.getTime();
  const gapDays = Math.round(gapMs / 86400000);
  console.log(
    `\nGap between Block 1 end and Block 2 start: ${gapDays} day(s)`,
  );

  if (gapDays <= 0) {
    console.log("No gap — blocks are already back-to-back. Nothing to do.");
    await db.$disconnect();
    return;
  }

  // Shift Phase 2+ by -7 days (or by the exact gap size)
  const shiftMs = Math.min(SHIFT_MS, gapMs); // don't overshoot
  const shiftDays = Math.round(shiftMs / 86400000);
  console.log(`\nShifting Phase 2+ by -${shiftDays} days...`);

  const phasesToShift = macro.phases.filter((p) => p.blockNumber >= 2);

  for (const p of phasesToShift) {
    const newStart = new Date(p.startDate.getTime() - shiftMs);
    const newEnd = new Date(p.plannedEndDate.getTime() - shiftMs);

    await db.phase.update({
      where: { id: p.id },
      data: {
        startDate: newStart,
        plannedEndDate: newEnd,
      },
    });
    console.log(
      `  Block ${p.blockNumber}: ${newStart.toISOString().slice(0, 10)} → ${newEnd.toISOString().slice(0, 10)}`,
    );

    // Shift WeeklyPlan rows
    for (const wp of p.weeklyPlans) {
      await db.weeklyPlan.update({
        where: { id: wp.id },
        data: {
          startDate: new Date(wp.startDate.getTime() - shiftMs),
          endDate: new Date(wp.endDate.getTime() - shiftMs),
        },
      });
    }
    console.log(`    Shifted ${p.weeklyPlans.length} WeeklyPlan rows`);
  }

  // Update macrocycle end date and totalWeeks
  const newMacroEnd = new Date(macro.endDate.getTime() - shiftMs);
  const weeksReduced = Math.round(shiftMs / (7 * 86400000));
  await db.macrocycle.update({
    where: { id: macro.id },
    data: {
      endDate: newMacroEnd,
      totalWeeks: macro.totalWeeks - weeksReduced,
    },
  });
  console.log(
    `\nMacrocycle updated: end=${newMacroEnd.toISOString().slice(0, 10)}, totalWeeks=${macro.totalWeeks - weeksReduced}`,
  );

  // Materialize workout rows for the shifted phases
  const earliestShifted = phasesToShift[0];
  if (earliestShifted) {
    const from = new Date(earliestShifted.startDate.getTime() - shiftMs);
    console.log(
      `\nMaterializing workouts from ${from.toISOString().slice(0, 10)}...`,
    );
    const result = await materializeWorkouts(user.id, from);
    console.log(
      `  Created: ${result.created}, Updated: ${result.updated}, Deleted: ${result.deleted}`,
    );
  }

  // Verify
  const updated = await db.phase.findMany({
    where: { macrocycleId: macro.id },
    orderBy: { blockNumber: "asc" },
  });
  console.log("\nAfter shift:");
  for (const p of updated) {
    console.log(
      `  Block ${p.blockNumber}: ${p.startDate.toISOString().slice(0, 10)} → ${p.plannedEndDate.toISOString().slice(0, 10)}`,
    );
  }

  await db.$disconnect();
  console.log("\nDone ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
