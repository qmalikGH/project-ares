// Compute day plan — Nutrition v2 orchestrator.
//
// Pure function: takes a DayTypeConfig + RecipeTemplates + athlete weight,
// returns a fully computed day plan with validation.
//
// Budget cascade (one-way, never reversed):
//   calorieTarget
//     − fixedSlots (morning, preTraining, afternoonSnack, eveningSnack)
//     − flexDessert (if enabled)
//     = remainingBudget
//     → dinner FIRST (budgetRatio × remaining) → scaleRecipe()
//     → mainMeal gets ACTUAL remainder (remaining − dinner.actual)
//       → scaleRecipe()  [rice at 10g steps absorbs rounding error]
//     → VALIDATE
//
// Dinner scales first because dinner recipes (eggs at 78 kcal/step, hack
// at 25g × 2.12 = 53 kcal/step) are coarser than mainMeal recipes (rice
// at 10g × 3.6 = 36 kcal/step). Letting the finer-grained recipe absorb
// rounding error keeps |slotSum − target| within ±30 kcal.

import { scaleRecipe } from "./scale-recipe";
import { findRecipeTemplate } from "./recipe-templates";
import type {
  DayTypeConfig,
  RecipeTemplate,
  ComputedDayPlan,
  MacroTotals,
  ValidationResult,
  FixedSlotItem,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum acceptable |slotSum − calorieTarget| in kcal. Tighter than v1 (was 50). */
const CALORIE_TOLERANCE = 30;

/** Minimum remaining budget after fixed slots. If lower, the config is broken. */
const MIN_REMAINING_BUDGET = 400;

/** Maximum daily food cost in EUR.
 *  Increased from 15 → 16 in v1.2 (higher calorie targets = more food). */
const MAX_DAILY_COST = 16.0;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function sumFixedItems(items: FixedSlotItem[]): MacroTotals {
  let kcal = 0, protein = 0, carbs = 0, fat = 0, cost = 0;
  for (const item of items) {
    kcal += item.kcal;
    protein += item.protein;
    carbs += item.carbs;
    fat += item.fat;
    cost += item.cost;
  }
  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    cost: Math.round(cost * 100) / 100,
  };
}

