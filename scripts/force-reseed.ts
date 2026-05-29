// Force-reseed: full deficit-sync path (Sprint v1.8 #6).
// Sets MealPlan.deficitKcal = DEFICIT_KCAL, overwrites DayTypeConfig from code
// constants, then runs the unified cascade which now syncs ALL 4 stores
// (DayTypeConfig, ComputedMealSlot, DayPlan, MealPlan.deficitKcal).
// Run: npx tsx scripts/force-reseed.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { forceReseedDayTypeConfigs } from "@/lib/nutrition/seed-day-type-configs";
import { cascadeNutritionUpdate } from "@/lib/nutrition/cascade";
import { DEFICIT_KCAL } from "@/lib/nutrition/constants";

async function main() {
  const plan = await db.mealPlan.findFirst({
    where: { status: "active" },
    select: { id: true, deficitKcal: true },
  });

  if (!plan) {
    console.error("No active meal plan found");
    process.exit(1);
  }

  console.log("Plan ID:", plan.id, "| deficitKcal", plan.deficitKcal, "->", DEFICIT_KCAL);

  // 1) deficitKcal is the source of truth — align it to the code constant.
  await db.mealPlan.update({
    where: { id: plan.id },
    data: { deficitKcal: DEFICIT_KCAL },
  });

  // 2) Overwrite DayTypeConfig rows from code constants (calorieTarget = tdee − DEFICIT_KCAL).
  const updated = await forceReseedDayTypeConfigs(plan.id);
  console.log("Reseeded day types:", updated.join(", "));

  // 3) Unified cascade — recomputes ComputedMealSlot AND DayPlan rows.
  const res = await cascadeNutritionUpdate(plan.id, "seed", "v1.8 force-reseed: deficit sync across all 4 stores");
  console.log("Cascade:", res.success ? "OK" : `FAILED: ${res.errors.join("; ")}`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
