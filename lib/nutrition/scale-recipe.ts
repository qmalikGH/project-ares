// Scale recipe engine — Nutrition v2.
//
// Pure function: takes a RecipeTemplate + calorie budget, returns a
// ScaledRecipe with computed portions. Enforces min/max/step constraints.
// NEVER silently adjusts — throws on impossible budgets.
//
// Algorithm:
//   1. Subtract sauce kcal (fixed)
//   2. Set vegetable to minimumAmount (fixed — micros, not calorie filler)
//   3. If recipe has carb component: protein 60%, carbs 40% of remaining
//   4. If no carb component (dinner): 100% → protein
//   5. Round to stepSize, clamp to [min, max]
//   6. Throw if clamped component makes budget impossible

import { INGREDIENT_LABELS } from "./recipe-templates";
import type { RecipeTemplate, RecipeComponent, ScaledRecipe, ScaledComponent, MacroTotals } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Round to nearest step (e.g. 25g for rice). */
function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Compute macros for a component at a given amount. */
function computeComponentMacros(comp: RecipeComponent, amount: number): ScaledComponent {
  const label = INGREDIENT_LABELS[comp.ingredientId] ?? comp.ingredientId;
  const unitLabel = comp.portionUnit === "g" ? `${amount}g` : `${amount} Stück`;
  return {
    ingredientId: comp.ingredientId,
    name: `${label} ${unitLabel}`,
    amount,
    unit: comp.portionUnit,
    kcal: Math.round(amount * comp.kcalPerUnit),
    protein: Math.round(amount * comp.proteinPerUnit * 10) / 10,
    carbs: Math.round(amount * comp.carbsPerUnit * 10) / 10,
    fat: Math.round(amount * comp.fatPerUnit * 10) / 10,
    cost: Math.round(amount * comp.costPerUnit * 100) / 100,
  };
}

