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
import type { RecipeTemplate, ScaledRecipe } from "./types";

const CALORIE_TOLERANCE = 30;
const PROTEIN_EXCESS_THRESHOLD = 10;

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
    fixedKcal,
    calorieTarget,
    proteinTargetG,
    athleteWeightKg,
    nonFunctionalProteinG,
  } = args;

  const dinnerBudget = Math.round(remainingBudget * dinnerBudgetRatio);

  // Pass 1: uncapped scaling (legacy 60/40 split)
  const scaledDinnerUncapped = scaleRecipe(dinnerTemplate, dinnerBudget);
  const mainMealBudgetRaw = remainingBudget - scaledDinnerUncapped.totals.kcal;
  const scaledMainMealUncapped = scaleRecipe(mainMealTemplate, mainMealBudgetRaw);

  const uncappedTotalProtein = fixedProteinG
    + scaledDinnerUncapped.totals.protein
    + scaledMainMealUncapped.totals.protein;

  // Effective target: must satisfy BOTH macro target AND functional minimum (2.0 g/kg)
  const minFunctionalProteinG = Math.round(athleteWeightKg * 2.0);
  const effectiveProteinTarget = Math.max(
    proteinTargetG,
    minFunctionalProteinG + nonFunctionalProteinG,
  );

  // Pass 2: only re-scale if protein overshoots target by >10g
  if (uncappedTotalProtein <= effectiveProteinTarget + PROTEIN_EXCESS_THRESHOLD) {
    return { mainMeal: scaledMainMealUncapped, dinner: scaledDinnerUncapped };
  }

  const remainingProteinG = effectiveProteinTarget - fixedProteinG;
  const dinnerHasCarb = dinnerTemplate.components.some((c) => c.role === "carb");
  const mainMealHasCarb = mainMealTemplate.components.some((c) => c.role === "carb");

  // Protein from no-carb recipes is fixed (can't be reduced without calorie gap)
  const uDinP = scaledDinnerUncapped.totals.protein;
  const uMainP = scaledMainMealUncapped.totals.protein;
  const fixedRecipeP = (dinnerHasCarb ? 0 : uDinP) + (mainMealHasCarb ? 0 : uMainP);
  const cappableTarget = Math.max(0, remainingProteinG - fixedRecipeP);
  const cappableUncapped = (dinnerHasCarb ? uDinP : 0) + (mainMealHasCarb ? uMainP : 0);

  if (cappableUncapped === 0 || cappableTarget >= cappableUncapped) {
    return { mainMeal: scaledMainMealUncapped, dinner: scaledDinnerUncapped };
  }

  // Distribute reduction proportionally among carb-containing recipes
  const dinnerCap = dinnerHasCarb
    ? Math.round(cappableTarget * uDinP / cappableUncapped)
    : undefined;

  const cappedDinner = dinnerCap !== undefined
    ? scaleRecipe(dinnerTemplate, dinnerBudget, dinnerCap)
    : scaledDinnerUncapped;

  const mainMealBudget = remainingBudget - cappedDinner.totals.kcal;
  const mainMealCap = mainMealHasCarb
    ? Math.max(0, remainingProteinG - cappedDinner.totals.protein)
    : undefined;

  const cappedMainMeal = mainMealCap !== undefined
    ? scaleRecipe(mainMealTemplate, mainMealBudget, mainMealCap)
    : scaleRecipe(mainMealTemplate, mainMealBudget);

  // Tolerance check: capping may leave kcal unplaceable when carb/veg maxima exhausted
  const cappedDayKcal = fixedKcal + cappedDinner.totals.kcal + cappedMainMeal.totals.kcal;
  if (Math.abs(cappedDayKcal - calorieTarget) <= CALORIE_TOLERANCE) {
    return { mainMeal: cappedMainMeal, dinner: cappedDinner };
  }

  // Capping created a worse kcal mismatch — fall back to uncapped
  return { mainMeal: scaledMainMealUncapped, dinner: scaledDinnerUncapped };
}
