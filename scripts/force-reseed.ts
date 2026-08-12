// Force-reseed: full deficit-sync path (Sprint v1.8 #6, reworked in 2.7 A5).
//
// Writes MealPlan.deficitKcal at the deficit actually in force (taper /
// maintenance near goal weight), overwrites DayTypeConfig from code constants,
// clamps every target to its derived minimum, then runs the unified cascade
// which syncs ComputedMealSlot + DayPlan.
//
// This is the ONLY way a change to DEFICIT_KCAL reaches the live plan.
//
// Run: npx tsx scripts/force-reseed.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { reseedNutritionFromConstants } from "@/lib/nutrition/reseed";
import { DEFICIT_KCAL } from "@/lib/nutrition/constants";

async function main() {
  const plan = await db.mealPlan.findFirst({
    where: { status: "active" },
    select: { id: true, userId: true, deficitKcal: true },
  });

  if (!plan) {
    console.error("No active meal plan found");
    process.exit(1);
  }

  console.log("Plan ID:", plan.id, "| deficitKcal", plan.deficitKcal, "-> base", DEFICIT_KCAL);

  const res = await reseedNutritionFromConstants(
    plan.userId,
    plan.id,
    "Sprint 2.7 (A5) force-reseed: deficit sync across all stores",
  );

  console.log("Deficit applied:", res.deficitKcal, `(${res.deficitMode})`);
  console.log("  ", res.deficitReason);
  console.log("Reseeded day types:", res.updatedDayTypes.join(", "));
  for (const note of res.clampNotes) console.log("  clamp:", note);
  console.log("Cascade:", res.cascade.success ? "OK" : `FAILED: ${res.cascade.errors.join("; ")}`);

  await db.$disconnect();

  // Sprint 2.7: exit non-zero on failure. This used to exit 0 either way, so a
  // scripted rollout reported success on a complete no-op.
  if (!res.cascade.success) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
