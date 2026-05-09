// Canonical Block-1 meal-slot templates — Sprint v0.16 Phase B7/B10.
// Used by the seed script to populate DayPlan.slots and by the UI when no
// active MealPlan exists yet (graceful empty state).

import { INITIAL_TARGETS, SLOT_PRESENCE } from "./day-type";
import type { DayType, MealItem, MealSlot, MealSlots } from "./types";

// ── Reusable slot definitions ────────────────────────────────────────────

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

function chickenMainMeal(): MealSlot {
  return {
    recipe: "chicken_rice_tkgemuse",
    items: [
      { name: "Hähnchenbrust 250g", kcal: 275, protein: 55, carbs: 0, fat: 3, costEur: 2.3 },
      { name: "Reis 150g (trocken)", kcal: 540, protein: 10, carbs: 117, fat: 1, costEur: 0.3 },
      { name: "TK Asia-Gemüse 250g", kcal: 60, protein: 3, carbs: 8, fat: 1, costEur: 0.6 },
      { name: "Öl + Sojasauce", kcal: 50, protein: 0, carbs: 1, fat: 5, costEur: 0.15 },
    ],
  };
}

function hackMainMeal(): MealSlot {
  return {
    recipe: "hack_rice_tkgemuse",
    items: [
      { name: "Rinderhack 250g", kcal: 525, protein: 45, carbs: 0, fat: 38, costEur: 2.86 },
      { name: "Reis 150g (trocken)", kcal: 540, protein: 10, carbs: 117, fat: 1, costEur: 0.3 },
      { name: "TK Brokkoli 250g", kcal: 70, protein: 8, carbs: 8, fat: 1, costEur: 0.56 },
      { name: "Dose Tomaten 130g", kcal: 26, protein: 1, carbs: 5, fat: 0, costEur: 0.2 },
    ],
  };
}

function eggMainMeal(): MealSlot {
  return {
    recipe: "egg_rice_tkgemuse",
    items: [
      { name: "Eier 4 Stück", kcal: 312, protein: 24, carbs: 2, fat: 22, costEur: 1.0 },
      { name: "Reis 200g (trocken)", kcal: 720, protein: 14, carbs: 156, fat: 2, costEur: 0.38 },
      { name: "TK Gemüse 250g", kcal: 63, protein: 5, carbs: 8, fat: 1, costEur: 0.6 },
      { name: "Sojasauce", kcal: 8, protein: 0, carbs: 0, fat: 0, costEur: 0.08 },
    ],
  };
}

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
  // Rest day: smaller — just carrots, no hummus
  items: [{ name: "Karotten 200g", kcal: 70, protein: 1, carbs: 16, fat: 0, costEur: 0.4 }],
};

function dinnerSlot(recipe: "chicken_rice_tkgemuse" | "hack_rice_tkgemuse" | "egg_rice_tkgemuse"): MealSlot {
  // Dinner is a smaller portion of the same recipe (Pfanne).
  if (recipe === "chicken_rice_tkgemuse") {
    return {
      recipe,
      items: [
        { name: "Hähnchenbrust 200g", kcal: 220, protein: 44, carbs: 0, fat: 2, costEur: 1.84 },
        { name: "Reis 100g (trocken)", kcal: 360, protein: 7, carbs: 78, fat: 1, costEur: 0.2 },
        { name: "TK Asia-Gemüse 200g", kcal: 50, protein: 2, carbs: 6, fat: 1, costEur: 0.48 },
      ],
    };
  }
  if (recipe === "hack_rice_tkgemuse") {
    return {
      recipe,
      items: [
        { name: "Rinderhack 200g", kcal: 420, protein: 36, carbs: 0, fat: 30, costEur: 2.29 },
        { name: "Reis 100g (trocken)", kcal: 360, protein: 7, carbs: 78, fat: 1, costEur: 0.2 },
        { name: "TK Brokkoli 200g", kcal: 56, protein: 6, carbs: 6, fat: 1, costEur: 0.45 },
      ],
    };
  }
  return {
    recipe,
    items: [
      { name: "Eier 3 Stück", kcal: 234, protein: 18, carbs: 2, fat: 17, costEur: 0.75 },
      { name: "Reis 100g (trocken)", kcal: 360, protein: 7, carbs: 78, fat: 1, costEur: 0.2 },
      { name: "TK Gemüse 200g", kcal: 50, protein: 4, carbs: 6, fat: 1, costEur: 0.48 },
    ],
  };
}

const dinnerRest: MealSlot = {
  // Rest day: portion ~200 kcal smaller than training-day dinner
  recipe: "chicken_rice_tkgemuse",
  items: [
    { name: "Hähnchenbrust 150g", kcal: 165, protein: 33, carbs: 0, fat: 2, costEur: 1.38 },
    { name: "Reis 75g (trocken)", kcal: 270, protein: 5, carbs: 59, fat: 1, costEur: 0.15 },
    { name: "TK Gemüse 200g", kcal: 50, protein: 2, carbs: 6, fat: 1, costEur: 0.48 },
  ],
};

const eveningSnack: MealSlot = {
  items: [{ name: "HEJ Protein Bar", kcal: 200, protein: 20, carbs: 18, fat: 7, costEur: 1.87 }],
};

// ── Per-day-type slot composition ────────────────────────────────────────

function emptySlot(): MealSlot {
  return { items: [] };
}

function buildSlots(dayType: DayType): MealSlots {
  const presence = SLOT_PRESENCE[dayType];

  // Resolve main meal recipe per day-type (chicken Mo-Wed, hack Thu-Sat,
  // egg Sun → but we don't know the date here, only the type. For seed
  // purposes, pick the canonical recipe per day-type.)
  const mainRecipe: "chicken_rice_tkgemuse" | "hack_rice_tkgemuse" | "egg_rice_tkgemuse" =
    dayType === "rest"
      ? "egg_rice_tkgemuse"
      : dayType === "long_run"
        ? "hack_rice_tkgemuse"
        : "chicken_rice_tkgemuse";

  const mainMealSlot =
    mainRecipe === "chicken_rice_tkgemuse"
      ? chickenMainMeal()
      : mainRecipe === "hack_rice_tkgemuse"
        ? hackMainMeal()
        : eggMainMeal();

  return {
    morning: presence.morning ? morning : emptySlot(),
    preTraining: presence.preTraining ? preTraining : emptySlot(),
    mainMeal: presence.mainMeal ? mainMealSlot : emptySlot(),
    postMealDessert: presence.postMealDessert ? skyrDessert : emptySlot(),
    afternoonSnack: presence.afternoonSnack
      ? dayType === "rest"
        ? afternoonSnackRest
        : afternoonSnack
      : emptySlot(),
    dinner: presence.dinner ? (dayType === "rest" ? dinnerRest : dinnerSlot(mainRecipe)) : emptySlot(),
    eveningSnack: presence.eveningSnack ? eveningSnack : emptySlot(),
  };
}

// ── Public helpers ────────────────────────────────────────────────────────

export function templateSlotsForDayType(dayType: DayType): MealSlots {
  return buildSlots(dayType);
}

export function templateDayPlan(dayType: DayType): {
  dayType: DayType;
  slots: MealSlots;
  tdeeEstimate: number;
  calorieTarget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
} {
  const targets = INITIAL_TARGETS[dayType];
  return {
    dayType,
    slots: buildSlots(dayType),
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
