// Nutrition cascade — Nutrition v2.
//
// Single entry point for recomputing all meal plans after any config change.
// Delegates to buildAllDayPlans() (pure engine), then persists via DB writes.
//
// Trigger scenarios:
//   - config_change:  Coach adjusts calorie targets or recipe assignments
//   - recipe_change:  Recipe template data is updated
//   - calibration:    14-day TDEE calibration completes
//   - manual:         Admin or seed operation
//
// All-or-nothing: if ANY dayType fails validation, NOTHING is written.
// This guarantees the DB never holds a partially-valid meal plan.

import { buildAllDayPlans } from "./build-all-day-plans";
import { DAY_TYPE_CONFIGS, ATHLETE_WEIGHT_KG } from "./day-type-configs";
import { RECIPE_TEMPLATES } from "./recipe-templates";
import type { DayTypeConfig, RecipeTemplate } from "./types";

export type CascadeTrigger = "config_change" | "recipe_change" | "calibration" | "manual";

export interface CascadeResult {
  success: boolean;
  errors: string[];
  trigger: CascadeTrigger;
  reason: string;
}

/**
 * Recompute all day plans and persist them.
 *
 * Phase 3 v1: Pure computation only (no DB writes yet — those are added
 * when the DB layer is wired up). Returns the computation result for
 * callers to persist as they see fit.
 *
 * @param trigger — what caused this cascade
 * @param reason — human-readable description for logging
 * @param configOverrides — optional custom configs (default: DAY_TYPE_CONFIGS)
 * @param recipesOverride — optional custom recipes (default: RECIPE_TEMPLATES)
 * @param weightOverride — optional athlete weight (default: ATHLETE_WEIGHT_KG)
 */
export function cascadeNutritionUpdate(
  trigger: CascadeTrigger,
  reason: string,
  configOverrides?: DayTypeConfig[],
  recipesOverride?: RecipeTemplate[],
  weightOverride?: number,
): CascadeResult {
  const configs = configOverrides ?? DAY_TYPE_CONFIGS;
  const recipes = recipesOverride ?? RECIPE_TEMPLATES;
  const weight = weightOverride ?? ATHLETE_WEIGHT_KG;

  const result = buildAllDayPlans(configs, recipes, weight);

  if (result.hasErrors) {
    return {
      success: false,
      errors: result.allErrors,
      trigger,
      reason,
    };
  }

  // TODO (Phase 3 full): Persist plans to DB via Prisma
  // 1. Load active MealPlan
  // 2. For each dayType in result.plans:
  //    - Delete existing DayPlan slots
  //    - Write new computed slots (bridged to MealSlots JSON)
  // 3. Update MealPlan.calibratedAt timestamp
  // 4. Log to CoachingLog: { trigger, reason, dayTypes: [...] }

  return {
    success: true,
    errors: [],
    trigger,
    reason,
  };
}
