// Canonical meal-slot templates — Sprint v0.16 Phase B7/B10, post-architecture-fix.
//
// ARCHITECTURE: calorieTarget is the SINGLE SOURCE OF TRUTH.
// Fixed slots (morning, pre-training, snacks) have hardcoded portions.
// Variable slots (mainMeal, dinner) are COMPUTED BACKWARDS from the
// remaining calorie budget after fixed slots, using protein-first logic:
//   1. Sum fixed slot kcal → remaining = calorieTarget - fixedSum - skyr
//   2. Split remaining: mainMeal 55%, dinner 45%
//   3. Protein-first: meat grams = proteinTarget / proteinPerGram
//   4. Carbs fill rest: rice grams = remainingKcal / riceKcalPerGram
//   5. Validation: assert |slotSum - calorieTarget| < 50 kcal
//
// This guarantees target and slot-sum can never diverge.

import { INITIAL_TARGETS, SLOT_PRESENCE } from "./day-type";
import type { DayTypeTargets } from "./day-type";
import type { DayType, MealItem, MealSlot, MealSlots } from "./types";

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
  items: [{ name: "Karotten + Hummus 150g", kcal: 550, protein: 12, carbs: 30, fat: 25, costEur: 2.0 }],
  alternatives: [
    {
      name: "Koro Erbsen Flips 75g",
      kcal: 600,
      protein: 20,
      carbs: 55,
      fat: 18,
      costEur: 3.0,
      maxPerWeek: 2,
    },
  ],
};

const afternoonSnackRest: MealSlot = {
  items: [{ name: "Karotten 200g", kcal: 70, protein: 1, carbs: 16, fat: 0, costEur: 0.4 }],
};

const eveningSnack: MealSlot = {
  items: [{ name: "HEJ Protein Bar", kcal: 200, protein: 20, carbs: 18, fat: 7, costEur: 1.87 }],
};

// ═══════════════════════════════════════════════════════════════════════════
// §2 — Nutritional constants for scalable ingredients
// ═══════════════════════════════════════════════════════════════════════════

/** Per-gram macros for weight-based protein sources. Derived from existing
 *  verified portions: 250g Hähnchenbrust = 275 kcal / 55g P / 3g F. */
const PROTEIN_SOURCES = {
  chicken: {
    label: "Hähnchenbrust",
    perG: { kcal: 1.1, protein: 0.22, carbs: 0, fat: 0.012, costEur: 0.0092 },
  },
  hack: {
    label: "Rinderhack",
    perG: { kcal: 2.1, protein: 0.18, carbs: 0, fat: 0.152, costEur: 0.01144 },
  },
} as const;

type ProteinSourceKey = keyof typeof PROTEIN_SOURCES;

/** Per-gram macros for rice (dry weight). 150g dry = 540 kcal / 10g P. */
const RICE_PER_G = { kcal: 3.6, protein: 0.067, carbs: 0.78, fat: 0.007, costEur: 0.002 };

// ═══════════════════════════════════════════════════════════════════════════
// §3 — Per-recipe garnish (fixed items, not scaled)
// ═══════════════════════════════════════════════════════════════════════════

type RecipeKey = "chicken_rice_tkgemuse" | "hack_rice_tkgemuse";

const GARNISH: Record<RecipeKey, { main: MealItem[]; dinner: MealItem[] }> = {
  chicken_rice_tkgemuse: {
    main: [
      { name: "TK Asia-Gemüse 250g", kcal: 60, protein: 3, carbs: 8, fat: 1, costEur: 0.6 },
      { name: "Öl + Sojasauce", kcal: 50, protein: 0, carbs: 1, fat: 5, costEur: 0.15 },
    ],
    dinner: [
      { name: "TK Asia-Gemüse 200g", kcal: 50, protein: 2, carbs: 6, fat: 1, costEur: 0.48 },
    ],
  },
  hack_rice_tkgemuse: {
    main: [
      { name: "TK Brokkoli 250g", kcal: 70, protein: 8, carbs: 8, fat: 1, costEur: 0.56 },
      { name: "Dose Tomaten 130g", kcal: 26, protein: 1, carbs: 5, fat: 0, costEur: 0.2 },
    ],
    dinner: [
      { name: "TK Brokkoli 200g", kcal: 56, protein: 6, carbs: 6, fat: 1, costEur: 0.45 },
    ],
  },
};

