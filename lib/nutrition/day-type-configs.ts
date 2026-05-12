// DayType configurations — Nutrition v2 single source of truth.
//
// This is the ONLY place where day-type properties are defined.
// INITIAL_TARGETS and SLOT_PRESENCE in day-type.ts are DERIVED from these.
// Every change cascades automatically through the system.

import type { DayTypeConfig, FixedSlotItem } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Shared fixed slot items (reused across day types)
// ═══════════════════════════════════════════════════════════════════════════

const HEJ_BAR: FixedSlotItem = {
  name: "HEJ Protein Bar", kcal: 200, protein: 13, carbs: 18, fat: 7, cost: 1.87,
};

const WHEY_CREATINE: FixedSlotItem = {
  name: "Whey Shake 30g + Creatine", kcal: 120, protein: 25, carbs: 2, fat: 1, cost: 0.5,
};

const BEET_JUICE: FixedSlotItem = {
  name: "Rote Bete Saft 200ml", kcal: 80, protein: 0, carbs: 18, fat: 0, cost: 0.5,
};

const GINGER_HONEY: FixedSlotItem = {
  name: "Ingwer + Honig", kcal: 70, protein: 0, carbs: 17, fat: 0, cost: 0.3,
};

const COLLAGEN_VITC: FixedSlotItem = {
  name: "Kollagen 15g + Vitamin C", kcal: 55, protein: 14, carbs: 0, fat: 0, cost: 0.4,
};

const CARROTS: FixedSlotItem = {
  name: "Karotten 200g", kcal: 70, protein: 1, carbs: 14, fat: 0, cost: 0.4,
};

const HUMMUS: FixedSlotItem = {
  name: "Hummus 100g (Ja!)", kcal: 200, protein: 7, carbs: 10, fat: 15, cost: 1.0,
};

const SKYR: FixedSlotItem = {
  name: "Arla Skyr Vanille 200g", kcal: 130, protein: 20, carbs: 14, fat: 0, cost: 1.19,
};

// ═══════════════════════════════════════════════════════════════════════════
// Fixed slot definitions (shared structure)
// ═══════════════════════════════════════════════════════════════════════════

const MORNING = { items: [HEJ_BAR, WHEY_CREATINE] };
const PRE_TRAINING = { items: [BEET_JUICE, GINGER_HONEY, COLLAGEN_VITC] };
const AFTERNOON_SNACK = { items: [CARROTS, HUMMUS] };
const EVENING_SNACK = { items: [HEJ_BAR] };
const FLEX_DESSERT_ON = { enabled: true, items: [SKYR] };

// ═══════════════════════════════════════════════════════════════════════════
// DayType configurations
// ═══════════════════════════════════════════════════════════════════════════

export const DAY_TYPE_CONFIGS: DayTypeConfig[] = [
  {
    dayType: "strength_run", // Mo, Do, Fr — easy AM + Kraft PM
    calorieTarget: 2853, // Intake = TDEE 3353 − 500 deficit
    macroTargets: { proteinG: 190, carbsG: 310, fatG: 70 },
    fixedSlots: {
      morning: MORNING,
      preTraining: PRE_TRAINING,
      afternoonSnack: AFTERNOON_SNACK,
      eveningSnack: EVENING_SNACK,
      flexDessert: FLEX_DESSERT_ON,
    },
    variableSlots: {
      mainMeal: { recipeId: "chicken_rice_asia", budgetRatio: 0.55 },
      dinner: { recipeId: "egg_asia_norice", budgetRatio: 0.45 },
    },
    tdeeEstimate: 3353,
    trainingWindow: "both",
    dinnerNeedsCarbs: false,
  },
  {
    dayType: "threshold", // Di — Abend-Run only
    calorieTarget: 2439, // Intake = TDEE 2939 − 500 deficit
    macroTargets: { proteinG: 190, carbsG: 280, fatG: 70 },
    fixedSlots: {
      morning: MORNING,
      preTraining: PRE_TRAINING,
      afternoonSnack: AFTERNOON_SNACK,
      eveningSnack: EVENING_SNACK,
      flexDessert: FLEX_DESSERT_ON,
    },
    variableSlots: {
      // 50:50 — dinner now has rice (egg_chicken_rice_asia) for Post-WO Carbs.
      mainMeal: { recipeId: "chicken_rice_asia", budgetRatio: 0.50 },
      dinner: { recipeId: "egg_chicken_rice_asia", budgetRatio: 0.50 },
    },
    tdeeEstimate: 2939,
    trainingWindow: "evening",
    dinnerNeedsCarbs: true,
  },
  {
    dayType: "long_run", // Sa — Abend-Run only
    calorieTarget: 2668, // Intake = TDEE 3168 − 500 deficit
    macroTargets: { proteinG: 190, carbsG: 310, fatG: 70 },
    fixedSlots: {
      morning: MORNING,
      preTraining: PRE_TRAINING,
      afternoonSnack: AFTERNOON_SNACK,
      eveningSnack: EVENING_SNACK,
      flexDessert: FLEX_DESSERT_ON,
    },
    variableSlots: {
      // 0.54/0.46 — mainMeal gets extra budget so hack reaches 225g (25g step
      // boundary), pushing day protein from 184→188g engine / 187g bridge.
      // Dinner still gets enough rice (70g = ~55g carbs) for Post-WO recovery.
      mainMeal: { recipeId: "hack_rice_brokkoli", budgetRatio: 0.54 },
      dinner: { recipeId: "egg_rice_brokkoli", budgetRatio: 0.46 },
    },
    tdeeEstimate: 3168,
    trainingWindow: "evening",
    dinnerNeedsCarbs: true,
  },
  {
    dayType: "rest", // Mi, So — kein Training
    calorieTarget: 2000, // Intake = TDEE 2500 (capped) − 500 deficit
    macroTargets: { proteinG: 190, carbsG: 180, fatG: 70 },
    fixedSlots: {
      morning: MORNING,
      preTraining: null, // no training → no pre-training slot
      afternoonSnack: AFTERNOON_SNACK,
      eveningSnack: EVENING_SNACK,
      flexDessert: FLEX_DESSERT_ON,
    },
    variableSlots: {
      // Rest day: egg_asia_norice MainMeal (KEIN REIS, Carb-Cut) +
      // chicken_rice_brokkoli Dinner (Hähnchen statt Hack, 2x Protein-Effizienz).
      // 0.48/0.52 (not 50:50) — dinner gets extra budget so chicken reaches
      // 275g (25g step boundary), pushing day protein from 180→186g (≥184g).
      mainMeal: { recipeId: "egg_asia_norice", budgetRatio: 0.48 },
      dinner: { recipeId: "chicken_rice_brokkoli", budgetRatio: 0.52 },
    },
    tdeeEstimate: 2500,
    trainingWindow: "none",
    dinnerNeedsCarbs: false,
  },
];

/** Athlete weight for protein validation (2.0 g/kg minimum). */
export const ATHLETE_WEIGHT_KG = 92;

/** Lookup a DayTypeConfig by dayType string. Throws if not found. */
export function findDayTypeConfig(dayType: string): DayTypeConfig {
  const config = DAY_TYPE_CONFIGS.find((c) => c.dayType === dayType);
  if (!config) {
    throw new Error(`DayTypeConfig not found: "${dayType}"`);
  }
  return config;
}
