// Build all day plans — Nutrition v2 batch computation.
//
// Pure function: iterates all DayTypeConfigs, calls computeDayPlan() for
// each. If ANY day type fails validation → entire build fails. No partial
// results.

import { computeDayPlan } from "./compute-day-plan";
import type { DayTypeConfig, RecipeTemplate, ComputedDayPlan } from "./types";

/**
 * Compute day plans for all day types.
 *
 * Returns a Map<dayType, ComputedDayPlan>. If any day type has validation
 * errors, they are collected and the overall result includes them — callers
 * should check `hasErrors` before persisting.
 */
export function buildAllDayPlans(
  configs: DayTypeConfig[],
  recipes: RecipeTemplate[],
  athleteWeightKg: number,
): { plans: Map<string, ComputedDayPlan>; hasErrors: boolean; allErrors: string[] } {
  const plans = new Map<string, ComputedDayPlan>();
  const allErrors: string[] = [];

  for (const config of configs) {
    try {
      const plan = computeDayPlan(config, recipes, athleteWeightKg);
      plans.set(config.dayType, plan);

      if (!plan.validation.valid) {
        for (const err of plan.validation.errors) {
          allErrors.push(`[${config.dayType}] ${err}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      allErrors.push(`[${config.dayType}] Fatal: ${msg}`);
    }
  }

  return {
    plans,
    hasErrors: allErrors.length > 0,
    allErrors,
  };
}
