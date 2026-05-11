// POST /api/admin/resync-nutrition
// One-time migration: re-compute all DayPlan slot data from the new
// budget-driven template (post architecture fix). Overwrites the old
// hardcoded slots with backward-computed portions that match calorieTarget.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { db } from "@/lib/db/client";
import { templateDayPlan, sumSlotMacros } from "@/lib/nutrition/template";
import type { DayType } from "@/lib/nutrition/types";

const VALID_DAY_TYPES: DayType[] = ["strength_run", "threshold", "long_run", "rest"];

export async function POST() {
  const userId = await getCurrentUserId();

  // Find the active meal plan with all day plans
  const activePlan = await db.mealPlan.findFirst({
    where: { userId, status: "active" },
    include: { dayPlans: true },
  });

  if (!activePlan) {
    return NextResponse.json({ error: "No active meal plan" }, { status: 404 });
  }

  const results: { dayType: string; oldKcal: number; newKcal: number; target: number }[] = [];

  for (const dp of activePlan.dayPlans) {
    if (!VALID_DAY_TYPES.includes(dp.dayType as DayType)) continue;

    const template = templateDayPlan(dp.dayType as DayType);
    const newTotals = sumSlotMacros(template.slots);

    // Compute old kcal from existing slots for comparison
    let oldKcal = 0;
    const oldSlots = dp.slots as Record<string, { items?: { kcal?: number }[] }>;
    if (oldSlots && typeof oldSlots === "object") {
      for (const slot of Object.values(oldSlots)) {
        if (slot?.items && Array.isArray(slot.items)) {
          for (const item of slot.items) {
            oldKcal += item.kcal ?? 0;
          }
        }
      }
    }

    await db.dayPlan.update({
      where: { id: dp.id },
      data: {
        tdeeEstimate: template.tdeeEstimate,
        calorieTarget: template.calorieTarget,
        proteinG: template.proteinG,
        carbsG: template.carbsG,
        fatG: template.fatG,
        slots: template.slots as unknown as object,
      },
    });

    results.push({
      dayType: dp.dayType,
      oldKcal: Math.round(oldKcal),
      newKcal: newTotals.kcal,
      target: template.calorieTarget,
    });
  }

  return NextResponse.json({
    status: "OK",
    mealPlanId: activePlan.id,
    updated: results,
  });
}
