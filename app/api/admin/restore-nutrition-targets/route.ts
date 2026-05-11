// POST /api/admin/restore-nutrition-targets
// One-time fix: set exact coaching-determined calorie targets, rebuild
// slots via backward computation, and log as CoachingLog entries so
// future auto-calibration respects them.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { db } from "@/lib/db/client";
import type { DayTypeTargets } from "@/lib/nutrition/day-type";
import { buildSlotsForTargets } from "@/lib/nutrition/template";
import type { DayType } from "@/lib/nutrition/types";

const COACHING_TARGETS: Record<DayType, Omit<DayTypeTargets, "tdeeEstimate">> = {
  strength_run: { calorieTarget: 3026, proteinG: 190, carbsG: 409, fatG: 70 },
  threshold: { calorieTarget: 2439, proteinG: 190, carbsG: 262, fatG: 70 },
  long_run: { calorieTarget: 2668, proteinG: 190, carbsG: 320, fatG: 70 },
  rest: { calorieTarget: 1900, proteinG: 190, carbsG: 128, fatG: 70 },
};

export async function POST() {
  const userId = await getCurrentUserId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plan: any = await db.mealPlan.findFirst({
    where: { userId, status: "active" },
    select: { id: true, deficitKcal: true },
  });
  if (!plan) {
    return NextResponse.json({ error: "No active meal plan" }, { status: 404 });
  }

  const results: {
    dayType: string;
    tdeeEstimate: number;
    calorieTarget: number;
    slotSum: number;
  }[] = [];

  for (const [dayType, macros] of Object.entries(COACHING_TARGETS) as [DayType, typeof COACHING_TARGETS[DayType]][]) {
    const tdeeEstimate = macros.calorieTarget + plan.deficitKcal;
    const targets: DayTypeTargets = { tdeeEstimate, ...macros };

    // Rebuild slots from the coaching-determined targets
    const slots = buildSlotsForTargets(dayType, targets);

    // Compute slot sum for verification
    let slotSum = 0;
    for (const slot of Object.values(slots)) {
      for (const item of slot.items) slotSum += item.kcal;
    }

    // Update DayPlan rows
    const dayPlans = await db.dayPlan.findMany({
      where: { mealPlanId: plan.id, dayType },
      select: { id: true },
    });
    for (const dp of dayPlans) {
      await db.dayPlan.update({
        where: { id: dp.id },
        data: {
          tdeeEstimate,
          calorieTarget: macros.calorieTarget,
          proteinG: macros.proteinG,
          carbsG: macros.carbsG,
          fatG: macros.fatG,
          slots: slots as unknown as object,
        },
      });
    }

    // Log as coaching override so auto-calibration respects it
    await db.coachingLog.create({
      data: {
        userId,
        action: "updateCalorieTargets",
        data: { dayType, ...macros } as unknown as object,
        reason: "Restore coaching-determined targets for Block 1 (post-illness correction)",
      },
    });

    results.push({
      dayType,
      tdeeEstimate,
      calorieTarget: macros.calorieTarget,
      slotSum: Math.round(slotSum),
    });
  }

  return NextResponse.json({ status: "OK", mealPlanId: plan.id, results });
}
