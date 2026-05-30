// Scale recipe engine — Nutrition v2.
//
// Pure function: takes a RecipeTemplate + calorie budget, returns a
// ScaledRecipe with computed portions. Enforces min/max/step constraints.
// NEVER silently adjusts — throws on impossible budgets.
//
// Algorithm:
//   1. Subtract sauce kcal (fixed)
//   2. Set vegetable to minimumAmount (fixed — micros, not calorie filler)
//   2b. Multi-protein (Strategy B): secondary proteins at minimumAmount,
//       subtract their kcal; primary protein scales with remainder
//   3. If proteinBudgetG provided: cap protein to macro budget, rest → carbs
//      Else fallback: protein 60%, carbs 40% of remaining
//   4. If no carb component (dinner): protein capped at budget, rest → veg
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
  const unitLabel =
    comp.portionUnit === "g" ? `${amount}g`
    : comp.portionUnit === "ml" ? `${amount}ml`
    : `${amount} Stück`;
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
 * When `proteinBudgetG` is provided, protein is capped to that many grams
 * (macro-aware mode). Excess calories shift to carbs/vegetables.
 * Without it, falls back to the legacy 60/40 protein/carb split.
 *
 * Pure function. Throws if the budget is too low to satisfy minimum
 * portion constraints — NEVER silently adjusts.
 */
