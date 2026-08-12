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
 *
 * Sprint 2.7 (A5): returns the repair outcome instead of `void`. This runs
 * lazily on ordinary nutrition page loads, so a failing repair here was the
 * quietest of the three ignored cascade call sites — a user could open /today
 * and trigger a failed repair with nothing anywhere to show for it. The cascade
 * now logs and notifies on its own; this just stops discarding the answer.
 */
export interface IntegrityResult {
  repaired: boolean;
  ok: boolean;
  errors: string[];
}

export async function ensureNutritionIntegrity(planId: string): Promise<IntegrityResult> {
  // 1. Check DayTypeConfigs
  const configs = await db.dayTypeConfig.findMany({
    where: { planId },
    select: { dayType: true },
  });

  if (configs.length === 0) {
    await seedDayTypeConfigs(planId);
    const r = await cascadeNutritionUpdate(planId, "seed", "Initial setup — integrity check");
    return { repaired: true, ok: r.success, errors: r.errors };
  }

  if (configs.length < EXPECTED_DAY_TYPES) {
    const existingDayTypes = configs.map((c) => c.dayType);
    await seedMissingDayTypeConfigs(planId, existingDayTypes);
    const r = await cascadeNutritionUpdate(planId, "seed", "Missing day types repaired — integrity check");
    return { repaired: true, ok: r.success, errors: r.errors };
  }

  // 2. Check ComputedMealSlots
  const slotCount = await db.computedMealSlot.count({ where: { planId } });
  if (slotCount === 0) {
    const r = await cascadeNutritionUpdate(planId, "manual", "Slots missing, recomputed — integrity check");
    return { repaired: true, ok: r.success, errors: r.errors };
  }

  return { repaired: false, ok: true, errors: [] };
}