/** Sum macro totals from an array of scaled components + fixed sauces. */
function sumTotals(components: ScaledComponent[], sauces: { kcal: number; protein: number; carbs: number; fat: number; cost: number }[]): MacroTotals {
  let kcal = 0, protein = 0, carbs = 0, fat = 0, cost = 0;
  for (const c of components) {
    kcal += c.kcal;
    protein += c.protein;
    carbs += c.carbs;
    fat += c.fat;
    cost += c.cost;
  }
  for (const s of sauces) {
    kcal += s.kcal;
    protein += s.protein;
    carbs += s.carbs;
    fat += s.fat;
    cost += s.cost;
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
// Core: scaleRecipe
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scale a RecipeTemplate to fit a calorie budget.
 *
 * Pure function. Throws if the budget is too low to satisfy minimum
 * portion constraints — NEVER silently adjusts.
 */
export function scaleRecipe(template: RecipeTemplate, targetKcal: number): ScaledRecipe {
  // 1. Sauce kcal (fixed, not scaled)
  const sauceKcal = template.sauces.reduce((s, sauce) => s + sauce.kcal, 0);

  // 2. Component budget
  const componentBudget = targetKcal - sauceKcal;

  // 3. Find components by role
  const proteinComp = template.components.find((c) => c.role === "protein");
  const carbComp = template.components.find((c) => c.role === "carb");
  const vegComp = template.components.find((c) => c.role === "vegetable");

  if (!proteinComp) {
    throw new Error(`Recipe "${template.id}" has no protein component`);
  }

  // 4. Vegetable at minimum (fixed, not scaled for calories)
  const vegAmount = vegComp ? vegComp.minimumAmount : 0;
  const vegKcal = vegComp ? vegAmount * vegComp.kcalPerUnit : 0;

  // 5. Remaining budget after vegetable
  const remaining = componentBudget - vegKcal;

  if (remaining < 0) {
    throw new Error(
      `Recipe "${template.id}": budget too low. ` +
      `targetKcal=${targetKcal}, sauceKcal=${sauceKcal}, vegKcal=${Math.round(vegKcal)} → ` +
      `remaining=${Math.round(remaining)} kcal (negative).`,
    );
  }

  // 6. Waterfall allocation: protein FIRST, then remaining → carbs,
  //    then any leftover → scale vegetables UP from minimum.
  //    This prevents kcal loss when protein hits its max cap.
  let proteinAmount: number;
  let carbAmount: number;
  let actualVegAmount = vegAmount; // start at minimum, may scale up

  if (carbComp) {
    // MainMeal recipe (has rice): protein gets 60% of budget as STARTING POINT
    const idealProteinAmount = (remaining * 0.6) / proteinComp.kcalPerUnit;

    // Round and clamp protein
    proteinAmount = clamp(
      roundToStep(idealProteinAmount, proteinComp.stepSize),
      proteinComp.minimumAmount,
      proteinComp.maximumAmount,
    );

    // Actual protein kcal after clamping
    const actualProteinKcal = proteinAmount * proteinComp.kcalPerUnit;

    // ALL remaining kcal after protein → carbs (waterfall, no kcal lost)
    const carbBudget = remaining - actualProteinKcal;
    carbAmount = clamp(
      roundToStep(carbBudget / carbComp.kcalPerUnit, carbComp.stepSize),
      carbComp.minimumAmount,
      carbComp.maximumAmount,
    );

    // If carbs also hit their max, scale vegetables up to absorb remainder
    if (vegComp) {
      const usedKcal = proteinAmount * proteinComp.kcalPerUnit + carbAmount * carbComp.kcalPerUnit;
      const vegBudget = remaining - usedKcal;
      if (vegBudget > vegKcal) {
        actualVegAmount = clamp(
          roundToStep(vegBudget / vegComp.kcalPerUnit, vegComp.stepSize),
          vegComp.minimumAmount,
          vegComp.maximumAmount,
        );
      }
    }
  } else {
    // Dinner recipe (no rice): 100% → protein
    proteinAmount = clamp(
      roundToStep(remaining / proteinComp.kcalPerUnit, proteinComp.stepSize),
      proteinComp.minimumAmount,
      proteinComp.maximumAmount,
    );
    carbAmount = 0;

    // If protein hits max, scale vegetables up to absorb remainder
    if (vegComp) {
      const actualProteinKcal = proteinAmount * proteinComp.kcalPerUnit;
      const vegBudget = remaining - actualProteinKcal;
      if (vegBudget > vegKcal) {
        actualVegAmount = clamp(
          roundToStep(vegBudget / vegComp.kcalPerUnit, vegComp.stepSize),
          vegComp.minimumAmount,
          vegComp.maximumAmount,
        );
      }
    }
  }

  // 8. Validate: check that minimum portions don't exceed budget
  const minProteinKcal = proteinComp.minimumAmount * proteinComp.kcalPerUnit;
  const minCarbKcal = carbComp ? carbComp.minimumAmount * carbComp.kcalPerUnit : 0;
  const minTotalKcal = minProteinKcal + minCarbKcal + vegKcal + sauceKcal;

  if (minTotalKcal > targetKcal * 1.5) {
    throw new Error(
      `Recipe "${template.id}": minimum portions (${Math.round(minTotalKcal)} kcal) ` +
      `exceed budget (${targetKcal} kcal) by more than 50%. ` +
      `Consider a different recipe or higher budget.`,
    );
  }

  // 9. Build scaled components
  const scaledComponents: ScaledComponent[] = [];
  scaledComponents.push(computeComponentMacros(proteinComp, proteinAmount));
  if (carbComp && carbAmount > 0) {
    scaledComponents.push(computeComponentMacros(carbComp, carbAmount));
  }
  if (vegComp) {
    scaledComponents.push(computeComponentMacros(vegComp, actualVegAmount));
  }

  // 10. Compute totals
  const totals = sumTotals(scaledComponents, template.sauces);

  return {
    recipeId: template.id,
    recipeName: template.name,
    components: scaledComponents,
    sauces: [...template.sauces],
    totals,
  };
}