function addTotals(...totalsArr: MacroTotals[]): MacroTotals {
  let kcal = 0, protein = 0, carbs = 0, fat = 0, cost = 0;
  for (const t of totalsArr) {
    kcal += t.kcal;
    protein += t.protein;
    carbs += t.carbs;
    fat += t.fat;
    cost += t.cost;
  }
  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    cost: Math.round(cost * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Core: computeDayPlan
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a full day plan from a DayTypeConfig.
 *
 * Pure function. Validates all constraints. Returns ValidationResult with
 * errors/warnings — callers decide how to handle them. Does NOT throw on
 * validation failure (unlike scaleRecipe which throws on impossible budgets).
 */
export function computeDayPlan(
  config: DayTypeConfig,
  recipes: RecipeTemplate[],
  athleteWeightKg: number,
): ComputedDayPlan {
  // ── Step 1: Sum fixed slots ──
  const fixedSlotEntries: Record<string, { items: FixedSlotItem[]; totalKcal: number }> = {};
  let fixedTotals: MacroTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 };

  const slotMap: Record<string, FixedSlotItem[] | null> = {
    morning: config.fixedSlots.morning.items,
    preTraining: config.fixedSlots.preTraining?.items ?? null,
    afternoonSnack: config.fixedSlots.afternoonSnack.items,
    eveningSnack: config.fixedSlots.eveningSnack.items,
  };

  for (const [name, items] of Object.entries(slotMap)) {
    if (items) {
      const totals = sumFixedItems(items);
      fixedSlotEntries[name] = { items, totalKcal: totals.kcal };
      fixedTotals = addTotals(fixedTotals, totals);
    }
  }

  // Non-functional protein: items where functionalProtein === false (e.g. collagen — no leucine, no MPS)
  const allFixedItems = Object.values(slotMap).flat().filter((x): x is FixedSlotItem => x !== null);
  let nonFunctionalProtein = allFixedItems
    .filter((item) => item.functionalProtein === false)
    .reduce((sum, item) => sum + item.protein, 0);

  // ── Step 2: Flex dessert (Skyr) ──
  let flexDessertResult: ComputedDayPlan["flexDessert"] = null;
  if (config.fixedSlots.flexDessert?.enabled) {
    const dessertTotals = sumFixedItems(config.fixedSlots.flexDessert.items);
    flexDessertResult = {
      enabled: true,
      items: config.fixedSlots.flexDessert.items,
      totalKcal: dessertTotals.kcal,
    };
    fixedTotals = addTotals(fixedTotals, dessertTotals);
    // Include flex dessert items in non-functional protein check
    nonFunctionalProtein += config.fixedSlots.flexDessert.items
      .filter((item) => item.functionalProtein === false)
      .reduce((sum, item) => sum + item.protein, 0);
  }

  const fixedSlotsTotalKcal = fixedTotals.kcal;

  // ── Step 3: Remaining budget ──
  const remainingBudget = config.calorieTarget - fixedSlotsTotalKcal;

  if (remainingBudget < MIN_REMAINING_BUDGET) {
    throw new Error(
      `Remaining budget too low (${remainingBudget} kcal). ` +
      `Fixed slots consume ${fixedSlotsTotalKcal} of ${config.calorieTarget} target. ` +
      `Reduce fixed slots or increase target.`,
    );
  }

  // ── Step 4: Scale dinner FIRST (coarser rounding), then mainMeal absorbs remainder ──
  const mainMealTemplate = findRecipeTemplate(config.variableSlots.mainMeal.recipeId);
  const dinnerTemplate = findRecipeTemplate(config.variableSlots.dinner.recipeId);

  // Dinner uses the ratio-based budget (eggs/hack have coarser step sizes)
  const dinnerBudget = Math.round(remainingBudget * config.variableSlots.dinner.budgetRatio);
  const scaledDinner = scaleRecipe(dinnerTemplate, dinnerBudget);

  // MainMeal gets the ACTUAL remaining kcal after dinner's real output.
  // This lets rice (10g/36kcal steps) absorb the rounding error from dinner.
  const mainMealBudget = remainingBudget - scaledDinner.totals.kcal;
  const scaledMainMeal = scaleRecipe(mainMealTemplate, mainMealBudget);

  // ── Step 6: Sum all totals ──
  const dayTotals = addTotals(fixedTotals, scaledMainMeal.totals, scaledDinner.totals);

  // ── Step 7: Validate ──
  const errors: string[] = [];
  const warnings: string[] = [];

  // 7a. Calorie tolerance
  const kcalDiff = Math.abs(dayTotals.kcal - config.calorieTarget);
  if (kcalDiff > CALORIE_TOLERANCE) {
    errors.push(
      `Calorie mismatch: ${dayTotals.kcal} kcal vs ${config.calorieTarget} target (Δ=${kcalDiff} > ${CALORIE_TOLERANCE})`,
    );
  }

  // 7b. Functional protein minimum (2.0 g/kg)
  // Exclude non-functional protein (e.g. collagen — no leucine, no MPS stimulus)
  const functionalProtein = dayTotals.protein - nonFunctionalProtein;
  const minProtein = Math.round(athleteWeightKg * 2.0);
  if (functionalProtein < minProtein) {
    errors.push(
      `Functional protein ${functionalProtein}g < minimum ${minProtein}g (${athleteWeightKg}kg × 2.0, excludes ${nonFunctionalProtein}g non-functional)`,
    );
  }

  // 7c. Cost maximum
  if (dayTotals.cost > MAX_DAILY_COST) {
    errors.push(`Cost €${dayTotals.cost.toFixed(2)} > maximum €${MAX_DAILY_COST.toFixed(2)}`);
  }

  // 7d. Recipe uniqueness
  if (config.variableSlots.mainMeal.recipeId === config.variableSlots.dinner.recipeId) {
    errors.push(
      `MainMeal and Dinner use same recipe "${config.variableSlots.mainMeal.recipeId}"`,
    );
  }

  // 7e. Budget ratio sum
  const ratioSum = config.variableSlots.mainMeal.budgetRatio + config.variableSlots.dinner.budgetRatio;
  if (Math.abs(ratioSum - 1.0) > 0.001) {
    errors.push(`Budget ratios sum to ${ratioSum} instead of 1.0`);
  }

  // 7f. Cost warning
  if (dayTotals.cost > MAX_DAILY_COST * 0.9) {
    warnings.push(`Cost €${dayTotals.cost.toFixed(2)} approaching €${MAX_DAILY_COST.toFixed(2)} limit`);
  }

  // 7g. Protein cap per slot — SOFT warning (not error) for MPS-optimal distribution
  const PROTEIN_CAP_PER_SLOT = 60;
  if (scaledMainMeal.totals.protein > PROTEIN_CAP_PER_SLOT) {
    warnings.push(
      `MainMeal protein ${Math.round(scaledMainMeal.totals.protein)}g > ${PROTEIN_CAP_PER_SLOT}g soft cap`,
    );
  }
  if (scaledDinner.totals.protein > PROTEIN_CAP_PER_SLOT) {
    warnings.push(
      `Dinner protein ${Math.round(scaledDinner.totals.protein)}g > ${PROTEIN_CAP_PER_SLOT}g soft cap`,
    );
  }

  const validation: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  return {
    dayType: config.dayType,
    calorieTarget: config.calorieTarget,
    fixedSlotsTotalKcal,
    remainingBudget,
    mainMeal: scaledMainMeal,
    dinner: scaledDinner,
    fixedSlots: fixedSlotEntries,
    flexDessert: flexDessertResult,
    totals: dayTotals,
    validation,
  };
}
