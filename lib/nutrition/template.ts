// Canonical meal-slot templates — Nutrition v2.
//
// ARCHITECTURE: DayTypeConfig is the SINGLE SOURCE OF TRUTH.
// Fixed slots have hardcoded portions from DayTypeConfig.fixedSlots.
// Variable slots (mainMeal, dinner) are computed by the v2 scaleRecipe engine.
// mainMeal and dinner ALWAYS use DIFFERENT recipes (core v2 fix).
//
// This module is the BACKWARD-COMPAT BRIDGE: it produces MealSlots in the
// same shape as v1 but backed by the new v2 engine. Callers (API routes,
// shopping list, UI) don't need to change their imports.
//
// Budget flow (v2, dinner-first):
//   calorieTarget
//     − fixedSlots (morning, preTraining, snacks, skyr)
//     = remaining
//     → dinner FIRST (coarser rounding — eggs/hack)
//     → mainMeal absorbs actual remainder (rice at 10g/36kcal absorbs error)
//     → VALIDATE: |slotSum − target| ≤ 30 kcal

import { DAY_TYPE_BY_WEEKDAY, INITIAL_TARGETS, SLOT_PRESENCE } from "./day-type";
import { findDayTypeConfig, DAY_TYPE_CONFIGS } from "./day-type-configs";
import { scaleRecipe } from "./scale-recipe";
import { findRecipeTemplate, RECIPE_TEMPLATES } from "./recipe-templates";
import type { DayTypeTargets } from "./day-type";
import type { DayType, MealItem, MealSlot, MealSlots } from "./types";
import type { ScaledRecipe, DayTypeConfig } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// §1 — Fixed slot definitions (portions never change with calorie target)
// ═══════════════════════════════════════════════════════════════════════════

const morning: MealSlot = {
  items: [
    { name: "HEJ Protein Bar", kcal: 200, protein: 20, carbs: 18, fat: 7, costEur: 1.87 },
    { name: "Whey Shake 30g + Creatine", kcal: 120, protein: 25, carbs: 2, fat: 1, costEur: 0.5 },
  ],
};

const preTraining: MealSlot = {
  items: [
    { name: "Rote Bete Saft 200ml", kcal: 80, protein: 0, carbs: 18, fat: 0, costEur: 0.5 },
    { name: "Ingwer + Honig", kcal: 70, protein: 0, carbs: 17, fat: 0, costEur: 0.3 },
    { name: "Kollagen 15g + Vitamin C", kcal: 55, protein: 14, carbs: 0, fat: 0, costEur: 0.4 },
  ],
};

const skyrDessert: MealSlot = {
  flexible: true,
  items: [{ name: "Arla Skyr Vanille 200g", kcal: 130, protein: 20, carbs: 14, fat: 0, costEur: 1.19 }],
};

const afternoonSnack: MealSlot = {
  items: [
    { name: "Karotten 200g", kcal: 70, protein: 1, carbs: 14, fat: 0, costEur: 0.4 },
    { name: "Hummus 100g (Ja!)", kcal: 200, protein: 7, carbs: 10, fat: 15, costEur: 1.0 },
  ],
};

const eveningSnack: MealSlot = {
  items: [{ name: "HEJ Protein Bar", kcal: 200, protein: 20, carbs: 18, fat: 7, costEur: 1.87 }],
};

// ═══════════════════════════════════════════════════════════════════════════
// §2 — Bridge: ScaledRecipe → MealSlot (v2 engine → v1 MealSlots shape)
// ═══════════════════════════════════════════════════════════════════════════

