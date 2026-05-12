// Nutrition data integrity check — Sprint v1.1.
//
// Ensures DayTypeConfigs and ComputedMealSlots exist for the given plan.
// Auto-repairs missing data by seeding from code constants and cascading.
// Idempotent: multiple calls produce no writes if data is already consistent.
//
// Called lazily on the first nutrition API request after deployment.

import { db } from "@/lib/db/client";
import { cascadeNutritionUpdate } from "./cascade";
import { seedDayTypeConfigs, seedMissingDayTypeConfigs } from "./seed-day-type-configs";

const EXPECTED_DAY_TYPES = 4;

/**
 * Ensure the nutrition data for a plan is consistent.
 * Repairs missing DayTypeConfigs and ComputedMealSlots.
 */
export async function ensureNutritionIntegrity(planId: string): Promise<void> {
  // 1. Check DayTypeConfigs
  const configs = await db.dayTypeConfig.findMany({
    where: { planId },
    select: { dayType: true },
  });

  if (configs.length === 0) {
    await seedDayTypeConfigs(planId);
    await cascadeNutritionUpdate(planId, "seed", "Initial setup — integrity check");
    return;
  }

  if (configs.length < EXPECTED_DAY_TYPES) {
    const existingDayTypes = configs.map((c) => c.dayType);
    await seedMissingDayTypeConfigs(planId, existingDayTypes);
    await cascadeNutritionUpdate(planId, "seed", "Missing day types repaired — integrity check");
    return;
  }

  // 2. Check ComputedMealSlots
  const slotCount = await db.computedMealSlot.count({ where: { planId } });
  if (slotCount === 0) {
    await cascadeNutritionUpdate(planId, "manual", "Slots missing, recomputed — integrity check");
  }
}
