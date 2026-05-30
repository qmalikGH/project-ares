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

import { findRecipeTemplate } from "./recipe-templates";
import { scaleVariableSlots } from "./scale-variable-slots";
import {
  PROTEIN_HARD_FLOOR_PER_KG,
  FAT_FLOOR_PER_KG,
  FAT_MAX_G,
  RICE_BAG_G,
  RICE_BAGS,
} from "./constants";
import type {
  DayTypeConfig,
  RecipeTemplate,
  ComputedDayPlan,
  MacroTotals,
  ValidationResult,
  FixedSlotItem,
  ScaledRecipe,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum acceptable |slotSum − calorieTarget| in kcal. Tighter than v1 (was 50). */
const CALORIE_TOLERANCE = 30;

/** Minimum remaining budget after fixed slots. If lower, the config is broken. */
const MIN_REMAINING_BUDGET = 400;

/** Maximum daily food cost in EUR.
 *  v1.2: 15 → 16. v1.7: 16 → 18 (egg white). v1.9: 18 → 16 (egg white reverted
 *  out — it was the only driver above 16). */
const MAX_DAILY_COST = 16.0;

/**
 * Per-ingredient hard portion floors (Sprint v1.7). A protein/carb source must
 * reach its floor OR be omitted entirely (no sliver). Eggs handled separately
 * (whole units). egg_white_liquid in 50ml steps.
 */
const PORTION_FLOORS: Record<string, number> = {
  chicken_breast: 150,
  beef_mince: 100,
  rice_dry: 40,
  egg_white_liquid: 50,
};

/**
 * Assert a scaled slot ships no sub-floor protein/carb source or absurd portion.
 * Omitted components aren't in `components`, so anything present below its floor
 * is a real sliver → LOUD error. Exported for direct unit testing.
 */
export function validatePortionSanity(slot: ScaledRecipe, label: string): string[] {
  const errs: string[] = [];
  for (const c of slot.components) {
    const floor = PORTION_FLOORS[c.ingredientId];
    if (floor !== undefined && c.amount > 0 && c.amount < floor) {
      errs.push(`${label}: ${c.ingredientId} ${c.amount}${c.unit} below floor ${floor} (sub-floor sliver)`);
    }
    if (c.ingredientId === "eggs" && !Number.isInteger(c.amount)) {
      errs.push(`${label}: eggs ${c.amount} is not a whole number`);
    }
  }
  return errs;
}

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

  // ── Step 4: Macro-aware scaling (delegates to shared helper) ──
  const mainMealTemplate = findRecipeTemplate(config.variableSlots.mainMeal.recipeId);
  const dinnerTemplate = findRecipeTemplate(config.variableSlots.dinner.recipeId);

  // Sprint v1.9: rice quantized to 125g cook-bags per day type + slot (carb-split).
  const bags = RICE_BAGS[config.dayType] ?? { mainMeal: 0, dinner: 0 };

  const { mainMeal: scaledMainMeal, dinner: scaledDinner } = scaleVariableSlots({
    mainMealTemplate,
    dinnerTemplate,
    remainingBudget,
    dinnerBudgetRatio: config.variableSlots.dinner.budgetRatio,
    fixedProteinG: fixedTotals.protein,
    fixedKcal: fixedTotals.kcal,
    calorieTarget: config.calorieTarget,
    proteinTargetG: config.macroTargets.proteinG,
    athleteWeightKg,
    nonFunctionalProteinG: nonFunctionalProtein,
    mainMealFixedCarbG: bags.mainMeal * RICE_BAG_G,
    dinnerFixedCarbG: bags.dinner * RICE_BAG_G,
  });

  // ── Step 6: Sum all totals ──
  // Non-functional protein (Kollagen) is EXCLUDED from the visible total —
  // it doesn't count as a macro (no leucine, no MPS contribution).
  const dayTotalsRaw = addTotals(fixedTotals, scaledMainMeal.totals, scaledDinner.totals);
  const dayTotals: MacroTotals = {
    ...dayTotalsRaw,
    protein: dayTotalsRaw.protein - nonFunctionalProtein,
  };

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

  // 7b. Functional protein HARD floor (Sprint v1.7: two-tier protein).
  // Hard floor = 1.8 g/kg (~166g): below this the plan FAILS. The soft target
  // (2.2 g/kg, maximize-toward) lives in scale-variable-slots and is NOT a hard
  // fail — FFM protection is a weekly-average + per-meal job (Helms/Morton).
  // dayTotals.protein already excludes non-functional protein (e.g. collagen).
  const functionalProtein = dayTotals.protein;
  const minProtein = Math.round(athleteWeightKg * PROTEIN_HARD_FLOOR_PER_KG);
  if (functionalProtein < minProtein) {
    errors.push(
      `Functional protein ${functionalProtein}g < hard floor ${minProtein}g (${athleteWeightKg}kg × ${PROTEIN_HARD_FLOOR_PER_KG}, excludes ${nonFunctionalProtein}g non-functional)`,
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
  const PROTEIN_CAP_PER_SLOT = 50;
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

  // 7h. Fat guard-rails (Sprint v1.7). Floor protects hormones/satiety after
  // the −600 cut + Eiklar swap (Eiklar verdrängt Voll-Ei-Fett); cap unchanged.
  // Floor = hard error (hormones/satiety protection after the cut, Sprint v1.7).
  const minFat = Math.round(athleteWeightKg * FAT_FLOOR_PER_KG);
  if (dayTotals.fat < minFat) {
    errors.push(`Fat ${dayTotals.fat}g < floor ${minFat}g (${athleteWeightKg}kg × ${FAT_FLOOR_PER_KG})`);
  }
  // Cap = soft warning (was never enforced pre-v1.7; production days sit ~50–62g).
  if (dayTotals.fat > FAT_MAX_G) {
    warnings.push(`Fat ${dayTotals.fat}g > soft cap ${FAT_MAX_G}g`);
  }

  // 7i. Portion sanity (Sprint v1.7) — fail LOUD on sub-floor protein sources
  // or absurd portions, instead of silently shipping a sliver.
  errors.push(...validatePortionSanity(scaledMainMeal, "MainMeal"));
  errors.push(...validatePortionSanity(scaledDinner, "Dinner"));

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