export function scaleRecipe(
  template: RecipeTemplate,
  targetKcal: number,
  /**
   * Sprint v1.9.1: when set, protein is scaled TOWARD this gram target (capped
   * only by the calorie budget + recipe max); carbs (rice) then fill the kcal
   * remainder. This makes the day hit its protein target instead of a 60/40 split.
   */
  proteinBudgetG?: number,
): ScaledRecipe {
  // 1. Sauce kcal (fixed, not scaled)
  const sauceKcal = template.sauces.reduce((s, sauce) => s + sauce.kcal, 0);

  // 2. Component budget
  const componentBudget = targetKcal - sauceKcal;

  // 3. Find components by role
  // v1.3: .filter() for multi-protein support (e.g. egg_chicken_rice_asia)
  const proteinComps = template.components.filter((c) => c.role === "protein");
  const proteinComp = proteinComps[0]; // Primary protein (first in template)
  const carbComp = template.components.find((c) => c.role === "carb");
  const vegComp = template.components.find((c) => c.role === "vegetable");

  if (proteinComps.length === 0) {
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

  // 5b. Strategy B: Multi-protein — secondary proteins at fixed minimumAmount.
  //     Primary (index 0) scales flexibly with the remaining budget.
  //     When only 1 protein component exists, this is a no-op (identical to v1.2).
  //
  //     Sprint v1.7 — OMIT logic: a secondary protein is dropped entirely (no
  //     sliver) when the budget can't fit it at its floor after reserving the
  //     primary + carb minimums. "Hähnchen ≥150g ODER weg."
  const secondaryComponents: ScaledComponent[] = [];
  const omittedComponents: ScaledComponent[] = [];
  let secondaryKcal = 0;

  if (proteinComps.length > 1) {
    const primaryMinKcal = proteinComp.minimumAmount * proteinComp.kcalPerUnit;
    const carbMinKcal = carbComp ? carbComp.minimumAmount * carbComp.kcalPerUnit : 0;
    // kcal available for secondaries beyond the mandatory primary + carb + veg minimums.
    let secHeadroom = remaining - primaryMinKcal - carbMinKcal;
    for (let i = 1; i < proteinComps.length; i++) {
      const sec = proteinComps[i];
      const secKcal = sec.minimumAmount * sec.kcalPerUnit;
      if (secKcal > secHeadroom) {
        // No room at the floor → omit (no sub-floor sliver).
        omittedComponents.push(computeComponentMacros(sec, 0));
        continue;
      }
      secondaryComponents.push(computeComponentMacros(sec, sec.minimumAmount));
      secondaryKcal += secKcal;
      secHeadroom -= secKcal;
    }
  }

  // Budget available for primary protein (+ carbs)
  const primaryRemaining = remaining - secondaryKcal;

  // 6. Waterfall allocation: protein FIRST, then remaining → carbs,
  //    then any leftover → scale vegetables UP from minimum.
  //    This prevents kcal loss when protein hits its max cap.
  //
  //    When proteinBudgetG is provided (macro-aware mode), protein is capped
  //    to that budget (minus sauce/veg/secondary protein). Excess → carbs.
  let proteinAmount: number;
  let carbAmount: number;
  let actualVegAmount = vegAmount; // start at minimum, may scale up

  // Compute primary protein amount from macro budget (if provided)
  let budgetProteinAmount: number | undefined;
  if (proteinBudgetG !== undefined) {
    // Subtract fixed protein contributions (sauces, vegetables, secondary proteins)
    const sauceProtein = template.sauces.reduce((s, sauce) => s + sauce.protein, 0);
    const vegProtein = vegComp ? vegAmount * vegComp.proteinPerUnit : 0;
    const secondaryProtein = secondaryComponents.reduce((s, c) => s + c.protein, 0);
    const primaryBudgetG = Math.max(0, proteinBudgetG - sauceProtein - vegProtein - secondaryProtein);
    budgetProteinAmount = primaryBudgetG / proteinComp.proteinPerUnit;
  }

  if (carbComp) {
    // Recipe with carb component (has rice): protein scales toward its target,
    // carbs (rice) fill the remaining kcal.
    const kcalBasedAmount = (primaryRemaining * 0.6) / proteinComp.kcalPerUnit;
    let idealProteinAmount: number;
    if (budgetProteinAmount !== undefined) {
      // Sprint v1.9.1: AIM for the protein target, but RESERVE the carb minimum
      // so protein can't eat the whole budget and force rice to clamp UP to its
      // min (which would overshoot calories). Protein leaves room for ≥ rice-min;
      // rice then fills the rest.
      const carbMinKcal = carbComp.minimumAmount * carbComp.kcalPerUnit;
      const kcalCappedAmount = (primaryRemaining - carbMinKcal) / proteinComp.kcalPerUnit;
      idealProteinAmount = Math.min(budgetProteinAmount, kcalCappedAmount);
    } else {
      // Legacy fallback (no target): protein gets 60% of budget as STARTING POINT
      idealProteinAmount = kcalBasedAmount;
    }

    // Round and clamp protein
    proteinAmount = clamp(
      roundToStep(idealProteinAmount, proteinComp.stepSize),
      proteinComp.minimumAmount,
      proteinComp.maximumAmount,
    );

    // Actual protein kcal after clamping
    const actualProteinKcal = proteinAmount * proteinComp.kcalPerUnit;

    // ALL remaining kcal after protein → carbs (waterfall, no kcal lost)
    const carbBudget = primaryRemaining - actualProteinKcal;
    carbAmount = clamp(
      roundToStep(carbBudget / carbComp.kcalPerUnit, carbComp.stepSize),
      carbComp.minimumAmount,
      carbComp.maximumAmount,
    );

    // If carbs also hit their max, scale vegetables up to absorb remainder
    if (vegComp) {
      const usedKcal = proteinAmount * proteinComp.kcalPerUnit + carbAmount * carbComp.kcalPerUnit;
      const vegBudget = primaryRemaining - usedKcal;
      if (vegBudget > vegKcal) {
        actualVegAmount = clamp(
          roundToStep(vegBudget / vegComp.kcalPerUnit, vegComp.stepSize),
          vegComp.minimumAmount,
          vegComp.maximumAmount,
        );
      }
    }
  } else {
    // Recipe without carbs: protein fills budget, constrained by calorie budget
    const kcalBasedAmount = primaryRemaining / proteinComp.kcalPerUnit;
    let idealProteinAmount: number;
    if (budgetProteinAmount !== undefined) {
      // Macro-aware: take LOWER of budget and calorie-derived amount
      // (can't shift excess to carbs — no carb component to absorb it)
      idealProteinAmount = Math.min(budgetProteinAmount, kcalBasedAmount);
    } else {
      // Legacy fallback: 100% → protein
      idealProteinAmount = kcalBasedAmount;
    }

    proteinAmount = clamp(
      roundToStep(idealProteinAmount, proteinComp.stepSize),
      proteinComp.minimumAmount,
      proteinComp.maximumAmount,
    );
    carbAmount = 0;

    // If protein hits max or is capped, scale vegetables up to absorb remainder
    if (vegComp) {
      const actualProteinKcal = proteinAmount * proteinComp.kcalPerUnit;
      const vegBudget = primaryRemaining - actualProteinKcal;
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
  const minTotalKcal = minProteinKcal + minCarbKcal + vegKcal + sauceKcal + secondaryKcal;

  if (minTotalKcal > targetKcal * 1.5) {
    throw new Error(
      `Recipe "${template.id}": minimum portions (${Math.round(minTotalKcal)} kcal) ` +
      `exceed budget (${targetKcal} kcal) by more than 50%. ` +
      `Consider a different recipe or higher budget.`,
    );
  }

  // 9. Build scaled components
  const scaledComponents: ScaledComponent[] = [];
  // Sprint v1.7: skip a 0-amount primary (egg white can scale to 0 = omitted).
  if (proteinAmount > 0) {
    scaledComponents.push(computeComponentMacros(proteinComp, proteinAmount));
  }
  // Secondary protein components (Strategy B: fixed at minimumAmount)
  scaledComponents.push(...secondaryComponents);
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
    ...(omittedComponents.length > 0 ? { omitted: omittedComponents } : {}),
  };
}
