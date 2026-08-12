// Full reseed of the nutrition stores from code constants — Sprint 2.7 (A5).
//
// One implementation for both entry points (`scripts/force-reseed.ts` and the
// `forceReseed` coaching action). Before this they were two hand-maintained
// copies of the same four steps, and only one of them looked at the cascade
// result.
//
// The reseed is the ONLY path that carries `DEFICIT_KCAL` from the code into
// `MealPlan.deficitKcal`, which is the runtime authority. Changing the constant
// without running this changes nothing a user can see.

import { db } from "@/lib/db/client";
import { getRecentWeightAverageKg } from "@/lib/db/queries/sensors";
import { cascadeNutritionUpdate, type CascadeResult } from "./cascade";
import { DEFICIT_KCAL, gartheMaxDeficit } from "./constants";
import { resolveDeficitKcal, type DeficitMode } from "./deficit";
import { resolveAthleteWeightKg } from "./dry-run";
import { clampToMinIntake } from "./min-intake";
import { dbConfigToEngineConfig, forceReseedDayTypeConfigs } from "./seed-day-type-configs";

export interface ReseedResult {
  deficitKcal: number;
  deficitMode: DeficitMode;
  deficitReason: string;
  updatedDayTypes: string[];
  clampNotes: string[];
  cascade: CascadeResult;
}

/**
 * Overwrite every nutrition store from the code constants, at the deficit that
 * is actually in force right now.
 *
 * Order matters:
 *   1. resolve the deficit (taper/maintenance may override the constant)
 *   2. write it to MealPlan — the runtime authority
 *   3. force-reseed the DayTypeConfig rows from code
 *   4. re-derive calorieTarget from the resolved deficit and clamp each row up
 *      to its derived minimum, so an aggressive deficit can never write a
 *      target the engine cannot build
 *   5. cascade → ComputedMealSlot + DayPlan, transactionally
 */
export async function reseedNutritionFromConstants(
  userId: string,
  planId: string,
  reason: string,
): Promise<ReseedResult> {
  const [weightKg, weightAvg, plan] = await Promise.all([
    resolveAthleteWeightKg(userId),
    getRecentWeightAverageKg(userId),
    db.mealPlan.findUnique({ where: { id: planId }, select: { deficitKcal: true } }),
  ]);
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { targetWeightKg: true },
  });

  const resolved = resolveDeficitKcal({
    avg7dWeightKg: weightAvg.avgKg,
    targetWeightKg: settings?.targetWeightKg ?? null,
    currentDeficitKcal: plan?.deficitKcal ?? null,
    baseDeficitKcal: DEFICIT_KCAL,
    gartheCapKcal: gartheMaxDeficit(weightKg),
  });

  await db.mealPlan.update({
    where: { id: planId },
    data: { deficitKcal: resolved.deficitKcal },
  });

  const updatedDayTypes = await forceReseedDayTypeConfigs(planId);

  // The static configs bake DEFICIT_KCAL in at compile time and know nothing
  // about body mass, so re-derive from tdeeEstimate whenever the resolved
  // deficit differs — and clamp every row to its derived floor either way.
  const rows = await db.dayTypeConfig.findMany({ where: { planId } });
  const clampNotes: string[] = [];
  for (const row of rows) {
    const proposed =
      row.tdeeEstimate != null ? row.tdeeEstimate - resolved.deficitKcal : row.calorieTarget;
    const clamp = clampToMinIntake(proposed, dbConfigToEngineConfig(row), weightKg);
    if (clamp.note) clampNotes.push(clamp.note);
    if (clamp.calorieTarget !== row.calorieTarget) {
      await db.dayTypeConfig.update({
        where: { id: row.id },
        data: { calorieTarget: clamp.calorieTarget },
      });
    }
  }

  const cascade = await cascadeNutritionUpdate(planId, "seed", reason);

  return {
    deficitKcal: resolved.deficitKcal,
    deficitMode: resolved.mode,
    deficitReason: resolved.reason,
    updatedDayTypes,
    clampNotes,
    cascade,
  };
}