/** Canonical recipe per day-type. Egg recipe dropped — too kcal-dense per
 *  gram of protein for the protein-first backward computation at rest-day
 *  calorie budgets (78 kcal / 6g P per egg vs. 1.1 kcal / 0.22g P per g chicken). */
const RECIPE_BY_DAY_TYPE: Record<DayType, RecipeKey> = {
  strength_run: "chicken_rice_tkgemuse",
  threshold: "chicken_rice_tkgemuse",
  long_run: "hack_rice_tkgemuse",
  rest: "chicken_rice_tkgemuse",
};

// ═══════════════════════════════════════════════════════════════════════════
// §4 — Backward portion computation (protein-first, carbs fill remainder)
// ═══════════════════════════════════════════════════════════════════════════

/** Round to nearest `step` (e.g. 10g for practical cooking portions). */
function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function sumItemsMacros(items: MealItem[]): { kcal: number; protein: number } {
  return items.reduce(
    (s, i) => ({ kcal: s.kcal + i.kcal, protein: s.protein + i.protein }),
    { kcal: 0, protein: 0 },
  );
}

/** Build a MealItem from a protein source at a specific weight. */
function meatItem(source: ProteinSourceKey, grams: number): MealItem {
  const s = PROTEIN_SOURCES[source];
  return {
    name: `${s.label} ${grams}g`,
    kcal: Math.round(grams * s.perG.kcal),
    protein: Math.round(grams * s.perG.protein),
    carbs: Math.round(grams * s.perG.carbs),
    fat: Math.round(grams * s.perG.fat),
    costEur: Math.round(grams * s.perG.costEur * 100) / 100,
  };
}

/** Build a MealItem for dry rice at a specific weight. */
function riceItem(grams: number): MealItem {
  return {
    name: `Reis ${grams}g (trocken)`,
    kcal: Math.round(grams * RICE_PER_G.kcal),
    protein: Math.round(grams * RICE_PER_G.protein),
    carbs: Math.round(grams * RICE_PER_G.carbs),
    fat: Math.round(grams * RICE_PER_G.fat),
    costEur: Math.round(grams * RICE_PER_G.costEur * 100) / 100,
  };
}

/**
 * Compute a scalable meal (mainMeal or dinner) from a calorie + protein budget.
 *
 * Algorithm (protein-first, carbs fill remainder):
 *   1. Subtract fixed garnish kcal + protein from budget
 *   2. Compute grams of protein source to hit remaining protein target
 *   3. Remaining kcal after protein → rice grams
 *   4. Round portions to nearest 10g for practical cooking
 */
