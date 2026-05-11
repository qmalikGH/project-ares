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
  name: "HEJ Protein Bar", kcal: 200, protein: 20, carbs: 18, fat: 7, cost: 1.87,
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
    dayType: "strength_run", // Mo, Do, Fr
    calorieTarget: 2500,
    macroTargets: { proteinG: 190, carbsG: 278, fatG: 70 },
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
  },
  {
    dayType: "threshold", // Di
    calorieTarget: 2939,
    macroTargets: { proteinG: 190, carbsG: 350, fatG: 70 },
    fixedSlots: {
      morning: MORNING,
      preTraining: PRE_TRAINING,
      afternoonSnack: AFTERNOON_SNACK,
      eveningSnack: EVENING_SNACK,
      flexDessert: FLEX_DESSERT_ON,
    },
    variableSlots: {
      // Higher mainMeal ratio: egg-only dinner caps at ~676 kcal (8 eggs),
      // so extra budget goes to mainMeal where rice absorbs the kcal.
      mainMeal: { recipeId: "chicken_rice_asia", budgetRatio: 0.65 },
      dinner: { recipeId: "egg_asia_norice", budgetRatio: 0.35 },
    },
  },
  {
    dayType: "long_run", // Sa
    calorieTarget: 3168,
    macroTargets: { proteinG: 190, carbsG: 380, fatG: 70 },
    fixedSlots: {
      morning: MORNING,
      preTraining: PRE_TRAINING,
      afternoonSnack: AFTERNOON_SNACK,
      eveningSnack: EVENING_SNACK,
      flexDessert: FLEX_DESSERT_ON,
    },
    variableSlots: {
      // Higher mainMeal ratio: egg-only dinner caps at ~676 kcal.
      mainMeal: { recipeId: "hack_rice_brokkoli", budgetRatio: 0.65 },
      dinner: { recipeId: "egg_brokkoli_norice", budgetRatio: 0.35 },
    },
  },
  {
    dayType: "rest", // Mi, So
    calorieTarget: 2400,
    macroTargets: { proteinG: 190, carbsG: 220, fatG: 70 },
    fixedSlots: {
      morning: MORNING,
      preTraining: null, // no training → no pre-training slot
      afternoonSnack: AFTERNOON_SNACK,
      eveningSnack: EVENING_SNACK,
      flexDessert: FLEX_DESSERT_ON,
    },
    variableSlots: {
      // Rest day: egg mainMeal (with rice) + hack dinner (no rice).
      // 58:42 ratio keeps hack dinner well within protein budget.
      mainMeal: { recipeId: "egg_rice_asia", budgetRatio: 0.58 },
      dinner: { recipeId: "hack_brokkoli_norice", budgetRatio: 0.42 },
    },
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
