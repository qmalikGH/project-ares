// Shared macro-aware scaling for variable slots (mainMeal + dinner).
//
// Both `template.ts:buildSlots()` (used by /api/nutrition/today) and
// `compute-day-plan.ts:computeDayPlan()` (used by cascade) need the same
// two-pass macro-aware scaling so the user-facing macros match the DB.
//
// Algorithm:
//   Pass 1: scale uncapped (legacy 60/40 split).
//   Pass 2: if total protein exceeds effectiveTarget+10g, re-scale with
//           protein caps on carb-containing recipes only. Fall back to
//           uncapped when capping would violate kcal tolerance (component
//           maxima exhausted).

import { scaleRecipe } from "./scale-recipe";
import { PROTEIN_SOFT_TARGET_PER_KG } from "./constants";
import type { RecipeTemplate, ScaledRecipe } from "./types";

export interface ScaleVariableSlotsArgs {
  mainMealTemplate: RecipeTemplate;
  dinnerTemplate: RecipeTemplate;
  remainingBudget: number;
  dinnerBudgetRatio: number;
  /** Protein already consumed by fixed slots (incl. non-functional). */
  fixedProteinG: number;
  /** kcal already consumed by fixed slots — used for tolerance check. */
  fixedKcal: number;
  /** Day's calorie target — used for tolerance check. */
  calorieTarget: number;
  /** Macro-target protein (from DayTypeConfig). */
  proteinTargetG: number;
  /** Athlete weight (kg) — for functional minimum (2.0 g/kg). */
  athleteWeightKg: number;
  /** Non-functional protein in fixed slots (e.g. collagen) — excluded from MPS minimum. */
  nonFunctionalProteinG: number;
}

export interface ScaleVariableSlotsResult {
  mainMeal: ScaledRecipe;
  dinner: ScaledRecipe;
}

export function scaleVariableSlots(args: ScaleVariableSlotsArgs): ScaleVariableSlotsResult {
  const {
    mainMealTemplate,
    dinnerTemplate,
    remainingBudget,
    dinnerBudgetRatio,
    fixedProteinG,
    proteinTargetG,
    athleteWeightKg,
    nonFunctionalProteinG,
  } = args;

  // Sprint v1.9.1 — Protein-target-driven scaling: aim for the day's protein
  // target (meat climbs toward it), then rice fills the remaining calories.
  // Replaces the old 60/40-then-cap which left days well under target.
  // Work in FUNCTIONAL protein (collagen excluded) consistently. fixedProteinG
  // is the raw fixed-slot total (incl. collagen) from BOTH callers; subtract the
  // non-functional part to get functional fixed protein. Recipe protein is all
  // functional (no collagen), so the variable target is functional too.
  const softTarget = Math.round(athleteWeightKg * PROTEIN_SOFT_TARGET_PER_KG);
  const functionalTarget = Math.max(proteinTargetG, softTarget);
  const functionalFixed = fixedProteinG - nonFunctionalProteinG;
  const variableTarget = Math.max(0, functionalTarget - functionalFixed);

  const dinnerHasCarb = dinnerTemplate.components.some((c) => c.role === "carb");
  const mainHasCarb = mainMealTemplate.components.some((c) => c.role === "carb");
  const mainBudgetRatio = 1 - dinnerBudgetRatio;

  // Scale the COARSE (no-rice) slot first; the rice-bearing slot goes LAST so its
  // fine-grained rice absorbs the day's rounding drift → calorie target is hit.
  if (!mainHasCarb && dinnerHasCarb) {
    // main (e.g. egg_asia_norice) first, dinner (rice) absorbs.
    const mainBudget = Math.round(remainingBudget * mainBudgetRatio);
    const mainProteinTarget = Math.round(variableTarget * mainBudgetRatio);
    const mainMeal = scaleRecipe(mainMealTemplate, mainBudget, mainProteinTarget);
    const dinnerBudget = remainingBudget - mainMeal.totals.kcal;
    const dinnerProteinTarget = Math.max(0, variableTarget - mainMeal.totals.protein);
    const dinner = scaleRecipe(dinnerTemplate, dinnerBudget, dinnerProteinTarget);
    return { mainMeal, dinner };
  }

  // Default: dinner first, main (rice) absorbs the remainder + drift.
  const dinnerBudget = Math.round(remainingBudget * dinnerBudgetRatio);
  const dinnerProteinTarget = Math.round(variableTarget * dinnerBudgetRatio);
  const dinner = scaleRecipe(dinnerTemplate, dinnerBudget, dinnerProteinTarget);
  const mainMealBudget = remainingBudget - dinner.totals.kcal;
  const mainProteinTarget = Math.max(0, variableTarget - dinner.totals.protein);
  const mainMeal = scaleRecipe(mainMealTemplate, mainMealBudget, mainProteinTarget);

  return { mainMeal, dinner };
}
