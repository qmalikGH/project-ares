// Recipe library — Sprint v0.16 Phase B3.
// Three rotating meal-prep recipes covering Q's full week. All cooked on
// the stovetop only (no oven), with TK vegetables for low waste & cost.
// `perServing` is the canonical macro/cost reference used by the meal-plan
// engine; `ingredients` drives the shopping list.

export interface Ingredient {
  name: string;
  // One of these will be set:
  amountG?: number;
  amountMl?: number;
  amount?: number; // unit-count (e.g. eggs)
  // Per-100g or per-unit nutritional / cost references
  kcalPer100g?: number;
  kcalPerMl?: number;
  kcalPerUnit?: number;
  proteinPer100g?: number;
  proteinPerUnit?: number;
  costEur: number;
}

export interface RecipePerServing {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  costEur: number;
}

export interface Recipe {
  key: RecipeKey;
  name: string;
  prepTimeMin: number;
  servings: number;
  ingredients: Ingredient[];
  instructions: string;
  perServing: RecipePerServing;
}

/** Legacy recipe keys for the 3 original meal-prep recipes (with full metadata). */
export type LegacyRecipeKey =
  | "chicken_rice_tkgemuse"
  | "hack_rice_tkgemuse"
  | "egg_rice_tkgemuse";

/** All valid recipe identifiers — legacy + v2 engine IDs. */
export type RecipeKey =
  | LegacyRecipeKey
  // v2 dinner recipes (no rice, lighter)
  | "egg_asia_norice"
  | "egg_brokkoli_norice"
  | "hack_brokkoli_norice"
  // v2 mainMeal recipe IDs
  | "chicken_rice_asia"
  | "hack_rice_brokkoli"
  | "egg_rice_asia";

export const RECIPES: Record<LegacyRecipeKey, Recipe> = {
  chicken_rice_tkgemuse: {
    key: "chicken_rice_tkgemuse",
    name: "Hähnchen-Reis mit TK-Gemüse",
    prepTimeMin: 20,
    servings: 3,
    ingredients: [
      { name: "Hähnchenbrust", amountG: 750, kcalPer100g: 110, proteinPer100g: 23, costEur: 6.87 },
      { name: "Langkorn Reis (trocken)", amountG: 450, kcalPer100g: 360, proteinPer100g: 7, costEur: 0.85 },
      { name: "TK Asia-Gemüse", amountG: 750, kcalPer100g: 25, proteinPer100g: 2, costEur: 1.79 },
      { name: "Rapsöl", amountMl: 15, kcalPerMl: 9, costEur: 0.10 },
      { name: "Sojasauce", amountMl: 30, kcalPerMl: 0.5, costEur: 0.15 },
    ],
    instructions:
      "Reis kochen. Hähnchen in Streifen schneiden, in Öl anbraten. TK-Gemüse dazu, 5 min braten. Sojasauce. Auf 3 Boxen verteilen.",
    perServing: { kcal: 650, protein: 50, carbs: 65, fat: 12, costEur: 3.25 },
  },

  hack_rice_tkgemuse: {
    key: "hack_rice_tkgemuse",
    name: "Hackfleisch-Reis mit TK-Brokkoli",
    prepTimeMin: 20,
    servings: 3,
    ingredients: [
      { name: "Rinderhack", amountG: 750, kcalPer100g: 210, proteinPer100g: 18, costEur: 8.58 },
      { name: "Langkorn Reis (trocken)", amountG: 450, kcalPer100g: 360, proteinPer100g: 7, costEur: 0.85 },
      { name: "TK Brokkoli", amountG: 750, kcalPer100g: 28, proteinPer100g: 3, costEur: 1.69 },
      { name: "Dose Tomaten", amountG: 400, kcalPer100g: 20, proteinPer100g: 1, costEur: 0.59 },
      { name: "Zwiebel", amountG: 100, kcalPer100g: 28, proteinPer100g: 1, costEur: 0.15 },
    ],
    instructions:
      "Reis kochen. Zwiebel anbraten, Hack krümelig braten. Dosentomaten + TK-Brokkoli dazu, 8 min köcheln. Auf 3 Boxen.",
    perServing: { kcal: 700, protein: 45, carbs: 65, fat: 18, costEur: 3.95 },
  },

  egg_rice_tkgemuse: {
    key: "egg_rice_tkgemuse",
    name: "Eier-Reis mit TK-Gemüse (Budget)",
    prepTimeMin: 15,
    servings: 1,
    ingredients: [
      { name: "Eier", amount: 4, kcalPerUnit: 78, proteinPerUnit: 6, costEur: 1.0 },
      { name: "Langkorn Reis (trocken)", amountG: 200, kcalPer100g: 360, proteinPer100g: 7, costEur: 0.38 },
      { name: "TK Gemüse", amountG: 250, kcalPer100g: 25, proteinPer100g: 2, costEur: 0.6 },
      { name: "Sojasauce", amountMl: 15, kcalPerMl: 0.5, costEur: 0.08 },
    ],
    instructions:
      "Reis kochen. TK-Gemüse in Pfanne, Eier dazu, Rührei machen. Sojasauce.",
    perServing: { kcal: 600, protein: 30, carbs: 70, fat: 15, costEur: 2.06 },
  },
};

// ── Weekly recipe assignment (B3.2) ──────────────────────────────────────
// Two cook-days per week: Sun (Mo-Mi prep), Wed (Do-Sa prep). Sunday is
// flex/fresh with eggs.
//
// Keyed by JS getUTCDay() values: 0=Sun, 1=Mon, ..., 6=Sat.
export const WEEKLY_RECIPE_BY_WEEKDAY: Record<number, LegacyRecipeKey> = {
  1: "chicken_rice_tkgemuse", // Mon (cook-day for Mo-Mi)
  2: "chicken_rice_tkgemuse", // Tue (reheat)
  3: "chicken_rice_tkgemuse", // Wed (reheat — last portion)
  4: "hack_rice_tkgemuse", // Thu (cook-day for Do-Sa)
  5: "hack_rice_tkgemuse", // Fri (reheat)
  6: "hack_rice_tkgemuse", // Sat (reheat)
  0: "egg_rice_tkgemuse", // Sun (fresh / flex)
};

export function getRecipeForDate(date: Date): Recipe {
  const key = WEEKLY_RECIPE_BY_WEEKDAY[date.getUTCDay()];
  return RECIPES[key];
}

// Cook days = the days where the user actually prepares the multi-serving
// recipes. Used by the shopping-list generator to decide trip timing.
export const COOK_DAYS_WEEKDAY = [0, 4]; // Sun, Thu (UTC weekday)