/** Convert a v2 ScaledRecipe to a v1 MealSlot for backward compatibility. */
function scaledRecipeToMealSlot(scaled: ScaledRecipe): MealSlot {
  const items: MealItem[] = [];

  for (const comp of scaled.components) {
    items.push({
      name: comp.name,
      kcal: comp.kcal,
      protein: Math.round(comp.protein),
      carbs: Math.round(comp.carbs),
      fat: Math.round(comp.fat),
      costEur: comp.cost,
    });
  }

  for (const sauce of scaled.sauces) {
    items.push({
      name: sauce.name,
      kcal: sauce.kcal,
      protein: sauce.protein,
      carbs: sauce.carbs,
      fat: sauce.fat,
      costEur: sauce.cost,
    });
  }

  return { recipe: scaled.recipeId, items };
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — Slot composition (v2 engine: dinner-first budget cascade)
// ═══════════════════════════════════════════════════════════════════════════

function emptySlot(): MealSlot {
  return { items: [] };
}

function sumItemsKcal(items: MealItem[]): number {
  return items.reduce((s, i) => s + i.kcal, 0);
}

/**
 * Build all 7 meal slots for a day-type using the v2 engine.
 * Variable slots (mainMeal, dinner) use DIFFERENT recipes per DayTypeConfig.
 *
 * @param dayType   — determines which fixed slots are present + which recipes
 * @param targetsOverride — custom calorie/macro targets (default: from DayTypeConfig)
 */
function buildSlots(dayType: DayType, targetsOverride?: DayTypeTargets): MealSlots {
  const presence = SLOT_PRESENCE[dayType];
  const config = findDayTypeConfig(dayType);
  const calorieTarget = targetsOverride?.calorieTarget ?? config.calorieTarget;

  // ── Step 1: Sum fixed slot kcal ──
  const fixedEntries: { slot: MealSlot; present: boolean }[] = [
    { slot: morning, present: presence.morning },
    { slot: preTraining, present: presence.preTraining },
    { slot: afternoonSnack, present: presence.afternoonSnack },
    { slot: eveningSnack, present: presence.eveningSnack },
    { slot: skyrDessert, present: presence.postMealDessert },
  ];

  let fixedKcal = 0;
  for (const { slot, present } of fixedEntries) {
    if (present) {
      fixedKcal += sumItemsKcal(slot.items);
    }
  }

  // ── Step 2: Remaining budget after fixed slots ──
  const remainingKcal = calorieTarget - fixedKcal;

  // ── Step 3: Scale dinner FIRST (coarser steps), then mainMeal absorbs remainder ──
  const dinnerTemplate = findRecipeTemplate(config.variableSlots.dinner.recipeId);
  const mainMealTemplate = findRecipeTemplate(config.variableSlots.mainMeal.recipeId);

  const dinnerBudget = Math.round(remainingKcal * config.variableSlots.dinner.budgetRatio);
  const scaledDinner = scaleRecipe(dinnerTemplate, dinnerBudget);

  const mainMealBudget = remainingKcal - scaledDinner.totals.kcal;
  const scaledMainMeal = scaleRecipe(mainMealTemplate, mainMealBudget);

  const mainMealSlot = presence.mainMeal
    ? scaledRecipeToMealSlot(scaledMainMeal)
    : emptySlot();
  const dinnerSlot = presence.dinner
    ? scaledRecipeToMealSlot(scaledDinner)
    : emptySlot();

  return {
    morning: presence.morning ? morning : emptySlot(),
    preTraining: presence.preTraining ? preTraining : emptySlot(),
    mainMeal: mainMealSlot,
    postMealDessert: presence.postMealDessert ? skyrDessert : emptySlot(),
    afternoonSnack: presence.afternoonSnack ? afternoonSnack : emptySlot(),
    dinner: dinnerSlot,
    eveningSnack: presence.eveningSnack ? eveningSnack : emptySlot(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — Public exports (same API surface as v1)
// ═══════════════════════════════════════════════════════════════════════════

/** Build slots using the day-type's default recipe (no weekday context). */
export function templateSlotsForDayType(dayType: DayType): MealSlots {
  return buildSlots(dayType);
}

/**
 * Build slots for a day-type with CUSTOM targets and the day-type's recipe
 * assignment from DayTypeConfig. Used for DB slot storage (per-dayType
 * DayPlan records) and calibration cascade.
 */
export function buildSlotsForTargets(dayType: DayType, targets: DayTypeTargets): MealSlots {
  return buildSlots(dayType, targets);
}

/**
 * Build slots for a specific weekday with CUSTOM targets. The weekday
 * determines the dayType, which determines recipes from DayTypeConfig.
 *
 * NOTE: In v2, recipes are assigned per dayType (not per weekday rotation).
 * mainMeal and dinner always use DIFFERENT recipes.
 */
export function buildSlotsForWeekday(weekday: number, targets: DayTypeTargets): MealSlots {
  const dayType = DAY_TYPE_BY_WEEKDAY[weekday] ?? "rest";
  return buildSlots(dayType, targets);
}

/**
 * Build a complete weekday → MealSlots map (7 entries, 0=Sun..6=Sat).
 * Each weekday's dayType determines recipe assignment from DayTypeConfig.
 *
 * Used by the API route + shopping list as the single source of truth.
 */
export function buildWeekdaySlotsMap(
  targetsByDayType: Partial<Record<DayType, DayTypeTargets>>,
): Record<number, MealSlots> {
  const result: Record<number, MealSlots> = {};
  for (let wd = 0; wd <= 6; wd++) {
    const dayType = DAY_TYPE_BY_WEEKDAY[wd] ?? "rest";
    const targets = targetsByDayType[dayType] ?? INITIAL_TARGETS[dayType];
    result[wd] = buildSlots(dayType, targets);
  }
  return result;
}

/** Maximum acceptable |slotSum − calorieTarget| in kcal. Tightened in v2 from 50 → 30. */
const CALORIE_TOLERANCE = 30;

export function templateDayPlan(dayType: DayType, targetsOverride?: DayTypeTargets): {
  dayType: DayType;
  slots: MealSlots;
  tdeeEstimate: number;
  calorieTarget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
} {
  const targets = targetsOverride ?? INITIAL_TARGETS[dayType];
  const slots = buildSlots(dayType, targets);

  // Architecture invariant: slot sum must track calorie target.
  const totals = sumSlotMacros(slots);
  const diff = Math.abs(totals.kcal - targets.calorieTarget);
  if (diff > CALORIE_TOLERANCE) {
    throw new Error(
      `Nutrition template invariant violated: ${dayType} slots sum to ${totals.kcal} kcal ` +
        `but calorieTarget is ${targets.calorieTarget} kcal (diff ${diff} > tolerance ${CALORIE_TOLERANCE})`,
    );
  }

  return {
    dayType,
    slots,
    ...targets,
  };
}

export function sumSlotMacros(slots: MealSlots): {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  costEur: number;
} {
  let kcal = 0,
    protein = 0,
    carbs = 0,
    fat = 0,
    costEur = 0;
  for (const slot of Object.values(slots)) {
    for (const item of slot.items) {
      kcal += item.kcal;
      protein += item.protein;
      carbs += item.carbs;
      fat += item.fat;
      costEur += item.costEur;
    }
  }
  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    costEur: Math.round(costEur * 100) / 100,
  };
}

export function sumSingleSlotMacros(slot: MealSlot): {
  kcal: number;
  protein: number;
  costEur: number;
} {
  let kcal = 0,
    protein = 0,
    costEur = 0;
  for (const item of slot.items) {
    kcal += item.kcal;
    protein += item.protein;
    costEur += item.costEur;
  }
  return { kcal: Math.round(kcal), protein: Math.round(protein), costEur: Math.round(costEur * 100) / 100 };
}

export const SLOT_LABELS: Record<keyof MealSlots, string> = {
  morning: "Morgen",
  preTraining: "Pre-Training",
  mainMeal: "Hauptmahlzeit",
  postMealDessert: "Skyr (flex)",
  afternoonSnack: "Nachmittag",
  dinner: "Abendessen",
  eveningSnack: "Abend-Snack",
};
