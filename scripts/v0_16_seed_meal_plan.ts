// scripts/v0_16_seed_meal_plan.ts
//
// Sprint v0.16 Phase B10.1 — seed Q's first MealPlan + 4 DayPlans.
//
// Usage:
//   npx tsx scripts/v0_16_seed_meal_plan.ts
//
// Behavior:
//   - If an active MealPlan already exists for Q, refuses (use the coaching
//     update endpoint to modify it). Pass --force to archive the existing
//     plan and seed a new one.
//   - Otherwise creates one MealPlan ("Block 1 Standard") plus 4 DayPlans
//     (strength_run, threshold, long_run, rest) populated from the
//     templates in lib/nutrition/template.ts.
//
// Pre-req: `npx prisma migrate dev` must have applied the v0.16 nutrition
// migration (MealPlan / DayPlan / DailyNutritionLog).

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { templateDayPlan } from "@/lib/nutrition/template";
import type { DayType } from "@/lib/nutrition/types";

const FORCE = process.argv.includes("--force");

const DAY_TYPES: DayType[] = ["strength_run", "threshold", "long_run", "rest"];

async function main() {
  const userId = await getCurrentUserId();
  console.log(`[seed] userId = ${userId}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing: any = await db.mealPlan.findFirst({
    where: { userId, status: "active" },
  });
  if (existing) {
    if (!FORCE) {
      console.error(
        `[abort] An active MealPlan already exists (${existing.id}). ` +
          `Re-run with --force to archive it and seed a new one.`,
      );
      process.exit(1);
    }
    console.log(`[seed] archiving existing plan ${existing.id}`);
    await db.mealPlan.update({
      where: { id: existing.id },
      data: { status: "archived" },
    });
  }

  const plan = await db.mealPlan.create({
    data: {
      userId,
      name: "Block 1 Standard",
      status: "active",
      budgetPerDay: 15.0,
      proteinTarget: 190,
      deficitKcal: 500,
      calibrationStatus: "pending",
    },
  });
  console.log(`[ok]   MealPlan created: ${plan.id}`);

  for (const dayType of DAY_TYPES) {
    const template = templateDayPlan(dayType);
    const dp = await db.dayPlan.create({
      data: {
        mealPlanId: plan.id,
        dayType,
        tdeeEstimate: template.tdeeEstimate,
        calorieTarget: template.calorieTarget,
        proteinG: template.proteinG,
        carbsG: template.carbsG,
        fatG: template.fatG,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        slots: template.slots as any,
      },
    });
    console.log(
      `[ok]   DayPlan ${dayType} created: ${dp.id} (target ${template.calorieTarget} kcal, ${template.proteinG}P/${template.carbsG}C/${template.fatG}F)`,
    );
  }

  console.log("\n[done] Seed complete. Visit /nutrition to see the active plan.");
  await db.$disconnect();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