function computeScalableMeal(
  targetKcal: number,
  targetProtein: number,
  recipe: RecipeKey,
  isDinner: boolean,
): MealSlot {
  const source: ProteinSourceKey = recipe.startsWith("chicken") ? "chicken" : "hack";
  const garnish = isDinner ? GARNISH[recipe].dinner : GARNISH[recipe].main;
  const garnishTotals = sumItemsMacros(garnish);

  const availableKcal = targetKcal - garnishTotals.kcal;
  const neededProtein = Math.max(0, targetProtein - garnishTotals.protein);

  // Step 1: protein source grams — protein target drives meat quantity.
  // Cap at kcal ceiling: calorie-dense proteins (hack at 2.1 kcal/g) can
  // exceed the calorie budget before hitting the protein target. In that
  // case, prioritize calorie target — overall daily protein still lands
  // close because fixed slots contribute ~110g.
  const idealMeatG = neededProtein / PROTEIN_SOURCES[source].perG.protein;
  const maxMeatByKcal = availableKcal / PROTEIN_SOURCES[source].perG.kcal;
  const meatG = Math.max(0, roundTo(Math.min(idealMeatG, maxMeatByKcal), 10));
  const meatKcal = meatG * PROTEIN_SOURCES[source].perG.kcal;

  // Step 2: rice fills remaining kcal (carb-filler)
  const riceKcalBudget = Math.max(0, availableKcal - meatKcal);
  const riceG = Math.max(0, roundTo(riceKcalBudget / RICE_PER_G.kcal, 10));

  const items: MealItem[] = [meatItem(source, meatG)];
  if (riceG > 0) items.push(riceItem(riceG));
  items.push(...garnish);

  return { recipe, items };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 — Slot composition (calorie-target-driven)
// ═══════════════════════════════════════════════════════════════════════════

function emptySlot(): MealSlot {
  return { items: [] };
}

/** Resolve the correct afternoon snack slot for this day type. */
function resolveAfternoonSnack(dayType: DayType, present: boolean): MealSlot {
  if (!present) return emptySlot();
  return dayType === "rest" ? afternoonSnackRest : afternoonSnack;
}

/**
 * Build all 7 meal slots for a day-type. Variable slots (mainMeal, dinner)
 * are backwards-computed from the calorie target so the total always matches.
 *
 * Budget flow:
 *   calorieTarget
 *     − fixed slots (morning, preTraining, snacks, skyr)
 *     = remaining
 *     → 55% mainMeal
 *     → 45% dinner
 */
function buildSlots(dayType: DayType, targetsOverride?: DayTypeTargets): MealSlots {
  const presence = SLOT_PRESENCE[dayType];
  const targets = targetsOverride ?? INITIAL_TARGETS[dayType];
  const recipe = RECIPE_BY_DAY_TYPE[dayType];

  // ── Step 1: Sum fixed slot kcal + protein ──
  const fixedEntries: { slot: MealSlot; present: boolean }[] = [
    { slot: morning, present: presence.morning },
    { slot: preTraining, present: presence.preTraining },
    { slot: resolveAfternoonSnack(dayType, presence.afternoonSnack), present: presence.afternoonSnack },
    { slot: eveningSnack, present: presence.eveningSnack },
    { slot: skyrDessert, present: presence.postMealDessert },
  ];

  let fixedKcal = 0;
  let fixedProtein = 0;
  for (const { slot, present } of fixedEntries) {
    if (present) {
      const t = sumItemsMacros(slot.items);
      fixedKcal += t.kcal;
      fixedProtein += t.protein;
    }
  }

  // ── Step 2: Remaining budget after fixed slots ──
  const remainingKcal = targets.calorieTarget - fixedKcal;
  const remainingProtein = Math.max(0, targets.proteinG - fixedProtein);

  // ── Step 3: Split 55% mainMeal / 45% dinner ──
  const mainMealKcal = Math.round(remainingKcal * 0.55);
  const dinnerKcal = remainingKcal - mainMealKcal; // exact remainder avoids rounding drift
  const mainMealProtein = Math.round(remainingProtein * 0.55);
  const dinnerProtein = remainingProtein - mainMealProtein;

  // ── Step 4: Backward-compute variable slots ──
  const mainMealSlot = presence.mainMeal
    ? computeScalableMeal(mainMealKcal, mainMealProtein, recipe, false)
    : emptySlot();
  const dinnerSlotResult = presence.dinner
    ? computeScalableMeal(dinnerKcal, dinnerProtein, recipe, true)
    : emptySlot();

  return {
    morning: presence.morning ? morning : emptySlot(),
    preTraining: presence.preTraining ? preTraining : emptySlot(),
    mainMeal: mainMealSlot,
    postMealDessert: presence.postMealDessert ? skyrDessert : emptySlot(),
    afternoonSnack: resolveAfternoonSnack(dayType, presence.afternoonSnack),
    dinner: dinnerSlotResult,
    eveningSnack: presence.eveningSnack ? eveningSnack : emptySlot(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 — Public exports
// ═══════════════════════════════════════════════════════════════════════════

export function templateSlotsForDayType(dayType: DayType): MealSlots {
  return buildSlots(dayType);
}

/**
 * Build slots for a day-type with CUSTOM targets (e.g. from calibration).
 * Same backward-computation logic as templateSlotsForDayType, but the calorie
 * target + protein target come from the caller instead of INITIAL_TARGETS.
 *
 * This is the calibration cascade entry point: when calibrateMealPlan()
 * updates DayPlan targets from Garmin TDEE data, it calls this to rebuild
 * the meal portions so they always match the new target.
 */
export function buildSlotsForTargets(dayType: DayType, targets: DayTypeTargets): MealSlots {
  return buildSlots(dayType, targets);
}

/** Maximum acceptable |slotSum − calorieTarget| in kcal. Small rounding
 *  errors from 10g-step portion rounding are expected. */
const CALORIE_TOLERANCE = 50;

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
