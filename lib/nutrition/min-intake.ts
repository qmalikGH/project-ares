// Derived minimum intake — Sprint 2.7 (A5). Pure leaf module.
//
// WHY THIS EXISTS
//
// The weekly calibration computes `calorieTarget = avgGarminTDEE − deficitKcal`
// with no lower bound whatsoever. On 2026-06-15 that produced a rest-day target
// of 1558 kcal (42 g carbohydrate). The engine cannot build such a day — the
// protein hard floor alone needs more — so `cascadeNutritionUpdate` failed, and
// because it is all-or-nothing NOTHING was written. The DayTypeConfig rows kept
// the impossible values while DayPlan and ComputedMealSlot kept the old ones,
// and the split went unnoticed for two months.
//
// The fix is not a magic constant. The minimum viable target is DERIVABLE: it is
// whatever the floors the engine already enforces cost, plus the fixed slots,
// plus the budget the variable slots need to exist at all. This module computes
// that number so a broken input is rejected at the door with an actionable
// message ("rest target 1558 < derived minimum 1871, carb floor binding")
// instead of surfacing as a downstream protein error nobody can act on.
//
// Pure: no db, no next/*, no side effects. Constants live in ./constants.

import {
  PROTEIN_HARD_FLOOR_PER_KG,
  FAT_FLOOR_PER_KG,
  CARB_FLOOR_PER_KG_TRAINING,
  CARB_FLOOR_PER_KG_REST,
  MIN_REMAINING_BUDGET,
  FOOD_REALISM_FACTOR,
} from "./constants";
import type { DayTypeConfig, FixedSlotItem } from "./types";

/** Which term set the floor — carried into the error message so the reader
 *  knows which lever to pull. */
export type MinIntakeBinding = "macro_floor" | "structural";

export interface MinIntakeInput {
  weightKg: number;
  /** Sum of all fixed slots INCLUDING the flex dessert. */
  fixedKcal: number;
  /** Protein that does not count toward the functional floor (collagen). */
  nonFunctionalProteinG: number;
  /** Rest days get the lower carb floor and carry no pre-training slot. */
  isTrainingDay: boolean;
}

export interface MinIntakeResult {
  minKcal: number;
  binding: MinIntakeBinding;
  breakdown: {
    proteinG: number;
    fatG: number;
    carbsG: number;
    macroFloorKcal: number;
    structuralKcal: number;
  };
}

/** Carbohydrate floor in g/kg for a day type. */
export function carbFloorPerKg(isTrainingDay: boolean): number {
  return isTrainingDay ? CARB_FLOOR_PER_KG_TRAINING : CARB_FLOOR_PER_KG_REST;
}

/**
 * The lowest `calorieTarget` at which a day of this shape can still be built.
 *
 * Two independent lower bounds, take the larger:
 *
 *   macro floor — what the enforced floors cost as food. Note the protein term
 *     adds `nonFunctionalProteinG`: collagen occupies calories but does not
 *     count toward the functional floor, so a day carrying it needs strictly
 *     more energy to clear the same bar.
 *
 *   structural — fixed slots + MIN_REMAINING_BUDGET. Even if the macros were
 *     free, `computeDayPlan` throws when the variable slots have less than
 *     MIN_REMAINING_BUDGET to work with.
 */
export function minCalorieTarget(input: MinIntakeInput): MinIntakeResult {
  const { weightKg, fixedKcal, nonFunctionalProteinG, isTrainingDay } = input;

  const proteinG = weightKg * PROTEIN_HARD_FLOOR_PER_KG + nonFunctionalProteinG;
  const fatG = weightKg * FAT_FLOOR_PER_KG;
  const carbsG = weightKg * carbFloorPerKg(isTrainingDay);

  const macroFloorKcal = Math.round(
    FOOD_REALISM_FACTOR * (proteinG * 4 + fatG * 9 + carbsG * 4),
  );
  const structuralKcal = Math.round(fixedKcal + MIN_REMAINING_BUDGET);

  const binding: MinIntakeBinding =
    macroFloorKcal >= structuralKcal ? "macro_floor" : "structural";

  return {
    minKcal: Math.max(macroFloorKcal, structuralKcal),
    binding,
    breakdown: {
      proteinG: Math.round(proteinG),
      fatG: Math.round(fatG),
      carbsG: Math.round(carbsG),
      macroFloorKcal,
      structuralKcal,
    },
  };
}

/**
 * Facts about a config's fixed slots that the floor needs. Mirrors the private
 * accounting in `computeDayPlan` (fixed slots + flex dessert, non-functional
 * protein summed across both) so the two cannot disagree about what a day costs
 * before its variable slots are scaled.
 */
export function fixedSlotFacts(fixedSlots: DayTypeConfig["fixedSlots"]): {
  fixedKcal: number;
  nonFunctionalProteinG: number;
} {
  const groups: (FixedSlotItem[] | null | undefined)[] = [
    fixedSlots.morning?.items,
    fixedSlots.preTraining?.items,
    fixedSlots.afternoonSnack?.items,
    fixedSlots.eveningSnack?.items,
    fixedSlots.flexDessert?.enabled ? fixedSlots.flexDessert.items : null,
  ];

  let fixedKcal = 0;
  let nonFunctionalProteinG = 0;
  for (const items of groups) {
    if (!items) continue;
    for (const item of items) {
      fixedKcal += item.kcal;
      if (item.functionalProtein === false) nonFunctionalProteinG += item.protein;
    }
  }

  return {
    fixedKcal: Math.round(fixedKcal),
    nonFunctionalProteinG: Math.round(nonFunctionalProteinG),
  };
}

/**
 * Convenience wrapper: floor for a whole config. `dayType` decides the carb
 * floor — everything that is not "rest" is a training day.
 */
export function minCalorieTargetForConfig(
  config: Pick<DayTypeConfig, "dayType" | "fixedSlots">,
  weightKg: number,
): MinIntakeResult {
  const { fixedKcal, nonFunctionalProteinG } = fixedSlotFacts(config.fixedSlots);
  return minCalorieTarget({
    weightKg,
    fixedKcal,
    nonFunctionalProteinG,
    isTrainingDay: config.dayType !== "rest",
  });
}

/**
 * Clamp a proposed target up to the floor. Returns the clamped target plus a
 * human-readable note when it bit — callers log the note; a floor that engages
 * silently would repeat exactly the failure mode this module exists to end.
 */
export function clampToMinIntake(
  proposedTarget: number,
  config: Pick<DayTypeConfig, "dayType" | "fixedSlots">,
  weightKg: number,
): { calorieTarget: number; clamped: boolean; note: string | null; floor: MinIntakeResult } {
  const floor = minCalorieTargetForConfig(config, weightKg);
  if (proposedTarget >= floor.minKcal) {
    return { calorieTarget: proposedTarget, clamped: false, note: null, floor };
  }
  return {
    calorieTarget: floor.minKcal,
    clamped: true,
    note:
      `${config.dayType}: target ${proposedTarget} kcal raised to derived minimum ` +
      `${floor.minKcal} kcal (${floor.binding === "macro_floor" ? "macro floor" : "fixed slots + variable-slot budget"} binding, ` +
      `${weightKg} kg)`,
    floor,
  };
}
